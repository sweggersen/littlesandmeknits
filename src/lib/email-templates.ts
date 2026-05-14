import type { NotificationType } from './notify';

function wrap(body: string): string {
  return `<!DOCTYPE html>
<html lang="nb">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#FAF6F1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
<p style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#7A8B6F;margin:0 0 24px">Strikketorget</p>
${body}
<p style="margin:32px 0 0;font-size:12px;color:#999">Du mottar denne e-posten fordi du har en konto på Strikketorget. <a href="{{siteUrl}}/innstillinger" style="color:#999">Endre varslingsinnstillinger</a></p>
</div>
</body>
</html>`;
}

function btn(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:#3C3C3C;color:#FAF6F1;padding:12px 24px;border-radius:999px;text-decoration:none;font-size:14px;font-weight:500">${label}</a></p>`;
}

function generic(p: { title: string; body?: string; url?: string; siteUrl: string }): { subject: string; html: string } {
  return {
    subject: p.title,
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:#555;line-height:1.5">${p.body ?? ''}</p>${p.url ? btn(p.siteUrl + p.url, 'Se mer') : ''}`),
  };
}

const templates: Partial<Record<NotificationType, (p: { title: string; body?: string; url?: string; siteUrl: string }) => { subject: string; html: string }>> = {
  new_offer: (p) => ({
    subject: 'Nytt tilbud på oppdraget ditt',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:#555;line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Se tilbudet')}`),
  }),
  offer_accepted: (p) => ({
    subject: 'Tilbudet ditt ble akseptert!',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:#555;line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Se oppdraget')}`),
  }),
  offer_declined: (p) => ({
    subject: 'Oppdatering på tilbudet ditt',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:#555;line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + '/marked/oppdrag', 'Se andre oppdrag')}`),
  }),
  payment_received: (p) => ({
    subject: 'Betaling mottatt',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:#555;line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Se oppdraget')}`),
  }),
  project_update: (p) => ({
    subject: 'Ny oppdatering på prosjektet',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:#555;line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Se oppdateringen')}`),
  }),
  new_message: (p) => ({
    subject: 'Ny melding på Strikketorget',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:#555;line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Svar på meldingen')}`),
  }),
  yarn_shipped: (p) => ({
    subject: 'Garnet er sendt!',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:#555;line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Se oppdraget')}`),
  }),
  yarn_received: (p) => ({
    subject: 'Garnet er mottatt',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:#555;line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Se oppdraget')}`),
  }),
  commission_completed: (p) => ({
    subject: 'Oppdraget er ferdigstrikket!',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:#555;line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Bekreft mottak')}`),
  }),
  commission_delivered: (p) => ({
    subject: 'Levering bekreftet',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:#555;line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + (p.url ?? ''), 'Se oppdraget')}`),
  }),
  request_expired: (p) => ({
    subject: 'Forespørselen har utløpt',
    html: wrap(`<h2 style="font-size:20px;margin:0 0 12px">${p.title}</h2><p style="font-size:15px;color:#555;line-height:1.5">${p.body ?? ''}</p>${btn(p.siteUrl + '/marked/oppdrag', 'Se oppdrag')}`),
  }),
};

export function renderEmail(
  type: NotificationType,
  opts: { title: string; body?: string; url?: string; siteUrl: string },
): { subject: string; html: string } {
  const fn = templates[type] ?? generic;
  const result = fn(opts);
  result.html = result.html.replaceAll('{{siteUrl}}', opts.siteUrl);
  return result;
}
