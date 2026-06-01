// Client controller for /studio/tools.
//
// Wires up the five calculators (gauge, yardage, evenly, ruler,
// pinnestørrelser) and the tab switcher that toggles which one is
// visible without a full page reload. Extracted from a 270-line
// inline <script> block in src/pages/studio/tools.astro as part of
// refactor item 9.

const VERKTOY_TOOLS = ['gauge', 'yardage', 'evenly', 'ruler', 'needles'] as const;
type VerktoyTool = (typeof VERKTOY_TOOLS)[number];

export function init(): void {
  const tabLinks = document.querySelectorAll<HTMLAnchorElement>(
    'nav a[href^="/studio/tools?tool="]',
  );
  const sections = document.querySelectorAll<HTMLElement>('[data-verktoy-tool]');
  if (!tabLinks.length && !sections.length) return;

  function setActiveTool(tool: VerktoyTool) {
    sections.forEach((s) => {
      s.toggleAttribute('hidden', s.dataset.verktoyTool !== tool);
    });
    tabLinks.forEach((a) => {
      const href = a.getAttribute('href') ?? '';
      const isActive = href.includes(`tool=${tool}`);
      a.classList.toggle('border-terracotta-500', isActive);
      a.classList.toggle('text-charcoal', isActive);
      a.classList.toggle('border-transparent', !isActive);
      a.classList.toggle('text-charcoal/55', !isActive);
    });
    document.dispatchEvent(new CustomEvent('verktoy:show', { detail: { tool } }));
  }

  function toolFromUrl(): VerktoyTool {
    const t = new URL(window.location.href).searchParams.get('tool');
    return (VERKTOY_TOOLS as readonly string[]).includes(t ?? '')
      ? (t as VerktoyTool)
      : 'gauge';
  }

  tabLinks.forEach((a) => {
    a.addEventListener('click', (e) => {
      // Allow modifier-clicks (open-in-new-tab) to behave normally.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      const target = new URL(a.href, window.location.origin);
      const tool = target.searchParams.get('tool');
      if (!tool || !(VERKTOY_TOOLS as readonly string[]).includes(tool)) return;
      setActiveTool(tool as VerktoyTool);
      history.pushState(null, '', a.href);
    });
  });
  window.addEventListener('popstate', () => setActiveTool(toolFromUrl()));

  // ── Gauge calculator ──
  const gaugeForm = document.querySelector<HTMLFormElement>('[data-gauge]');
  const gaugeOut = document.querySelector<HTMLElement>('[data-gauge-result]');
  function recalcGauge() {
    if (!gaugeForm || !gaugeOut) return;
    const fd = new FormData(gaugeForm);
    const stitches = parseFloat(fd.get('stitches')?.toString() ?? '0');
    const width = parseFloat(fd.get('width')?.toString() ?? '0');
    if (!stitches || !width) {
      gaugeOut.textContent = '—';
      return;
    }
    const result = Math.round((stitches / 10) * width);
    gaugeOut.textContent = String(result);
  }
  gaugeForm?.addEventListener('input', recalcGauge);
  recalcGauge();

  // ── Yardage estimator ──
  // Approximate base yardage in grams for a "default" size, then scale by size factor.
  type Garment = 'hat' | 'mittens' | 'socks' | 'scarf' | 'cardigan_kid' | 'cardigan_adult' | 'blanket';
  const baseGrams: Record<Garment, number> = {
    hat: 80,
    mittens: 70,
    socks: 100,
    scarf: 200,
    cardigan_kid: 250,
    cardigan_adult: 600,
    blanket: 700,
  };
  const sizeFactor: Record<string, number> = {
    '0': 0.7, '1': 0.85, '2': 1.0, '4': 1.2, '6': 1.4, '8': 1.6,
    'adult_s': 1.0, 'adult_m': 1.1, 'adult_l': 1.25,
  };
  // Yarn meters per gram baseline (DK weight): ~3.0 m/g
  const metersPerGram = 3.0;

  const yarForm = document.querySelector<HTMLFormElement>('[data-yardage]');
  const yarGrams = document.querySelector<HTMLElement>('[data-yardage-grams]');
  const yarMeters = document.querySelector<HTMLElement>('[data-yardage-meters]');
  function recalcYardage() {
    if (!yarForm || !yarGrams || !yarMeters) return;
    const fd = new FormData(yarForm);
    const garment = fd.get('garment')?.toString() as Garment;
    const size = fd.get('size')?.toString() ?? '2';
    const isAdult = garment === 'cardigan_adult';
    const sizeKey = isAdult && !size.startsWith('adult_') ? 'adult_m' : size;
    const factor = sizeFactor[sizeKey] ?? 1;
    const g = Math.round(baseGrams[garment] * factor);
    const m = Math.round(g * metersPerGram);
    yarGrams.textContent = `${g} g`;
    yarMeters.textContent = `· ${m} m`;
  }
  yarForm?.addEventListener('input', recalcYardage);
  recalcYardage();

  // ── Increase / decrease evenly ──
  const evenlyForm = document.querySelector<HTMLFormElement>('[data-evenly]');
  const evenlySummary = document.querySelector<HTMLElement>('[data-evenly-summary]');
  const evenlyDetail = document.querySelector<HTMLElement>('[data-evenly-detail]');
  const evenlyRows = document.querySelector<HTMLElement>('[data-evenly-rows]');
  function recalcEvenly() {
    if (!evenlyForm || !evenlySummary || !evenlyDetail || !evenlyRows) return;
    const fd = new FormData(evenlyForm);
    const current = parseInt(fd.get('current')?.toString() ?? '0', 10);
    const target = parseInt(fd.get('target')?.toString() ?? '0', 10);
    const rows = parseInt(fd.get('rows')?.toString() ?? '0', 10);
    if (!current || !target || !rows) {
      evenlySummary.textContent = '—';
      evenlyDetail.textContent = '';
      evenlyRows.textContent = '';
      return;
    }
    const delta = target - current;
    const D = Math.abs(delta);
    const verb = delta > 0 ? 'Øk' : 'Senk';
    if (D === 0) {
      evenlySummary.textContent = 'Ingen endring trengs.';
      evenlyDetail.textContent = '';
      evenlyRows.textContent = '';
      return;
    }
    if (D > rows) {
      evenlySummary.textContent = 'Flere endringer enn rader — øk antall rader.';
      evenlyDetail.textContent = '';
      evenlyRows.textContent = '';
      return;
    }
    const q = Math.floor(rows / D);
    const r = rows % D;
    if (r === 0) {
      evenlySummary.textContent = `${verb} 1 maske hver ${q}. rad, ${D} ganger.`;
    } else {
      evenlySummary.textContent =
        `${verb} 1 maske hver ${q + 1}. rad ${r} gang${r === 1 ? '' : 'er'}, ` +
        `deretter hver ${q}. rad ${D - r} gang${(D - r) === 1 ? '' : 'er'}.`;
    }
    evenlyDetail.textContent = `${D} endringer over ${rows} rader, sluttantall ${target} masker.`;
    // Even-distribution row list (Bresenham-style — change at end of these rows).
    const list: number[] = [];
    for (let i = 0; i < D; i++) {
      list.push(Math.round(((i + 1) * rows) / D));
    }
    evenlyRows.textContent = `Endre etter rad: ${list.join(', ')}.`;
  }
  evenlyForm?.addEventListener('input', recalcEvenly);
  recalcEvenly();

  // ── Ruler ──
  // Calibrate via credit card (85.6 mm wide), then draw a cm/mm ruler.
  const STORAGE_KEY = 'littles-ruler-pxpmm';
  const DEFAULT_PXPMM = 3.7795; // 96 dpi
  const CARD_MM = 85.6;

  const rulerCard = document.querySelector<HTMLElement>('[data-ruler-card]');
  const rulerSlider = document.querySelector<HTMLInputElement>('[data-ruler-slider]');
  const rulerNarrow = document.querySelector<HTMLButtonElement>('[data-ruler-narrow]');
  const rulerWide = document.querySelector<HTMLButtonElement>('[data-ruler-wide]');
  const rulerSave = document.querySelector<HTMLButtonElement>('[data-ruler-save]');
  const rulerPxPmmLabel = document.querySelector<HTMLElement>('[data-ruler-pxpmm]');
  const rulerSaveMsg = document.querySelector<HTMLElement>('[data-ruler-savemsg]');
  const rulerSurface = document.querySelector<HTMLElement>('[data-ruler]');

  function loadPxPmm(): number {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return DEFAULT_PXPMM;
      const n = parseFloat(stored);
      return Number.isFinite(n) && n > 0 ? n : DEFAULT_PXPMM;
    } catch {
      return DEFAULT_PXPMM;
    }
  }

  function applyPxPmm(pxpmm: number) {
    if (rulerCard) rulerCard.style.width = `${Math.round(pxpmm * CARD_MM)}px`;
    if (rulerPxPmmLabel) rulerPxPmmLabel.textContent = pxpmm.toFixed(2).replace('.', ',');
    drawRuler(pxpmm);
  }

  function drawRuler(pxpmm: number) {
    if (!rulerSurface) return;
    rulerSurface.innerHTML = '';
    const totalWidth = rulerSurface.clientWidth;
    if (!totalWidth) return;
    const maxMm = Math.floor(totalWidth / pxpmm);
    const tickColor = 'rgba(44,42,38,0.7)';
    const subTickColor = 'rgba(44,42,38,0.35)';
    for (let mm = 0; mm <= maxMm; mm++) {
      const x = mm * pxpmm;
      const tall = mm % 10 === 0;
      const mid = mm % 5 === 0;
      const tick = document.createElement('div');
      tick.style.position = 'absolute';
      tick.style.left = `${x}px`;
      tick.style.top = '0';
      tick.style.width = '1px';
      tick.style.height = tall ? '34px' : mid ? '22px' : '12px';
      tick.style.background = tall ? tickColor : subTickColor;
      rulerSurface.appendChild(tick);
      if (tall) {
        const label = document.createElement('div');
        label.style.position = 'absolute';
        label.style.left = `${x + 2}px`;
        label.style.top = '36px';
        label.style.fontSize = '11px';
        label.style.color = 'rgba(44,42,38,0.7)';
        label.textContent = `${mm / 10}`;
        rulerSurface.appendChild(label);
      }
    }
    const cmLabel = document.createElement('div');
    cmLabel.style.position = 'absolute';
    cmLabel.style.right = '8px';
    cmLabel.style.bottom = '4px';
    cmLabel.style.fontSize = '10px';
    cmLabel.style.fontWeight = '700';
    cmLabel.style.letterSpacing = '0.18em';
    cmLabel.style.textTransform = 'uppercase';
    cmLabel.style.color = 'rgba(44,42,38,0.4)';
    cmLabel.textContent = 'cm';
    rulerSurface.appendChild(cmLabel);
  }

  let currentPxPmm = loadPxPmm();
  if (rulerSlider) rulerSlider.value = String(currentPxPmm);
  applyPxPmm(currentPxPmm);

  rulerSlider?.addEventListener('input', () => {
    currentPxPmm = parseFloat(rulerSlider.value);
    applyPxPmm(currentPxPmm);
  });
  rulerNarrow?.addEventListener('click', () => {
    if (!rulerSlider) return;
    currentPxPmm = Math.max(2.5, currentPxPmm - 0.05);
    rulerSlider.value = String(currentPxPmm);
    applyPxPmm(currentPxPmm);
  });
  rulerWide?.addEventListener('click', () => {
    if (!rulerSlider) return;
    currentPxPmm = Math.min(6, currentPxPmm + 0.05);
    rulerSlider.value = String(currentPxPmm);
    applyPxPmm(currentPxPmm);
  });
  rulerSave?.addEventListener('click', () => {
    try {
      localStorage.setItem(STORAGE_KEY, String(currentPxPmm));
      if (rulerSaveMsg) {
        rulerSaveMsg.textContent = 'Lagret. Linjalen vil huske kalibreringen din neste gang.';
        setTimeout(() => { if (rulerSaveMsg) rulerSaveMsg.textContent = ''; }, 3000);
      }
    } catch {
      if (rulerSaveMsg) rulerSaveMsg.textContent = 'Kunne ikke lagre — prøv igjen.';
    }
  });
  window.addEventListener('resize', () => drawRuler(currentPxPmm));
  // Redraw when the ruler tab becomes visible — its surface clientWidth
  // is 0 while the section is `hidden`, so the initial draw uses the
  // wrong width and the ticks land too tight.
  document.addEventListener('verktoy:show', (e) => {
    const detail = (e as CustomEvent<{ tool: string }>).detail;
    if (detail.tool === 'ruler') {
      requestAnimationFrame(() => drawRuler(currentPxPmm));
    }
  });
}
