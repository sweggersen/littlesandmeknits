// Follow-a-store toggle. The button carries the store id in
// data-store-follow="<id>" and toggles its label + pressed state. Posts to
// /api/stores/follow. Mirrors store-fav.ts.
//
// registerController re-runs init() on every astro:page-load; bindOnce attaches
// the click listener exactly once per button so a navigation can't stack it.

import { bindOnce } from '../dom';

export function init(): void {
  document.querySelectorAll('[data-store-follow]').forEach((btn) => {
    if (!bindOnce('store-follow', btn)) return;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = btn as HTMLElement;
      if (el.dataset.followBusy) return;
      el.dataset.followBusy = '1';
      let res: Response;
      try {
        const body = new FormData();
        body.set('store_id', el.dataset.storeFollow!);
        res = await fetch('/api/stores/follow', { method: 'POST', body, credentials: 'same-origin' });
      } finally {
        delete el.dataset.followBusy;
      }
      if (!res.ok) return;
      const { following } = await res.json();
      el.setAttribute('aria-pressed', following ? 'true' : 'false');
      const label = el.querySelector('[data-follow-label]');
      if (label) label.textContent = following ? 'Følger' : '+ Følg butikk';
      // Filled (following) vs outline (not) — via the primary token.
      el.classList.toggle('bg-primary', following);
      el.classList.toggle('text-primary-fg', following);
      el.classList.toggle('border-charcoal', following);
    });
  });
}
