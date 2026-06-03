// Favorites page button: toggles favourite via /api/favorites/toggle
// and on un-favorite animates the row out and removes it.
// Distinct from the global FavScript (which only toggles state) and
// the listing-detail variant (which carries its own internal state
// attr). Extracted from market/favorites.astro inline script.
//
// Needs bindOnce for the same reason as fav-script: registerController re-runs
// init() on every astro:page-load, so without a per-element guard the listener
// stacked and one click fired multiple toggles — on this page the un-favorite
// branch removes the row, so a stray extra toggle could yank a row the user
// didn't mean to remove.

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
      if (!favorited) {
        const li = btn.closest('li');
        if (li) {
          (li as HTMLElement).style.transition = 'opacity 0.2s, transform 0.2s';
          (li as HTMLElement).style.opacity = '0';
          (li as HTMLElement).style.transform = 'scale(0.95)';
          setTimeout(() => li.remove(), 200);
        }
      }
    });
  });
}
