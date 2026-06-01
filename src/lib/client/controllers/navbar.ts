// Site-wide Navbar bottom controller. This is the non-is:inline half
// of src/components/Navbar.astro -- the is:inline block above this
// is intentionally inline (hot-path: it runs synchronously before
// paint so cached auth state shows without flash).
//
// Extracted as part of refactor item 9.

import { bindOnce } from '../dom';

declare global {
  interface Window {
    applyAuthUI: (loggedIn: boolean) => void;
    applyProfileInfo: (user: unknown) => void;
    initDevMenu?: () => void;
  }
}

export function init(): void {
  const trigger = document.querySelector<HTMLButtonElement>('[data-mobile-menu-trigger]');
  const menu = document.querySelector<HTMLElement>('[data-mobile-menu]');
  // Reset menu on every navigation in case it was open.
  menu?.classList.add('hidden');
  if (trigger && bindOnce('navbar-trigger', trigger)) {
    trigger.addEventListener('click', () => {
      menu?.classList.toggle('hidden');
    });
  }

  // Re-init dev menu after SPA navigation
  window.initDevMenu?.();

  // Apply cached state immediately after DOM swap
  const cached = sessionStorage.getItem('lm-auth') === '1';
  if (cached) window.applyAuthUI?.(true);

  // Refresh in background
  fetch('/api/me', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data?.user) {
        sessionStorage.setItem('lm-auth', '1');
        sessionStorage.setItem('lm-profile', JSON.stringify(data.user));
        window.applyAuthUI?.(true);
        window.applyProfileInfo?.(data.user);
      } else {
        sessionStorage.removeItem('lm-auth');
        sessionStorage.removeItem('lm-profile');
      }
    })
    .catch(() => {});
}
