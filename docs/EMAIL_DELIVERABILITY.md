# Email deliverability (owner setup)

june26.md §1.6. Transactional email is sent via **Resend** from
`Strikketorget <noreply@littlesandme.no>` (`src/lib/email.ts`). A welcome email
fires on first login (`auth/callback.ts`), and notification emails (seller
activated, sold, shipped, payout failed, etc.) go through `createNotification`.
Code is done; **inbox placement depends on DNS records you must set once** or
the mails land in spam and the work is wasted.

## Required DNS on `littlesandme.no`
Add the records Resend shows under **Domains → littlesandme.no** (verify the
domain there first):

1. **SPF** — a TXT record authorising Resend to send. Resend provides the exact
   value (a `include:` mechanism). If an SPF record already exists, merge, don't
   add a second one (only one SPF TXT per domain is valid).
2. **DKIM** — the CNAME/TXT records Resend generates (signs each message).
3. **DMARC** — a `_dmarc.littlesandme.no` TXT record. Start in monitor mode and
   tighten once SPF+DKIM pass:
   ```
   v=DMARC1; p=none; rua=mailto:dmarc@littlesandme.no; fo=1
   ```
   Move `p=none` → `p=quarantine` → `p=reject` after a week of clean reports.

## Verify
- Resend dashboard shows the domain **Verified** (SPF + DKIM green).
- Send a test welcome to a Gmail + an Outlook address; in Gmail use
  "Show original" and confirm **SPF: PASS, DKIM: PASS, DMARC: PASS**.
- Send from a fresh account end-to-end (real signup) and confirm the welcome
  lands in the inbox, not Promotions/Spam.

## Notes
- The `from` domain (`littlesandme.no`) must match the verified Resend domain.
  If you ever send from `strikketorget.no`, verify that domain in Resend too.
- Keep the list to transactional mail only; bulk/marketing from the same domain
  without consent tracking hurts the sending reputation.
