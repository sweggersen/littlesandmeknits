// Favorites page button: toggles favourite via /api/favorites/toggle
// and on un-favorite animates the row out and removes it.
// Distinct from the global FavScript (which only toggles state) and
// the listing-detail variant (which carries its own internal state
// attr). Extracted from market/favorites.astro inline script.

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
