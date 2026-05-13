#!/usr/bin/env -S npx --yes tsx
/**
 * Headless smoke test — runs the Test Control Tower scenarios against a live
 * deployment (staging preview or local dev). Designed to run post-deploy.
 *
 * Usage:
 *   SMOKE_URL=https://xxx.workers.dev SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/smoke-test.ts
 *   SMOKE_URL=http://localhost:4321 SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/smoke-test.ts
 *
 * Env vars:
 *   SMOKE_URL                   — base URL of the deployment (required)
 *   SUPABASE_SERVICE_ROLE_KEY   — used to generate the admin HMAC token (required)
 *   SMOKE_SCENARIOS             — comma-separated list to run (default: all)
 */

// ── Helpers ──────────────────────────────────────────

const BASE = process.env.SMOKE_URL?.replace(/\/$/, '');
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!BASE) { console.error('SMOKE_URL is required'); process.exit(1); }
if (!SRK) { console.error('SUPABASE_SERVICE_ROLE_KEY is required'); process.exit(1); }

async function makeAdminToken(): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(SRK), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const today = new Date().toISOString().slice(0, 10);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`admin-tower-${today}`));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).slice(0, 43);
}

let adminToken = '';

async function exec(action: string, actor: string | null, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/api/dev/test-exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': adminToken },
    body: JSON.stringify({ action, actor, params }),
  });
  const json = await res.json() as Record<string, unknown>;
  if (!json.ok) throw new Error(`exec ${action} failed: ${(json as any).error ?? res.status}`);
  return (json.data ?? json) as Record<string, unknown>;
}

async function getState(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  return exec('get-state', null, params);
}

async function cleanup() {
  await exec('cleanup', null);
}

function resolve(value: unknown, results: Map<string, Record<string, unknown>>): unknown {
  if (typeof value !== 'string' || !value.startsWith('$')) return value;
  const [stepId, field] = value.slice(1).split('.');
  const stepResult = results.get(stepId);
  if (!stepResult) throw new Error(`Unresolved ref: ${value} (step "${stepId}" not yet run)`);
  return stepResult[field];
}

function resolveParams(params: Record<string, unknown>, results: Map<string, Record<string, unknown>>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    resolved[k] = resolve(v, results);
  }
  return resolved;
}

