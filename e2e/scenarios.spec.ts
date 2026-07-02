import { test, expect, type APIRequestContext } from '@playwright/test';
import { SCENARIOS, PERSONAS, type Scenario } from '../src/lib/dev/scenarios';

// Headless scenario runner (flow-simulation system). Executes the SHARED
// scenario definitions (src/lib/dev/scenarios.ts — same ones the visual
// test-tower uses) against the REAL services via /api/dev/test-exec, with the
// simulated Stripe double (STRIPE_SECRET_KEY=sk_simulate). One CI test per
// scenario → every business flow runs on every commit, and the money paths
// assert both entity state AND the payment_events ledger.

let adminToken: string;

async function exec(api: APIRequestContext, action: string, actorEmail: string | undefined, params: Record<string, unknown>) {
  const res = await api.post('/api/dev/test-exec', {
    headers: { 'X-Admin-Token': adminToken, 'Content-Type': 'application/json' },
    data: { action, actor: actorEmail, params },
  });
  const json = await res.json();
  return json as { ok: boolean; data?: any; error?: string };
}

/** Resolve `$stepId.field` param refs against prior step outputs. */
function resolveParams(params: Record<string, unknown>, results: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' && v.startsWith('$')) {
      const [sid, field] = v.slice(1).split('.');
      out[k] = results[sid]?.[field];
    } else out[k] = v;
  }
  return out;
}

const CREATE_LISTING = new Set(['create-listing', 'create-listing-moderated']);
const CREATE_REQUEST = new Set(['create-request', 'create-request-moderated']);

/** Build get-state params: thread the tracked entity id + any scenario flags. */
function stateParams(scenario: Scenario, results: Record<string, any>): Record<string, unknown> {
  const params: Record<string, unknown> = {
    user_emails: scenario.personas.map((k) => PERSONAS[k].email),
  };
  for (const step of scenario.steps) {
    const r = results[step.id];
    if (!r?.id) continue;
    if (scenario.track === 'listing' && CREATE_LISTING.has(step.action)) params.listing_id = r.id;
    if (scenario.track === 'request' && CREATE_REQUEST.has(step.action)) params.request_id = r.id;
    if (r.queue_item_id) params.queue_item_id = r.queue_item_id;
  }
  for (const flag of scenario.stateFlags ?? []) params[flag] = true;
  return params;
}

test.describe('Flow scenarios (real services + simulated Stripe)', () => {
  test.beforeAll(async ({ request }) => {
    adminToken = (await (await request.get('/api/dev/test-token')).json()).token;
  });

  for (const [key, scenario] of Object.entries(SCENARIOS)) {
    test(`${key}: ${scenario.title}`, async ({ request }) => {
      // Fresh state; ensure every persona exists (test-login auto-creates).
      await exec(request, 'cleanup', undefined, {});
      for (const p of scenario.personas) {
        await request.post('/api/dev/test-login', { data: { email: PERSONAS[p].email } });
      }

      const results: Record<string, any> = {};
      try {
        for (const step of scenario.steps) {
          const params = resolveParams(step.params ?? {}, results);
          const r = await exec(request, step.action, PERSONAS[step.actor].email, params);
          if (step.expectFail) {
            expect(r.ok, `step "${step.id}" (${step.action}) was expected to FAIL but succeeded`).toBeFalsy();
          } else {
            expect(r.ok, `step "${step.id}" (${step.action}) failed: ${r.error}`).toBeTruthy();
          }
          results[step.id] = r.data ?? {};

          if (!step.expect) continue;
          const state = await exec(request, 'get-state', undefined, stateParams(scenario, results));
          expect(state.ok, `get-state after "${step.id}" failed: ${state.error}`).toBeTruthy();
          for (const [label, actual, expected] of step.expect(state.data)) {
            expect(actual, `[${key} · ${step.id}] ${label}`).toEqual(expected);
          }
        }
      } finally {
        await exec(request, 'cleanup', undefined, {});
      }
    });
  }
});
