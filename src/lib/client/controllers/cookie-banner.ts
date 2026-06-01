// Cookie-consent banner. Shows once per browser (gated on
// localStorage), hides on click and persists the consent flag.
// Extracted from src/components/CookieBanner.astro.

import { bindOnce } from '../dom';

export function init(): void {
  const banner = document.querySelector<HTMLElement>('[data-lm-cookie]');
  const btn = document.querySelector<HTMLButtonElement>('[data-lm-cookie-ok]');
  if (!banner || !btn) return;
  let consented = false;
  try { consented = localStorage.getItem('lm-cookie-consent') === '1'; } catch {}
  if (consented) return;
  banner.hidden = false;
  if (!bindOnce('cookie-banner', btn)) return;
  btn.addEventListener('click', () => {
    try { localStorage.setItem('lm-cookie-consent', '1'); } catch {}
    banner.hidden = true;
  });
}
