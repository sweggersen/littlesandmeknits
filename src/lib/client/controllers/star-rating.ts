// Star rating controller. Binds 1-5 SVG stars inside a
// `<fieldset data-star-rating>` to a hidden `<input name="rating">`
// radio set. Hover previews; click commits.
//
// Used by the buyer review form on market/listing/[id] and the
// commission review form on market/commissions/[id]. Extracted
// from inline scripts as part of refactor item 9.

import { bindOnce } from '../dom';

export function init(): void {
  document.querySelectorAll<HTMLFieldSetElement>('[data-star-rating]').forEach((fs) => {
    if (!bindOnce('star-rating', fs)) return;
    const stars = fs.querySelectorAll<SVGElement>('[data-star]');
    const inputs = fs.querySelectorAll<HTMLInputElement>('input[name="rating"]');

    function highlight(n: number) {
      stars.forEach((s) => {
        const v = parseInt(s.dataset.star!, 10);
        s.setAttribute('fill', v <= n ? 'currentColor' : 'none');
        s.classList.toggle('text-terracotta-500', v <= n);
        s.classList.toggle('text-charcoal/20', v > n);
      });
    }

    inputs.forEach((inp) => inp.addEventListener('change', () => highlight(parseInt(inp.value, 10))));
    stars.forEach((s) => {
      s.addEventListener('mouseenter', () => highlight(parseInt(s.dataset.star!, 10)));
      s.addEventListener('mouseleave', () => {
        const checked = fs.querySelector<HTMLInputElement>('input[name="rating"]:checked');
        highlight(checked ? parseInt(checked.value, 10) : 0);
      });
    });
  });
}
