// Strikketorget-domain navbar controller. The nav element itself
// uses transition:persist so this init() runs after every navigation
// with the same persisted DOM nodes — every event binding therefore
// guards via bindOnce.
//
// Responsibilities:
//   - Sync active tab + mobile back button against the current route
//   - Mobile hamburger menu open/close (trigger + backdrop + Esc)
//   - Localhost dev menu visibility + outside-click close
//   - Profile dropdown trigger + outside-click close
//   - Hot-path auth state from sessionStorage + /api/me refresh in
//     background. applyAuthUI/applyProfileInfo come from the
//     <script is:inline> hot-path block in Navbar.astro (intentional
//     no-flash global).
//
// Extracted from src/components/StrikketorgetNav.astro inline
// script as part of refactor item 9.

import { bindOnce } from '../dom';

// Per-category section-pill colours (active = `on`, inactive hover = `hov`).
// Mirrors PILL_ACTIVE/PILL_HOVER in StrikketorgetNav.astro. Keep class strings
// literal — Tailwind only generates classes it can see in source.
const PILL_COLORS: Record<string, { on: string[]; hov: string[] }> = {
  '/market/used': { on: ['bg-[#915f3a]/12', 'text-[#915f3a]'], hov: ['hover:text-[#915f3a]', 'hover:bg-[#915f3a]/10'] },
  '/market/new': { on: ['bg-[#5d6f4b]/12', 'text-[#5d6f4b]'], hov: ['hover:text-[#5d6f4b]', 'hover:bg-[#5d6f4b]/10'] },
  '/market/commissions': { on: ['bg-[#6f5494]/15', 'text-[#6f5494]'], hov: ['hover:text-[#6f5494]', 'hover:bg-[#6f5494]/10'] },
  default: { on: ['bg-terracotta-500/10', 'text-terracotta-500'], hov: ['hover:text-charcoal', 'hover:bg-sage-100/60'] },
};

declare global {
  interface Window {
    applyAuthUI: (loggedIn: boolean) => void;
    applyProfileInfo: (user: unknown) => void;
  }
}

function syncRouteState() {
  const path = location.pathname.replace(/\/$/, '') || '/market';
  const ROOTS = new Set(['/market', '/inbox']);

  document.querySelectorAll<HTMLAnchorElement>('[data-nav-link]').forEach((el) => {
    const href = el.dataset.navLink!;
    const exact = el.dataset.navLinkExact === '1';
    const active = exact ? path === href : path.startsWith(href);
    // Per-category active + hover colours, matching the home cards/icons.
    // Class strings must stay literal so Tailwind generates them.
    const cfg = PILL_COLORS[href] ?? PILL_COLORS.default;
    cfg.on.forEach((c) => el.classList.toggle(c, active));
    cfg.hov.forEach((c) => el.classList.toggle(c, !active));
    el.classList.toggle('text-charcoal/70', !active);
  });
  document.querySelectorAll<HTMLAnchorElement>('[data-mobile-nav-link]').forEach((el) => {
    const href = el.dataset.mobileNavLink!;
    const active = path.startsWith(href);
    el.classList.toggle('text-terracotta-500', active);
    el.classList.toggle('text-charcoal/80', !active);
  });

  const back = document.querySelector<HTMLAnchorElement>('[data-st-back]');
  if (back) {
    const showBack = !ROOTS.has(path);
    back.classList.toggle('hidden', !showBack);
    const parts = path.split('/').filter(Boolean);
    let parent = '/market';
    if (parts.length > 1) { parts.pop(); parent = '/' + parts.join('/'); }
    back.href = parent;
  }
}

