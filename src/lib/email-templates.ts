import type { NotificationType } from './notify';

// Email clients (Gmail, Outlook, Apple Mail) cannot resolve CSS custom
// properties, so we mirror the brand palette here as literal hex codes.
// Keep these in sync with src/styles/global.css @theme — but they are
// the *only* place email templates should declare colors.
const EMAIL = {
  bg: '#FAF6F1',          // linen (page background)
  text: '#3C3C3C',         // charcoal (body copy + CTA bg)
  textBody: '#555555',     // softer paragraph text
  textSoft: '#888888',     // tertiary copy (notes, signoffs)
  textMuted: '#999999',    // footer / unsubscribe link
  brand: '#7A8B6F',        // sage-700 (Strikketorget eyebrow)
  accent: '#c2604a',       // terracotta link accent
  fontStack: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
} as const;

function wrap(body: string): string {
  return `<!DOCTYPE html>
<html lang="nb">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:${EMAIL.bg};font-family:${EMAIL.fontStack}">
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
<p style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${EMAIL.brand};margin:0 0 24px">Strikketorget</p>
${body}
<p style="margin:32px 0 0;font-size:12px;color:${EMAIL.textMuted}">Du mottar denne e-posten fordi du har en konto på Strikketorget. <a href="{{siteUrl}}/innstillinger" style="color:${EMAIL.textMuted}">Endre varslingsinnstillinger</a></p>
</div>
</body>
</html>`;
}

function btn(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:${EMAIL.text};color:${EMAIL.bg};padding:12px 24px;border-radius:999px;text-decoration:none;font-size:14px;font-weight:500">${label}</a></p>`;
}

function generic(p: { title: string; body?: string; url?: string; siteUrl: string }): { subject: string; html: string } {
  return {
    subject: p.title,
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:${EMAIL.textBody};line-height:1.5">${p.body ?? ''}</p>${p.url ? btn(p.siteUrl + p.url, 'Se mer') : ''}`),
  };
}

const templates: Partial<Record<NotificationType, (p: { title: string; body?: string; url?: string; siteUrl: string }) => { subject: string; html: string }>> = {
  new_offer: (p) => ({
    subject: 'Nytt tilbud på oppdraget ditt',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:${EMAIL.textBody};line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Se tilbudet')}`),
  }),
  offer_accepted: (p) => ({
    subject: 'Tilbudet ditt ble akseptert!',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:${EMAIL.textBody};line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Se oppdraget')}`),
  }),
  offer_declined: (p) => ({
    subject: 'Oppdatering på tilbudet ditt',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:${EMAIL.textBody};line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + '/market/commissions', 'Se andre oppdrag')}`),
  }),
  payment_received: (p) => ({
    subject: 'Betaling mottatt',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:${EMAIL.textBody};line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Se oppdraget')}`),
  }),
  project_update: (p) => ({
    subject: 'Ny oppdatering på prosjektet',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:${EMAIL.textBody};line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Se oppdateringen')}`),
  }),
  new_message: (p) => ({
    subject: 'Ny melding på Strikketorget',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:${EMAIL.textBody};line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Svar på meldingen')}`),
  }),
  yarn_shipped: (p) => ({
    subject: 'Garnet er sendt!',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:${EMAIL.textBody};line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Se oppdraget')}`),
  }),
  yarn_received: (p) => ({
    subject: 'Garnet er mottatt',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:${EMAIL.textBody};line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Se oppdraget')}`),
  }),
  commission_completed: (p) => ({
    subject: 'Oppdraget er ferdigstrikket!',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:${EMAIL.textBody};line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Bekreft mottak')}`),
  }),
  commission_delivered: (p) => ({
    subject: 'Levering bekreftet',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:${EMAIL.textBody};line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Se oppdraget')}`),
  }),
  request_expired: (p) => ({
    subject: 'Forespørselen har utløpt',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:${EMAIL.textBody};line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + '/market/commissions', 'Se oppdrag')}`),
  }),
  listing_purchased: (p) => ({
    subject: 'Varen din er solgt!',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:${EMAIL.textBody};line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Se kjøpet og send varen')}`),
  }),
  listing_shipped: (p) => ({
    subject: 'Varen er sendt!',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:${EMAIL.textBody};line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Følg sendingen')}`),
  }),
  listing_delivered: (p) => ({
    subject: 'Levering bekreftet',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:${EMAIL.textBody};line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Se annonsen')}`),
  }),
};

