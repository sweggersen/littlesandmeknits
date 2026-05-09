export async function sendEmail(
  apiKey: string,
  opts: { to: string; subject: string; html: string },
): Promise<boolean> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Strikketorget <noreply@littlesandme.no>',
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  });
  return res.ok;
}
