// Shared flow scenarios — the single source of truth for both the visual
// test-tower (/dev/test-tower) and the headless CI runner (e2e/scenarios.spec).
// Each scenario is a sequence of steps that drive /api/dev/test-exec (the real
// services, with the simulated Stripe double) and assert against get-state.
//
// Assertions are `[label, actual, expected]` triples; the runner checks
// deepEqual(actual, expected). Step params may reference a prior step's output
// with `$stepId.field` (e.g. `'$create-listing.id'`).

export type Assertion = [label: string, actual: unknown, expected: unknown];

export interface ScenarioStep {
  id: string;
  actor: string;            // persona key (see PERSONAS)
  action: string;           // test-exec action
  label: string;
  params?: Record<string, unknown>;
  expect?: (state: any) => Assertion[];
}

export interface Scenario {
  title: string;
  desc?: string;
  /** Which entity id to thread into get-state. */
  track: 'listing' | 'request' | 'none';
  personas: string[];
  /** Extra get-state flags (e.g. 'include_profiles', 'include_reports'). */
  stateFlags?: string[];
  steps: ScenarioStep[];
}

export const PERSONAS: Record<string, { email: string; name: string; role: string }> = {
  liv: { email: 'liv@test.strikketorget.no', name: 'Liv', role: 'buyer' },
  eline: { email: 'eline@test.strikketorget.no', name: 'Eline', role: 'knitter' },
  maja: { email: 'maja@test.strikketorget.no', name: 'Maja', role: 'knitter' },
  ingrid: { email: 'ingrid@test.strikketorget.no', name: 'Ingrid', role: 'knitter' },
  kari: { email: 'kari@test.strikketorget.no', name: 'Kari', role: 'moderator' },
  nora: { email: 'nora@test.strikketorget.no', name: 'Nora', role: 'admin' },
};

const has = (events: any[] | undefined, type: string) =>
  !!events?.some((e) => e.event_type === type);

export const SCENARIOS: Record<string, Scenario> = {
  'listing-purchase': {
    title: 'Kjøp & levering (escrow)',
    desc: 'Full kjøpsflyt gjennom de ekte tjenestene + simulert Stripe: annonse → kjøp → sending → bekreft → vurdering. Sjekker ordre-state OG payment_events-hovedboka.',
    track: 'listing',
    personas: ['eline', 'liv'],
    stateFlags: ['include_profiles'],
    steps: [
      {
        id: 'setup-seller', actor: 'eline', action: 'set-stripe-onboarded',
        label: 'Eline er Stripe-verifisert selger',
        expect: (s) => [
          ['seller connect verified', s.profiles?.['eline@test.strikketorget.no']?.stripe_connect_status, 'verified'],
        ],
      },
      {
        id: 'trust-seller', actor: 'eline', action: 'set-trust',
        label: 'Eline er betrodd selger (auto-godkjenn)',
        params: { trust_tier: 'trusted', trust_score: 100 },
      },
      {
        id: 'create-listing', actor: 'eline', action: 'create-listing',
        label: 'Eline oppretter annonse',
        params: { title: 'Strikket genser str 2 år', kind: 'pre_loved', category: 'genser', size_label: '2 år', price_nok: 349, condition: 'lite_brukt', description: 'Vakker strikket genser i merinoull.' },
        expect: (s) => [['listing draft', s.listing?.status, 'draft']],
      },
      {
        id: 'publish', actor: 'eline', action: 'publish-listing',
        label: 'Publiser annonse',
        params: { listing_id: '$create-listing.id' },
        expect: (s) => [['listing active', s.listing?.status, 'active']],
      },
      {
        id: 'purchase', actor: 'liv', action: 'purchase-listing',
        label: 'Liv kjøper (escrow-hold)',
        params: {
          listing_id: '$create-listing.id',
          buyer_name: 'Liv Johansen', buyer_address: 'Storgata 12',
          buyer_postal_code: '0155', buyer_city: 'Oslo',
        },
        expect: (s) => [
          ['listing reserved (projection)', s.listing?.status, 'reserved'],
          ['order reserved (source of truth)', s.order?.status, 'reserved'],
          ['order buyer set', !!s.order?.buyer_id, true],
          ['shipping PII on order not listing', s.order?.shipping_name, 'Liv Johansen'],
          ['shipping city', s.order?.shipping_city, 'Oslo'],
          ['ship-by deadline set', !!s.order?.ship_deadline_at, true],
          ['ledger: reserved event', has(s.payment_events, 'reserved'), true],
        ],
      },
      {
        id: 'ship', actor: 'eline', action: 'ship-listing',
        label: 'Eline sender (capture-at-ship)',
        params: { listing_id: '$create-listing.id', tracking_code: 'POSTEN-98765' },
        expect: (s) => [
          ['listing shipped', s.listing?.status, 'shipped'],
          ['order shipped', s.order?.status, 'shipped'],
          ['tracking on order', s.order?.tracking_code, 'POSTEN-98765'],
          ['shipped_at set', !!s.order?.shipped_at, true],
          ['ledger: captured event', has(s.payment_events, 'captured'), true],
        ],
      },
      {
        id: 'confirm', actor: 'liv', action: 'confirm-listing-delivery',
        label: 'Liv bekrefter mottak (escrow frigis)',
        params: { listing_id: '$create-listing.id' },
        expect: (s) => [
          ['listing sold', s.listing?.status, 'sold'],
          ['order delivered', s.order?.status, 'delivered'],
          ['delivered_at set', !!s.order?.delivered_at, true],
          ['ledger: released event', has(s.payment_events, 'released'), true],
        ],
      },
      {
        id: 'review', actor: 'liv', action: 'submit-seller-review',
        label: 'Liv vurderer selger',
        params: { listing_id: '$create-listing.id', rating: 5, comment: 'Nydelig genser, rask levering!' },
        expect: (s) => [
          ['one review', s.seller_reviews?.length, 1],
          ['rating 5', s.seller_reviews?.[0]?.rating, 5],
        ],
      },
    ],
  },
};
