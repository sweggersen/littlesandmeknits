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
  /** When true, the action is expected to FAIL (e.g. an anti-abuse guard). */
  expectFail?: boolean;
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

  'mod-approve': {
    title: 'Moderering — godkjenn',
    desc: 'Erfaren moderator (>50 vurderinger) godkjenner direkte — annonse blir aktiv.',
    track: 'listing',
    personas: ['eline', 'kari', 'nora'],
    stateFlags: ['include_mod_stats', 'include_profiles'],
    steps: [
      { id: 'setup-nora', actor: 'nora', action: 'set-role', label: 'Nora = admin', params: { role: 'admin' },
        expect: (s) => [['nora admin', s.profiles?.['nora@test.strikketorget.no']?.role, 'admin']] },
      { id: 'setup-kari', actor: 'kari', action: 'set-role', label: 'Kari = moderator', params: { role: 'moderator' },
        expect: (s) => [['kari moderator', s.profiles?.['kari@test.strikketorget.no']?.role, 'moderator']] },
      { id: 'setup-kari-stats', actor: 'kari', action: 'set-mod-stats', label: 'Kari erfaren (60 vurderinger)',
        params: { total_reviews: 60, total_approvals: 55, total_rejections: 5, rate_nok_per_review: 2.0 },
        expect: (s) => [['60 reviews', s.mod_stats?.['kari@test.strikketorget.no']?.total_reviews, 60]] },
      { id: 'create-listing', actor: 'eline', action: 'create-listing-moderated', label: 'Eline publiserer → kø',
        params: { title: 'Strikket babygenser str 6 mnd', price_nok: 349, category: 'genser', size_label: '6 mnd', description: 'Nystrikket i merinoull.' },
        expect: (s) => [
          ['pending_review', s.listing?.status, 'pending_review'],
          ['queue pending', s.queue_item?.status, 'pending'],
        ] },
      { id: 'approve', actor: 'kari', action: 'moderate-review', label: 'Kari godkjenner (direkte)',
        params: { queue_item_id: '$create-listing.queue_item_id', decision: 'approve', internal_notes: 'Ser bra ut.' },
        expect: (s) => [
          ['listing active', s.listing?.status, 'active'],
          ['queue approved', s.queue_item?.status, 'approved'],
          ['no shadow', s.queue_item?.shadow_review, false],
          ['reviews 61', s.mod_stats?.['kari@test.strikketorget.no']?.total_reviews, 61],
          ['earned +2', s.mod_stats?.['kari@test.strikketorget.no']?.current_month_earned_nok >= 2, true],
        ] },
    ],
  },

  'mod-reject': {
    title: 'Moderering — avvis',
    desc: 'Moderator avviser en forespørsel — innsenderens tillit påvirkes.',
    track: 'request',
    personas: ['liv', 'kari'],
    stateFlags: ['include_mod_stats', 'include_profiles'],
    steps: [
      { id: 'setup-kari', actor: 'kari', action: 'set-role', label: 'Kari = moderator', params: { role: 'moderator' },
        expect: (s) => [['kari moderator', s.profiles?.['kari@test.strikketorget.no']?.role, 'moderator']] },
      { id: 'setup-kari-stats', actor: 'kari', action: 'set-mod-stats', label: 'Kari erfaren',
        params: { total_reviews: 60, total_approvals: 55, total_rejections: 5, rate_nok_per_review: 2.0 },
        expect: (s) => [['60 reviews', s.mod_stats?.['kari@test.strikketorget.no']?.total_reviews, 60]] },
      { id: 'create-request', actor: 'liv', action: 'create-request-moderated', label: 'Liv oppretter → kø',
        params: { title: 'Sko i lær og ull', category: 'annet', size_label: '38', budget_nok_min: 200, budget_nok_max: 400, description: 'Noen som kan lage sko?' },
        expect: (s) => [
          ['pending_review', s.request?.status, 'pending_review'],
          ['queue pending', s.queue_item?.status, 'pending'],
        ] },
      { id: 'reject', actor: 'kari', action: 'moderate-review', label: 'Kari avviser',
        params: { queue_item_id: '$create-request.queue_item_id', decision: 'reject', rejection_reason: 'Ikke et strikkeprodukt.' },
        expect: (s) => [
          ['request rejected', s.request?.status, 'rejected'],
          ['queue rejected', s.queue_item?.status, 'rejected'],
          ['liv rejection recorded', s.profiles?.['liv@test.strikketorget.no']?.total_rejections >= 1, true],
          ['reviews 61', s.mod_stats?.['kari@test.strikketorget.no']?.total_reviews, 61],
        ] },
    ],
  },

  'shadow-review': {
    title: 'Skyggevurdering',
    desc: 'Ny moderator (<50) — beslutning holdes til admin bekrefter.',
    track: 'listing',
    personas: ['eline', 'kari', 'nora'],
    stateFlags: ['include_mod_stats', 'include_profiles'],
    steps: [
      { id: 'setup-nora', actor: 'nora', action: 'set-role', label: 'Nora = admin', params: { role: 'admin' },
        expect: (s) => [['nora admin', s.profiles?.['nora@test.strikketorget.no']?.role, 'admin']] },
      { id: 'setup-kari', actor: 'kari', action: 'set-role', label: 'Kari = moderator', params: { role: 'moderator' },
        expect: (s) => [['kari moderator', s.profiles?.['kari@test.strikketorget.no']?.role, 'moderator']] },
      { id: 'setup-kari-new', actor: 'kari', action: 'set-mod-stats', label: 'Kari ny (10 vurderinger)',
        params: { total_reviews: 10, total_approvals: 9, total_rejections: 1, rate_nok_per_review: 1.0 },
        expect: (s) => [['10 reviews', s.mod_stats?.['kari@test.strikketorget.no']?.total_reviews, 10]] },
      { id: 'create-listing', actor: 'eline', action: 'create-listing-moderated', label: 'Eline publiserer → kø',
        params: { title: 'Babyvotter i alpakka', price_nok: 129, category: 'votter', size_label: '0-6 mnd' },
        expect: (s) => [['pending_review', s.listing?.status, 'pending_review']] },
      { id: 'kari-approves', actor: 'kari', action: 'moderate-review', label: 'Kari godkjenner (skygge holdes)',
        params: { queue_item_id: '$create-listing.queue_item_id', decision: 'approve' },
        expect: (s) => [
          ['still pending_review', s.listing?.status, 'pending_review'],
          ['queue approved', s.queue_item?.status, 'approved'],
          ['shadow flagged', s.queue_item?.shadow_review, true],
          ['not confirmed', s.queue_item?.shadow_confirmed_at, null],
        ] },
      { id: 'nora-confirms', actor: 'nora', action: 'shadow-confirm', label: 'Nora bekrefter → aktiv',
        params: { queue_item_id: '$create-listing.queue_item_id', action: 'confirm' },
        expect: (s) => [
          ['listing active', s.listing?.status, 'active'],
          ['confirmed', !!s.queue_item?.shadow_confirmed_at, true],
          ['not overridden', s.queue_item?.shadow_decision_overridden, false],
        ] },
    ],
  },

  'shadow-override': {
    title: 'Skygge — overstyring',
    desc: 'Ny moderator avviser feilaktig; admin overstyrer til godkjent.',
    track: 'listing',
    personas: ['eline', 'kari', 'nora'],
    stateFlags: ['include_mod_stats', 'include_profiles'],
    steps: [
      { id: 'setup-nora', actor: 'nora', action: 'set-role', label: 'Nora = admin', params: { role: 'admin' },
        expect: (s) => [['nora admin', s.profiles?.['nora@test.strikketorget.no']?.role, 'admin']] },
      { id: 'setup-kari', actor: 'kari', action: 'set-role', label: 'Kari = moderator', params: { role: 'moderator' },
        expect: (s) => [['kari moderator', s.profiles?.['kari@test.strikketorget.no']?.role, 'moderator']] },
      { id: 'setup-kari-new', actor: 'kari', action: 'set-mod-stats', label: 'Kari ny (5 vurderinger)',
        params: { total_reviews: 5, total_approvals: 4, total_rejections: 1, shadow_overrides: 0 },
        expect: (s) => [['5 reviews', s.mod_stats?.['kari@test.strikketorget.no']?.total_reviews, 5]] },
      { id: 'create-listing', actor: 'eline', action: 'create-listing-moderated', label: 'Eline publiserer → kø',
        params: { title: 'Strikket lue i ull', price_nok: 199, category: 'lue', size_label: '2-4 år' },
        expect: (s) => [['pending_review', s.listing?.status, 'pending_review']] },
      { id: 'kari-rejects', actor: 'kari', action: 'moderate-review', label: 'Kari avviser (skygge holdes)',
        params: { queue_item_id: '$create-listing.queue_item_id', decision: 'reject', rejection_reason: 'Tror dette er spam' },
        expect: (s) => [
          ['still pending_review', s.listing?.status, 'pending_review'],
          ['queue rejected', s.queue_item?.status, 'rejected'],
          ['shadow flagged', s.queue_item?.shadow_review, true],
        ] },
      { id: 'nora-overrides', actor: 'nora', action: 'shadow-confirm', label: 'Nora overstyrer → godkjent',
        params: { queue_item_id: '$create-listing.queue_item_id', action: 'override' },
        expect: (s) => [
          ['listing active', s.listing?.status, 'active'],
          ['overridden', s.queue_item?.shadow_decision_overridden, true],
          ['queue approved', s.queue_item?.status, 'approved'],
          ['kari override counted', s.mod_stats?.['kari@test.strikketorget.no']?.shadow_overrides >= 1, true],
        ] },
    ],
  },

  'reports': {
    title: 'Rapporter',
    desc: 'Flere brukere rapporterer en annonse; moderator behandler rapporten.',
    track: 'listing',
    personas: ['eline', 'liv', 'maja', 'ingrid', 'kari'],
    stateFlags: ['include_reports'],
    steps: [
      { id: 'setup-kari', actor: 'kari', action: 'set-role', label: 'Kari = moderator', params: { role: 'moderator' } },
      { id: 'trust-seller', actor: 'eline', action: 'set-trust', label: 'Eline betrodd', params: { trust_tier: 'trusted', trust_score: 100 } },
      { id: 'create-listing', actor: 'eline', action: 'create-listing', label: 'Eline oppretter annonse',
        params: { title: 'Strikket skjerf', price_nok: 99, category: 'annet', size_label: 'One size' },
        expect: (s) => [['draft', s.listing?.status, 'draft']] },
      { id: 'publish', actor: 'eline', action: 'publish-listing', label: 'Publiser', params: { listing_id: '$create-listing.id' },
        expect: (s) => [['active', s.listing?.status, 'active']] },
      { id: 'report-1', actor: 'liv', action: 'submit-report', label: 'Liv rapporterer (svindel)',
        params: { target_type: 'listing', target_id: '$create-listing.id', reason: 'scam', description: 'Ser ut som svindel.' },
        expect: (s) => [['1 report', s.reports?.length, 1]] },
      { id: 'report-2', actor: 'maja', action: 'submit-report', label: 'Maja rapporterer (spam)',
        params: { target_type: 'listing', target_id: '$create-listing.id', reason: 'spam' },
        expect: (s) => [['2 reports', s.reports?.length, 2]] },
      { id: 'report-3', actor: 'ingrid', action: 'submit-report', label: 'Ingrid rapporterer',
        params: { target_type: 'listing', target_id: '$create-listing.id', reason: 'inappropriate' },
        expect: (s) => [['3 reports', s.reports?.length, 3]] },
      { id: 'resolve', actor: 'kari', action: 'resolve-report', label: 'Kari behandler rapporten',
        params: { report_id: '$report-1.id', notes: 'Vurdert og behandlet.' },
        expect: (s) => [['a report resolved', s.reports?.some((r: any) => r.status === 'resolved'), true]] },
    ],
  },

  'reviews-trust': {
    title: 'Vurderinger & tillit',
    desc: 'Etter levering vurderer begge parter; begge blir synlige samtidig (double-blind).',
    track: 'request',
    personas: ['liv', 'eline'],
    stateFlags: ['include_tx_reviews'],
    steps: [
      { id: 'verify-knitter', actor: 'eline', action: 'set-stripe-onboarded', label: 'Eline verifisert' },
      { id: 'create-request', actor: 'liv', action: 'create-request', label: 'Liv oppretter forespørsel',
        params: { title: 'Babysokker i ull', category: 'sokker', size_label: '0-6 mnd', budget_nok_min: 150, budget_nok_max: 300 },
        expect: (s) => [['open', s.request?.status, 'open']] },
      { id: 'offer', actor: 'eline', action: 'make-offer', label: 'Eline gir tilbud',
        params: { request_id: '$create-request.id', price_nok: 200, turnaround_weeks: 1 },
        expect: (s) => [['1 offer', s.offers?.length, 1]] },
      { id: 'accept', actor: 'liv', action: 'accept-offer', label: 'Liv aksepterer', params: { offer_id: '$offer.id' },
        expect: (s) => [['awaiting_payment', s.request?.status, 'awaiting_payment']] },
      { id: 'pay', actor: 'liv', action: 'pay', label: 'Liv betaler', params: { request_id: '$create-request.id' },
        expect: (s) => [['awarded', s.request?.status, 'awarded']] },
      { id: 'complete', actor: 'eline', action: 'mark-completed', label: 'Eline merker ferdig', params: { request_id: '$create-request.id' },
        expect: (s) => [['completed', s.request?.status, 'completed']] },
      { id: 'deliver', actor: 'liv', action: 'confirm-delivery', label: 'Liv bekrefter mottak', params: { request_id: '$create-request.id' },
        expect: (s) => [['delivered', s.request?.status, 'delivered']] },
      { id: 'review-buyer', actor: 'liv', action: 'submit-tx-review', label: 'Liv vurderer (4★) — ikke synlig ennå',
        params: { commission_request_id: '$create-request.id', rating: 4, comment: 'Fine sokker!' },
        expect: (s) => [
          ['1 review', s.tx_reviews?.length, 1],
          ['hidden until both', s.tx_reviews?.[0]?.visible, false],
        ] },
      { id: 'review-knitter', actor: 'eline', action: 'submit-tx-review', label: 'Eline vurderer (5★) — begge synlige nå',
        params: { commission_request_id: '$create-request.id', rating: 5, comment: 'God kommunikasjon.' },
        expect: (s) => [
          ['2 reviews', s.tx_reviews?.length, 2],
          ['both visible', s.tx_reviews?.every((r: any) => r.visible), true],
        ] },
    ],
  },

  'mod-compensation': {
    title: 'Moderator-godtgjørelse',
    desc: 'Moderator vurderer, samler godtgjørelse; admin genererer + markerer utbetaling.',
    track: 'listing',
    personas: ['eline', 'kari', 'nora'],
    stateFlags: ['include_mod_stats', 'include_profiles', 'include_payouts'],
    steps: [
      { id: 'setup-nora', actor: 'nora', action: 'set-role', label: 'Nora = admin', params: { role: 'admin' } },
      { id: 'setup-kari', actor: 'kari', action: 'set-role', label: 'Kari = moderator', params: { role: 'moderator' } },
      { id: 'setup-kari-stats', actor: 'kari', action: 'set-mod-stats', label: 'Kari erfaren (2 kr/vurd.)',
        params: { total_reviews: 60, total_approvals: 55, total_rejections: 5, rate_nok_per_review: 2.0, current_month_reviews: 0, current_month_earned_nok: 0, total_earned_nok: 100 },
        expect: (s) => [
          ['rate 2', s.mod_stats?.['kari@test.strikketorget.no']?.rate_nok_per_review, 2],
          ['total earned 100', s.mod_stats?.['kari@test.strikketorget.no']?.total_earned_nok, 100],
        ] },
      { id: 'item-1', actor: 'eline', action: 'create-listing-moderated', label: 'Annonse #1',
        params: { title: 'Strikket lue #1', price_nok: 149, category: 'lue', size_label: '2 år' },
        expect: (s) => [['pending', s.listing?.status, 'pending_review']] },
      { id: 'review-1', actor: 'kari', action: 'moderate-review', label: 'Kari godkjenner #1 (+2 kr)',
        params: { queue_item_id: '$item-1.queue_item_id', decision: 'approve' },
        expect: (s) => [
          ['month reviews 1', s.mod_stats?.['kari@test.strikketorget.no']?.current_month_reviews, 1],
          ['month earned ≥2', s.mod_stats?.['kari@test.strikketorget.no']?.current_month_earned_nok >= 2, true],
        ] },
      { id: 'item-2', actor: 'eline', action: 'create-listing-moderated', label: 'Annonse #2',
        params: { title: 'Strikket lue #2', price_nok: 199, category: 'lue', size_label: '4 år' } },
      { id: 'review-2', actor: 'kari', action: 'moderate-review', label: 'Kari godkjenner #2 (+2 kr)',
        params: { queue_item_id: '$item-2.queue_item_id', decision: 'approve' },
        expect: (s) => [
          ['month reviews 2', s.mod_stats?.['kari@test.strikketorget.no']?.current_month_reviews, 2],
          ['month earned ≥4', s.mod_stats?.['kari@test.strikketorget.no']?.current_month_earned_nok >= 4, true],
        ] },
      { id: 'generate-payouts', actor: 'nora', action: 'generate-payouts', label: 'Nora genererer utbetalinger',
        expect: (s) => [
          ['payout created', s.payouts?.length >= 1, true],
          ['payout pending', s.payouts?.[0]?.status, 'pending'],
          ['amount ≥4', s.payouts?.[0]?.amount_nok >= 4, true],
        ] },
      { id: 'mark-paid', actor: 'nora', action: 'mark-payout-paid', label: 'Nora markerer utbetalt',
        params: { payout_id: '$generate-payouts.first_payout_id' },
        expect: (s) => [['a payout paid', s.payouts?.some((p: any) => p.status === 'paid'), true]] },
    ],
  },

  'self-review-block': {
    title: 'Anti-misbruk: ingen egenvurdering',
    desc: 'En moderator kan ikke moderere sitt eget innsendte innhold; en annen admin kan.',
    track: 'request',
    personas: ['kari', 'nora'],
    stateFlags: ['include_mod_stats', 'include_profiles'],
    steps: [
      { id: 'setup-kari', actor: 'kari', action: 'set-role', label: 'Kari = moderator', params: { role: 'moderator' } },
      { id: 'setup-kari-stats', actor: 'kari', action: 'set-mod-stats', label: 'Kari erfaren', params: { total_reviews: 60 } },
      { id: 'kari-submits', actor: 'kari', action: 'create-request-moderated', label: 'Kari sender eget oppdrag',
        params: { title: 'Cardigan til meg selv', category: 'cardigan', size_label: 'M', budget_nok_min: 500, budget_nok_max: 1000 },
        expect: (s) => [
          ['pending_review', s.request?.status, 'pending_review'],
          ['queued', !!s.queue_item, true],
        ] },
      { id: 'self-review-fails', actor: 'kari', action: 'moderate-review', label: 'Kari prøver å godkjenne eget (skal feile)',
        expectFail: true,
        params: { queue_item_id: '$kari-submits.queue_item_id', decision: 'approve' },
        expect: (s) => [['unchanged, still pending', s.request?.status, 'pending_review']] },
      { id: 'setup-nora', actor: 'nora', action: 'set-role', label: 'Nora = admin', params: { role: 'admin' } },
      { id: 'setup-nora-stats', actor: 'nora', action: 'set-mod-stats', label: 'Nora erfaren (direkte beslutning)', params: { total_reviews: 60 } },
      { id: 'nora-approves', actor: 'nora', action: 'moderate-review', label: 'Nora godkjenner (ikke eget)',
        params: { queue_item_id: '$kari-submits.queue_item_id', decision: 'approve' },
        expect: (s) => [
          ['request open', s.request?.status, 'open'],
          ['queue approved', s.queue_item?.status, 'approved'],
        ] },
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
