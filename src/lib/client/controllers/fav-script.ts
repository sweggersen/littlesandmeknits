// Card-grid favourite toggle. The button carries the listing id in
// data-fav-btn="<id>" and the item type in data-fav-type. Distinct
// from listing-fav-toggle (which is a single button with internal
// state on the listing detail page) and favorites-page (which also
// animates the row away on un-favorite).
//
// Extracted from src/components/FavScript.astro inline script as
// part of refactor item 9.
//
// registerController re-runs init() on every astro:page-load (initial load +
// each view-transition navigation). Without a per-element guard the click
// listener stacked on every navigation, so one click fired N toggles —
// insert-then-delete netting to "un-favorited", which read as the button
// removing items / being unresponsive / favorites never persisting. bindOnce
// attaches the listener exactly once per button element.

import { bindOnce } from '../dom';

export function init(): void {
  document.querySelectorAll('[data-fav-btn]').forEach((btn) => {
    if (!bindOnce('fav-script', btn)) return;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = btn as HTMLElement;
      // Guard against a second click before the first resolves — overlapping
      // insert/delete requests would race to a nondeterministic state.
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
      const svg = btn.querySelector('svg');
      if (svg) svg.setAttribute('fill', favorited ? 'currentColor' : 'none');
      // Toggle the unfavorited utility class AND the inline color so
      // the visual state matches regardless of cascade quirks. Uses
      // the brand --color-primary token so a re-skin updates the
      // heart too.
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
