// Newsletter signup AJAX submit. Toggles success/error panels and
// resets the form on success. Extracted from
// src/components/NewsletterSignup.astro.

export function init(): void {
  const form = document.querySelector<HTMLFormElement>('[data-newsletter-form]');
  const success = document.querySelector<HTMLElement>('[data-newsletter-success]');
  const error = document.querySelector<HTMLElement>('[data-newsletter-error]');
  const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (success) success.hidden = true;
    if (error) error.hidden = true;
    if (submit) submit.disabled = true;

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new FormData(form),
      });
      if (response.ok) {
        form.reset();
        if (success) success.hidden = false;
      } else {
        if (error) error.hidden = false;
      }
    } catch {
      if (error) error.hidden = false;
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}
