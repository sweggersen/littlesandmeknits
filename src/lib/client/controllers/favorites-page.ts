// Favorites page button: toggles favourite via /api/favorites/toggle.
// On un-favourite we DON'T yank the card out — that made the grid reflow under
// the user's cursor. Instead we just mark the card (dimmed + empty heart); it's
// gone on the next page load, since the page query only returns current
// favourites. Re-clicking restores it. Distinct from the global FavScript and
// the listing-detail variant.
//
// Needs bindOnce for the same reason as fav-script: registerController re-runs
// init() on every astro:page-load, so without a per-element guard the listener
// stacked and one click fired multiple toggles.

import { bindOnce } from '../dom';

export function init(): void {
  document.querySelectorAll('[data-fav-btn]').forEach((btn) => {
    if (!bindOnce('favorites-page', btn)) return;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = btn as HTMLElement;
      if (el.dataset.favBusy) return;
      el.dataset.favBusy = '1';
      let res: Response;
      try {
        const body = new FormData();
        body.set('item_type', el.dataset.favType!);
        body.set('item_id', el.dataset.favBtn!);
        res = await fetch('/api/favorites/toggle', { method: 'POST', body, credentials: 'same-origin' });
      } finally {
        delete el.dataset.favBusy;
      }
      if (!res.ok) return;
      const { favorited } = await res.json();

      // Reflect the heart state in place (no layout change).
      const svg = btn.querySelector('svg');
      if (svg) svg.setAttribute('fill', favorited ? 'currentColor' : 'none');
      el.setAttribute('aria-pressed', favorited ? 'true' : 'false');
      el.setAttribute('aria-label', favorited ? 'Fjern fra favoritter' : 'Lagre som favoritt');
      if (favorited) {
        el.classList.remove('text-charcoal/30');
        el.style.color = 'var(--color-primary)';
      } else {
        el.classList.add('text-charcoal/30');
        el.style.color = '';
      }

      // Dim the card to show it's pending removal, but keep it in place until
      // the next reload so the grid doesn't reshuffle mid-interaction.
      const li = btn.closest('li');
      if (li) li.classList.toggle('opacity-40', !favorited);
    });
  });
}
