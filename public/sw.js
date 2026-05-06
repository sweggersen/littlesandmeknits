// Minimal service worker.
//
// The site is server-rendered and changes constantly while we iterate, so an
// over-eager offline cache would just serve stale UI. We register a worker so
// browsers will treat the site as a PWA and surface the "Install" / "Add to
// Home Screen" prompt — but we deliberately do *not* cache page responses.
//
// Behavior:
//   - Always pass through to the network for navigation, API, and asset
//     requests.
//   - On total network failure of a navigation, fall back to a tiny offline
//     page so the home-screen launch doesn't show a broken Chrome error.

const OFFLINE_HTML = `<!doctype html>
<html lang="nb-NO"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Offline — Littles and Me</title>
<style>
  body { margin:0; font-family: system-ui, sans-serif; background:#FAF6F0; color:#2C2A26; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  main { max-width: 360px; text-align:center; }
  h1 { font-family: serif; font-size: 28px; margin: 0 0 12px; }
  p { color: rgba(44,42,38,.7); line-height: 1.5; }
  button { margin-top: 24px; background:#2C2A26; color:#FAF6F0; border:0; padding:12px 24px; border-radius:999px; font-size:14px; cursor:pointer; }
</style></head><body>
<main>
  <h1>Du er offline</h1>
  <p>Studioet trenger nett for å hente prosjektene dine. Sjekk tilkoblingen og prøv igjen.</p>
  <button onclick="location.reload()">Prøv igjen</button>
</main></body></html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(
        () => new Response(OFFLINE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
      ),
    );
  }
});
