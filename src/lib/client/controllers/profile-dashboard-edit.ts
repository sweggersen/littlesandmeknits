// Editable profile dashboard: "Rediger" toggles an inline layout editor where
// each widget can be dragged to reorder and resized S/M/L (column span). The
// layout (order + sizes) is remembered per user in localStorage; "Tilbakestill"
// clears it back to the server default.
//
// (Follow-up: persist to a dashboard_layouts table so it syncs across devices.)

const SIZE_SPAN: Record<string, string> = { s: 'md:col-span-2', m: 'md:col-span-4', l: 'md:col-span-6' };
const SIZES = ['s', 'm', 'l'];

interface LayoutItem { widget: string; size: string; }

export function init(): void {
  const gridEl = document.querySelector<HTMLElement>('#dashgrid');
  if (!gridEl || gridEl.dataset.dashInit === '1') return;
  gridEl.dataset.dashInit = '1';
  const grid: HTMLElement = gridEl; // non-null for the nested closures below

  const key = `lm-dash-${grid.dataset.user || 'anon'}`;
  const widgets = () => [...grid.querySelectorAll<HTMLElement>('.dash-widget')];

  const setSize = (w: HTMLElement, size: string) => {
    for (const s of SIZES) w.classList.remove(SIZE_SPAN[s]);
    w.classList.add(SIZE_SPAN[size] ?? SIZE_SPAN.m);
    w.dataset.size = size;
  };
  const currentLayout = (): LayoutItem[] =>
    widgets().map((w) => ({ widget: w.dataset.widget ?? '', size: w.dataset.size ?? 'm' }));
  const applyLayout = (layout: LayoutItem[]) => {
    const byKey = new Map(widgets().map((w) => [w.dataset.widget ?? '', w]));
    for (const item of layout) {
      const w = byKey.get(item.widget);
      if (!w) continue;
      setSize(w, item.size);
      grid.appendChild(w); // move into saved order
      byKey.delete(item.widget);
    }
    for (const w of byKey.values()) grid.appendChild(w); // new widgets go last
  };

  // Apply the saved layout on load.
  try {
    const raw = localStorage.getItem(key);
    if (raw) applyLayout(JSON.parse(raw) as LayoutItem[]);
  } catch { /* ignore corrupt state */ }

  // --- edit chrome --------------------------------------------------------
  const viewActions = document.querySelector<HTMLElement>('[data-view-actions]');
  const editActions = document.querySelector<HTMLElement>('[data-edit-actions]');
  const hint = document.querySelector<HTMLElement>('[data-edit-hint]');
  let snapshot: LayoutItem[] | null = null;

  const grip = '<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></svg>';

  function addTools() {
    widgets().forEach((w) => {
      if (w.querySelector('.dash-tools')) return;
      const bar = document.createElement('div');
      bar.className = 'dash-tools';
      bar.innerHTML =
        `<span class="dash-grip" title="Dra for å flytte">${grip}</span>` +
        `<button type="button" class="dash-size" title="Bytt størrelse">${(w.dataset.size ?? 'm').toUpperCase()}</button>`;
      w.appendChild(bar);
      bar.querySelector('.dash-size')!.addEventListener('click', (e) => {
        e.stopPropagation();
        const cur = w.dataset.size ?? 'm';
        const next = SIZES[(SIZES.indexOf(cur) + 1) % SIZES.length];
        setSize(w, next);
        (bar.querySelector('.dash-size') as HTMLElement).textContent = next.toUpperCase();
      });
    });
  }
  const removeTools = () => grid.querySelectorAll('.dash-tools').forEach((el) => el.remove());

  function onDragOver(e: DragEvent) {
    e.preventDefault();
    const dragging = grid.querySelector<HTMLElement>('.dash-dragging');
    if (!dragging) return;
    let target: HTMLElement | null = null;
    let best = Infinity;
    for (const el of grid.querySelectorAll<HTMLElement>('.dash-widget:not(.dash-dragging)')) {
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
  function bindDnD() {
    widgets().forEach((w) => {
      w.setAttribute('draggable', 'true');
      w.addEventListener('dragstart', () => w.classList.add('dash-dragging'));
      w.addEventListener('dragend', () => w.classList.remove('dash-dragging'));
    });
    grid.addEventListener('dragover', onDragOver);
  }
  function unbindDnD() {
    widgets().forEach((w) => w.removeAttribute('draggable'));
    grid.removeEventListener('dragover', onDragOver);
  }

  function enterEdit() {
    snapshot = currentLayout();
    document.body.classList.add('dash-editing');
    viewActions?.classList.add('hidden');
    editActions?.classList.remove('hidden');
    editActions?.classList.add('flex');
    hint?.classList.remove('hidden');
    addTools();
    bindDnD();
  }
  function exitEdit(save: boolean) {
    if (save) { try { localStorage.setItem(key, JSON.stringify(currentLayout())); } catch { /* quota */ } }
    else if (snapshot) applyLayout(snapshot);
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
    location.reload();
  });
}
