// First-listing templates for the new-listing wizard (june26.md §1.5).
// Pure data so it can be unit-tested (a typo'd category/kind would otherwise
// only blow up at server-side validation). The wizard controller prefills the
// form from one of these; the seller edits everything afterwards.

export interface ListingTemplate {
  kind: 'pre_loved' | 'ready_made';
  title: string;
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

export const LISTING_TEMPLATES: Record<'preloved' | 'new', ListingTemplate> = {
  preloved: {
    kind: 'pre_loved',
    title: 'Mariusgenser str. 92, naturhvit',
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
    title: 'Nystrikket babylue i merinoull',
    category: 'lue',
    size_label: '0-3 mnd',
    colorway: 'Støvet rosa',
    pattern_external_title: 'Egen oppskrift',
    knitted_by: 'Meg',
    location: 'Bergen',
    description: 'Nystrikket i 100 % merinoull (superwash), aldri brukt. Røykfritt og dyrefritt hjem.\n\nHåndvask eller ullprogram anbefales.',
    price_nok: '420',
  },
};
