import type { APIRoute } from 'astro';
import { createAdminSupabase } from '../../../lib/supabase';
import { getCurrentUser } from '../../../lib/auth';
import { env } from 'cloudflare:workers';

// Seller bookkeeping export. CSV with one row per completed transaction:
//   date, type, item_id, title, gross_nok, platform_fee_nok, net_nok, channel, status
// Includes both completed sales (status = sold) and commissions delivered.
// Default range: last 90 days; ?from=YYYY-MM-DD&to=YYYY-MM-DD overrides.
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const user = await getCurrentUser({ request, cookies });
  if (!user) return new Response('Not signed in', { status: 401 });

  const admin = createAdminSupabase(env.SUPABASE_SERVICE_ROLE_KEY);

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 90 * 86400_000);
  const fromIso = url.searchParams.get('from') ?? defaultFrom.toISOString().slice(0, 10);
  const toIso = url.searchParams.get('to') ?? now.toISOString().slice(0, 10);

  // Listings sold by this user.
  const { data: soldListings } = await admin
    .from('listings')
    .select('id, title, price_nok, platform_fee_nok, sold_at, status, kind, store_id')
    .eq('seller_id', user.id)
    .in('status', ['sold', 'delivered'])
    .gte('sold_at', fromIso)
    .lte('sold_at', toIso + 'T23:59:59.999Z')
    .order('sold_at', { ascending: true });

  // Commissions completed by this user as knitter.
  const { data: knitterOffers } = await admin
    .from('commission_offers')
    .select('id, price_nok, request_id, status, accepted_at, knitter_id, commission_requests!commission_offers_request_id_fkey(id, title, delivered_at, status, platform_fee_nok)')
    .eq('knitter_id', user.id)
    .eq('status', 'accepted');

  const rows: Array<{ date: string; type: string; item_id: string; title: string; gross_nok: number; fee_nok: number; net_nok: number; channel: string; status: string }> = [];

  for (const l of soldListings ?? []) {
    const fee = l.platform_fee_nok ?? 0;
    rows.push({
      date: (l.sold_at ?? '').slice(0, 10),
      type: l.kind === 'pre_loved' ? 'brukt' : 'nytt',
      item_id: l.id,
      title: l.title,
      gross_nok: l.price_nok,
      fee_nok: fee,
      net_nok: l.price_nok - fee,
      channel: l.store_id ? 'butikk' : 'privatsalg',
      status: l.status,
    });
  }

  for (const o of (knitterOffers ?? []) as any[]) {
    const req = o.commission_requests;
    if (!req || !req.delivered_at) continue;
    const d = req.delivered_at as string;
    if (d.slice(0, 10) < fromIso || d.slice(0, 10) > toIso) continue;
    const fee = req.platform_fee_nok ?? 0;
    rows.push({
      date: d.slice(0, 10),
      type: 'oppdrag',
      item_id: req.id,
      title: req.title,
      gross_nok: o.price_nok,
      fee_nok: fee,
      net_nok: o.price_nok - fee,
      channel: 'oppdrag',
      status: req.status,
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date));

  // Totals row at the bottom.
  const totals = rows.reduce(
    (acc, r) => ({ gross: acc.gross + r.gross_nok, fee: acc.fee + r.fee_nok, net: acc.net + r.net_nok }),
    { gross: 0, fee: 0, net: 0 },
  );

  const esc = (v: string | number): string => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = ['Dato', 'Type', 'Vare-ID', 'Tittel', 'Brutto NOK', 'Gebyr NOK', 'Netto NOK', 'Kanal', 'Status'].join(';');
  const body = rows.map(r => [r.date, r.type, r.item_id, r.title, r.gross_nok, r.fee_nok, r.net_nok, r.channel, r.status].map(esc).join(';')).join('\n');
  const sumLine = ['', '', '', 'SUM', totals.gross, totals.fee, totals.net, '', ''].map(esc).join(';');

  // BOM for Excel + nb-NO friendly format.
  const csv = '﻿' + [header, body, sumLine].filter(Boolean).join('\n');

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bokforing-${fromIso}-${toIso}.csv"`,
    },
  });
};
