// Disables the submit button on a full-page POST form the moment it submits, so
// money CTAs (buy / pattern checkout / commission pay) that then hit Stripe don't
// look frozen and can't be double-submitted. Opt-in via `data-guard-submit` on
// the <form>; an optional `data-busy-label` on the button swaps its text.
//
// Safe for navigating forms: the browser has already started the POST when the
// submit event fires, so disabling the button afterwards blocks a second submit
// without aborting the first.

import { bindOnce } from '../dom';

export function init(): void {
  document.querySelectorAll<HTMLFormElement>('form[data-guard-submit]').forEach((form) => {
    if (!bindOnce('submit-guard', form)) return;
    form.addEventListener('submit', () => {
      const btn = form.querySelector<HTMLButtonElement>('button[type="submit"], button:not([type])');
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      const busy = btn.getAttribute('data-busy-label');
      if (busy) btn.textContent = busy;
    });
  });
}
