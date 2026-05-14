export const CATEGORY_LABEL: Record<string, string> = {
  genser: 'Genser', cardigan: 'Cardigan', lue: 'Lue', votter: 'Votter',
  sokker: 'Sokker', teppe: 'Teppe', kjole: 'Kjole', bukser: 'Bukser', annet: 'Annet',
};

export const KIND_LABEL: Record<string, string> = { pre_loved: 'Brukt', ready_made: 'Nytt' };

export const CONDITION_LABEL: Record<string, string> = {
  som_ny: 'Som ny', lite_brukt: 'Lite brukt', brukt: 'Brukt', slitt: 'Slitt',
};

export const LISTING_STATUS: Record<string, string> = {
  draft: 'Utkast', active: 'Aktiv', reserved: 'Reservert', shipped: 'Sendt',
  sold: 'Solgt', removed: 'Fjernet', disputed: 'Tvist',
  pending_review: 'Under vurdering', rejected: 'Avvist',
};

export const COMMISSION_STATUS: Record<string, string> = {
  open: 'Åpen', awaiting_payment: 'Venter på betaling', awaiting_yarn: 'Venter på garn',
  awarded: 'Pågår', completed: 'Ferdigstrikket', delivered: 'Levert',
  cancelled: 'Avbrutt', expired: 'Utløpt', disputed: 'Tvist',
  pending_review: 'Under vurdering', rejected: 'Avvist',
};

export const OFFER_STATUS: Record<string, string> = {
  pending: 'Venter', accepted: 'Akseptert', declined: 'Avslått', withdrawn: 'Trukket',
};

export const PROJECT_STATUS: Record<string, string> = {
  planning: 'Planlegger', active: 'Pågår', finished: 'Ferdig', frogged: 'Røket opp',
};

export const MODERATION_QUEUE_STATUS: Record<string, string> = {
  pending: 'Venter', assigned: 'Tilordnet', approved: 'Godkjent',
  rejected: 'Avvist', escalated: 'Eskalert',
};

export const REPORT_STATUS: Record<string, string> = {
  open: 'Åpen', resolved: 'Løst', dismissed: 'Avvist',
};

export const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_LABEL));
export const VALID_PROJECT_STATUSES = new Set(Object.keys(PROJECT_STATUS));
