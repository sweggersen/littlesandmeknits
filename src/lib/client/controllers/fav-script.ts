// Card-grid favourite toggle. The button carries the listing id in
// data-fav-btn="<id>" and the item type in data-fav-type. Distinct
// from listing-fav-toggle (which is a single button with internal
// state on the listing detail page) and favorites-page (which also
// animates the row away on un-favorite).
//
// Extracted from src/components/FavScript.astro inline script as
// part of refactor item 9.

export function init(): void {
  document.querySelectorAll('[data-fav-btn]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = btn as HTMLElement;
      const body = new FormData();
      body.set('item_type', el.dataset.favType!);
      body.set('item_id', el.dataset.favBtn!);
      const res = await fetch('/api/favorites/toggle', { method: 'POST', body, credentials: 'same-origin' });
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
