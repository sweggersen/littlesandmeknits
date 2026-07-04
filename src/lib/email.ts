// Sender identity. Resend rejects (403) any `from` whose domain isn't verified
// in the Resend account, so this MUST be a domain you own and have verified.
// Override with the EMAIL_FROM env var; the default uses the marketplace domain.
export const DEFAULT_EMAIL_FROM = 'Strikketorget <noreply@strikketorget.no>';

export async function sendEmail(
  apiKey: string,
  opts: { to: string; subject: string; html: string },
  from: string = DEFAULT_EMAIL_FROM,
): Promise<boolean> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  });
  if (!res.ok) {
    // Surface WHY the send failed instead of swallowing it — Resend returns a
    // JSON error (e.g. "domain is not verified", invalid key). Callers only get
    // a boolean, so this log is the audit trail behind "sjekk Resend-loggen".
    const detail = await res.text().catch(() => '');
    console.error(`sendEmail: Resend ${res.status} for ${opts.to} — ${detail}`);
  }
  return res.ok;
}
