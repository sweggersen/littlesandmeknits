// Tiny same-origin UI flow runner for /dev/ui-flows.
//
// Drives an <iframe> by manipulating its document directly. Each step is
// one of a small set of verbs. The runner highlights the affected element
// briefly so the human watching the panel can follow what's happening.
//
// This is NOT Playwright. It's a synthetic-click demo harness: the data
// and page are real, but clicks are programmatic. See docs/UI_RUNNER.md
// for the trade-off discussion.

/** Card shown over the iframe during a step. Mainly used on apiCall/loginAs
 *  steps to explain what the shortcut is standing in for in real life. */
export type StepOverlay = {
  icon?: string;
  title: string;
  body?: string;
  note?: string;
};

type StepCommon = { label?: string; overlay?: StepOverlay };

export type FlowStep = StepCommon & (
  | { action: 'goto'; url: string }
  | { action: 'fill'; selector: string; value: string }
  | { action: 'select'; selector: string; value: string }
  | { action: 'check'; selector: string; checked?: boolean }
  | { action: 'click'; selector?: string; text?: string }
  | { action: 'expectText'; text: string }
  | { action: 'expectUrl'; match: string | RegExp }
  | { action: 'wait'; ms: number }
  | { action: 'loginAs'; persona: 'liv' | 'eline' | 'maja' | 'nora' | 'kari' | null }
  | { action: 'apiCall'; exec: string; actor?: string; params?: Record<string, unknown> }
  // bindUrl: extract a regex group from the iframe's current URL and stash
  // it under `key` so later steps can reference it as $key. Used to capture
  // IDs after a real form submit (e.g. /market/commissions/<id>).
  | { action: 'bindUrl'; key: string; pattern: string }
);

export type StepResult = { ok: true } | { ok: false; error: string };

const HIGHLIGHT_STYLE =
  'outline: 3px solid #C75B39 !important; outline-offset: 3px !important; box-shadow: 0 0 0 6px rgba(199, 91, 57, 0.25) !important; transition: outline 120ms, box-shadow 120ms';
const DEFAULT_DELAY_MS = 1400;

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
    case 'bindUrl': return `bindUrl $${step.key} from ${step.pattern}`;
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function waitForLoad(iframe: HTMLIFrameElement, expectedUrl: string, timeoutMs = 10_000): Promise<void> {
  // Poll-based wait. Resolves when:
  //   - the iframe's current pathname matches the expected URL, and
  //   - document.readyState is 'complete'.
  // More reliable than racing on `load` (fires before our listener attaches
  // at fast playback speeds) or `astro:page-load` (only fires within
  // ClientRouter context).
  let expectedPath = expectedUrl;
  try { expectedPath = new URL(expectedUrl, window.location.href).pathname; } catch { /* keep raw */ }

  // /market/listing/<uuid> 301-redirects to /market/listing/<slug>-<uuid>
  // for SEO. Match by trailing UUID so test seeds with bare ids still
  // resolve after the redirect.
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const expectedUuidMatch = expectedPath.match(UUID_RE);
  const expectedUuid = expectedUuidMatch?.[0] ?? null;

  function pathMatches(actual: string): boolean {
    if (actual === expectedPath) return true;
    // If the expected path ends in a UUID, accept any path that ends
    // in the same UUID (handles the pretty-URL 301 redirect).
    if (expectedUuid && actual.toLowerCase().endsWith(expectedUuid.toLowerCase())) {
      return true;
    }
    return false;
  }

  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      try {
        const win = iframe.contentWindow;
        const doc = iframe.contentDocument;
        if (win && doc) {
          const path = win.location.pathname;
          if (pathMatches(path) && doc.readyState === 'complete') {
            // Give the iframe a tick to run hydration scripts before we touch it.
            return setTimeout(resolve, 60);
          }
        }
      } catch { /* cross-origin during transition */ }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`iframe load timeout after ${timeoutMs}ms (expected ${expectedPath})`));
      }
      setTimeout(check, 40);
    };
    check();
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

