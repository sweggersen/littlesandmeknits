// Brønnøysundregistrene (Norwegian Business Register) lookup.
// Free public API, no auth required, no key needed.
// Docs: https://data.brreg.no/enhetsregisteret/api/docs/index.html

const BRREG_URL = 'https://data.brreg.no/enhetsregisteret/api/enheter';

export type OrgnrLookupError =
  | 'invalid_format'
  | 'invalid_checksum'
  | 'not_found'
  | 'brreg_error'
  | 'network_error';

export type OrgnrStatus = 'normal' | 'deleted' | 'bankrupt' | 'liquidation';

export interface OrgnrData {
  orgnr: string;
  legalName: string;
  businessType: string;
  businessTypeDescription: string;
  industryCode: string;
  industryDescription: string;
  address: string;
  city: string | null;
  postalCode: string | null;
  foundedDate: string | null;
  status: OrgnrStatus;
}

export interface OrgnrLookupResult {
  ok: boolean;
  error?: OrgnrLookupError;
  data?: OrgnrData;
}

/** Strip everything except digits. Accepts "924 838 053", "924-838-053", etc. */
export function normalizeOrgnr(input: string): string {
  return input.replace(/\D/g, '');
}

/**
 * Validate a Norwegian organisasjonsnummer using its MOD11 checksum.
 * https://www.brreg.no/om-oss/oppgavene-vare/alle-registrene-vare/om-enhetsregisteret/organisasjonsnummeret/
 */
export function isValidOrgnr(orgnr: string): boolean {
  if (!/^\d{9}$/.test(orgnr)) return false;
  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += parseInt(orgnr[i], 10) * weights[i];
  const remainder = sum % 11;
  let check = 11 - remainder;
  if (check === 11) check = 0;
  if (check === 10) return false; // not a valid orgnr
  return check === parseInt(orgnr[8], 10);
}

interface BrregEnhet {
  organisasjonsnummer: string;
  navn: string;
  organisasjonsform: { kode: string; beskrivelse: string };
  stiftelsesdato?: string;
  forretningsadresse?: {
    adresse?: string[];
    postnummer?: string;
    poststed?: string;
    kommune?: string;
    land?: string;
  };
  naeringskode1?: { kode: string; beskrivelse: string };
  konkurs?: boolean;
  underAvvikling?: boolean;
  underTvangsavviklingEllerTvangsopplosning?: boolean;
  slettedato?: string;
}

/** A registered role at a Norwegian business (board member, CEO, etc.). */
export interface OrgRole {
  roleCode: string;
  roleDescription: string;
  groupCode: string;
  groupDescription: string;
  personName: string | null;
  birthDate: string | null;
  resignedFlag: boolean;
  /** True if the role is held by another organisation, not a person. */
  isOrganisation: boolean;
  organisationName: string | null;
}

interface BrregRolesResponse {
  rollegrupper?: Array<{
    type?: { kode?: string; beskrivelse?: string };
    roller?: Array<{
      type?: { kode?: string; beskrivelse?: string };
      person?: {
        fodselsdato?: string;
        navn?: { fornavn?: string; mellomnavn?: string; etternavn?: string };
        erDoed?: boolean;
      };
      enhet?: { navn?: string; organisasjonsnummer?: string };
      fratraadt?: boolean;
    }>;
  }>;
}

/** Fetch registered roles (board, CEO, signing rights, proprietor) for an orgnr. */
export async function lookupOrgnrRoles(input: string): Promise<{ ok: boolean; roles?: OrgRole[]; error?: OrgnrLookupError }> {
  const orgnr = normalizeOrgnr(input);
  if (!/^\d{9}$/.test(orgnr)) return { ok: false, error: 'invalid_format' };

  let res: Response;
  try {
    res = await fetch(`${BRREG_URL}/${orgnr}/roller`, {
      headers: { Accept: 'application/json' },
    });
  } catch {
    return { ok: false, error: 'network_error' };
  }
  if (res.status === 404 || res.status === 410) return { ok: false, error: 'not_found' };
  if (!res.ok) return { ok: false, error: 'brreg_error' };

  const body = (await res.json()) as BrregRolesResponse;
  const roles: OrgRole[] = [];
  for (const group of body.rollegrupper ?? []) {
    for (const r of group.roller ?? []) {
      const navn = r.person?.navn;
      const personName = navn
        ? [navn.fornavn, navn.mellomnavn, navn.etternavn].filter(Boolean).join(' ').trim()
        : null;
      roles.push({
        roleCode: r.type?.kode ?? '',
        roleDescription: r.type?.beskrivelse ?? '',
        groupCode: group.type?.kode ?? '',
        groupDescription: group.type?.beskrivelse ?? '',
        personName,
        birthDate: r.person?.fodselsdato ?? null,
        resignedFlag: !!r.fratraadt,
        isOrganisation: !!r.enhet,
        organisationName: r.enhet?.navn ?? null,
      });
    }
  }
  return { ok: true, roles };
}

/** Look up a Norwegian orgnr against Brønnøysundregistrene. */
export async function lookupOrgnr(input: string): Promise<OrgnrLookupResult> {
  const orgnr = normalizeOrgnr(input);
  if (!/^\d{9}$/.test(orgnr)) return { ok: false, error: 'invalid_format' };
  if (!isValidOrgnr(orgnr)) return { ok: false, error: 'invalid_checksum' };

  let res: Response;
  try {
    res = await fetch(`${BRREG_URL}/${orgnr}`, {
      headers: { Accept: 'application/json' },
    });
  } catch {
    return { ok: false, error: 'network_error' };
  }

  if (res.status === 404 || res.status === 410) return { ok: false, error: 'not_found' };
  if (!res.ok) return { ok: false, error: 'brreg_error' };

  const enhet = (await res.json()) as BrregEnhet;

  let status: OrgnrStatus = 'normal';
  if (enhet.slettedato) status = 'deleted';
  else if (enhet.konkurs) status = 'bankrupt';
  else if (enhet.underAvvikling || enhet.underTvangsavviklingEllerTvangsopplosning) status = 'liquidation';

  const addr = enhet.forretningsadresse;
  const addressLines = [...(addr?.adresse ?? []), addr?.postnummer, addr?.poststed]
    .filter(Boolean)
    .join(', ');

  return {
    ok: true,
    data: {
      orgnr,
      legalName: enhet.navn,
      businessType: enhet.organisasjonsform.kode,
      businessTypeDescription: enhet.organisasjonsform.beskrivelse,
      industryCode: enhet.naeringskode1?.kode ?? '',
      industryDescription: enhet.naeringskode1?.beskrivelse ?? '',
      address: addressLines,
      city: addr?.poststed ?? null,
      postalCode: addr?.postnummer ?? null,
      foundedDate: enhet.stiftelsesdato ?? null,
      status,
    },
  };
}