function dig(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

// ── Personas ─────────────────────────────────────────

const P = {
  liv:    'liv@test.strikketorget.no',
  eline:  'eline@test.strikketorget.no',
  maja:   'maja@test.strikketorget.no',
  ingrid: 'ingrid@test.strikketorget.no',
  kari:   'kari@test.strikketorget.no',
  nora:   'nora@test.strikketorget.no',
} as const;

type PersonaKey = keyof typeof P;
const allEmails = Object.values(P);

// ── Assertion type ───────────────────────────────────

interface Assertion {
  label: string;
  path: string;
  expected: unknown;
  compare?: 'eq' | 'gte' | 'truthy';
}

interface Step {
  id: string;
  actor: PersonaKey;
  action: string;
  params: Record<string, unknown>;
  expectFail?: boolean;
  assertions: Assertion[];
}

interface Scenario {
  name: string;
  title: string;
  track: 'request' | 'listing';
  steps: Step[];
}

// ── Scenario definitions ─────────────────────────────

const SCENARIOS: Scenario[] = [
  {
    name: 'commission',
    title: 'Commission — standard flow',
    track: 'request',
    steps: [
      {
        id: 'create-request', actor: 'liv', action: 'create-request',
        params: { title: 'Mariusgenser i str 2 år', category: 'genser', size_label: '2 år', budget_nok_min: 800, budget_nok_max: 1500, description: 'Smoke test.' },
        assertions: [
          { label: 'request.status=open', path: 'request.status', expected: 'open' },
        ],
      },
      {
        id: 'offer-eline', actor: 'eline', action: 'make-offer',
        params: { request_id: '$create-request.id', price_nok: 1200, turnaround_weeks: 3, message: 'Smoke test offer.' },
        assertions: [
          { label: 'offers.length=1', path: 'offers.length', expected: 1 },
          { label: 'offer pending', path: 'offers.0.status', expected: 'pending' },
        ],
      },
      {
        id: 'accept', actor: 'liv', action: 'accept-offer',
        params: { offer_id: '$offer-eline.id' },
        assertions: [
          { label: 'awaiting_payment', path: 'request.status', expected: 'awaiting_payment' },
        ],
      },
      {
        id: 'pay', actor: 'liv', action: 'pay',
        params: { request_id: '$create-request.id' },
        assertions: [
          { label: 'awarded', path: 'request.status', expected: 'awarded' },
          { label: 'project exists', path: 'project', expected: true, compare: 'truthy' },
        ],
      },
      {
        id: 'complete', actor: 'eline', action: 'mark-completed',
        params: { request_id: '$create-request.id' },
        assertions: [
          { label: 'completed', path: 'request.status', expected: 'completed' },
        ],
      },
      {
        id: 'deliver', actor: 'liv', action: 'confirm-delivery',
        params: { request_id: '$create-request.id' },
        assertions: [
          { label: 'delivered', path: 'request.status', expected: 'delivered' },
        ],
      },
    ],
  },
  {
    name: 'commission-yarn',
    title: 'Commission — buyer-provided yarn + competing offers',
    track: 'request',
    steps: [
      {
        id: 'create-request', actor: 'liv', action: 'create-request',
        params: { title: 'Babyteppe merinoull', category: 'teppe', size_label: '70x90cm', budget_nok_min: 600, budget_nok_max: 1200, yarn_provided_by_buyer: true },
        assertions: [
          { label: 'open', path: 'request.status', expected: 'open' },
          { label: 'yarn flag', path: 'request.yarn_provided_by_buyer', expected: true },
        ],
      },
      {
        id: 'offer-eline', actor: 'eline', action: 'make-offer',
        params: { request_id: '$create-request.id', price_nok: 900, turnaround_weeks: 4, message: 'Offer 1' },
        assertions: [{ label: '1 offer', path: 'offers.length', expected: 1 }],
      },
      {
        id: 'offer-maja', actor: 'maja', action: 'make-offer',
        params: { request_id: '$create-request.id', price_nok: 1100, turnaround_weeks: 2, message: 'Offer 2' },
        assertions: [{ label: '2 offers', path: 'offers.length', expected: 2 }],
      },
      {
        id: 'accept', actor: 'liv', action: 'accept-offer',
        params: { offer_id: '$offer-eline.id' },
        assertions: [
          { label: 'awaiting_payment', path: 'request.status', expected: 'awaiting_payment' },
        ],
      },
      {
        id: 'pay', actor: 'liv', action: 'pay',
        params: { request_id: '$create-request.id' },
        assertions: [
          { label: 'awaiting_yarn', path: 'request.status', expected: 'awaiting_yarn' },
        ],
      },
      {
        id: 'ship-yarn', actor: 'liv', action: 'ship-yarn',
        params: { request_id: '$create-request.id', tracking_code: 'SMOKE-TRACK-001' },
        assertions: [
          { label: 'yarn_shipped_at', path: 'request.yarn_shipped_at', expected: true, compare: 'truthy' },
        ],
      },
      {
        id: 'receive-yarn', actor: 'eline', action: 'receive-yarn',
        params: { request_id: '$create-request.id' },
        assertions: [
          { label: 'awarded', path: 'request.status', expected: 'awarded' },
          { label: 'project active', path: 'project.status', expected: 'active' },
        ],
      },
      {
        id: 'complete', actor: 'eline', action: 'mark-completed',
        params: { request_id: '$create-request.id' },
        assertions: [{ label: 'completed', path: 'request.status', expected: 'completed' }],
      },
      {
        id: 'deliver', actor: 'liv', action: 'confirm-delivery',
        params: { request_id: '$create-request.id' },
        assertions: [{ label: 'delivered', path: 'request.status', expected: 'delivered' }],
      },
    ],
  },
  {
    name: 'listing',
    title: 'Listing + messaging',
    track: 'listing',
    steps: [
      {
        id: 'create-listing', actor: 'eline', action: 'create-listing',
        params: { title: 'Smoke test genser', kind: 'pre_loved', category: 'genser', size_label: '3 år', price_nok: 249, condition: 'lite_brukt' },
        assertions: [{ label: 'draft', path: 'listing.status', expected: 'draft' }],
      },
      {
        id: 'publish', actor: 'eline', action: 'publish-listing',
        params: { listing_id: '$create-listing.id' },
        assertions: [{ label: 'active', path: 'listing.status', expected: 'active' }],
      },
      {
        id: 'message', actor: 'liv', action: 'send-message',
        params: { listing_id: '$create-listing.id', message: 'Smoke test message' },
        assertions: [
          { label: 'conversation', path: 'conversations.length', expected: 1 },
        ],
      },
      {
        id: 'reply', actor: 'eline', action: 'reply',
        params: { conversation_id: '$message.conversationId', message: 'Smoke test reply' },
        assertions: [
          { label: '2 messages', path: 'conversations.0.marketplace_messages.length', expected: 2 },
        ],
      },
    ],
  },
  {
    name: 'mod-approve',
    title: 'Moderation — experienced moderator approves',
    track: 'listing',
    steps: [
      { id: 'setup-nora', actor: 'nora', action: 'set-role', params: { role: 'admin' }, assertions: [] },
      { id: 'setup-kari', actor: 'kari', action: 'set-role', params: { role: 'moderator' }, assertions: [] },
      {
        id: 'setup-kari-stats', actor: 'kari', action: 'set-mod-stats',
        params: { total_reviews: 60, total_approvals: 55, total_rejections: 5, rate_nok_per_review: 2.00 },
        assertions: [],
      },
      {
        id: 'create-listing', actor: 'eline', action: 'create-listing-moderated',
        params: { title: 'Smoke mod listing', price_nok: 349, category: 'genser', size_label: '6 mnd' },
        assertions: [
          { label: 'pending_review', path: 'listing.status', expected: 'pending_review' },
          { label: 'queue pending', path: 'queue_item.status', expected: 'pending' },
        ],
      },
      {
        id: 'approve', actor: 'kari', action: 'moderate-review',
        params: { queue_item_id: '$create-listing.queue_item_id', decision: 'approve' },
        assertions: [
          { label: 'listing active', path: 'listing.status', expected: 'active' },
          { label: 'queue approved', path: 'queue_item.status', expected: 'approved' },
          { label: 'not shadow', path: 'queue_item.shadow_review', expected: false },
        ],
      },
    ],
  },
  {
    name: 'shadow-review',
    title: 'Shadow review — new moderator, admin confirms',
    track: 'listing',
    steps: [
      { id: 'setup-nora', actor: 'nora', action: 'set-role', params: { role: 'admin' }, assertions: [] },
      { id: 'setup-kari', actor: 'kari', action: 'set-role', params: { role: 'moderator' }, assertions: [] },
      {
        id: 'setup-kari-new', actor: 'kari', action: 'set-mod-stats',
        params: { total_reviews: 10, total_approvals: 9, total_rejections: 1 },
        assertions: [],
      },
      {
        id: 'create-listing', actor: 'eline', action: 'create-listing-moderated',
        params: { title: 'Shadow test listing', price_nok: 129, category: 'votter', size_label: '0-6 mnd' },
        assertions: [{ label: 'pending', path: 'listing.status', expected: 'pending_review' }],
      },
      {
        id: 'kari-approves', actor: 'kari', action: 'moderate-review',
        params: { queue_item_id: '$create-listing.queue_item_id', decision: 'approve' },
        assertions: [
          { label: 'listing still pending', path: 'listing.status', expected: 'pending_review' },
          { label: 'shadow flag', path: 'queue_item.shadow_review', expected: true },
          { label: 'not confirmed', path: 'queue_item.shadow_confirmed_at', expected: null },
        ],
      },
      {
        id: 'nora-confirms', actor: 'nora', action: 'shadow-confirm',
        params: { queue_item_id: '$create-listing.queue_item_id', action: 'confirm' },
        assertions: [
          { label: 'listing active', path: 'listing.status', expected: 'active' },
          { label: 'confirmed', path: 'queue_item.shadow_confirmed_at', expected: true, compare: 'truthy' },
        ],
      },
    ],
  },
  {
    name: 'shadow-override',
    title: 'Shadow review — admin overrides wrong rejection',
    track: 'listing',
    steps: [
      { id: 'setup-nora', actor: 'nora', action: 'set-role', params: { role: 'admin' }, assertions: [] },
      { id: 'setup-kari', actor: 'kari', action: 'set-role', params: { role: 'moderator' }, assertions: [] },
      {
        id: 'setup-kari-new', actor: 'kari', action: 'set-mod-stats',
        params: { total_reviews: 5, total_approvals: 4, total_rejections: 1, shadow_overrides: 0 },
        assertions: [],
      },
      {
        id: 'create-listing', actor: 'eline', action: 'create-listing-moderated',
        params: { title: 'Override test listing', price_nok: 199, category: 'lue', size_label: '2-4 år' },
        assertions: [{ label: 'pending', path: 'listing.status', expected: 'pending_review' }],
      },
      {
        id: 'kari-rejects', actor: 'kari', action: 'moderate-review',
        params: { queue_item_id: '$create-listing.queue_item_id', decision: 'reject', rejection_reason: 'Spam test' },
        assertions: [
          { label: 'listing still pending', path: 'listing.status', expected: 'pending_review' },
          { label: 'shadow', path: 'queue_item.shadow_review', expected: true },
        ],
      },
      {
        id: 'nora-overrides', actor: 'nora', action: 'shadow-confirm',
        params: { queue_item_id: '$create-listing.queue_item_id', action: 'override' },
        assertions: [
          { label: 'listing active', path: 'listing.status', expected: 'active' },
          { label: 'overridden to approved', path: 'queue_item.status', expected: 'approved' },
        ],
      },
    ],
  },
  {
    name: 'reviews-trust',
    title: 'Bidirectional reviews + trust',
    track: 'request',
    steps: [
      {
        id: 'create-request', actor: 'liv', action: 'create-request',
        params: { title: 'Babysokker smoke', category: 'sokker', size_label: '0-6 mnd', budget_nok_min: 150, budget_nok_max: 300 },
        assertions: [{ label: 'open', path: 'request.status', expected: 'open' }],
      },
      {
        id: 'offer', actor: 'eline', action: 'make-offer',
        params: { request_id: '$create-request.id', price_nok: 200, turnaround_weeks: 1, message: 'Quick smoke' },
        assertions: [],
      },
      { id: 'accept', actor: 'liv', action: 'accept-offer', params: { offer_id: '$offer.id' }, assertions: [] },
      { id: 'pay', actor: 'liv', action: 'pay', params: { request_id: '$create-request.id' }, assertions: [] },
      { id: 'complete', actor: 'eline', action: 'mark-completed', params: { request_id: '$create-request.id' }, assertions: [] },
      { id: 'deliver', actor: 'liv', action: 'confirm-delivery', params: { request_id: '$create-request.id' }, assertions: [] },
      {
        id: 'review-buyer', actor: 'liv', action: 'submit-tx-review',
        params: { commission_request_id: '$create-request.id', rating: 4, comment: 'Great!' },
        assertions: [
          { label: '1 review', path: 'tx_reviews.length', expected: 1 },
          { label: 'not visible', path: 'tx_reviews.0.visible', expected: false },
        ],
      },
      {
        id: 'review-knitter', actor: 'eline', action: 'submit-tx-review',
        params: { commission_request_id: '$create-request.id', rating: 5, comment: 'Lovely!' },
        assertions: [
          { label: '2 reviews', path: 'tx_reviews.length', expected: 2 },
        ],
      },
    ],
  },
  {
    name: 'self-review-block',
    title: 'Anti-abuse — cannot review own submission',
    track: 'request',
    steps: [
      { id: 'setup-kari', actor: 'kari', action: 'set-role', params: { role: 'moderator' }, assertions: [] },
      { id: 'setup-kari-stats', actor: 'kari', action: 'set-mod-stats', params: { total_reviews: 60 }, assertions: [] },
      {
        id: 'kari-submits', actor: 'kari', action: 'create-request-moderated',
        params: { title: 'Self review test', category: 'cardigan', size_label: 'M', budget_nok_min: 500, budget_nok_max: 1000 },
        assertions: [{ label: 'pending_review', path: 'request.status', expected: 'pending_review' }],
      },
      {
        id: 'self-review-fails', actor: 'kari', action: 'moderate-review',
        params: { queue_item_id: '$kari-submits.queue_item_id', decision: 'approve' },
        expectFail: true,
        assertions: [],
      },
    ],
  },
];

// ── Runner ───────────────────────────────────────────

function checkAssertion(state: Record<string, unknown>, a: Assertion): boolean {
  const actual = dig(state, a.path);
  if (a.compare === 'truthy') return !!actual;
  if (a.compare === 'gte') return typeof actual === 'number' && actual >= (a.expected as number);
  return JSON.stringify(actual) === JSON.stringify(a.expected);
}

async function runScenario(scenario: Scenario): Promise<{ passed: number; failed: number; errors: string[] }> {
  const results = new Map<string, Record<string, unknown>>();
  let passed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const step of scenario.steps) {
    const params = resolveParams(step.params, results);

    let stepResult: Record<string, unknown>;
    try {
      stepResult = await exec(step.action, P[step.actor], params);
      if (step.expectFail) {
        errors.push(`  FAIL  ${step.id}: expected failure but succeeded`);
        failed++;
        continue;
      }
    } catch (e) {
      if (step.expectFail) {
        passed++;
        results.set(step.id, {});
        continue;
      }
      errors.push(`  FAIL  ${step.id}: ${e instanceof Error ? e.message : String(e)}`);
      failed++;
      continue;
    }

    results.set(step.id, stepResult);

    if (step.assertions.length === 0) continue;

    const stateParams: Record<string, unknown> = { user_emails: allEmails, include_profiles: true };
    if (scenario.track === 'request') {
      const reqId = resolve('$create-request.id', results) as string | undefined;
      if (reqId) {
        stateParams.request_id = reqId;
        stateParams.include_tx_reviews = true;
      }
    } else {
      const listingId = resolve('$create-listing.id', results) as string | undefined;
      if (listingId) stateParams.listing_id = listingId;
    }

    const queueItemId = results.get('create-listing')?.queue_item_id ?? results.get('kari-submits')?.queue_item_id;
    if (queueItemId) stateParams.queue_item_id = queueItemId;
    stateParams.include_mod_stats = true;
    stateParams.include_reports = true;
    stateParams.include_payouts = true;

    const state = await getState(stateParams);

    for (const a of step.assertions) {
      if (checkAssertion(state, a)) {
        passed++;
      } else {
        const actual = dig(state, a.path);
        errors.push(`  FAIL  ${step.id} > ${a.label}: expected ${JSON.stringify(a.expected)}, got ${JSON.stringify(actual)}`);
        failed++;
      }
    }
  }

  return { passed, failed, errors };
}

