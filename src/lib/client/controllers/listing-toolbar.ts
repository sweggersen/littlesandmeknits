// Listing toolbar: search input + filter-panel toggle + grid/list
// view switcher with localStorage persistence.
// Extracted from src/components/ListingToolbar.astro.

import { bindOnce } from '../dom';

export function init(): void {
  const filterPanel = document.querySelector('[data-filter-panel]') as HTMLElement;
  const searchInput = document.querySelector('[data-search-input]') as HTMLInputElement;
  const syncQ = filterPanel?.querySelector('[data-sync-q]') as HTMLInputElement;
  // registerController re-runs init() (incl. on the initial hard load); bind
  // once per toolbar instance (anchored on the search input) so search/filter
  // toggles don't fire twice. New element after a view transition rebinds.
  if (searchInput && !bindOnce('listing-toolbar', searchInput)) return;

  document.querySelector('[data-toggle-filter]')?.addEventListener('click', () => {
    filterPanel?.classList.toggle('hidden');
  });

  function doSearch() {
    if (syncQ) syncQ.value = searchInput.value;
    if (filterPanel) {
      filterPanel.classList.remove('hidden');
      (filterPanel as HTMLFormElement).requestSubmit();
    }
  }

  document.querySelector('[data-search-submit]')?.addEventListener('click', doSearch);
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
  });

  const GRID_CLASSES = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4';
  const LIST_CLASSES = 'flex flex-col gap-2';

  function setView(mode: 'grid' | 'list') {
    const grid = document.querySelector('[data-listing-grid]') as HTMLElement;
    if (!grid) return;

    document.querySelectorAll<HTMLElement>('[data-view]').forEach((b) => {
      const active = b.dataset.view === mode;
      b.className = `p-2 rounded-lg transition-colors ${active ? 'bg-primary text-primary-fg' : 'text-charcoal/40 hover:text-charcoal'}`;
    });

    grid.className = mode === 'grid' ? GRID_CLASSES : LIST_CLASSES;

    grid.querySelectorAll<HTMLElement>('[data-listing-item]').forEach((li) => {
      const link = li.querySelector('[data-card-link]') as HTMLElement;
      const imgWrap = li.querySelector('[data-card-img-wrap]') as HTMLElement;
      const img = imgWrap?.querySelector('img, div');

      if (mode === 'list') {
        link.classList.add('flex', 'flex-row', 'items-center');
        if (imgWrap) imgWrap.className = 'w-28 h-28 flex-shrink-0';
        if (img) { img.classList.remove('aspect-square'); img.classList.add('w-28', 'h-28', 'rounded-l-2xl'); }
      } else {
        link.classList.remove('flex', 'flex-row', 'items-center');
        if (imgWrap) imgWrap.className = '';
        if (img) { img.classList.add('aspect-square'); img.classList.remove('w-28', 'h-28', 'rounded-l-2xl'); }
      }
    });

    localStorage.setItem('strikketorget-view', mode);
  }

  document.querySelectorAll<HTMLElement>('[data-view]').forEach((b) => {
    b.addEventListener('click', () => setView(b.dataset.view as 'grid' | 'list'));
  });

  const saved = localStorage.getItem('strikketorget-view') as 'grid' | 'list' | null;
  if (saved === 'list') setView('list');
}
