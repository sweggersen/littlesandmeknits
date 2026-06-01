// Controller for /market/listing/new — wizard step navigation,
// pre-loved vs ready_made condition toggle, and the "Fyll inn et
// eksempel" prefill helper. Extracted from inline script as part of
// refactor item 9.

import { bindOnce } from '../dom';

export function init(): void {
  const form = document.querySelector<HTMLFormElement>('[data-wizard]');
  if (!form) return;
  if (!bindOnce('listing-wizard', form)) return;

  const steps = Array.from(form.querySelectorAll<HTMLElement>('[data-step]'));
  const pills = Array.from(document.querySelectorAll<HTMLElement>('[data-step-pill]'));
  const back = document.querySelector<HTMLButtonElement>('[data-wizard-back]')!;
  const next = document.querySelector<HTMLButtonElement>('[data-wizard-next]')!;
  const submit = document.querySelector<HTMLButtonElement>('[data-wizard-submit]')!;
  let current = 1;

  function show(n: number) {
    current = n;
    steps.forEach((s) => s.classList.toggle('hidden', s.dataset.step !== String(n)));
    pills.forEach((p) => {
      const sn = parseInt(p.dataset.stepPill!, 10);
      p.classList.toggle('bg-charcoal', sn === n);
      p.classList.toggle('text-linen', sn === n);
      p.classList.toggle('text-charcoal/45', sn !== n);
      p.classList.toggle('bg-sage-100', sn < n);
      p.classList.toggle('text-sage-900', sn < n);
    });
    back.classList.toggle('hidden', n === 1);
    next.classList.toggle('hidden', n === steps.length);
    submit.classList.toggle('hidden', n !== steps.length);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function validateStep(n: number): boolean {
    const inputs = steps[n - 1].querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[required], select[required], textarea[required]');
    for (const el of Array.from(inputs)) {
      if (el.offsetParent === null) continue;
      if (!el.checkValidity()) { el.reportValidity(); return false; }
    }
    return true;
  }

  back.addEventListener('click', () => show(Math.max(1, current - 1)));
  next.addEventListener('click', () => { if (validateStep(current)) show(current + 1); });

  // Sync condition/kind visibility (kept from previous form).
  const kindEl = document.getElementById('kind') as HTMLSelectElement | null;
  const conditionEl = document.getElementById('condition') as HTMLSelectElement | null;
  const conditionWrap = document.querySelector('[data-condition-wrapper]') as HTMLElement | null;
  function syncKind() {
    if (!kindEl || !conditionEl || !conditionWrap) return;
    const isPreLoved = kindEl.value === 'pre_loved';
    conditionWrap.style.display = isPreLoved ? '' : 'none';
    conditionEl.disabled = !isPreLoved;
    if (!isPreLoved) conditionEl.removeAttribute('name');
    else conditionEl.setAttribute('name', 'condition');
  }
  kindEl?.addEventListener('change', syncKind);
  syncKind();

  // "Fyll inn et eksempel" — pre-fills the form with a realistic
  // sample so new sellers see what good copy looks like.
  const fillBtn = document.querySelector<HTMLButtonElement>('[data-fill-example]');
  fillBtn?.addEventListener('click', () => {
    const example: Record<string, string | number> = {
      kind: 'pre_loved',
      title: 'Mariusgenser str. 92, naturhvit',
      category: 'genser',
      size_label: '92',
      condition: 'som_ny',
      size_age_months_min: '18',
      size_age_months_max: '24',
      colorway: 'Naturhvit med blå border',
      pattern_external_title: 'Mariusgenser – Sandnes Garn',
      knitted_by: 'Mormor (privat)',
      location: 'Oslo',
      description: 'Strikket i Sandnes Smart Superwash. Brukt et par ganger på hytta, som ny.\n\nVasket forsiktig på ullprogram, lufttørket. Røykfritt hjem.',
      price_nok: '350',
    };
    for (const [name, value] of Object.entries(example)) {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
      if (el && 'value' in el) el.value = String(value);
    }
    // Make sure dependent UI reflects the new kind/condition.
    kindEl?.dispatchEvent(new Event('change'));
    // Open the "Flere detaljer" expander so the seller can see what got filled.
    document.querySelectorAll('details').forEach((d) => { d.open = true; });
    // Hide the helper row — it has served its purpose.
    document.querySelector<HTMLElement>('[data-example-row]')?.remove();
  });

  show(1);
}
