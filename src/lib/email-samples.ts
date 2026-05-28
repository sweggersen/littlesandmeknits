// Sample-copy generators for each email template. Pulled out of the
// admin endpoint so it stays free of `cloudflare:workers` imports and
// can be unit-tested without a worker runtime.

import {
  renderEmail,
  renderWelcomeEmail,
  renderDraftNudgeEmail,
} from './email-templates';
import type { NotificationType } from './notify';

type SampleFn = (siteUrl: string, name?: string | null) => { subject: string; html: string };

export const EMAIL_SAMPLES: Record<string, SampleFn> = {
  welcome: (siteUrl, name) => renderWelcomeEmail({ name, siteUrl }),
  draft_nudge: (siteUrl, name) =>
    renderDraftNudgeEmail({
      name,
      listingTitle: 'Babylue rosa str. 0–3 mnd',
      listingId: '00000000-0000-0000-0000-000000000000',
      siteUrl,
    }),
  new_message: (siteUrl) => renderEmail('new_message' as NotificationType, {
    title: 'Ny melding fra Eline',
    body: 'Hei! Lurer på om dette settet kan vaskes på 30°?',
    url: '/inbox',
    siteUrl,
  }),
  new_offer: (siteUrl) => renderEmail('new_offer' as NotificationType, {
    title: 'Nytt tilbud på «Mariusgenser str. 2 år»',
    body: 'Maja har gitt deg et tilbud på 1 200 NOK med 4 ukers leveringstid.',
    url: '/market/commissions/example',
    siteUrl,
  }),
  listing_purchased: (siteUrl) => renderEmail('listing_purchased' as NotificationType, {
    title: 'Varen din er solgt!',
    body: 'Liv kjøpte «Strikket genser str 2 år» for 349 NOK. Pakk og send innen 3 virkedager.',
    url: '/market/listing/example',
    siteUrl,
  }),
  listing_shipped: (siteUrl) => renderEmail('listing_shipped' as NotificationType, {
    title: 'Varen er sendt!',
    body: 'Sporingsnummer 1234567890. Forventet levering i morgen.',
    url: '/market/listing/example',
    siteUrl,
  }),
  seller_new_listing: (siteUrl) => renderEmail('seller_new_listing' as NotificationType, {
    title: 'Eline la ut en ny annonse',
    body: '«Babylue rosa str 0-3 mnd» er nå tilgjengelig.',
    url: '/market/listing/example',
    siteUrl,
  }),
  review_received: (siteUrl) => renderEmail('review_received' as NotificationType, {
    title: 'Liv ga deg en omtale',
    body: '«Fantastisk kvalitet og kjapp levering. Vil definitivt kjøpe igjen!» ★★★★★',
    url: '/market/seller/example',
    siteUrl,
  }),
};

export const EMAIL_SAMPLE_KEYS = Object.keys(EMAIL_SAMPLES);
