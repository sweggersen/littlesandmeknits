// Bottom tab bar active-state on /studio pages. Picks the matching
// tab by regex stored on each [data-tab-match] element.
// Extracted from src/components/StudioTabBar.astro.

export function init(): void {
  const path = window.location.pathname.replace(/\/$/, '') || '/studio';
  document
    .querySelectorAll<HTMLElement>('[data-studio-tabbar] [data-tab-match]')
    .forEach((el) => {
      const re = el.getAttribute('data-tab-match');
      if (!re) return;
      el.classList.toggle('is-active', new RegExp(re).test(path));
    });
}
