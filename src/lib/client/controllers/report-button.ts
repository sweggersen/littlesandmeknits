// Report-button dropdown with reason form. Closes when clicking
// outside the wrapper. Extracted from src/components/ReportButton.astro.

import { bindOnce } from '../dom';

export function init(): void {
  // The outside-click close is registered ONCE on the document (which survives
  // ClientRouter swaps) — binding it per-wrapper leaked a listener on every
  // navigation. It closes any open dropdown whose wrapper doesn't contain the click.
  if (bindOnce('report-button-doc', document.documentElement)) {
    document.addEventListener('click', (e) => {
      document.querySelectorAll('[data-report-wrapper]').forEach((wrapper) => {
        if (!wrapper.contains(e.target as Node)) {
          wrapper.querySelector('[data-report-dropdown]')?.classList.add('hidden');
        }
      });
    });
  }

  document.querySelectorAll('[data-report-wrapper]').forEach((wrapper) => {
    // registerController re-runs init() (incl. on initial load); without this
    // each wrapper stacked a duplicate submit listener.
    if (!bindOnce('report-button', wrapper)) return;
    const toggle = wrapper.querySelector('[data-report-toggle]') as HTMLButtonElement;
    const dropdown = wrapper.querySelector('[data-report-dropdown]') as HTMLElement;
    const form = wrapper.querySelector('[data-report-form]') as HTMLFormElement;
    const status = wrapper.querySelector('[data-report-status]') as HTMLElement;

    toggle.addEventListener('click', () => {
      dropdown.classList.toggle('hidden');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
      if (submitBtn?.disabled) return; // in-flight guard: ignore a double-click
      if (submitBtn) submitBtn.disabled = true;
      const body = new FormData(form);
      try {
        const res = await fetch('/api/report', { method: 'POST', body, credentials: 'same-origin' });
        if (res.ok) {
          status.textContent = 'Rapport sendt. Takk!';
          status.classList.remove('hidden', 'text-red-600');
          status.classList.add('text-sage-700');
          if (submitBtn) {
            submitBtn.disabled = true; // stays disabled — reported once
            submitBtn.textContent = 'Rapport sendt';
          }
        } else {
          const text = await res.text();
          status.textContent = text.includes('already_reported')
            ? 'Du har allerede rapportert dette.'
            : text || 'Noe gikk galt. Prøv igjen.';
          status.classList.remove('hidden', 'text-sage-700');
          status.classList.add('text-red-600');
          if (submitBtn) submitBtn.disabled = false; // let them retry
        }
      } catch {
        status.textContent = 'Noe gikk galt. Prøv igjen.';
        status.classList.remove('hidden');
        status.classList.add('text-red-600');
        if (submitBtn) submitBtn.disabled = false; // let them retry
      }
    });
  });
}