export function renderWelcomeEmail(opts: { name?: string | null; siteUrl: string }): { subject: string; html: string } {
  const greeting = opts.name ? `Hei ${opts.name}!` : 'Velkommen!';
  const html = wrap(`
<h2 style="font-size:22px;margin:0 0 12px">${greeting}</h2>
<p style="font-size:15px;color:${EMAIL.textBody};line-height:1.6;margin:0 0 16px">
  Så hyggelig at du fant veien til Strikketorget, et lite varmt sted for håndstrikkede plagg og oppdrag mellom strikkeglade folk i Norge.
</p>
<p style="font-size:15px;color:${EMAIL.textBody};line-height:1.6;margin:0 0 16px">
  Her er to ting å vite før du begynner:
</p>
<ul style="font-size:15px;color:${EMAIL.textBody};line-height:1.7;margin:0 0 20px;padding-left:20px">
  <li><strong>Legg ut din første annonse</strong>. Det tar et par minutter, og du kan velge mellom brukt eller nytt.</li>
  <li><strong>Trygg betaling</strong> holder pengene i sikker forvaring til varen er mottatt. Kjøper betaler en liten avgift, selger får alt utbetalt automatisk.</li>
</ul>
${btn(opts.siteUrl + '/market/listing/new', 'Legg ut første annonse')}
<p style="margin:16px 0 0;font-size:14px;color:${EMAIL.textSoft}">
  Eller <a href="${opts.siteUrl}/market" style="color:${EMAIL.accent};text-decoration:none">se hva andre legger ut</a> først.
</p>
<p style="margin:32px 0 0;font-size:13px;color:${EMAIL.textSoft};line-height:1.5">
  Har du spørsmål? Bare svar på denne e-posten. Vi leser hver eneste melding.
</p>
`);
  return { subject: 'Velkommen til Strikketorget', html: html.replaceAll('{{siteUrl}}', opts.siteUrl) };
}

export function renderDraftNudgeEmail(opts: {
  name?: string | null;
  listingTitle: string;
  listingId: string;
  siteUrl: string;
}): { subject: string; html: string } {
  const greet = opts.name ? `Hei ${opts.name}!` : 'Hei!';
  const html = wrap(`
<h2 style="font-size:22px;margin:0 0 12px">${greet}</h2>
<p style="font-size:15px;color:${EMAIL.textBody};line-height:1.6;margin:0 0 16px">
  Du startet på en annonse, <strong>«${opts.listingTitle}»</strong>, men la den ikke ut.
  Det eneste som mangler er bilder. Det tar et par minutter.
</p>
<p style="font-size:15px;color:${EMAIL.textBody};line-height:1.6;margin:0 0 20px">
  Tips: annonser med 3+ bilder får betydelig flere visninger.
</p>
${btn(opts.siteUrl + '/market/listing/' + opts.listingId + '/foto', 'Last opp bilder nå')}
<p style="margin:16px 0 0;font-size:14px;color:${EMAIL.textSoft}">
  Eller <a href="${opts.siteUrl}/market/my-listings" style="color:${EMAIL.accent};text-decoration:none">se alle utkastene dine</a>.
</p>
<p style="margin:32px 0 0;font-size:13px;color:${EMAIL.textSoft};line-height:1.5">
  Vil du heller slette utkastet? Det kan du gjøre fra annonsesiden, eller bare ignorere denne e-posten:
  utkast lagres ubegrenset.
</p>
`);
  return { subject: 'Du er nesten ferdig, bare bildene mangler', html: html.replaceAll('{{siteUrl}}', opts.siteUrl) };
}

export function renderEmail(
  type: NotificationType,
  opts: { title: string; body?: string; url?: string; siteUrl: string },
): { subject: string; html: string } {
  const fn = templates[type] ?? generic;
  const result = fn(opts);
  result.html = result.html.replaceAll('{{siteUrl}}', opts.siteUrl);
  return result;
}
