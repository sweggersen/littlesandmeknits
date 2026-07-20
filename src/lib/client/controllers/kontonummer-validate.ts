// Live validation for the become-seller account-number field. Reuses the same
// MOD-11 validator the server uses (src/lib/kontonummer.ts) so the inline
// feedback can't disagree with what the server will accept.

import { isValidKontonummer, normalizeKontonummer } from '../../kontonummer';

export function init(): void {
  const input = document.querySelector<HTMLInputElement>('#kontonummer');
  const status = document.querySelector<HTMLElement>('[data-konto-status]');
  if (!input || !status || input.dataset.kontoInit === '1') return;
  input.dataset.kontoInit = '1';

  const DEFAULT = status.textContent ?? '';

  const update = () => {
    const digits = normalizeKontonummer(input.value);
    input.classList.remove('konto-ok', 'konto-bad');
    status.classList.remove('konto-status-ok', 'konto-status-bad');
    if (digits.length === 0) { status.textContent = DEFAULT; return; }
    if (digits.length < 11) { status.textContent = `Skriv inn 11 siffer (${digits.length}/11).`; return; }
    if (isValidKontonummer(input.value)) {
      input.classList.add('konto-ok');
      status.classList.add('konto-status-ok');
      status.textContent = 'Gyldig kontonummer.';
    } else {
      input.classList.add('konto-bad');
      status.classList.add('konto-status-bad');
      status.textContent = 'Kontonummeret er ikke gyldig. Sjekk sifrene.';
    }
  };

  input.addEventListener('input', update);
  update(); // reflect a prefilled value (e.g. after a failed submit)
}
