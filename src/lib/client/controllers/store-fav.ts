// Store-card favourite toggle. The heart button carries the store id in
// data-store-fav="<id>". Mirrors fav-script.ts (listing cards) but posts to
// /api/stores/favorite and keys on a single store_id field.
//
// registerController re-runs init() on every astro:page-load; bindOnce attaches
// the click listener exactly once per button so a navigation can't stack it.

import { bindOnce } from '../dom';

export function init(): void {
  document.querySelectorAll('[data-store-fav]').forEach((btn) => {
    if (!bindOnce('store-fav', btn)) return;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = btn as HTMLElement;
      if (el.dataset.favBusy) return;
      el.dataset.favBusy = '1';
      let res: Response;
      try {
        const body = new FormData();
        body.set('store_id', el.dataset.storeFav!);
        res = await fetch('/api/stores/favorite', { method: 'POST', body, credentials: 'same-origin' });
      } finally {
        delete el.dataset.favBusy;
      }
      if (!res.ok) return;
      const { favorited } = await res.json();
      const svg = btn.querySelector('svg');
      if (svg) svg.setAttribute('fill', favorited ? 'currentColor' : 'none');
      el.setAttribute('aria-pressed', favorited ? 'true' : 'false');
      el.setAttribute('aria-label', favorited ? 'Fjern butikk fra favoritter' : 'Lagre butikk som favoritt');
      if (favorited) {
        el.classList.remove('text-charcoal/30');
        el.style.color = 'var(--color-primary)';
      } else {
        el.classList.add('text-charcoal/30');
        el.style.color = '';
      }
    });
  });
}
