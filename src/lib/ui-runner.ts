// Tiny same-origin UI flow runner for /dev/ui-flows.
//
// Drives an <iframe> by manipulating its document directly. Each step is
// one of a small set of verbs. The runner highlights the affected element
// briefly so the human watching the panel can follow what's happening.
//
// This is NOT Playwright. It's a synthetic-click demo harness: the data
// and page are real, but clicks are programmatic. See docs/UI_RUNNER.md
// for the trade-off discussion.

export type FlowStep =
  | { action: 'goto'; url: string; label?: string }
  | { action: 'fill'; selector: string; value: string; label?: string }
  | { action: 'select'; selector: string; value: string; label?: string }
  | { action: 'check'; selector: string; checked?: boolean; label?: string }
  | { action: 'click'; selector?: string; text?: string; label?: string }
  | { action: 'expectText'; text: string; label?: string }
  | { action: 'expectUrl'; match: string | RegExp; label?: string }
  | { action: 'wait'; ms: number; label?: string }
  | { action: 'loginAs'; persona: 'liv' | 'eline' | 'maja' | 'nora' | 'kari' | null; label?: string }
  | { action: 'apiCall'; exec: string; actor?: string; params?: Record<string, unknown>; label?: string };

export type StepResult = { ok: true } | { ok: false; error: string };

const HIGHLIGHT_STYLE =
  'outline: 3px solid #C75B39 !important; outline-offset: 2px !important; transition: outline 120ms';
const DEFAULT_DELAY_MS = 350;

