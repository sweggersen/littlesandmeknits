// Web Vitals reporter (june26.md §1.7). Dependency-free: native
// PerformanceObserver for LCP / CLS / INP. Reports as a Plausible custom event,
// so it only does anything when product analytics is enabled (window.plausible
// present) — otherwise it's a silent no-op. Measured once per hard document
// load (call from a module script, not on every astro:page-load).

export function init(): void {
  if (typeof PerformanceObserver === 'undefined') return;

  const report = (metric: 'LCP' | 'CLS' | 'INP', value: number) => {
    const plausible = (window as unknown as { plausible?: (e: string, o?: unknown) => void }).plausible;
    plausible?.('web-vitals', { props: { metric, value: Math.round(value) } });
  };

  const observe = (type: string, cb: (entries: PerformanceEntryList) => void, extra: Record<string, unknown> = {}) => {
    try {
      new PerformanceObserver((list) => cb(list.getEntries())).observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
    } catch { /* type unsupported in this browser */ }
  };

  // LCP: largest-contentful-paint, last entry wins.
  observe('largest-contentful-paint', (entries) => {
    const last = entries[entries.length - 1] as (PerformanceEntry & { renderTime?: number; loadTime?: number }) | undefined;
    if (last) report('LCP', last.renderTime || last.loadTime || last.startTime);
  });

  // CLS: sum layout-shift values that weren't right after user input.
  let cls = 0;
  observe('layout-shift', (entries) => {
    for (const e of entries as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
      if (!e.hadRecentInput) cls += e.value;
    }
  });

  // INP-ish: worst interaction latency seen (event timing).
  let inp = 0;
  observe('event', (entries) => {
    for (const e of entries) if (e.duration > inp) inp = e.duration;
  }, { durationThreshold: 40 });

  // Flush on the first time the page is hidden (most reliable end-of-session signal).
  addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    if (cls > 0) report('CLS', cls * 1000); // ×1000 so the integer prop keeps precision
    if (inp > 0) report('INP', inp);
  }, { once: true });
}
