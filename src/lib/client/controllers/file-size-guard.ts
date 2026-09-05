// Client-side file-size guard for upload forms. The server rejects oversize/
// wrong-type files with a service error that (for these HTML form routes)
// currently renders as a bare English error page — a scary dead-end for a user
// who just picked a big phone photo. Validate at selection time instead: show
// an inline Norwegian message and block submit until a valid file is chosen.
//
// Opt in per input with `data-max-mb="10"`. Registered once from StudioLayout,
// so it applies to every studio upload form (and no-ops on pages without one).

export function init(): void {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"][data-max-mb]');
  inputs.forEach((input) => {
    if (input.dataset.fileGuardInit === '1') return;
    input.dataset.fileGuardInit = '1';

    const maxMb = parseFloat(input.dataset.maxMb || '0');
    const maxBytes = maxMb * 1024 * 1024;
    const form = input.closest('form');
    const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"], input[type="submit"]') ?? null;

    // A message slot right after the input (created once).
    let msg = input.nextElementSibling?.matches?.('[data-file-error]')
      ? (input.nextElementSibling as HTMLElement)
      : null;
    if (!msg) {
      msg = document.createElement('p');
      msg.setAttribute('data-file-error', '');
      msg.className = 'text-xs text-red-700 mt-1';
      msg.hidden = true;
      input.insertAdjacentElement('afterend', msg);
    }

    const check = () => {
      const file = input.files?.[0];
      const tooBig = !!(file && maxBytes && file.size > maxBytes);
      if (tooBig) {
        const mb = (file!.size / 1024 / 1024).toFixed(1);
        msg!.textContent = `Filen er for stor (${mb} MB). Maks ${maxMb} MB. Velg et mindre bilde.`;
        msg!.hidden = false;
      } else {
        msg!.hidden = true;
      }
      if (submit) submit.disabled = tooBig;
    };

    input.addEventListener('change', check);
  });
}
