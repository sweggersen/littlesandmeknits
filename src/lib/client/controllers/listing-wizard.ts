// Controller for /market/listing/new — wizard step navigation,
// pre-loved vs ready_made condition toggle, and the "Fyll inn et
// eksempel" prefill helper. Extracted from inline script as part of
// refactor item 9.

import { bindOnce } from '../dom';
import { LISTING_TEMPLATES } from '../../listing-templates';

export function init(): void {
  const formEl = document.querySelector<HTMLFormElement>('[data-wizard]');
  if (!formEl) return;
  if (!bindOnce('listing-wizard', formEl)) return;
  const form = formEl; // narrowed alias for the closures below

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

  // First-listing templates — prefill the form from a realistic preset so a
  // new seller sees what good copy looks like (june26 §1.5). "Tomt ark" just
  // dismisses the row. They edit everything afterwards. Presets live in
  // ../../listing-templates (pure + unit-tested against valid categories/kinds).
  document.querySelectorAll<HTMLButtonElement>('[data-fill-template]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tpl = LISTING_TEMPLATES[btn.dataset.fillTemplate ?? ''];
      if (tpl) {
        for (const [name, value] of Object.entries(tpl)) {
          const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
          if (el && 'value' in el) el.value = String(value);
        }
        // Reflect the new kind/condition and reveal "Flere detaljer".
        kindEl?.dispatchEvent(new Event('change'));
        document.querySelectorAll('details').forEach((d) => { d.open = true; });
      }
      // The row has served its purpose (whichever chip was clicked).
      document.querySelector<HTMLElement>('[data-example-row]')?.remove();
    });
  });

  show(1);
}
