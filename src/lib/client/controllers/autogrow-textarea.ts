// Auto-grow <textarea data-autogrow> as the user types, up to 320px.
// Clears the value after the parent <form> is submitted so a
// post-redirect view doesn't show stale text. Used on the commission
// message form. Extracted from commissions/[id] inline script.

import { bindOnce } from '../dom';

export function init(): void {
  document.querySelectorAll<HTMLTextAreaElement>('textarea[data-autogrow]').forEach((el) => {
    if (!bindOnce('autogrow-textarea', el)) return;
    const resize = () => {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 320) + 'px';
    };
    el.addEventListener('focus', resize);
    el.addEventListener('input', resize);
    const form = el.closest('form');
    form?.addEventListener('submit', () => {
      setTimeout(() => { el.value = ''; resize(); }, 0);
    });
    resize();
  });
}
