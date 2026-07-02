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
  'commission': {
    title: 'Strikke-oppdrag',
    desc: 'Standard oppdragsflyt: forespørsel → tilbud → aksept → betaling → ferdig → levert.',
    track: 'request',
    personas: ['liv', 'eline'],
    steps: [
      {
        id: 'verify-knitter', actor: 'eline', action: 'set-stripe-onboarded',
        label: 'Eline er Stripe-verifisert (kan motta betaling)',
      },
      {
        id: 'create-request', actor: 'liv', action: 'create-request',
        label: 'Liv oppretter forespørsel',
        params: { title: 'Mariusgenser i str 2 år', category: 'genser', size_label: '2 år', budget_nok_min: 800, budget_nok_max: 1500, description: 'Klassisk Mariusgenser, str 2 år.' },
        expect: (s) => [
          ['request open', s.request?.status, 'open'],
          ['no offers', s.offers?.length ?? 0, 0],
        ],
      },
      {
        id: 'offer-eline', actor: 'eline', action: 'make-offer',
        label: 'Eline gir tilbud',
        params: { request_id: '$create-request.id', price_nok: 1200, turnaround_weeks: 3, message: 'Jeg har strikket mange mariusgensere.' },
        expect: (s) => [
          ['offer_count 1', s.request?.offer_count, 1],
          ['offer pending', s.offers?.[0]?.status, 'pending'],
        ],
      },
      {
        id: 'accept', actor: 'liv', action: 'accept-offer',
        label: 'Liv aksepterer',
        params: { offer_id: '$offer-eline.id' },
        expect: (s) => [
          ['awaiting_payment', s.request?.status, 'awaiting_payment'],
          ['awarded_offer set', !!s.request?.awarded_offer_id, true],
        ],
      },
      {
        id: 'pay', actor: 'liv', action: 'pay',
        label: 'Liv betaler (prosjekt opprettes)',
        params: { request_id: '$create-request.id' },
        expect: (s) => [
          ['awarded', s.request?.status, 'awarded'],
          ['project active', s.project?.status, 'active'],
        ],
      },
      {
        id: 'complete', actor: 'eline', action: 'mark-completed',
        label: 'Eline merker ferdig',
        params: { request_id: '$create-request.id' },
        expect: (s) => [
          ['completed', s.request?.status, 'completed'],
          ['completed_at set', !!s.request?.completed_at, true],
        ],
      },
      {
        id: 'deliver', actor: 'liv', action: 'confirm-delivery',
        label: 'Liv bekrefter mottak',
        params: { request_id: '$create-request.id' },
        expect: (s) => [
          ['delivered', s.request?.status, 'delivered'],
          ['delivered_at set', !!s.request?.delivered_at, true],
        ],
      },
    ],
  },

  'commission-yarn': {
    title: 'Oppdrag + garn + konkurranse',
    desc: 'Kjøper sender eget garn; flere strikkere konkurrerer, én vinner.',
    track: 'request',
    personas: ['liv', 'eline', 'maja'],
    steps: [
      {
        id: 'verify-knitter', actor: 'eline', action: 'set-stripe-onboarded',
        label: 'Eline er Stripe-verifisert',
      },
      {
        id: 'create-request', actor: 'liv', action: 'create-request',
        label: 'Forespørsel med eget garn',
        params: { title: 'Babyteppe i merinoull', category: 'teppe', size_label: '70x90 cm', budget_nok_min: 600, budget_nok_max: 1200, description: 'Babyteppe i pastell.', yarn_provided_by_buyer: true, yarn_preference: 'Sandnes Garn Merino' },
        expect: (s) => [
          ['open', s.request?.status, 'open'],
          ['yarn by buyer', s.request?.yarn_provided_by_buyer, true],
        ],
      },
      {
        id: 'offer-eline', actor: 'eline', action: 'make-offer',
        label: 'Eline gir tilbud',
        params: { request_id: '$create-request.id', price_nok: 900, turnaround_weeks: 4, message: 'Jeg elsker babyteppe!' },
        expect: (s) => [['1 offer', s.offers?.length ?? 0, 1]],
      },
      {
        id: 'offer-maja', actor: 'maja', action: 'make-offer',
        label: 'Maja gir konkurrerende tilbud',
        params: { request_id: '$create-request.id', price_nok: 1100, turnaround_weeks: 2, message: 'Kan levere på 2 uker!' },
        expect: (s) => [
          ['2 offers', s.offers?.length ?? 0, 2],
          ['all pending', s.offers?.every((o: any) => o.status === 'pending'), true],
        ],
      },
      {
        id: 'accept', actor: 'liv', action: 'accept-offer',
        label: 'Liv velger Eline (Maja avslås)',
        params: { offer_id: '$offer-eline.id' },
        expect: (s) => [
          ['awaiting_payment', s.request?.status, 'awaiting_payment'],
          ['1 accepted', s.offers?.filter((o: any) => o.status === 'accepted').length, 1],
          ['1 declined', s.offers?.filter((o: any) => o.status === 'declined').length, 1],
        ],
      },
      {
        id: 'pay', actor: 'liv', action: 'pay',
        label: 'Liv betaler → venter på garn',
        params: { request_id: '$create-request.id' },
        expect: (s) => [
          ['awaiting_yarn', s.request?.status, 'awaiting_yarn'],
          ['project exists', !!s.project, true],
        ],
      },
      {
        id: 'ship-yarn', actor: 'liv', action: 'ship-yarn',
        label: 'Liv sender garn',
        params: { request_id: '$create-request.id', tracking_code: 'POSTEN-12345' },
        expect: (s) => [
          ['yarn shipped', !!s.request?.yarn_shipped_at, true],
          ['yarn tracking', s.request?.yarn_tracking_code, 'POSTEN-12345'],
        ],
      },
      {
        id: 'receive-yarn', actor: 'eline', action: 'receive-yarn',
        label: 'Eline mottar garn (prosjekt aktivt)',
        params: { request_id: '$create-request.id' },
        expect: (s) => [
          ['awarded', s.request?.status, 'awarded'],
          ['yarn received', !!s.request?.yarn_received_at, true],
          ['project active', s.project?.status, 'active'],
        ],
      },
      {
        id: 'complete', actor: 'eline', action: 'mark-completed',
        label: 'Eline merker ferdig',
        params: { request_id: '$create-request.id' },
        expect: (s) => [['completed', s.request?.status, 'completed']],
      },
      {
        id: 'deliver', actor: 'liv', action: 'confirm-delivery',
        label: 'Liv bekrefter mottak',
        params: { request_id: '$create-request.id' },
        expect: (s) => [['delivered', s.request?.status, 'delivered']],
      },
    ],
  },

  'listing-message': {
    title: 'Annonse & melding',
    desc: 'Selger publiserer annonse, kjøper starter samtale, de melder frem og tilbake.',
    track: 'listing',
    personas: ['eline', 'liv'],
    steps: [
      {
        id: 'trust-seller', actor: 'eline', action: 'set-trust',
        label: 'Eline betrodd (auto-godkjenn)',
        params: { trust_tier: 'trusted', trust_score: 100 },
      },
      {
        id: 'create-listing', actor: 'eline', action: 'create-listing',
        label: 'Eline oppretter annonse',
        params: { title: 'Strikket genser str 3 år', kind: 'pre_loved', category: 'genser', size_label: '3 år', price_nok: 249, condition: 'lite_brukt', description: 'Fin genser i merinoull.' },
        expect: (s) => [
          ['draft', s.listing?.status, 'draft'],
          ['kind', s.listing?.kind, 'pre_loved'],
        ],
      },
      {
        id: 'publish', actor: 'eline', action: 'publish-listing',
        label: 'Publiser annonse',
        params: { listing_id: '$create-listing.id' },
        expect: (s) => [['active', s.listing?.status, 'active']],
      },
      {
        id: 'message', actor: 'liv', action: 'send-message',
        label: 'Liv sender melding',
        params: { listing_id: '$create-listing.id', message: 'Hei! Er denne tilgjengelig? Kan du sende til Oslo?' },
        expect: (s) => [
          ['1 conversation', s.conversations?.length, 1],
          ['1 message', s.conversations?.[0]?.marketplace_messages?.length, 1],
        ],
      },
      {
        id: 'reply-1', actor: 'eline', action: 'reply',
        label: 'Eline svarer',
        params: { conversation_id: '$message.conversationId', message: 'Ja, tilgjengelig! Posten, 69 kr frakt.' },
        expect: (s) => [['2 messages', s.conversations?.[0]?.marketplace_messages?.length, 2]],
      },
      {
        id: 'reply-2', actor: 'liv', action: 'reply',
        label: 'Liv svarer',
        params: { conversation_id: '$message.conversationId', message: 'Perfekt, jeg tar den!' },
        expect: (s) => [['3 messages', s.conversations?.[0]?.marketplace_messages?.length, 3]],
      },
    ],
  },

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
