// MarketplaceNav non-is:inline controller. Just reveals
// [data-marketplace-auth] elements once the auth cookie cache has
// been confirmed. The is:inline counterpart in
// src/components/MarketplaceNav.astro does the synchronous reveal;
// this one re-applies after view-transition swaps. Extracted as
// part of refactor item 9.

export function init(): void {
  if (sessionStorage.getItem('lm-auth') === '1') {
    document.querySelectorAll<HTMLElement>('[data-marketplace-auth]').forEach((el) => {
      el.classList.remove('hidden');
    });
  }
}
