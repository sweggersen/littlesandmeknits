// First-listing templates for the new-listing wizard (june26.md §1.5).
// Pure data so it can be unit-tested (a typo'd category/kind would otherwise
// only blow up at server-side validation).
//
// Deliberately minimal: a chip only sets the TYPE (kind) and CATEGORY — the
// quick-start "I'm listing a used kids' sweater". Everything else (title, size,
// colour, pattern, who knitted it, place, description, price) is the seller's
// own, so we never seed fake/duplicate details into real listings.

export interface ListingTemplate {
  kind: 'pre_loved' | 'ready_made';
  category: string;
}

export const LISTING_TEMPLATES: Record<string, ListingTemplate> = {
  preloved: { kind: 'pre_loved', category: 'genser' },
  cardigan: { kind: 'pre_loved', category: 'cardigan' },
  new: { kind: 'ready_made', category: 'lue' },
  blanket: { kind: 'pre_loved', category: 'teppe' },
  accessories: { kind: 'ready_made', category: 'votter' },
};
