// brukt/nytt directory header: toggles the filter panel and auto-applies a sort
// change. Sort stays visible beside the title; the filter fields hide behind the
// Filter button until opened (or when filters are already active).
//
// registerController re-runs init() on every astro:page-load; bindOnce anchors
// the listeners once per instance so a view-transition can't stack them.

import { bindOnce } from '../dom';

export function init(): void {
  const toggle = document.querySelector('[data-toggle-filter]');
  if (toggle && bindOnce('listing-dir-toggle', toggle)) {
    const panel = document.querySelector('[data-filter-panel]');
    toggle.addEventListener('click', () => panel?.classList.toggle('hidden'));
  }

  const sort = document.querySelector('[data-listing-sort]') as HTMLSelectElement | null;
  if (sort && bindOnce('listing-dir-sort', sort)) {
    // A new sort starts a fresh page (the form carries no cursor).
    sort.addEventListener('change', () => sort.form?.requestSubmit());
  }
}
