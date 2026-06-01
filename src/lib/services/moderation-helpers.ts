// Pure helpers extracted from the report/moderation flow so they can be
// unit-tested without touching Supabase.

export interface SiblingReportInput {
  reason: string;
  description?: string | null;
  status: string; // 'open' | 'resolved' | 'dismissed' | …
}

export const REASON_LABEL_NB: Record<string, string> = {
  scam: 'Svindel',
  inappropriate: 'Upassende innhold',
  wrong_category: 'Feil kategori',
  spam: 'Spam',
  other: 'Annet',
};

export const TARGET_LABEL_NB: Record<string, string> = {
  listing: 'annonse',
  commission_request: 'oppdrag',
  store: 'butikk',
  profile: 'profil',
};

export const ITEM_DEFINITE_NB: Record<string, string> = {
  listing: 'annonsen',
  commission_request: 'oppdraget',
  store: 'butikken',
  profile: 'profilen',
};

export function reasonLabel(reason: string): string {
  return REASON_LABEL_NB[reason] ?? reason;
}

/** Build the moderator's outreach message draft. Includes every sibling
 *  report that isn't dismissed (so admin sees a complete picture). */
export function composeReportDraft(
  siblings: SiblingReportInput[],
  targetType: string,
): string {
  const itemLabel = ITEM_DEFINITE_NB[targetType] ?? 'elementet';
  const drafts = siblings.filter((s) => s.status !== 'dismissed');

  let intro: string;
  if (drafts.length > 1) {
    const lines = drafts.map((s) =>
      `- «${reasonLabel(s.reason)}»${s.description ? `: ${s.description}` : ''}`,
    ).join('\n');
    intro = `Vi har mottatt ${drafts.length} rapporter om ${itemLabel} med følgende grunner:\n${lines}`;
  } else {
    const only = drafts[0];
    const reason = only ? reasonLabel(only.reason) : 'rapport';
    const detail = only?.description ? `, beskrevet som «${only.description}»` : '';
    intro = `Vi har mottatt en rapport om ${itemLabel}. Innmelder oppga grunnen «${reason}»${detail}.`;
  }

  return [
    'Hei,',
    '',
    intro,
    '',
    `Mens vi behandler saken er ${itemLabel} midlertidig frosset og skjult fra Strikketorget. Den blir gjenåpnet så snart vi er enige om en løsning.`,
    '',
    'Kan du svare oss her med din side av saken? Hvis vi ikke hører fra deg innen 48 timer, lukker vi saken med utgangspunkt i informasjonen vi har.',
    '',
    'Vennlig hilsen',
    'Moderatorteamet',
  ].join('\n');
}

/** Validate a freeze/dismiss decision before it hits the DB. */
export function validateDecideInput(input: {
  reportId?: string; action?: string; firstMessage?: string;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.reportId) return { ok: false, reason: 'reportId required' };
  if (!input.action || !['freeze', 'dismiss'].includes(input.action)) {
    return { ok: false, reason: 'invalid action' };
  }
  if (input.action === 'freeze') {
    const msg = (input.firstMessage ?? '').trim();
    if (!msg) return { ok: false, reason: 'first message required for freeze' };
  }
  return { ok: true };
}

/** Decide what status a listing should restore to when unfrozen. */
export function restoreStatus(preFreeze: string | null | undefined): 'active' | 'draft' {
  // Only "active" or "draft" make sense to restore to — if the listing
  // was in some weird intermediate state (reserved/shipped) before the
  // freeze, drop back to active so the seller can re-engage normally.
  return preFreeze === 'draft' ? 'draft' : 'active';
}
