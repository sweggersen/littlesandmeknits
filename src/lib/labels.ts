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
  pending_review: 'Under vurdering', rejected: 'Avvist', frozen: 'Frosset',
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

export const NEEDLE_TYPE: Record<string, string> = {
  circular: 'Rundpinne', dpn: 'Strømpepinner', straight: 'Rette pinner',
};

export const MODERATION_QUEUE_STATUS: Record<string, string> = {
  pending: 'Venter', assigned: 'Tilordnet', approved: 'Godkjent',
  rejected: 'Avvist', escalated: 'Eskalert',
};

export const REPORT_STATUS: Record<string, string> = {
  open: 'Åpen', resolved: 'Løst', dismissed: 'Avvist',
};

export const REFUND_REASON: Record<string, string> = {
  not_received: 'Ikke mottatt', damaged: 'Skadet', not_as_described: 'Ikke som beskrevet',
  wrong_size: 'Feil størrelse', changed_mind: 'Ombestemte meg', other: 'Annet',
};

export const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_LABEL));
export const VALID_PROJECT_STATUSES = new Set(Object.keys(PROJECT_STATUS));

// Store page-builder editor (Phase 2). Norwegian-facing labels for the theme
// colour roles + the editor chrome, kept here so no page/island hardcodes them.
export const STORE_COLOR_ROLE_LABEL: Record<string, string> = {
  page: 'Sidebakgrunn',
  surface: 'Kortbakgrunn',
  heading: 'Overskrift',
  text: 'Innhold',
  muted: 'Dempet tekst',
  border: 'Kantlinje',
  primary: 'Hovedfarge',
  primaryFg: 'Tekst på hovedfarge',
  accent: 'Aksentfarge',
  headerBg: 'Toppbakgrunn',
  tag: 'Merkelapp',
};

// Heading typography controls (theme-level, applies to all headings).
export const STORE_HEADING_WEIGHT_LABEL: Record<string, string> = {
  normal: 'Normal',
  medium: 'Medium',
  semibold: 'Halvfet',
  bold: 'Fet',
};
export const STORE_HEADING_SCALE_LABEL: Record<string, string> = {
  sm: 'Liten',
  base: 'Standard',
  lg: 'Stor',
  xl: 'Ekstra stor',
};

export const STORE_EDITOR_LABELS = {
  title: 'Butikk-bygger',
  blocks: 'Blokker',
  addBlock: 'Legg til blokk',
  theme: 'Tema',
  fontDisplay: 'Overskriftsfont',
  fontBody: 'Brødtekstfont',
  colors: 'Farger',
  headings: 'Overskrifter',
  headingColor: 'Overskriftsfarge',
  headingWeight: 'Tykkelse',
  headingItalic: 'Kursiv',
  headingUnderline: 'Understrek',
  headingScale: 'Størrelse',
  headingEditHint: 'Endrer alle overskrifter i butikken.',
  presets: 'Forhåndsvalg',
  properties: 'Egenskaper',
  noSelection: 'Velg en blokk for å redigere den.',
  save: 'Lagre',
  saved: 'Lagret',
  saving: 'Lagrer …',
  preview: 'Forhåndsvis',
  publish: 'Publiser',
  published: 'Publisert',
  publishing: 'Publiserer …',
  reset: 'Tilbakestill',
  undo: 'Angre',
  remove: 'Fjern',
  moveUp: 'Flytt opp',
  moveDown: 'Flytt ned',
  upload: 'Last opp bilde',
  uploading: 'Laster opp …',
  chooseImage: 'Velg bilde',
  noImage: 'Ingen bilde valgt',
  maxImagesReached: 'Maks antall bilder valgt.',
  noListings: 'Butikken har ingen aktive annonser å velge.',
  confirmReset: 'Vil du tilbakestille utkastet? Ulagrede endringer forsvinner.',
  emptyTitle: 'Bygg butikksiden din',
  emptyCanvas: 'Velg et forhåndsvalg for å komme i gang, eller legg til blokker fra venstre.',
  heroLayout: 'Plassering',
  heroLayoutHint: 'Dra logo, tittel, undertittel og knapp for å plassere dem i toppseksjonen. Dra hjørnet på logoen for å endre størrelsen. På mobil vises alt sentrert.',
  heroResetLayout: 'Nullstill plassering',
  resizeLogo: 'Endre logostørrelse',
  // Click-to-edit popover: title + short hint per element kind.
  editHeading: 'Overskrifter',
  editText: 'Tekst',
  editTag: 'Merkelapp',
  editHeader: 'Toppseksjon',
  editLogo: 'Logo',
  editTextHint: 'Endrer fargen på brødteksten i hele butikken.',
  editTagHint: 'Teksten justeres automatisk til svart eller hvit for lesbarhet.',
  editHeaderHint: 'Endrer bakgrunnsfargen på toppseksjonen.',
  editLogoHint: 'Endre størrelse og gråtone på logoen.',
  logoSize: 'Størrelse',
  logoTint: 'Gråtone',
} as const;
