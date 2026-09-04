// fetch with a bounded timeout. On Cloudflare Workers a hung external call ties
// up the invocation until the platform kills it; every outbound integration
// (Bring, Helthjem, Resend, Vipps, web-push) should cap its wait. Brønnøysund
// already does this inline (brreg.ts); this is the shared version for the rest.
//
// AbortSignal.timeout fires an AbortError after `timeoutMs`, which surfaces as a
// rejected fetch — callers already treat a thrown/failed fetch as the failure
// path, so no call-site error handling changes.

const DEFAULT_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
