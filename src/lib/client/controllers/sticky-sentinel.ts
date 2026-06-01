// Marketplace home sticky-sentinel: once the [data-sticky-sentinel]
// element scrolls past the top, body gets data-past-anchor="true"
// which the nav uses to engage scroll-direction hide logic.
// Extracted from market/index.astro inline script.

export function init(): void {
  const sentinel = document.querySelector<HTMLElement>('[data-sticky-sentinel]');
  if (!sentinel) return;
  const obs = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        document.body.removeAttribute('data-past-anchor');
      } else if (entry.boundingClientRect.top < 0) {
        document.body.setAttribute('data-past-anchor', 'true');
      }
    },
    { rootMargin: '-120px 0px 0px 0px', threshold: 0 },
  );
  obs.observe(sentinel);
}
