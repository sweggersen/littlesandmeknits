// Generic show/hide toggle: clicking [data-expand-btn] flips the
// display of the nearest [data-expand-content] inside the same
// [data-expand-section] ancestor and swaps the button label.
// Extracted from profile/badges.astro inline script.

import { bindOnce } from '../dom';

export function init(): void {
  document.querySelectorAll('[data-expand-btn]').forEach((btn) => {
    const el = btn as HTMLElement;
    if (!bindOnce('expand-buttons', el)) return;
    const label = el.textContent ?? '';
    el.addEventListener('click', () => {
      const content = el.closest('[data-expand-section]')?.querySelector('[data-expand-content]') as HTMLElement | null;
      if (!content) return;
      const opening = content.style.display === 'none';
      content.style.display = opening ? '' : 'none';
      el.textContent = opening ? 'Skjul ▴' : label;
    });
  });
}
