// Review submission form: clickable star rating, AJAX submit with
// success/error status. Extracted from src/components/ReviewForm.astro.

export function init(): void {
  document.querySelectorAll('[data-review-form-wrapper]').forEach((wrapper) => {
    const form = wrapper.querySelector('[data-review-form]') as HTMLFormElement;
    const starGroup = wrapper.querySelector('[data-star-group]') as HTMLElement;
    const ratingInput = wrapper.querySelector('[data-rating-input]') as HTMLInputElement;
    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    const status = wrapper.querySelector('[data-review-status]') as HTMLElement;
    let selected = 0;

    function renderStars(highlight: number) {
      starGroup.querySelectorAll('[data-star]').forEach((btn) => {
        const val = parseInt((btn as HTMLElement).dataset.star!, 10);
        const svg = btn.querySelector('svg')!;
        if (val <= highlight) {
          svg.setAttribute('fill', 'currentColor');
          svg.classList.remove('text-charcoal/20');
          svg.classList.add('text-terracotta-500');
        } else {
          svg.setAttribute('fill', 'none');
          svg.classList.add('text-charcoal/20');
          svg.classList.remove('text-terracotta-500');
        }
      });
    }

    starGroup.querySelectorAll('[data-star]').forEach((btn) => {
      const val = parseInt((btn as HTMLElement).dataset.star!, 10);
      btn.addEventListener('click', () => {
        selected = val;
        ratingInput.value = String(val);
        renderStars(val);
        submitBtn.disabled = false;
      });
      btn.addEventListener('mouseenter', () => renderStars(val));
    });

    starGroup.addEventListener('mouseleave', () => renderStars(selected));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!ratingInput.value) return;
      const body = new FormData(form);
      try {
        const res = await fetch('/api/reviews/submit', { method: 'POST', body, credentials: 'same-origin' });
        const data = await res.json();
        if (data.ok) {
          status.textContent = 'Vurdering sendt!';
          status.classList.remove('hidden', 'text-red-600');
          status.classList.add('text-sage-700');
          submitBtn.disabled = true;
          submitBtn.textContent = 'Sendt';
        } else {
          status.textContent = data.error === 'already_reviewed' ? 'Du har allerede gitt en vurdering.' : 'Noe gikk galt.';
          status.classList.remove('hidden');
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
