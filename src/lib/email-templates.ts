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

// HTML-escape a leaf value before it goes into email markup. Notification
// title/body and welcome/draft names originate from fully user-controlled
// strings (display names, message bodies, listing titles) — without escaping,
// a user could inject <a>/<img>/<style> into a trusted transactional email
// (phishing links, tracking pixels, content spoofing). Escapes the five HTML-
// significant characters, which is also sufficient for double-quoted attribute
// values (used for hrefs in btn()).
function esc(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const DEFAULT_FOOTER = `Du mottar denne e-posten fordi du har en konto på Strikketorget. <a href="{{siteUrl}}/innstillinger" style="color:${EMAIL.textMuted}">Endre varslingsinnstillinger</a>`;

// `footer` overrides the default account-holder footer — used by the store
// invite, which can go to someone who doesn't have an account yet (so the
// "you have an account" line + settings link would be wrong).
function wrap(body: string, footer: string = DEFAULT_FOOTER): string {
  return `<!DOCTYPE html>
<html lang="nb">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:${EMAIL.bg};font-family:${EMAIL.fontStack}">
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
<p style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${EMAIL.brand};margin:0 0 24px">Strikketorget</p>
${body}
<p style="margin:32px 0 0;font-size:12px;color:${EMAIL.textMuted}">${footer}</p>
</div>
</body>
</html>`;
}

function btn(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${esc(href)}" style="display:inline-block;background:${EMAIL.text};color:${EMAIL.bg};padding:12px 24px;border-radius:999px;text-decoration:none;font-size:14px;font-weight:500">${label}</a></p>`;
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
  seller_activated: (p) => ({
    subject: 'Du er klar til å få betalt!',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:${EMAIL.textBody};line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + '/market/listing/new', 'Legg ut en annonse')}`),
  }),
  payout_failed: (p) => ({
    subject: 'Utbetaling feilet',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:${EMAIL.textBody};line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? '/market/selger/innstillinger'), 'Sjekk betalingsinnstillinger')}`),
  }),
};

export function renderWelcomeEmail(opts: { name?: string | null; siteUrl: string }): { subject: string; html: string } {
  const greeting = opts.name ? `Hei ${esc(opts.name)}!` : 'Velkommen!';
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
  const greet = opts.name ? `Hei ${esc(opts.name)}!` : 'Hei!';
  const html = wrap(`
<h2 style="font-size:22px;margin:0 0 12px">${greet}</h2>
<p style="font-size:15px;color:${EMAIL.textBody};line-height:1.6;margin:0 0 16px">
  Du startet på en annonse, <strong>«${esc(opts.listingTitle)}»</strong>, men la den ikke ut.
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

// Store invitation email — sent directly (not via createNotification) because
// the recipient may not have an account yet. Carries the tokenised accept link
// and an invite-appropriate footer. All user-controlled leaves are escaped.
export function renderStoreInviteEmail(opts: {
  storeName: string;
  inviterName: string;
  roleLabel: string;
  acceptUrl: string; // absolute URL to /invite/{token}
  expiresAt: string; // ISO date
  siteUrl: string;
}): { subject: string; html: string } {
  const store = esc(opts.storeName);
  const inviter = esc(opts.inviterName);
  const role = esc(opts.roleLabel);
  const expires = esc(new Date(opts.expiresAt).toLocaleDateString('nb-NO'));
  const footer = `Du fikk denne e-posten fordi ${inviter} inviterte deg til butikken «${store}» på Strikketorget. Kjenner du ikke avsenderen, kan du trygt ignorere den.`;
  const html = wrap(
    `<h2 style="font-size:20px;margin:0 0 12px">Du er invitert til «${store}»</h2>` +
    `<p style="font-size:15px;color:${EMAIL.textBody};line-height:1.5">${inviter} har invitert deg til å bli med i butikken «${store}» som <strong>${role}</strong> på Strikketorget.</p>` +
    btn(opts.acceptUrl, 'Godta invitasjon') +
    `<p style="margin:16px 0 0;font-size:13px;color:${EMAIL.textSoft};line-height:1.5">Invitasjonen utløper ${expires}. Du må logge inn (eller opprette en konto) med denne e-postadressen for å godta.</p>`,
    footer,
  );
  return {
    subject: `Invitasjon til «${opts.storeName}» på Strikketorget`,
    html: html.replaceAll('{{siteUrl}}', opts.siteUrl),
  };
}

export function renderEmail(
  type: NotificationType,
  opts: { title: string; body?: string; url?: string; siteUrl: string },
): { subject: string; html: string } {
  const fn = templates[type] ?? generic;
  // Escape the user-controlled leaves once, centrally, before they reach any
  // template's markup. `url` is not HTML-escaped here because it is only ever
  // placed inside an href attribute, which btn() attribute-escapes itself.
  const safe = { ...opts, title: esc(opts.title), body: esc(opts.body) };
  const result = fn(safe);
  // Subjects are plain text, never HTML-escaped. Only `generic` derives its
  // subject from the title, so restore the raw value there.
  if (result.subject === safe.title) result.subject = opts.title;
  result.html = result.html.replaceAll('{{siteUrl}}', opts.siteUrl);
  return result;
}
