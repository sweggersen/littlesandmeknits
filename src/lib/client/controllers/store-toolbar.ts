// Store directory toolbar: reveals the filter panel on demand and auto-applies
// a sort change. Sort stays visible; the By/Vurdering/aktive fields hide behind
// the Filter button until opened (or when filters are already active).
//
// registerController re-runs init() on every astro:page-load; bindOnce anchors
// the listeners once per instance so a view-transition can't stack them.

import { bindOnce } from '../dom';

export function init(): void {
  const toggle = document.querySelector('[data-toggle-store-filter]');
  if (toggle && bindOnce('store-toolbar-toggle', toggle)) {
    const panel = document.querySelector('[data-store-filter-panel]');
    toggle.addEventListener('click', () => panel?.classList.toggle('hidden'));
  }

  const sort = document.querySelector('[data-store-sort]') as HTMLSelectElement | null;
  if (sort && bindOnce('store-toolbar-sort', sort)) {
    // Applying a new sort starts a fresh page (no cursor in the form).
    sort.addEventListener('change', () => sort.form?.requestSubmit());
  }
}
