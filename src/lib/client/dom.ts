// Tiny shared helpers for client-side controllers.
//
// The codebase has a recurring pattern: an init() function that
// queries the DOM, binds events, and must NOT double-bind when
// view-transitions re-fire astro:page-load with the same elements
// already wired. Per CLAUDE.md, every script wired with
// astro:page-load must guard against running twice.
//
// The pre-Item-9 idiom was `(el as any)._myFeatureBound = true;` which
// is both untyped and forces every site to invent a unique flag name.
// This module replaces it with a single typed WeakSet keyed on the
// controller name.

const bound = new Map<string, WeakSet<Element>>();

/**
 * Returns true if the (controllerName, element) pair has not been
 * registered before; subsequent calls return false. Use to gate
 * one-time `addEventListener` calls inside an init function that
 * re-runs on every astro:page-load:
 *
 *   if (!bindOnce('fav-btn', btn)) return;
 *   btn.addEventListener('click', ...);
 */
export function bindOnce(controllerName: string, el: Element): boolean {
  let set = bound.get(controllerName);
  if (!set) {
    set = new WeakSet();
    bound.set(controllerName, set);
  }
  if (set.has(el)) return false;
  set.add(el);
  return true;
}

/**
 * Wires `init` to run on initial load AND after every client-side
 * navigation (the Astro ClientRouter fires astro:page-load on
 * both). `init` must be idempotent — bindOnce() is the standard
 * way to guarantee that.
 */
export function registerController(init: () => void): void {
  init();
  document.addEventListener('astro:page-load', init);
}
