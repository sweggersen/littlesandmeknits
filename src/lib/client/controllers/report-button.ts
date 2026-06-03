// Report-button dropdown with reason form. Closes when clicking
// outside the wrapper. Extracted from src/components/ReportButton.astro.

import { bindOnce } from '../dom';

export function init(): void {
  document.querySelectorAll('[data-report-wrapper]').forEach((wrapper) => {
    // registerController re-runs init() (incl. on initial load); without this
    // each wrapper stacked a duplicate submit + an extra document click listener.
    if (!bindOnce('report-button', wrapper)) return;
    const toggle = wrapper.querySelector('[data-report-toggle]') as HTMLButtonElement;
    const dropdown = wrapper.querySelector('[data-report-dropdown]') as HTMLElement;
    const form = wrapper.querySelector('[data-report-form]') as HTMLFormElement;
    const status = wrapper.querySelector('[data-report-status]') as HTMLElement;

    toggle.addEventListener('click', () => {
      dropdown.classList.toggle('hidden');
    });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target as Node)) dropdown.classList.add('hidden');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = new FormData(form);
      try {
        const res = await fetch('/api/report', { method: 'POST', body, credentials: 'same-origin' });
        if (res.ok) {
          status.textContent = 'Rapport sendt. Takk!';
          status.classList.remove('hidden', 'text-red-600');
          status.classList.add('text-sage-700');
          const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Rapport sendt';
          }
        } else {
          const text = await res.text();
          status.textContent = text.includes('already_reported')
            ? 'Du har allerede rapportert dette.'
            : text || 'Noe gikk galt. Prøv igjen.';
          status.classList.remove('hidden', 'text-sage-700');
          status.classList.add('text-red-600');
        }
      } catch {
        status.textContent = 'Noe gikk galt. Prøv igjen.';
        status.classList.remove('hidden');
        status.classList.add('text-red-600');
      }
    });
  });
}
