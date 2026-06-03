// First-listing templates for the new-listing wizard (june26.md §1.5).
// Pure data so it can be unit-tested (a typo'd category/kind would otherwise
// only blow up at server-side validation). The wizard controller prefills the
// form from one of these; the seller edits everything afterwards.

export interface ListingTemplate {
  kind: 'pre_loved' | 'ready_made';
  // Title is intentionally NOT templated — sellers write their own so we don't
  // seed generic/duplicate titles across the marketplace.
  category: string;
  size_label: string;
  condition?: string;
  size_age_months_min?: string;
  size_age_months_max?: string;
  colorway?: string;
  pattern_external_title?: string;
  knitted_by?: string;
  location?: string;
  description: string;
  price_nok: string;
}

export const LISTING_TEMPLATES: Record<string, ListingTemplate> = {
  preloved: {
    kind: 'pre_loved',
    category: 'genser',
    size_label: '92',
    condition: 'som_ny',
    size_age_months_min: '18',
    size_age_months_max: '24',
    colorway: 'Naturhvit med blå border',
    pattern_external_title: 'Mariusgenser, Sandnes Garn',
    knitted_by: 'Mormor (privat)',
    location: 'Oslo',
    description: 'Strikket i Sandnes Smart Superwash. Brukt et par ganger på hytta, som ny.\n\nVasket forsiktig på ullprogram, lufttørket. Røykfritt hjem.',
    price_nok: '350',
  },
  new: {
    kind: 'ready_made',
    category: 'lue',
    size_label: '0-3 mnd',
    colorway: 'Støvet rosa',
    pattern_external_title: 'Egen oppskrift',
    knitted_by: 'Meg',
    location: 'Bergen',
    description: 'Nystrikket i 100 % merinoull (superwash), aldri brukt. Røykfritt og dyrefritt hjem.\n\nHåndvask eller ullprogram anbefales.',
    price_nok: '420',
  },
  cardigan: {
    kind: 'pre_loved',
    category: 'cardigan',
    size_label: '80',
    condition: 'lite_brukt',
    size_age_months_min: '9',
    size_age_months_max: '12',
    colorway: 'Eplegrønn',
    pattern_external_title: 'Bregnekofta',
    knitted_by: 'Mormor (privat)',
    location: 'Oslo',
    description: 'Strikkejakke med trekuler som knapper. Lite brukt, ingen nupper eller hull.\n\nUllvask, lufttørket. Røykfritt hjem.',
    price_nok: '320',
  },
  blanket: {
    kind: 'pre_loved',
    category: 'teppe',
    size_label: '70 x 90 cm',
    condition: 'som_ny',
    colorway: 'Lys grå',
    knitted_by: 'Tante (privat)',
    location: 'Trondheim',
    description: 'Mykt babyteppe i ullmiks, brukt i vogna en sesong og vasket. Som nytt.\n\nUllvask, lufttørket.',
    price_nok: '450',
  },
  accessories: {
    kind: 'ready_made',
    category: 'votter',
    size_label: '1-2 år',
    colorway: 'Koksgrå',
    knitted_by: 'Meg',
    location: 'Stavanger',
    description: 'Nystrikkede votter i 100 % merinoull, aldri brukt. Tovet tupp for ekstra varme.\n\nHåndvask anbefales.',
    price_nok: '180',
  },
};
