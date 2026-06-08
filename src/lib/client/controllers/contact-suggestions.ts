// Quick-message chips for the listing "Send melding til selger" panel: clicking
// a chip prefills the message textarea (then the seller edits/sends). Mirrors
// the bid-modal chips in BuyActions. bindOnce so registerController's re-runs
// (incl. on initial load) don't stack listeners.

import { bindOnce } from '../dom';

export function init(): void {
  const root = document.querySelector<HTMLElement>('[data-contact-suggestions]');
  const message = document.querySelector<HTMLTextAreaElement>('[data-contact-message]');
  if (!root || !message || !bindOnce('contact-suggestions', root)) return;

  root.querySelectorAll<HTMLButtonElement>('[data-msg]').forEach((chip) => {
    chip.addEventListener('click', () => {
      message.value = chip.dataset.msg ?? '';
      message.focus();
    });
  });
}
