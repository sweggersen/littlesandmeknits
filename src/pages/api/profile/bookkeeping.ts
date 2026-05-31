import type { APIRoute } from 'astro';
import { buildServiceContext } from '../../../lib/services/context';
import { getBookkeeping } from '../../../lib/services/profile';

// Seller bookkeeping export. CSV with one row per completed transaction:
//   date, type, item_id, title, gross_nok, platform_fee_nok, net_nok, channel, status
// Includes both completed sales (status = sold) and commissions delivered.
// Default range: last 90 days; ?from=YYYY-MM-DD&to=YYYY-MM-DD overrides.
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const ctx = await buildServiceContext(request, cookies);
  if (!ctx) return new Response('Not signed in', { status: 401 });

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 90 * 86400_000);
  const fromIso = url.searchParams.get('from') ?? defaultFrom.toISOString().slice(0, 10);
  const toIso = url.searchParams.get('to') ?? now.toISOString().slice(0, 10);

  const result = await getBookkeeping(ctx, { fromIso, toIso });
  if (!result.ok) return new Response(result.message, { status: 500 });
  const { rows, totals } = result.data;

  const esc = (v: string | number): string => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['Dato', 'Type', 'Vare-ID', 'Tittel', 'Brutto NOK', 'Gebyr NOK', 'Netto NOK', 'Kanal', 'Status'].join(';');
  const body = rows.map((r) => [r.date, r.type, r.item_id, r.title, r.gross_nok, r.fee_nok, r.net_nok, r.channel, r.status].map(esc).join(';')).join('\n');
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
