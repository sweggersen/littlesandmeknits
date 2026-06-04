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

  function show(n: number, scroll = true) {
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
    // Only scroll when the user advances/goes back between steps — not on the
    // initial render, where it would jump past the page header + step bar.
    if (scroll) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      form.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function validateStep(n: number): boolean {
    const inputs = steps[n - 1].querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[required], select[required], textarea[required]');
    for (const el of Array.from(inputs)) {
      if (el.offsetParent === null) continue;
      if (!el.checkValidity()) { el.reportValidity(); return false; }
    }
    // Delivery: at least one of "kan sendes" / "kan møtes".
    if (n === 2 && !canShipEl?.checked && !canMeetEl?.checked) {
      deliveryError?.classList.remove('hidden');
      canShipEl?.focus();
      return false;
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

  // Delivery: "kan sendes" reveals the shipping-tier picker (and makes it
  // required); a listing must offer shipping and/or "kan møtes".
  const canShipEl = document.querySelector<HTMLInputElement>('[data-can-ship]');
  const canMeetEl = document.querySelector<HTMLInputElement>('[data-can-meet]');
  const shipOptions = document.querySelector<HTMLElement>('[data-ship-options]');
  const shipTiers = Array.from(document.querySelectorAll<HTMLInputElement>('[data-ship-tier]'));
  const deliveryError = document.querySelector<HTMLElement>('[data-delivery-error]');
  function syncDelivery() {
    const on = !!canShipEl?.checked;
    if (shipOptions) shipOptions.style.display = on ? '' : 'none';
    shipTiers.forEach((r) => { r.disabled = !on; });
    if (deliveryError && (canShipEl?.checked || canMeetEl?.checked)) deliveryError.classList.add('hidden');
  }
  canShipEl?.addEventListener('change', syncDelivery);
  canMeetEl?.addEventListener('change', syncDelivery);
  syncDelivery();

  // First-listing chips — set ONLY the type + category as a quick start
  // (june26 §1.5). Everything else stays the seller's own. "Tomt ark" just
  // dismisses the row. Presets live in ../../listing-templates (pure +
  // unit-tested against valid categories/kinds).
  document.querySelectorAll<HTMLButtonElement>('[data-fill-template]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tpl = LISTING_TEMPLATES[btn.dataset.fillTemplate ?? ''];
      if (tpl) {
        for (const [name, value] of Object.entries(tpl)) {
          const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
          if (el && 'value' in el) el.value = String(value);
        }
        // Reflect the new kind (toggles the condition field's visibility).
        kindEl?.dispatchEvent(new Event('change'));
      }
      // The row has served its purpose (whichever chip was clicked).
      document.querySelector<HTMLElement>('[data-example-row]')?.remove();
    });
  });

  show(1, false);
}
