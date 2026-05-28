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
//   - The offline page includes a small canvas-based yarn-ball click game
//     (Strikkeklikker) so being offline feels like a brand moment rather
//     than a dead end.

const OFFLINE_HTML = `<!doctype html>
<html lang="nb-NO"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Offline — Littles and Me</title>
<style>
  :root {
    --linen:#FAF6F0; --charcoal:#2C2A26; --terracotta:#C76D4E;
    --terracotta-dark:#9A4F37; --sage:#9CAF88; --oatmeal:#E8DFD0;
  }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--linen); color: var(--charcoal); min-height: 100vh;
    display:flex; flex-direction:column; align-items:center; padding:24px 16px;
    padding-bottom: calc(24px + env(safe-area-inset-bottom)); }
  header { text-align:center; max-width: 360px; margin: 0 auto 16px; }
  header h1 { font-family: Georgia, serif; font-size: 22px; margin: 0 0 6px; font-weight: 500; }
  header p { font-size: 13px; line-height: 1.5; margin: 0; color: rgba(44,42,38,.65); }
  .retry { display:inline-block; margin-top: 12px; background: transparent; color: var(--terracotta);
    border: 0; padding: 6px 10px; font-size: 12px; cursor: pointer; text-decoration: underline;
    text-underline-offset: 3px; font-family: inherit; }
  .game-card { width: 100%; max-width: 360px; margin: 8px auto 0; background: white;
    border-radius: 24px; box-shadow: 0 1px 0 rgba(44,42,38,.04), 0 8px 32px rgba(44,42,38,.05);
    padding: 16px; }
  .game-header { display:flex; align-items:baseline; justify-content:space-between;
    margin-bottom: 10px; padding: 0 4px; }
  .game-title { font-family: Georgia, serif; font-size: 16px; font-weight: 500; }
  .stitch-count { font-family: ui-monospace, monospace; font-size: 16px; font-weight: 600;
    color: var(--terracotta); font-variant-numeric: tabular-nums; }
  canvas { display:block; width: 100%; aspect-ratio: 3/4; background: var(--oatmeal);
    background: linear-gradient(180deg, #F2EBDE 0%, #E8DFD0 100%);
    border-radius: 16px; touch-action: manipulation; cursor: pointer;
    user-select: none; -webkit-user-select: none; }
  .hint { font-size: 11px; text-align: center; color: rgba(44,42,38,.5); margin: 10px 0 0; }
  .over { position: absolute; inset: 0; display:none; align-items:center; justify-content:center;
    flex-direction: column; background: rgba(44,42,38,.85); color: var(--linen); border-radius: 16px;
    backdrop-filter: blur(2px); }
  .over[data-on] { display: flex; }
  .over .final { font-family: Georgia, serif; font-size: 28px; margin: 0; }
  .over .label { font-size: 12px; opacity: .7; margin: 4px 0 16px; text-transform: uppercase;
    letter-spacing: .15em; }
  .over button { background: var(--terracotta); color: var(--linen); border: 0;
    padding: 10px 20px; border-radius: 999px; font-size: 14px; font-weight: 500; cursor: pointer;
    font-family: inherit; }
  .over button:hover { background: var(--terracotta-dark); }
  .stage { position: relative; }
</style></head><body>
<header>
  <h1>Du er offline</h1>
  <p>Vi trenger nett for å laste denne siden. Sjekk tilkoblingen og prøv igjen.</p>
  <button class="retry" onclick="location.reload()">Prøv igjen</button>
</header>

<section class="game-card" aria-label="Strikkeklikker">
  <div class="game-header">
    <span class="game-title">Strikkeklikker</span>
    <span class="stitch-count"><span id="score">0</span> masker</span>
  </div>
  <div class="stage">
    <canvas id="game" width="600" height="800"></canvas>
    <div class="over" id="over">
      <p class="final"><span id="final">0</span> masker</p>
      <p class="label">Ferdig strikket</p>
      <button id="replay" type="button">Strikk igjen</button>
    </div>
  </div>
  <p class="hint">Klikk garnnøstene før de ruller bort.</p>
</section>

<script>
(function() {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const overEl = document.getElementById('over');
  const finalEl = document.getElementById('final');
  const replayEl = document.getElementById('replay');

  const COLORS = ['#C76D4E', '#9CAF88', '#E8DFD0', '#9A4F37', '#BCCAA3'];
  const W = canvas.width, H = canvas.height;
  let balls, score, gameOver, lastSpawnAt, startedAt, speed;

  function reset() {
    balls = [];
    score = 0;
    gameOver = false;
    lastSpawnAt = 0;
    startedAt = performance.now();
    speed = 1;
    scoreEl.textContent = '0';
    overEl.removeAttribute('data-on');
    requestAnimationFrame(loop);
  }

  function spawn() {
    const r = 36 + Math.random() * 18;
    balls.push({
      x: r + Math.random() * (W - r * 2),
      y: -r,
      vy: 60 + Math.random() * 80,
      r,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      angle: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.4,
      caught: false,
      pop: 0,
    });
  }

  function drawBall(b) {
    if (b.pop > 0) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.globalAlpha = Math.max(0, 1 - b.pop);
      const s = 1 + b.pop * 0.6;
      ctx.scale(s, s);
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(0, 0, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    // Outer yarn ball
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(0, 0, b.r, 0, Math.PI * 2);
    ctx.fill();
    // Yarn texture: a few arcs across the ball
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1.5;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, b.r * 0.95, b.r * 0.35, i * 0.6, 0, Math.PI * 2);
      ctx.stroke();
    }
    // A tiny highlight
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(-b.r * 0.35, -b.r * 0.35, b.r * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  let lastFrame = 0;
  function loop(now) {
    if (gameOver) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0);
    lastFrame = now;
    ctx.clearRect(0, 0, W, H);
    // Spawn cadence: roughly one per 0.9s at start, speeds up.
    if (now - lastSpawnAt > 900 / Math.min(speed, 3)) {
      spawn();
      lastSpawnAt = now;
    }
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      if (b.caught) {
        b.pop += dt * 4;
        if (b.pop > 1) balls.splice(i, 1);
      } else {
        b.y += b.vy * speed * dt;
        b.angle += b.spin * dt * 4;
        if (b.y - b.r > H) {
          gameOver = true;
          showOver();
          return;
        }
      }
      drawBall(b);
    }
    // Speed ramps up: +50% every 20s.
    speed = 1 + ((now - startedAt) / 1000) / 40;
    requestAnimationFrame(loop);
  }

  function showOver() {
    finalEl.textContent = String(score);
    overEl.setAttribute('data-on', '');
  }

  function hit(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    // Translate from CSS pixels to canvas units.
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const x = (clientX - rect.left) * sx;
    const y = (clientY - rect.top) * sy;
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      if (b.caught) continue;
      if (Math.hypot(x - b.x, y - b.y) <= b.r) {
        b.caught = true;
        b.pop = 0.01;
        score++;
        scoreEl.textContent = String(score);
        return;
      }
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    hit(e.clientX, e.clientY);
  }, { passive: false });

  replayEl.addEventListener('click', reset);

  reset();
})();
</script>
</body></html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Strikketorget', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
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