function describe(step: FlowStep): string {
  if (step.label) return step.label;
  switch (step.action) {
    case 'goto': return `goto ${step.url}`;
    case 'fill': return `fill ${step.selector}`;
    case 'select': return `select ${step.selector} = ${step.value}`;
    case 'check': return `check ${step.selector}`;
    case 'click': return `click ${step.selector ?? `text:"${step.text}"`}`;
    case 'expectText': return `expectText "${step.text}"`;
    case 'expectUrl': return `expectUrl ${step.match}`;
    case 'wait': return `wait ${step.ms}ms`;
    case 'loginAs': return `loginAs ${step.persona ?? '(anon)'}`;
    case 'apiCall': return `api ${step.exec}${step.actor ? ` (${step.actor})` : ''}`;
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function waitForLoad(iframe: HTMLIFrameElement, timeoutMs = 10_000): Promise<void> {
  // Astro's ClientRouter (view transitions) navigates via History API, so
  // the iframe's `load` event only fires on a full document swap. We listen
  // for both, plus `astro:page-load` inside the iframe document, and resolve
  // on whichever wins.
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      iframe.removeEventListener('load', onLoad);
      try { iframe.contentDocument?.removeEventListener('astro:page-load', onAstroLoad); } catch {}
      // Let the iframe's own scripts run a tick before we touch it.
      setTimeout(resolve, 50);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      iframe.removeEventListener('load', onLoad);
      try { iframe.contentDocument?.removeEventListener('astro:page-load', onAstroLoad); } catch {}
      reject(new Error(`iframe load timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    function onLoad() { finish(); }
    function onAstroLoad() { finish(); }
    iframe.addEventListener('load', onLoad);
    try { iframe.contentDocument?.addEventListener('astro:page-load', onAstroLoad); } catch {}
  });
}

function getDoc(iframe: HTMLIFrameElement): Document {
  const doc = iframe.contentDocument;
  if (!doc) throw new Error('iframe document unavailable (cross-origin?)');
  return doc;
}

function findByText(doc: Document, text: string): Element | null {
  const candidates = doc.querySelectorAll('button, a, [role="button"]');
  for (const el of Array.from(candidates)) {
    if ((el.textContent ?? '').trim().includes(text)) return el;
  }
  return null;
}

function scrollIntoView(el: Element): void {
  try {
    (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  } catch {
    // ignore — older browsers without scroll options
  }
}

async function highlight(el: Element, durationMs = 250): Promise<void> {
  scrollIntoView(el);
  // Let the smooth scroll catch up before we draw the outline.
  await sleep(Math.min(180, durationMs));
  const previous = (el as HTMLElement).getAttribute('style') ?? '';
  (el as HTMLElement).setAttribute('style', `${previous};${HIGHLIGHT_STYLE}`);
  await sleep(durationMs);
  if (previous) (el as HTMLElement).setAttribute('style', previous);
  else (el as HTMLElement).removeAttribute('style');
}

export type RunnerOptions = {
  iframe: HTMLIFrameElement;
  /** Delay between steps in ms. Default 350. */
  delayMs?: number;
  /** Called before/after each step so a UI can render status. */
  onStep?: (i: number, step: FlowStep, result: StepResult | 'running') => void;
  /** Performs a session login (or signs out when persona is null). */
  onLoginAs?: (persona: string | null) => Promise<void>;
  /** Calls a server action (e.g., /api/dev/test-exec) and returns its data. */
  onApiCall?: (exec: string, body: { actor?: string; params?: Record<string, unknown> }) => Promise<unknown>;
  /** Resolve dynamic placeholders in a goto URL just before navigation. */
  onResolveUrl?: (url: string) => string;
};

export async function runFlow(
  steps: FlowStep[],
  opts: RunnerOptions,
): Promise<{ passed: number; failed: number }> {
  const { iframe, onStep } = opts;
  const delay = opts.delayMs ?? DEFAULT_DELAY_MS;
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    onStep?.(i, step, 'running');
    try {
      await runStep(step, iframe, opts);
      onStep?.(i, step, { ok: true });
      passed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onStep?.(i, step, { ok: false, error: msg });
      failed++;
      // Stop on first failure so the visible state matches the failure point.
      return { passed, failed };
    }
    await sleep(delay);
  }
  return { passed, failed };
}

async function runStep(step: FlowStep, iframe: HTMLIFrameElement, opts: RunnerOptions): Promise<void> {
  if (step.action === 'goto') {
    const url = opts.onResolveUrl ? opts.onResolveUrl(step.url) : step.url;
    iframe.src = url;
    await waitForLoad(iframe);
    return;
  }
  if (step.action === 'wait') {
    await sleep(step.ms);
    return;
  }
  if (step.action === 'loginAs') {
    if (!opts.onLoginAs) throw new Error('loginAs used but no onLoginAs handler provided');
    await opts.onLoginAs(step.persona);
    return;
  }
  if (step.action === 'apiCall') {
    if (!opts.onApiCall) throw new Error('apiCall used but no onApiCall handler provided');
    await opts.onApiCall(step.exec, { actor: step.actor, params: step.params });
    return;
  }
  if (step.action === 'expectUrl') {
    const url = iframe.contentWindow?.location?.href ?? '';
    const matched = typeof step.match === 'string' ? url.includes(step.match) : step.match.test(url);
    if (!matched) throw new Error(`URL "${url}" did not match ${step.match}`);
    return;
  }
  if (step.action === 'expectText') {
    const doc = getDoc(iframe);
    const text = doc.body.innerText ?? '';
    if (!text.includes(step.text)) throw new Error(`Text "${step.text}" not found on page`);
    return;
  }

  // Element-targeted verbs.
  const doc = getDoc(iframe);
  let el: Element | null = null;
  if (step.action === 'click' && step.text && !step.selector) {
    el = findByText(doc, step.text);
    if (!el) throw new Error(`No clickable element with text "${step.text}"`);
  } else {
    const selector = (step as any).selector as string | undefined;
    if (!selector) throw new Error(`${step.action} requires selector`);
    el = doc.querySelector(selector);
    if (!el) throw new Error(`Selector "${selector}" matched nothing`);
  }

  await highlight(el);

  if (step.action === 'fill') {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    input.focus();
    input.value = step.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (step.action === 'select') {
    const select = el as HTMLSelectElement;
    select.value = step.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (step.action === 'check') {
    const cb = el as HTMLInputElement;
    cb.checked = step.checked ?? true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (step.action === 'click') {
    const button = el as HTMLElement;
    // Capture pre-click URL to detect navigation.
    const beforeUrl = iframe.contentWindow?.location?.href ?? '';
    button.click();

    // Wait briefly for the click's side-effects. We try (in order):
    //  - URL change detected within 200ms → wait for the next paint cycle
    //    + Astro's view-transition to settle. A short fixed wait is more
    //    reliable than racing on `load` (never fires for SPA nav) or
    //    `astro:page-load` (timing-sensitive listener attach).
    //  - No URL change after 200ms → treat as in-page click and return.
    await new Promise<void>((resolve) => {
      const start = Date.now();
      const tick = () => {
        const now = iframe.contentWindow?.location?.href ?? '';
        if (now !== beforeUrl) {
          // Navigation started. Give Astro's view transition + new
          // page scripts a moment to settle.
          setTimeout(resolve, 400);
          return;
        }
        if (Date.now() - start > 200) return resolve();
        requestAnimationFrame(tick);
      };
      tick();
    });
    return;
  }
}

export { describe };
