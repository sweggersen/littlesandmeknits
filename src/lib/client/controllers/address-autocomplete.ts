// Single-field store-address autocomplete. As the user types, we query
// /api/geo/address-search (Kartverket) and show suggestions; picking one fills
// the hidden precise_address / postnummer / location_city inputs the store
// service reads. Editing the text again invalidates the prior pick, so a stale
// postnummer can never be submitted.
//
// registerController re-runs init() on every astro:page-load; bindOnce anchors
// the listeners once per input so a view-transition can't stack them.

import { bindOnce } from '../dom';

interface Hit { text: string; postnummer: string; poststed: string }

export function init(): void {
  document.querySelectorAll('[data-address-field]').forEach((field) => {
    const input = field.querySelector('[data-address-input]') as HTMLInputElement;
    if (!input || !bindOnce('address-ac', input)) return;
    const precise = field.querySelector('[data-address-precise]') as HTMLInputElement;
    const pnr = field.querySelector('[data-address-postnummer]') as HTMLInputElement;
    const city = field.querySelector('[data-address-city]') as HTMLInputElement;
    const list = field.querySelector('[data-address-suggestions]') as HTMLElement;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let ctrl: AbortController | undefined;

    const hide = () => { list.classList.add('hidden'); list.innerHTML = ''; };
    const clearPick = () => { precise.value = ''; pnr.value = ''; city.value = ''; };

    function render(hits: Hit[]) {
      list.innerHTML = '';
      if (!hits.length) { hide(); return; }
      for (const h of hits) {
        const li = document.createElement('li');
        li.textContent = `${h.text}, ${h.postnummer} ${h.poststed}`;
        li.className = 'px-3 py-2 text-sm cursor-pointer hover:bg-sage-100/60';
        // mousedown fires before the input's blur, so the pick isn't lost.
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = `${h.text}, ${h.postnummer} ${h.poststed}`;
          precise.value = h.text;
          pnr.value = h.postnummer;
          city.value = h.poststed;
          hide();
        });
        list.appendChild(li);
      }
      list.classList.remove('hidden');
    }

    input.addEventListener('input', () => {
      clearPick(); // any manual edit invalidates the previous selection
      const q = input.value.trim();
      if (timer) clearTimeout(timer);
      if (q.length < 3) { hide(); return; }
      timer = setTimeout(async () => {
        try { ctrl?.abort(); } catch { /* noop */ }
        ctrl = new AbortController();
        try {
          const res = await fetch(`/api/geo/address-search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
          if (!res.ok) return;
          render(await res.json() as Hit[]);
        } catch { /* aborted or offline — leave the list as-is */ }
      }, 250);
    });

    input.addEventListener('blur', () => setTimeout(hide, 150));
    document.addEventListener('click', (e) => {
      if (!field.contains(e.target as Node)) hide();
    });
  });
}