export function init(): void {
  const trigger = document.querySelector<HTMLButtonElement>('[data-mobile-menu-trigger]');
  const menu = document.querySelector<HTMLElement>('[data-mobile-menu]');
  const backdrop = document.querySelector<HTMLElement>('[data-mobile-backdrop]');

  function setMenuOpen(open: boolean) {
    menu?.classList.toggle('hidden', !open);
    backdrop?.classList.toggle('hidden', !open);
    document.body.style.overflow = open ? 'hidden' : '';
  }

  // Reset state on each fresh page-load — nav is transition:persist'd,
  // so without this the menu could carry the "open" state across navigations.
  setMenuOpen(false);

  if (trigger && bindOnce('strikketorget-nav-trigger', trigger)) {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      setMenuOpen(menu?.classList.contains('hidden') ?? false);
    });
  }
  if (backdrop && bindOnce('strikketorget-nav-backdrop', backdrop)) {
    backdrop.addEventListener('click', () => setMenuOpen(false));
  }
  if (menu && bindOnce('strikketorget-nav-menu', menu)) {
    menu.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('a, button')) setMenuOpen(false);
    });
  }
  if (bindOnce('strikketorget-nav-esc', document.documentElement)) {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !(menu?.classList.contains('hidden') ?? true)) setMenuOpen(false);
    });
  }

  syncRouteState();

  const back = document.querySelector<HTMLAnchorElement>('[data-st-back]');
  if (back && bindOnce('strikketorget-nav-back', back)) {
    back.addEventListener('click', (e) => {
      const ref = document.referrer;
      const sameOrigin = ref && new URL(ref).origin === location.origin;
      if (history.length > 1 && sameOrigin) {
        e.preventDefault();
        history.back();
      }
    });
  }

  // Localhost-only dev menu
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isLocal) {
    document.querySelectorAll('[data-dev-menu]').forEach((el) => el.classList.remove('hidden'));
    document.querySelectorAll<HTMLButtonElement>('[data-dev-menu-trigger]').forEach((btn) => {
      if (!bindOnce('strikketorget-nav-dev-trigger', btn)) return;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Mutually exclusive with the profile menu (stopPropagation above means
        // the outside-click closers don't fire, so close it explicitly).
        document.querySelector('[data-profile-menu]')?.classList.add('hidden');
        const dd = btn.parentElement?.querySelector('[data-dev-menu-dropdown]');
        dd?.classList.toggle('hidden');
      });
    });
    if (bindOnce('strikketorget-nav-dev-outside', document.body)) {
      document.addEventListener('click', (e) => {
        const target = e.target as Element | null;
        if (target?.closest('[data-dev-menu]')) return;
        document.querySelectorAll('[data-dev-menu-dropdown]').forEach((el) => el.classList.add('hidden'));
      });
    }
  }
  // Always force-close dev dropdown on a fresh navigation.
  document.querySelectorAll('[data-dev-menu-dropdown]').forEach((el) => el.classList.add('hidden'));

  // Profile dropdown
  const profileTrigger = document.querySelector<HTMLButtonElement>('[data-profile-menu-trigger]');
  const profileMenu = document.querySelector<HTMLElement>('[data-profile-menu]');
  if (profileTrigger && bindOnce('strikketorget-nav-profile-trigger', profileTrigger)) {
    profileTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close the dev dropdown so the two menus never overlap.
      document.querySelectorAll('[data-dev-menu-dropdown]').forEach((el) => el.classList.add('hidden'));
      profileMenu?.classList.toggle('hidden');
    });
  }
  if (bindOnce('strikketorget-nav-profile-outside', document.documentElement)) {
    document.addEventListener('click', (e) => {
      const pm = document.querySelector<HTMLElement>('[data-profile-menu]');
      const pt = document.querySelector<HTMLButtonElement>('[data-profile-menu-trigger]');
      if (!pm || !pt) return;
      if (!pt.parentElement?.contains(e.target as Node)) pm.classList.add('hidden');
    });
  }

  if (sessionStorage.getItem('lm-auth') === '1') {
    window.applyAuthUI?.(true);
  }

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
        window.applyAuthUI?.(false);
      }
    })
    .catch(() => {});
}
