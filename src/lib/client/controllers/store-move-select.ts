// "Move listings into store" selection: a select-all toggle, a live count on the
// submit button, and a guard so the form can't submit with nothing selected
// (an empty submit would fall through to the service's move-all path).

export function init(): void {
  const form = document.querySelector<HTMLFormElement>('[data-move-form]');
  if (!form || form.dataset.moveInit === '1') return;
  form.dataset.moveInit = '1';

  const boxes = [...form.querySelectorAll<HTMLInputElement>('[data-move-cb]')];
  const all = form.querySelector<HTMLInputElement>('[data-select-all]');
  const count = form.querySelector<HTMLElement>('[data-count]');
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');

  const update = () => {
    const n = boxes.filter((b) => b.checked).length;
    if (count) count.textContent = String(n);
    if (submit) { submit.disabled = n === 0; submit.classList.toggle('opacity-40', n === 0); }
    if (all) all.checked = n > 0 && n === boxes.length;
  };

  boxes.forEach((b) => b.addEventListener('change', update));
  all?.addEventListener('change', () => { boxes.forEach((b) => { b.checked = all.checked; }); update(); });
  update();
}
