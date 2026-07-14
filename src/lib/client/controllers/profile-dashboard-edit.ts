// Editable profile dashboard: "Rediger" toggles an inline layout editor where
// each widget can be dragged to reorder, resized S/M/L (a segmented control),
// and removed. Removed panels drop into a palette below the grid so they can be
// added back. The layout (which panels + order + sizes) is persisted per user to
// the dashboard_layouts table (via /api/dashboard/layout) so it syncs across
// devices, with a localStorage mirror for instant apply on the next load.
// "Tilbakestill" clears both back to the server default.

const SIZE_SPAN: Record<string, string> = { s: 'md:col-span-2', m: 'md:col-span-4', l: 'md:col-span-6' };
const SIZES = ['s', 'm', 'l'];
const CONTEXT = 'profile';

interface LayoutItem { widget: string; size: string; }

export function init(): void {
  const gridEl = document.querySelector<HTMLElement>('#dashgrid');
  if (!gridEl || gridEl.dataset.dashInit === '1') return;
  gridEl.dataset.dashInit = '1';
  const grid: HTMLElement = gridEl; // non-null for the nested closures below

  const key = `lm-dash-${grid.dataset.user || 'anon'}`;
  const allWidgets = () => [...grid.querySelectorAll<HTMLElement>('.dash-widget')];
  const liveWidgets = () => [...grid.querySelectorAll<HTMLElement>('.dash-widget:not(.dash-removed)')];

  const setSize = (w: HTMLElement, size: string) => {
    for (const s of SIZES) w.classList.remove(SIZE_SPAN[s]);
    w.classList.add(SIZE_SPAN[size] ?? SIZE_SPAN.m);
    w.dataset.size = size;
    // Reflect on the segmented control if it's mounted.
    w.querySelectorAll<HTMLElement>('.dash-sizes .dash-size').forEach((b) =>
      b.classList.toggle('is-active', b.dataset.size === size));
  };
  const setRemoved = (w: HTMLElement, removed: boolean) => w.classList.toggle('dash-removed', removed);

  const currentLayout = (): LayoutItem[] =>
    liveWidgets().map((w) => ({ widget: w.dataset.widget ?? '', size: w.dataset.size ?? 'm' }));
  const defaultLayout = (): LayoutItem[] =>
    allWidgets()
      .filter((w) => w.dataset.default === '1')
      .map((w) => ({ widget: w.dataset.widget ?? '', size: w.dataset.size ?? 'm' }));

  // Show exactly the widgets in `layout` (in that order + size); everything else
  // is removed into the palette. Handles panels added in code later: a saved
  // layout that predates them simply omits them, so they start in the palette.
  const applyLayout = (layout: LayoutItem[]) => {
    const byKey = new Map(allWidgets().map((w) => [w.dataset.widget ?? '', w]));
    const listed = new Set<string>();
    for (const item of layout) {
      const w = byKey.get(item.widget);
      if (!w) continue;
      setRemoved(w, false);
      setSize(w, item.size);
      grid.appendChild(w); // move into saved order
      listed.add(item.widget);
    }
    for (const [k, w] of byKey) if (!listed.has(k)) setRemoved(w, true);
  };

  // Apply the saved layout on load. Server row (data-saved-layout) is
  // authoritative — it syncs across devices; localStorage is a fallback; and a
  // brand-new user falls back to the code-defined default set.
  try {
    let layout: LayoutItem[] | null = null;
    const server = grid.dataset.savedLayout;
    if (server) {
      const parsed = JSON.parse(server) as LayoutItem[];
      if (Array.isArray(parsed) && parsed.length) layout = parsed;
    }
    if (!layout) {
      const raw = localStorage.getItem(key);
      if (raw) { const p = JSON.parse(raw) as LayoutItem[]; if (Array.isArray(p) && p.length) layout = p; }
    }
    applyLayout(layout ?? defaultLayout());
    try { localStorage.setItem(key, JSON.stringify(currentLayout())); } catch { /* quota */ }
  } catch { applyLayout(defaultLayout()); }

  const persist = (layout: LayoutItem[]) => {
    void fetch('/api/dashboard/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: CONTEXT, layout }),
    }).catch(() => { /* offline / transient — localStorage still holds it */ });
  };

  // --- edit chrome --------------------------------------------------------
  const viewActions = document.querySelector<HTMLElement>('[data-view-actions]');
  const editActions = document.querySelector<HTMLElement>('[data-edit-actions]');
  const hint = document.querySelector<HTMLElement>('[data-edit-hint]');
  const paletteList = document.querySelector<HTMLElement>('[data-dash-palette-list]');
  const paletteEmpty = document.querySelector<HTMLElement>('[data-dash-palette-empty]');
  let snapshot: LayoutItem[] | null = null;

  const grip = '<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></svg>';

  function addToolsTo(w: HTMLElement) {
    if (w.querySelector('.dash-tools')) return;
    const size = w.dataset.size ?? 'm';
    const bar = document.createElement('div');
    bar.className = 'dash-tools';
    const sizeBtns = SIZES.map((s) =>
      `<button type="button" class="dash-size${s === size ? ' is-active' : ''}" data-size="${s}" title="Størrelse ${s.toUpperCase()}">${s.toUpperCase()}</button>`,
    ).join('');
    bar.innerHTML =
      `<span class="dash-grip" title="Dra for å flytte">${grip}</span>` +
      `<span class="dash-sizes">${sizeBtns}</span>` +
      `<button type="button" class="dash-remove" title="Fjern panel" aria-label="Fjern panel">×</button>`;
    w.appendChild(bar);
    bar.querySelectorAll<HTMLElement>('.dash-size').forEach((btn) =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); setSize(w, btn.dataset.size ?? 'm'); }));
    bar.querySelector('.dash-remove')!.addEventListener('click', (e) => {
      e.stopPropagation();
      setRemoved(w, true);
      makeDraggable(w, false);
      rebuildPalette();
    });
  }
  const addTools = () => liveWidgets().forEach(addToolsTo);
  const removeTools = () => grid.querySelectorAll('.dash-tools').forEach((el) => el.remove());

  function rebuildPalette() {
    if (!paletteList) return;
    const removed = allWidgets().filter((w) => w.classList.contains('dash-removed'));
    paletteList.innerHTML = '';
    for (const w of removed) {
      const k = w.dataset.widget ?? '';
      const label = w.dataset.label ?? k;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'dash-add';
      chip.dataset.add = k;
      chip.innerHTML = `<span class="dash-add-plus">+</span>${label}`;
      chip.addEventListener('click', () => addWidget(k));
      paletteList.appendChild(chip);
    }
    if (paletteEmpty) paletteEmpty.style.display = removed.length ? 'none' : '';
  }
  function addWidget(k: string) {
    const w = allWidgets().find((x) => x.dataset.widget === k);
    if (!w) return;
    setRemoved(w, false);
    grid.appendChild(w); // re-added panels go to the end
    addToolsTo(w);
    makeDraggable(w, true);
    rebuildPalette();
  }

  // --- drag + drop --------------------------------------------------------
  const makeDraggable = (w: HTMLElement, on: boolean) => {
    if (on) w.setAttribute('draggable', 'true');
    else w.removeAttribute('draggable');
  };
  grid.addEventListener('dragstart', (e) => {
    const w = (e.target as HTMLElement)?.closest?.('.dash-widget');
    if (w && document.body.classList.contains('dash-editing')) w.classList.add('dash-dragging');
  });
  grid.addEventListener('dragend', (e) => {
    (e.target as HTMLElement)?.closest?.('.dash-widget')?.classList.remove('dash-dragging');
  });
  function onDragOver(e: DragEvent) {
    e.preventDefault();
    const dragging = grid.querySelector<HTMLElement>('.dash-dragging');
    if (!dragging) return;
    let target: HTMLElement | null = null;
    let best = Infinity;
    for (const el of grid.querySelectorAll<HTMLElement>('.dash-widget:not(.dash-dragging):not(.dash-removed)')) {
      const b = el.getBoundingClientRect();
      const d = Math.hypot(b.left + b.width / 2 - e.clientX, b.top + b.height / 2 - e.clientY);
      if (d < best) { best = d; target = el; }
    }
    if (!target) return;
    const b = target.getBoundingClientRect();
    const before = e.clientY < b.top + b.height / 2
      || (e.clientX < b.left + b.width / 2 && Math.abs(e.clientY - (b.top + b.height / 2)) < b.height / 2);
    grid.insertBefore(dragging, before ? target : target.nextSibling);
  }
  const bindDnD = () => { liveWidgets().forEach((w) => makeDraggable(w, true)); grid.addEventListener('dragover', onDragOver); };
  const unbindDnD = () => { allWidgets().forEach((w) => makeDraggable(w, false)); grid.removeEventListener('dragover', onDragOver); };

  // --- enter / exit -------------------------------------------------------
  function enterEdit() {
    snapshot = currentLayout();
    document.body.classList.add('dash-editing');
    viewActions?.classList.add('hidden');
    editActions?.classList.remove('hidden');
    editActions?.classList.add('flex');
    hint?.classList.remove('hidden');
    addTools();
    rebuildPalette();
    bindDnD();
  }
  function exitEdit(save: boolean) {
    if (save) {
      const layout = currentLayout();
      try { localStorage.setItem(key, JSON.stringify(layout)); } catch { /* quota */ }
      persist(layout); // sync to dashboard_layouts so it crosses devices
    } else if (snapshot) applyLayout(snapshot);
    document.body.classList.remove('dash-editing');
    editActions?.classList.add('hidden');
    editActions?.classList.remove('flex');
    viewActions?.classList.remove('hidden');
    hint?.classList.add('hidden');
    removeTools();
    unbindDnD();
  }

  document.querySelector('[data-edit-toggle]')?.addEventListener('click', enterEdit);
  document.querySelector('[data-edit-save]')?.addEventListener('click', () => exitEdit(true));
  document.querySelector('[data-edit-cancel]')?.addEventListener('click', () => exitEdit(false));
  document.querySelector('[data-edit-reset]')?.addEventListener('click', () => {
    try { localStorage.removeItem(key); } catch { /* */ }
    // Clear the server row too, then reload to the server default.
    fetch('/api/dashboard/layout', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: CONTEXT }),
    }).catch(() => { /* offline — localStorage cleared, will drift until next save */ })
      .finally(() => location.reload());
  });
}
