// Two-way binding between a <input type="color" data-color-input>
// and a <input type="text" data-color-text> showing the hex value.
// Both live inside a <* data-color-picker> wrapper. Used on the
// store admin settings page. Extracted from inline script.

import { bindOnce } from '../dom';

export function init(): void {
  document.querySelectorAll<HTMLElement>('[data-color-picker]').forEach((root) => {
    const colorInput = root.querySelector<HTMLInputElement>('[data-color-input]');
    const textInput = root.querySelector<HTMLInputElement>('[data-color-text]');
    if (!colorInput || !textInput) return;
    if (!bindOnce('color-picker', root)) return;
    const isValidHex = (s: string) => /^#[0-9A-Fa-f]{6}$/.test(s);
    if (textInput.value) colorInput.value = textInput.value;
    colorInput.addEventListener('input', () => {
      textInput.value = colorInput.value.toUpperCase();
    });
    textInput.addEventListener('input', () => {
      const v = textInput.value.trim();
      if (isValidHex(v)) colorInput.value = v;
    });
  });
}