// Find the smallest semantic element that contains the given text.
// Used by expectText so the runner can scroll/highlight what was asserted.
function findContainingElement(doc: Document, text: string): Element | null {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.textContent?.includes(text)) {
      let el: HTMLElement | null = node.parentElement;
      while (el && !el.matches('h1, h2, h3, h4, h5, h6, p, li, a, button, label, dd, dt, td, th, span, strong, em')) {
        el = el.parentElement;
      }
      return el ?? node.parentElement;
    }
  }
  return null;
}

// Find a good "landing element" to highlight after a page navigation —
// the first visible h1 if present, else h2, else any heading.
function findLandingHeading(doc: Document): Element | null {
  const headings = doc.querySelectorAll('h1, h2');
  for (const h of Array.from(headings)) {
    const rect = (h as HTMLElement).getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return h;
  }
  return doc.querySelector('h1, h2, h3');
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

// Re-exported for callers that want the per-step highlight duration to
// match the playback speed (longer when slowed down, near-zero on Maks).
export function highlightDurationFor(delayMs: number): number {
  return Math.max(180, Math.min(1200, Math.round(delayMs * 0.55)));
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
  /** Capture a value extracted from the iframe URL into a binding. */
  onBindUrl?: (key: string, value: string) => void;
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
  const dur = highlightDurationFor(opts.delayMs ?? DEFAULT_DELAY_MS);

  if (step.action === 'goto') {
    const url = opts.onResolveUrl ? opts.onResolveUrl(step.url) : step.url;
    iframe.src = url;
    await waitForLoad(iframe, url);
    // Highlight the landing page's main heading so the eye lands on
    // "what just appeared". Safe no-op if no heading found.
    try {
      const heading = findLandingHeading(getDoc(iframe));
      if (heading) await highlight(heading, dur);
    } catch { /* iframe might be re-loading */ }
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
  if (step.action === 'bindUrl') {
    if (!opts.onBindUrl) throw new Error('bindUrl used but no onBindUrl handler provided');
    // Poll for up to 10s so we tolerate slow form-submit redirects.
    const re = new RegExp(step.pattern);
    const start = Date.now();
    let url = '';
    let match: RegExpMatchArray | null = null;
    while (Date.now() - start < 10_000) {
      const win = iframe.contentWindow;
      if (win) {
        url = win.location.href;
        match = url.match(re);
        if (match && iframe.contentDocument?.readyState === 'complete') break;
      }
      await sleep(80);
    }
    if (!match) throw new Error(`bindUrl: pattern /${step.pattern}/ did not match ${url} within 10s`);
    const captured = match[1] ?? match[0];
    opts.onBindUrl(step.key, captured);
    return;
  }
  if (step.action === 'expectUrl') {
    const url = iframe.contentWindow?.location?.href ?? '';
    const matched = typeof step.match === 'string' ? url.includes(step.match) : step.match.test(url);
    if (!matched) throw new Error(`URL "${url}" did not match ${step.match}`);
    return;
  }
  if (step.action === 'expectText') {
    // Poll for up to 5s — handles slow nav/redirect cases where the new
    // page is still painting when this step runs.
    const start = Date.now();
    let doc: Document = getDoc(iframe);
    let bodyText = doc.body.innerText ?? '';
    while (!bodyText.includes(step.text) && Date.now() - start < 5_000) {
      await sleep(120);
      doc = getDoc(iframe);
      bodyText = doc.body.innerText ?? '';
    }
    if (!bodyText.includes(step.text)) throw new Error(`Text "${step.text}" not found on page`);
    const el = findContainingElement(doc, step.text);
    if (el) await highlight(el, dur);
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

  await highlight(el, highlightDurationFor(opts.delayMs ?? DEFAULT_DELAY_MS));

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
    // For <button type="submit"> inside a form, use form.requestSubmit(button)
    // so the form actually submits (synthetic .click() is unreliable here).
    const asButton = button as HTMLButtonElement;
    if (
      (asButton.tagName === 'BUTTON' && (asButton.type === 'submit' || asButton.type === ''))
      && asButton.form
    ) {
      asButton.form.requestSubmit(asButton);
    } else {
      button.click();
    }

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
