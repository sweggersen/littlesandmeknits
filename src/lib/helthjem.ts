// Helthjem parcel API (june26.md §2.6). Env-gated mirror of bring.ts:
// OAuth2 client-credentials -> book -> label (PDF) -> track. DORMANT until
// HELTHJEM_* credentials exist; isHelthjemConfigured() gates all callers.
//
// ⚠️ The request/response FIELD SHAPES below are a best-effort skeleton — the
// public developer docs (developer.helthjem.no) are access-gated, so confirm
// every `// TODO confirm` against the API reference once we have portal access
// + sandbox credentials. Endpoints are from Helthjem's "new APIs" docs.

const BASE = 'https://api.helthjem.no';
const TOKEN_URL = `${BASE}/auth/oauth2/v1/token`;
const BOOKINGS_URL = `${BASE}/parcels/v1/bookings`;
const TRACKING_URL = `${BASE}/parcels/v1/tracking/fetch`;
const SERVICE_POINTS_URL = `${BASE}/parcels/v1/service-points`; // TODO confirm path

export interface HelthjemAuth {
  clientId: string;
  clientSecret: string;
  /** Helthjem customer/shop id — the consignor (we book as the platform). */
  shopId: string;
}

/** True when Helthjem credentials are present. Callers no-op otherwise so the
 *  whole integration stays dormant until keys are set. */
export function isHelthjemConfigured(
  auth: Partial<HelthjemAuth> | null | undefined,
): auth is HelthjemAuth {
  return !!(auth?.clientId && auth?.clientSecret && auth?.shopId);
}

// ── OAuth2 client-credentials token (module-cached) ───────────────────
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(auth: HelthjemAuth): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return cachedToken.token;
  } catch {
    return null;
  }
}

async function authHeaders(auth: HelthjemAuth): Promise<Record<string, string> | null> {
  const token = await getToken(auth);
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// ── Address parties ───────────────────────────────────────────────────
export interface HelthjemParty {
  name: string;
  address: string;
  postalCode: string;
  city: string;
  email?: string;
  phone?: string;
}

// ── Booking ───────────────────────────────────────────────────────────
/** Til døren (home) vs Hentested (service point). */
export type HelthjemDelivery = 'home' | 'service_point';

export interface HelthjemBookingResult {
  bookingId: string;
  trackingNumber: string;
  /** The label is returned as a base64 PDF and/or a URL — confirm which. */
  labelPdfBase64?: string;
  labelUrl?: string;
}

export async function bookParcel(
  auth: HelthjemAuth,
  opts: {
    consignor: HelthjemParty;       // sender — the seller (or platform)
    consignee: HelthjemParty;       // recipient — the buyer
    weightGrams: number;
    delivery: HelthjemDelivery;
    /** Required when delivery === 'service_point'. */
    servicePointId?: string;
    /** Our listing/order id, echoed back for reconciliation. */
    reference?: string;
  },
): Promise<HelthjemBookingResult | null> {
  const h = await authHeaders(auth);
  if (!h) return null;

  // TODO confirm body shape against the Booking API reference.
  const body = {
    shopId: auth.shopId,
    consignor: party(opts.consignor),
    consignee: party(opts.consignee),
    delivery: {
      method: opts.delivery === 'home' ? 'HOME_DELIVERY' : 'SERVICE_POINT', // TODO confirm enum
      servicePointId: opts.servicePointId,
    },
    parcel: { weightGrams: opts.weightGrams },
    reference: opts.reference,
  };

  try {
    const res = await fetch(BOOKINGS_URL, { method: 'POST', headers: h, body: JSON.stringify(body) });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, any>;
    // TODO confirm response field names.
    const bookingId = data.bookingId ?? data.id;
    const trackingNumber = data.trackingNumber ?? data.shipmentNumber ?? data.barcode;
    if (!bookingId || !trackingNumber) return null;
    return {
      bookingId,
      trackingNumber,
      labelPdfBase64: data.label?.pdfBase64 ?? data.labelPdf,
      labelUrl: data.label?.url ?? data.labelUrl,
    };
  } catch {
    return null;
  }
}

function party(p: HelthjemParty) {
  // TODO confirm party field names (addressLine vs address, etc.).
  return {
    name: p.name,
    addressLine: p.address,
    postalCode: p.postalCode,
    city: p.city,
    countryCode: 'NO',
    email: p.email,
    phone: p.phone,
  };
}

// ── Tracking ──────────────────────────────────────────────────────────
export interface HelthjemTrackingEvent {
  status: string;
  description: string;
  dateTime: string;
  location?: string;
}

export async function getTracking(
  auth: HelthjemAuth,
  trackingNumber: string,
): Promise<HelthjemTrackingEvent[]> {
  const h = await authHeaders(auth);
  if (!h) return [];
  try {
    const res = await fetch(`${TRACKING_URL}/${encodeURIComponent(trackingNumber)}`, { headers: h });
    if (!res.ok) return [];
    const data = await res.json() as Record<string, any>;
    const events = data.events ?? data.trackingEvents ?? [];
    return events.map((e: any) => ({
      status: e.status ?? '',
      description: e.description ?? e.statusText ?? '',
      dateTime: e.timestamp ?? e.dateTime ?? '',
      location: e.location ?? e.city ?? undefined,
    }));
  } catch {
    return [];
  }
}

// ── Service points (Hentested) ────────────────────────────────────────
export interface HelthjemServicePoint {
  id: string;
  name: string;
  address: string;
  postalCode: string;
  city: string;
}

export async function findServicePoints(
  auth: HelthjemAuth,
  postalCode: string,
): Promise<HelthjemServicePoint[]> {
  const h = await authHeaders(auth);
  if (!h) return [];
  try {
    const res = await fetch(`${SERVICE_POINTS_URL}?postalCode=${encodeURIComponent(postalCode)}`, { headers: h });
    if (!res.ok) return [];
    const data = await res.json() as Record<string, any>;
    const points = data.servicePoints ?? data.points ?? (Array.isArray(data) ? data : []);
    return points.map((p: any) => ({
      id: p.id ?? p.servicePointId,
      name: p.name ?? '',
      address: p.address ?? p.addressLine ?? '',
      postalCode: p.postalCode ?? '',
      city: p.city ?? '',
    }));
  } catch {
    return [];
  }
}

/** Test seam: reset the cached OAuth token. */
export function __resetHelthjemTokenCache(): void {
  cachedToken = null;
}
