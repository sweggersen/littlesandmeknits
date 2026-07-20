// Deterministic in-memory Stripe double for flow simulation (test-tower /
// headless scenario runner). Implements exactly the subset the money services
// call, so the FULL escrow state machine — capture-at-ship, release-at-confirm,
// separate charges & transfers, refunds, cancels — runs faithfully in CI
// without a Stripe network dependency or a real PaymentIntent.
//
// Activated ONLY when STRIPE_SECRET_KEY === SIMULATE_STRIPE_KEY (see
// createStripe). A real prod key (sk_live_… / sk_test_…) never matches, so
// production is untouched. No env import here — keeps this off the unit-test
// cloudflare:workers graph.
import type Stripe from 'stripe';

export const SIMULATE_STRIPE_KEY = 'sk_simulate';

// PaymentIntents are tracked in-process by id so retrieve() reflects prior
// capture/cancel calls within a single run (a service that captures then a
// later step that retrieves sees 'succeeded'). Best-effort: the map is
// per-worker-instance, which is fine for a sequential scenario run.
const piState = new Map<string, string>();

function pi(id: string): Stripe.PaymentIntent {
  const status = piState.get(id) ?? 'requires_capture';
  return {
    id,
    status,
    // A charge id so releaseCommissionFunds' source_transaction path works.
    latest_charge: `ch_sim_${id}`,
    // No transfer_data → services take the "separate transfer" rail (creates a
    // transfer) rather than the legacy destination-charge rail.
    transfer_data: null,
  } as unknown as Stripe.PaymentIntent;
}

/** Minimal Stripe stand-in. Cast to Stripe at the boundary — it only needs to
 *  satisfy the methods the services actually invoke. */
export function createSimulatedStripe(): Stripe {
  const sim = {
    checkout: {
      sessions: {
        create: async (args: { metadata?: Record<string, string> }) => ({
          id: `cs_sim_${Date.now()}`,
          url: 'https://sim.stripe.local/checkout',
          payment_intent: `pi_sim_${Date.now()}`,
          metadata: args?.metadata ?? {},
        }),
      },
    },
    paymentIntents: {
      retrieve: async (id: string) => pi(id),
      capture: async (id: string) => { piState.set(id, 'succeeded'); return pi(id); },
      cancel: async (id: string) => { piState.set(id, 'canceled'); return pi(id); },
    },
    transfers: {
      create: async () => ({ id: `tr_sim_${Date.now()}` }),
    },
    refunds: {
      create: async () => ({ id: `re_sim_${Date.now()}` }),
    },
    // Connect Custom accounts (become-seller). A simulated account is returned
    // fully enabled so statusFromAccount() derives 'verified' — locally there's
    // no account.updated webhook to flip it later.
    accounts: {
      create: async () => ({
        id: `acct_sim_${Date.now()}`,
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { currently_due: [], disabled_reason: null },
      }),
      retrieve: async (id: string) => ({
        id,
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { currently_due: [], disabled_reason: null },
      }),
    },
    accountLinks: {
      create: async () => ({ url: 'https://sim.stripe.local/connect-onboarding' }),
    },
  };
  return sim as unknown as Stripe;
}
