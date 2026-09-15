// Butikker "Kart" view. Renders an interactive Leaflet map of located stores at
// their exact geocoded address (stores are businesses — their location is
// public; individual sellers stay coarse elsewhere). Leaflet + markercluster +
// their CSS are dynamically imported so the payload only loads when the map is
// shown; everything is bundled locally (no CDN) and tiles come from Esri's
// keyless "World Light Gray Canvas", a muted basemap that suits the palette.
//
// Overlapping markers collapse into a branded numbered cluster; clicking it
// zooms in, and stores sharing an exact spot spiderfy (fan out) so each is
// pickable. The container carries the markers as JSON in a sibling
// <script type="application/json" data-store-map-data> so SSR can hand the
// full located set (all pages, filters applied) to the client in one shot.

import { bindOnce } from '../dom';

interface Marker {
  id: string;
  slug: string;
  name: string;
  location_city: string | null;
  postnummer: string | null;
  verified: boolean;
  active_listing_count: number;
  lat: number;
  lng: number;
}

// Norway, roughly centred so an empty/one-marker map still reads as "Norway".
const NORWAY_CENTER: [number, number] = [64.5, 12.5];
const NORWAY_ZOOM = 4;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!),
  );
}

async function renderMap(container: HTMLElement, markers: Marker[]): Promise<void> {
  const L = (await import('leaflet')).default;
  // Leaflet's stylesheet, bundled (Vite inlines it). Without this the map
  // panes/controls are unstyled and tiles stack incorrectly.
  await import('leaflet/dist/leaflet.css');
  // markercluster extends the same (deduped) L instance as a side effect; its
  // core CSS drives the cluster + spiderfy animations.
  await import('leaflet.markercluster');
  await import('leaflet.markercluster/dist/MarkerCluster.css');

  const map = L.map(container, {
    center: NORWAY_CENTER,
    zoom: NORWAY_ZOOM,
    scrollWheelZoom: false, // don't hijack page scroll; user clicks to zoom
    attributionControl: true,
  });

  // Esri "World Light Gray Canvas": a muted grayscale basemap that suits the
  // linen/sage palette AND needs no API key (CARTO's free basemap now demands
  // one — the "API KEY REQUIRED" watermark). Note the {z}/{y}/{x} tile order.
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: 'Tiles &copy; <a href="https://www.esri.com">Esri</a>',
      maxZoom: 16,
      // Fetch double-density tiles on Retina/high-DPI screens so the basemap
      // renders crisp instead of upscaled-blurry.
      detectRetina: true,
    },
  ).addTo(map);

  // Cluster group: overlapping stores collapse into one branded numbered badge;
  // a click zooms in, and stores at an identical point spiderfy so each is
  // pickable. maxClusterRadius kept tight so exact addresses separate quickly.
  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 46,
    spiderfyOnMaxZoom: true,
    spiderLegPolylineOptions: { weight: 1.5, color: '#9A4F37', opacity: 0.5 },
    iconCreateFunction: (c) =>
      L.divIcon({
        className: 'store-map-cluster',
        // Centre the count inside a nested badge, not on the .leaflet-marker-icon
        // element itself — Leaflet's own rule for that class would override our
        // display:flex on source order and shove the number to the corner.
        html: `<span class="store-map-cluster__badge">${c.getChildCount()}</span>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      }),
  });

  const bounds: [number, number][] = [];
  for (const m of markers) {
    const count = m.active_listing_count;
    // Brand pin: terracotta teardrop with the active-listing count. Custom
    // divIcon avoids Leaflet's default marker PNGs (which break under bundling).
    const icon = L.divIcon({
      className: 'store-map-pin',
      html:
        `<span class="store-map-pin__dot${m.verified ? ' is-verified' : ''}">` +
        `${count > 0 ? `<span class="store-map-pin__count">${count}</span>` : ''}</span>`,
      iconSize: [28, 36],
      iconAnchor: [14, 34],
      popupAnchor: [0, -30],
    });
    const place = [m.location_city, m.postnummer].filter(Boolean).join(' · ');
    const popup =
      `<div class="store-map-popup">` +
      `<a class="store-map-popup__name" href="/market/store/${encodeURIComponent(m.slug)}">${escapeHtml(m.name)}</a>` +
      (place ? `<div class="store-map-popup__place">${escapeHtml(place)}</div>` : '') +
      `<div class="store-map-popup__meta">${count > 0 ? `${count} aktive annonser` : 'Ingen aktive annonser'}</div>` +
      `</div>`;
    cluster.addLayer(L.marker([m.lat, m.lng], { icon, title: m.name }).bindPopup(popup));
    bounds.push([m.lat, m.lng]);
  }
  cluster.addTo(map);

  // Fit the view to the markers — but only once the container actually has a
  // size. On first paint (and after an Astro view-transition swap) the map can
  // initialise before layout settles, leaving Leaflet convinced it's tiny → it
  // renders a single centred tile and never fits. A ResizeObserver recomputes
  // the size and fits on the first real dimensions, then keeps the tiles filled
  // on any later resize.
  const fit = () => {
    if (bounds.length === 1) map.setView(bounds[0], 8, { animate: false });
    else if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10, animate: false });
    container.dataset.storeMapFitted = '1';
  };
  // Re-fit whenever the container's LAYOUT size changes (offsetWidth is immune
  // to the CSS transform Astro applies during a view-transition swap, unlike
  // getBoundingClientRect). On the first navigation the map can initialise
  // before the swap's layout settles; re-fitting on each real size change means
  // a back-navigation that first sizes the map wrong (a single centred tile)
  // corrects itself once the true size arrives.
  let lastW = 0;
  let lastH = 0;
  const ensureFit = () => {
    const w = container.offsetWidth;
    const h = container.offsetHeight;
    if (w < 20 || h < 20 || (w === lastW && h === lastH)) return;
    lastW = w;
    lastH = h;
    map.invalidateSize();
    fit();
  };
  const ro = new ResizeObserver(ensureFit);
  ro.observe(container);
  // ResizeObserver ignores transform-only changes, so also poll briefly across
  // the swap animation until the size stabilises.
  requestAnimationFrame(() => requestAnimationFrame(ensureFit));
  const poll = window.setInterval(ensureFit, 120);
  window.setTimeout(() => window.clearInterval(poll), 2000);
  container.dataset.storeMapReady = '1';

  // Tear the map down before the next ClientRouter swap so we don't leak
  // detached Leaflet instances (or hit "container already initialised" if the
  // element is reused). bindOnce re-renders a fresh map on the way back.
  const cleanup = () => {
    window.clearInterval(poll);
    ro.disconnect();
    map.remove();
    document.removeEventListener('astro:before-swap', cleanup);
  };
  document.addEventListener('astro:before-swap', cleanup);
}

export function init(): void {
  document.querySelectorAll<HTMLElement>('[data-store-map]').forEach((container) => {
    if (!bindOnce('store-map', container)) return;
    const dataEl = container.parentElement?.querySelector<HTMLScriptElement>('[data-store-map-data]');
    let markers: Marker[] = [];
    try {
      markers = dataEl?.textContent ? (JSON.parse(dataEl.textContent) as Marker[]) : [];
    } catch {
      markers = [];
    }
    renderMap(container, markers).catch((err) => {
      console.error('store-map render failed', err);
      container.innerHTML =
        '<div class="store-map-error">Kunne ikke laste kartet. Prøv å laste siden på nytt.</div>';
    });
  });
}
