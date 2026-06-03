import { describe, it, expect } from 'vitest';
import { renderWelcomeEmail, renderEmail } from './email-templates';

const SITE = 'https://strikketorget.no';

describe('renderWelcomeEmail', () => {
  it('greets by name when provided and links to first listing', () => {
    const { subject, html } = renderWelcomeEmail({ name: 'Kari', siteUrl: SITE });
    expect(subject).toBeTruthy();
    expect(html).toContain('Hei Kari!');
    expect(html).toContain(`${SITE}/market/listing/new`);
  });

  it('falls back to a generic greeting without a name', () => {
    const { html } = renderWelcomeEmail({ name: null, siteUrl: SITE });
    expect(html).toContain('Velkommen!');
  });

  it('keeps user-facing copy free of em-dashes', () => {
    const { html } = renderWelcomeEmail({ name: 'Ola', siteUrl: SITE });
    expect(html).not.toContain('—');
  });
});

describe('renderEmail (notification-typed templates)', () => {
  it('seller_activated: payout-ready subject + CTA to create a listing', () => {
    const { subject, html } = renderEmail('seller_activated', {
      title: 'Du er godkjent som selger',
      body: 'Verifiseringen er fullført.',
      siteUrl: SITE,
    });
    expect(subject).toMatch(/betalt/i);
    expect(html).toContain(`${SITE}/market/listing/new`);
    expect(html).not.toContain('—');
  });

  it('payout_failed: surfaces the failure and links to payment settings', () => {
    const { subject, html } = renderEmail('payout_failed', {
      title: 'Utbetaling feilet',
      body: 'En utbetaling gikk ikke gjennom.',
      siteUrl: SITE,
    });
    expect(subject).toMatch(/feilet/i);
    expect(html).toContain(SITE);
  });

  it('unknown/un-templated type falls back to the generic template', () => {
    const { subject, html } = renderEmail('achievement_unlocked', {
      title: 'Ny prestasjon',
      body: 'Du har låst opp noe.',
      url: '/profile',
      siteUrl: SITE,
    });
    expect(subject).toBe('Ny prestasjon'); // generic uses title as subject
    expect(html).toContain(`${SITE}/profile`);
  });
});
