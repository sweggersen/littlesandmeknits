// Shared directory-header behaviour for all four marketplace grids (butikker,
// brukt, nytt, oppdrag): the Filter button reveals the filter panel, and a sort
// change auto-submits the surrounding GET form. Sort stays visible beside the
// title; the filter fields hide behind the Filter button until opened (or when
// filters are already active).
//
// registerController re-runs init() on every astro:page-load; bindOnce anchors
// the listeners once per instance so a view-transition can't stack them.

import { bindOnce } from '../dom';

export function init(): void {
  const toggle = document.querySelector('[data-toggle-directory-filter]');
  if (toggle && bindOnce('directory-toggle', toggle)) {
    const panel = document.querySelector('[data-directory-filter-panel]');
    toggle.addEventListener('click', () => panel?.classList.toggle('hidden'));
  }

  const sort = document.querySelector('[data-directory-sort]') as HTMLSelectElement | null;
  if (sort && bindOnce('directory-sort', sort)) {
    // A new sort starts a fresh page (the form carries no cursor).
    sort.addEventListener('change', () => sort.form?.requestSubmit());
  }
}
