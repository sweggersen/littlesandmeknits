// Inbox unread-marker: on click of an unread item, optimistically
// drop the visual unread chrome and beacon /api/notifications/read
// so the badge reflects reality without blocking navigation.
// Extracted from inbox.astro inline script.

import { bindOnce } from '../dom';

export function init(): void {
  document.querySelectorAll<HTMLAnchorElement>('[data-inbox-item][data-unread]').forEach((el) => {
    if (!bindOnce('inbox-read', el)) return;
    el.addEventListener('click', () => {
      el.removeAttribute('data-unread');
      el.querySelector<HTMLElement>('[data-unread-dot]')?.classList.add('invisible');
      const id = el.dataset.notifId;
      if (id) {
        const fd = new FormData();
        fd.set('id', id);
        (navigator.sendBeacon?.('/api/notifications/read', fd))
          || fetch('/api/notifications/read', { method: 'POST', body: fd, credentials: 'same-origin', keepalive: true });
      }
    });
  });
}
