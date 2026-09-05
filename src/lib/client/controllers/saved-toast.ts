// Shows a transient "Lagret" confirmation after a save. Form save routes append
// ?saved=1 to their success redirect (see toResponse `saved` opt); this reads
// it, shows a floating toast, then strips the param from the URL so a reload or
// back-navigation doesn't re-show it. Registered once from StudioLayout, so
// every studio save gets feedback with no per-page markup.

export function init(): void {
  const url = new URL(window.location.href);
  const saved = url.searchParams.get('saved') === '1';
  const error = url.searchParams.get('error');
  if (!saved && !error) return;

  // Strip the params immediately (so refresh/back doesn't re-toast).
  url.searchParams.delete('saved');
  url.searchParams.delete('error');
  window.history.replaceState({}, '', url.pathname + url.search + url.hash);

  // Avoid stacking toasts if the controller somehow runs twice.
  if (document.querySelector('[data-saved-toast]')) return;

  const toast = document.createElement('div');
  toast.setAttribute('data-saved-toast', '');
  toast.setAttribute('role', 'status');
  const base =
    'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full ' +
    'text-sm font-medium shadow-lg transition-opacity duration-300 max-w-[90vw] text-center';
  if (error) {
    toast.textContent = error;
    toast.className = `${base} bg-red-600 text-white`;
  } else {
    toast.textContent = 'Lagret';
    toast.className = `${base} bg-sage-500 text-linen`;
  }
  document.body.appendChild(toast);

  // Errors linger longer so they can be read.
  const ttl = error ? 5000 : 2200;
  window.setTimeout(() => {
    toast.style.opacity = '0';
    window.setTimeout(() => toast.remove(), 300);
  }, ttl);
}
