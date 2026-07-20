// Editable profile dashboard: "Rediger" toggles an inline layout editor where
// each widget can be dragged to reorder, resized S/M/L (a segmented control),
// and removed. Removed panels drop into a palette below the grid so they can be
// added back. The layout (which panels + order + sizes) is persisted per user to
// the dashboard_layouts table (via /api/dashboard/layout) so it syncs across
// devices, with a localStorage mirror for instant apply on the next load.
// "Tilbakestill" clears both back to the server default.

const SIZE_SPAN: Record<string, string> = { s: 'md:col-span-2', m: 'md:col-span-4', l: 'md:col-span-6' };
const SIZES = ['s', 'm', 'l'];

interface LayoutItem { widget: string; size: string; }

export function init(): void {
  const gridEl = document.querySelector<HTMLElement>('#dashgrid');
  if (!gridEl || gridEl.dataset.dashInit === '1') return;
  gridEl.dataset.dashInit = '1';
  const grid: HTMLElement = gridEl; // non-null for the nested closures below

  // The dashboard engine serves both homes: /profile (context 'profile') and
  // /studio ('studio'). Persistence + localStorage keys are per (context, user).
  const CONTEXT = grid.dataset.context || 'profile';
  const key = `lm-dash-${CONTEXT}-${grid.dataset.user || 'anon'}`;
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

  // --- grid vs staggered (masonry) ---------------------------------------
  // Masonry packs short panels beside tall ones instead of leaving a full row
  // gap. It works by giving the grid fine 8px auto-rows and setting each panel's
  // row span from its measured content height (see the CSS). Only meaningful at
  // md+, where the S/M/L column spans apply; on mobile it's a single column.
  const modeKey = `${key}-mode`;
  const MD = () => window.matchMedia('(min-width: 768px)').matches;
  let mode: 'grid' | 'masonry' =
    grid.dataset.savedMode === 'masonry' ? 'masonry'
    : grid.dataset.savedMode === 'grid' ? 'grid'
    : (localStorage.getItem(modeKey) === 'masonry' ? 'masonry' : 'grid');

  const clearSpans = () => allWidgets().forEach((w) => { w.style.gridRowEnd = ''; });
  const relayout = () => {
    if (mode !== 'masonry' || !MD()) { clearSpans(); return; }
    const ROW = 8, GAP = 20; // GAP reserves the visual row gap (row-gap is 0 in masonry)
    for (const w of liveWidgets()) {
      const content = (w.firstElementChild as HTMLElement | null);
      const h = content ? content.getBoundingClientRect().height : w.getBoundingClientRect().height;
      w.style.gridRowEnd = `span ${Math.max(1, Math.ceil((h + GAP) / ROW))}`;
    }
  };
  function applyMode() {
    grid.classList.toggle('dash-masonry', mode === 'masonry');
    if (mode === 'masonry') relayout(); else clearSpans();
    // Highlight the active segment of the Rutenett/Stablet control.
    document.querySelectorAll<HTMLElement>('[data-set-mode]').forEach((b) =>
      b.classList.toggle('is-active', b.dataset.setMode === mode));
  }

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
    // Unlisted widgets: locked ones (stats, admin) can't be removed, so a saved
    // layout that predates them still shows them, pinned to the top; everything
    // else drops into the palette.
    const unlistedLocked: HTMLElement[] = [];
    for (const [k, w] of byKey) {
      if (listed.has(k)) continue;
      if (w.dataset.lock === '1') { setRemoved(w, false); unlistedLocked.push(w); }
      else setRemoved(w, true);
    }
    for (const w of unlistedLocked.reverse()) grid.prepend(w); // keep original order at front
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

  applyMode();
  // Re-pack after first paint + on resize + once content (images) settles.
  requestAnimationFrame(relayout);
  window.addEventListener('load', relayout);
  let resizeT: number | undefined;
  window.addEventListener('resize', () => { window.clearTimeout(resizeT); resizeT = window.setTimeout(relayout, 120); });

  const persist = (layout: LayoutItem[]) => {
    try { localStorage.setItem(modeKey, mode); } catch { /* quota */ }
    void fetch('/api/dashboard/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: CONTEXT, layout, mode }),
    }).catch(() => { /* offline / transient — localStorage still holds it */ });
  };

  // --- edit chrome --------------------------------------------------------
  const viewActions = document.querySelector<HTMLElement>('[data-view-actions]');
  const editActions = document.querySelector<HTMLElement>('[data-edit-actions]');
  const hint = document.querySelector<HTMLElement>('[data-edit-hint]');
  const paletteList = document.querySelector<HTMLElement>('[data-dash-palette-list]');
  const paletteEmpty = document.querySelector<HTMLElement>('[data-dash-palette-empty]');
  let snapshot: LayoutItem[] | null = null;
  let snapshotMode: 'grid' | 'masonry' = mode;

  const grip = '<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></svg>';

  function addToolsTo(w: HTMLElement) {
    if (w.querySelector('.dash-tools')) return;
    const size = w.dataset.size ?? 'm';
    const locked = w.dataset.lock === '1';
    const bar = document.createElement('div');
    bar.className = 'dash-tools';
    const sizeBtns = SIZES.map((s) =>
      `<button type="button" class="dash-size${s === size ? ' is-active' : ''}" data-size="${s}" title="Størrelse ${s.toUpperCase()}">${s.toUpperCase()}</button>`,
    ).join('');
    // Locked panels (stats, admin) can be moved + resized but never removed.
    bar.innerHTML =
      `<span class="dash-grip" title="Dra for å flytte">${grip}</span>` +
      `<span class="dash-sizes">${sizeBtns}</span>` +
      (locked ? '' : `<button type="button" class="dash-remove" title="Fjern panel" aria-label="Fjern panel">×</button>`);
    w.appendChild(bar);
    bar.querySelectorAll<HTMLElement>('.dash-size').forEach((btn) =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); setSize(w, btn.dataset.size ?? 'm'); relayout(); }));
    bar.querySelector('.dash-remove')?.addEventListener('click', (e) => {
      e.stopPropagation();
      setRemoved(w, true);
      makeDraggable(w, false);
      rebuildPalette();
      relayout();
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
    relayout();
  }

  // --- drag + drop --------------------------------------------------------
  const makeDraggable = (w: HTMLElement, on: boolean) => {
    if (on) w.setAttribute('draggable', 'true');
    else w.removeAttribute('draggable');
  };
  // Live swap while dragging. The dragged panel is the source of truth: on each
  // frame we swap it with whichever panel its *projected centre* sits inside.
  // That "centre inside" rule gives natural hysteresis — right after a swap the
  // centre is over the dragged panel's own new slot, so nothing flips until the
  // pointer crosses into a different panel. No indicator, no oscillation.
  grid.addEventListener('dragstart', (e) => {
    const w = (e.target as HTMLElement)?.closest?.('.dash-widget') as HTMLElement | null;
    if (w && document.body.classList.contains('dash-editing')) {
      w.classList.add('dash-dragging');
      // Grab offset: the cursor sits on the grip (top-left), but the user aims
      // with the panel's *body*. Record cursor→panel-centre so the swap tracks
      // where the panel is, not where the pointer is.
      const r = w.getBoundingClientRect();
      grabCX = (r.left + r.width / 2) - (e as DragEvent).clientX;
      grabCY = (r.top + r.height / 2) - (e as DragEvent).clientY;
    }
  });
  grid.addEventListener('dragend', () => {
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
    grid.querySelector<HTMLElement>('.dash-dragging')?.classList.remove('dash-dragging');
    relayout();
  });
  // dragover fires many times per frame; coalesce to one pass per frame.
  let dragRaf = 0;
  let dragX = 0, dragY = 0;
  let grabCX = 0, grabCY = 0; // cursor→panel-centre offset, set on dragstart
  function onDragOver(e: DragEvent) {
    e.preventDefault(); // must stay synchronous so the drop is allowed
    dragX = e.clientX; dragY = e.clientY;
    if (dragRaf) return;
    dragRaf = requestAnimationFrame(processDrag);
  }
  // Swap two grid children in place (marker keeps it correct when adjacent).
  function swapNodes(a: Element, b: Element) {
    const marker = document.createComment('');
    grid.insertBefore(marker, a);
    grid.insertBefore(a, b);
    grid.insertBefore(b, marker);
    marker.remove();
  }
  function processDrag() {
    dragRaf = 0;
    const dragging = grid.querySelector<HTMLElement>('.dash-dragging');
    if (!dragging) return;
    const cx = dragX + grabCX, cy = dragY + grabCY; // projected panel centre
    for (const el of grid.querySelectorAll<HTMLElement>('.dash-widget:not(.dash-dragging):not(.dash-removed)')) {
      const b = el.getBoundingClientRect();
      if (cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom) {
        swapNodes(dragging, el);
        relayout();
        return;
      }
    }
  }
  const bindDnD = () => { liveWidgets().forEach((w) => makeDraggable(w, true)); grid.addEventListener('dragover', onDragOver); };
  const unbindDnD = () => { allWidgets().forEach((w) => makeDraggable(w, false)); grid.removeEventListener('dragover', onDragOver); };

  // --- enter / exit -------------------------------------------------------
  function enterEdit() {
    snapshot = currentLayout();
    snapshotMode = mode;
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
    } else {
      if (snapshot) applyLayout(snapshot);
      mode = snapshotMode; applyMode(); // revert a previewed grid/masonry switch
    }
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
  document.querySelectorAll<HTMLElement>('[data-set-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      const m = b.dataset.setMode;
      if (m === 'grid' || m === 'masonry') { mode = m; applyMode(); }
    }));
  document.querySelector('[data-edit-reset]')?.addEventListener('click', () => {
    try { localStorage.removeItem(key); localStorage.removeItem(modeKey); } catch { /* */ }
    // Clear the server row too, then reload to the server default.
    fetch('/api/dashboard/layout', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: CONTEXT }),
    }).catch(() => { /* offline — localStorage cleared, will drift until next save */ })
      .finally(() => location.reload());
  });
}
