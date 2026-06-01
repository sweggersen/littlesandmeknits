// Favorite-toggle button on the listing detail page. This is the
// "single button with internal state" variant — distinct from
// ListingCard's [data-fav-btn] which carries the listing id in its
// attribute. Here the button always references the same listing and
// stores its on/off state in [data-favorited].
//
// Markup contract:
//   <button data-fav-btn data-favorited="true|false"
//           data-item-type="listing" data-item-id="...">
//     <svg data-fav-icon>...</svg>
//   </button>
//
// Extracted from market/listing/[id].astro as part of refactor item 9.

import { bindOnce } from '../dom';

export function init(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-fav-btn]').forEach((btn) => {
    // Only the listing-detail variant has the data-favorited state attribute.
    // The card variant uses FavScript.astro for its own delegated handler.
    if (!btn.hasAttribute('data-favorited')) return;
    if (!bindOnce('listing-fav-toggle', btn)) return;

    const icon = btn.querySelector('[data-fav-icon]') as SVGElement | null;

    function render() {
      const on = btn.dataset.favorited === 'true';
      icon?.setAttribute('fill', on ? 'currentColor' : 'none');
      btn.style.color = on ? 'var(--color-primary)' : '';
      btn.setAttribute('aria-label', on ? 'Fjern favoritt' : 'Legg til favoritt');
    }
    render();

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const form = new FormData();
      form.set('item_type', btn.dataset.itemType!);
      form.set('item_id', btn.dataset.itemId!);
      try {
        const res = await fetch('/api/favorites/toggle', { method: 'POST', body: form, credentials: 'same-origin' });
        if (res.ok) {
          const data = await res.json();
          btn.dataset.favorited = data.favorited ? 'true' : 'false';
          render();
        }
      } finally {
        btn.disabled = false;
      }
    });
  });
}
