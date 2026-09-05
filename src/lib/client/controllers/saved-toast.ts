// Shows a transient "Lagret" confirmation after a save. Form save routes append
// ?saved=1 to their success redirect (see toResponse `saved` opt); this reads
// it, shows a floating toast, then strips the param from the URL so a reload or
// back-navigation doesn't re-show it. Registered once from StudioLayout, so
// every studio save gets feedback with no per-page markup.

export function init(): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get('saved') !== '1') return;

  // Strip the param immediately (so refresh/back doesn't re-toast).
  url.searchParams.delete('saved');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);

  // Avoid stacking toasts if the controller somehow runs twice.
  if (document.querySelector('[data-saved-toast]')) return;

  const toast = document.createElement('div');
  toast.setAttribute('data-saved-toast', '');
  toast.setAttribute('role', 'status');
  toast.textContent = 'Lagret';
  toast.className =
    'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-sage-500 text-linen ' +
    'px-5 py-2.5 rounded-full text-sm font-medium shadow-lg transition-opacity duration-300';
  document.body.appendChild(toast);

  window.setTimeout(() => {
    toast.style.opacity = '0';
    window.setTimeout(() => toast.remove(), 300);
  }, 2200);
}
