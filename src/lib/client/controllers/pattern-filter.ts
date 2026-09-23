// /oppskrifter filter pills: clicking [data-filter] toggles which
// [data-category] cards are visible. Extracted from inline script
// on oppskrifter/index.

import { bindOnce } from '../dom';

export function init(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('[data-filter]');
  const items = document.querySelectorAll<HTMLElement>('[data-category]');

  buttons.forEach((btn) => {
    // init() re-runs on initial load + every navigation; bind each pill once.
    if (!bindOnce('pattern-filter', btn)) return;
    btn.addEventListener('click', () => {
      const filter = btn.dataset.filter ?? 'all';

      buttons.forEach((b) => {
        b.classList.remove('bg-sage-500', 'text-white', 'shadow-sm');
        b.classList.add('text-charcoal/60');
      });
      btn.classList.remove('text-charcoal/60');
      btn.classList.add('bg-sage-500', 'text-white', 'shadow-sm');

      items.forEach((item) => {
        const matches = filter === 'all' || item.dataset.category === filter;
        item.style.display = matches ? '' : 'none';
      });
    });
  });
}