// ── Main ─────────────────────────────────────────────

async function main() {
  adminToken = await makeAdminToken();

  const filter = process.env.SMOKE_SCENARIOS?.split(',').map(s => s.trim());
  const toRun = filter ? SCENARIOS.filter(s => filter.includes(s.name)) : SCENARIOS;

  console.log(`\nSmoke test against ${BASE}`);
  console.log(`Running ${toRun.length} scenario${toRun.length === 1 ? '' : 's'}\n`);

  let totalPassed = 0;
  let totalFailed = 0;
  const allErrors: string[] = [];

  for (const scenario of toRun) {
    process.stdout.write(`  ${scenario.title} ... `);

    try {
      await cleanup();
    } catch {
      // first run, no data yet
    }

    try {
      const { passed, failed, errors } = await runScenario(scenario);
      totalPassed += passed;
      totalFailed += failed;

      if (failed === 0) {
        console.log(`OK (${passed} assertions)`);
      } else {
        console.log(`FAIL (${passed} passed, ${failed} failed)`);
        allErrors.push(`\n${scenario.title}:`);
        allErrors.push(...errors);
      }
    } catch (e) {
      totalFailed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`ERROR: ${msg}`);
      allErrors.push(`\n${scenario.title}: ${msg}`);
    }
  }

  try {
    await cleanup();
  } catch {
    // best effort
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Total: ${totalPassed} passed, ${totalFailed} failed`);

  if (allErrors.length > 0) {
    console.log('\nFailures:');
    console.log(allErrors.join('\n'));
  }

  console.log('');
  process.exit(totalFailed > 0 ? 1 : 0);
}

main();
