// Footer "Mer / Skjul" disclosure for the rich link grid.
// Extracted from src/components/Footer.astro.

import { bindOnce } from '../dom';

export function init(): void {
  const btn = document.querySelector<HTMLButtonElement>('[data-footer-toggle]');
  const rich = document.querySelector<HTMLElement>('[data-footer-rich]');
  const label = document.querySelector<HTMLElement>('[data-footer-toggle-label]');
  const chev = document.querySelector<SVGElement>('[data-footer-toggle-chev]');
  if (!btn || !rich) return;
  // The footer persists across view transitions, so registerController's
  // re-run would stack a new click listener on every navigation without this.
  if (!bindOnce('footer-toggle', btn)) return;
  btn.addEventListener('click', () => {
    const isOpen = !rich.classList.contains('hidden');
    if (isOpen) {
      rich.classList.add('hidden');
      btn.setAttribute('aria-expanded', 'false');
      if (label) label.textContent = 'Mer';
      if (chev) chev.style.transform = '';
    } else {
      rich.classList.remove('hidden');
      btn.setAttribute('aria-expanded', 'true');
      if (label) label.textContent = 'Skjul';
      if (chev) chev.style.transform = 'rotate(180deg)';
    }
  });
}
