# Vipps Login — Implementation Plan

Vipps Login is the Norway-native single sign-on built into the Vipps app most users already have installed. It's the highest-conversion login option for Norwegian consumer products — one tap on the phone, identity verified by BankID at registration time.

## Why it's not a one-day job

Unlike Google/Apple, Supabase Auth has no built-in Vipps provider. The integration is a **custom OIDC flow** that lives alongside Supabase Auth and links Vipps identities to Supabase users via the admin API.

It also requires a real Vipps merchant agreement — they don't have a public sandbox you can self-serve.

## What you need before any code is written

1. **Vipps merchant account** — same one you'd use for Vipps Payments. Go to <https://portal.vipps.no/> and apply. Approval can take 5–10 days.
2. **Enable Vipps Login product** in the portal — separate from Payments. Costs roughly 0.50–1.00 NOK per login (negotiable at volume).
3. **Sandbox (MT) credentials** — `client_id`, `client_secret`, `merchant_serial_number`, `subscription_key`. The portal gives you both test (MT) and production credentials.
4. **Set redirect URI** in the portal: `https://www.littlesandme.no/api/auth/vipps/callback` (and `http://localhost:4321/api/auth/vipps/callback` for dev).

## The flow

```
[User]
  ↓ clicks "Logg inn med Vipps"
[Browser]
  ↓ GET /api/auth/vipps/start
[Worker]
  ↓ generates PKCE verifier + state, stores in HMAC-signed cookie
  ↓ 302 → https://apitest.vipps.no/access-management-1.0/access/oauth2/auth?
            client_id=...&response_type=code&scope=openid+name+email+phoneNumber+birthDate&
            redirect_uri=...&state=...&code_challenge=...
[Vipps app]
  ↓ user confirms
[Browser]
  ↓ GET /api/auth/vipps/callback?code=...&state=...
[Worker]
  ↓ verify state, exchange code for tokens
  ↓ GET /vipps-userinfo-api/userinfo with access_token
  ↓ now we have { sub, email, phone_number, name, birthdate }
  ↓ link/create Supabase user (see Account linking below)
  ↓ set Supabase session cookie via admin.auth.admin.generateLink + signInWithIdToken
  ↓ 302 → /studio
```

## Account linking strategy

This is the trickiest part. Three cases:

| Case | Resolution |
|---|---|
| Vipps `sub` already linked | Use the linked Supabase user. Sign them in. |
| Vipps `sub` new, but email matches an existing Supabase user | **Show a merge prompt.** "Vi fant en konto med samme e-postadresse. Vil du koble Vipps til den?" Don't auto-merge — phishing risk. |
| Vipps `sub` new and email is new | Create a Supabase user via admin API, link Vipps `sub`, set consent timestamps. |

Schema additions:

```sql
ALTER TABLE public.profiles
  ADD COLUMN vipps_sub text UNIQUE,
  ADD COLUMN vipps_linked_at timestamptz;
```

The `vipps_sub` is Vipps's stable per-merchant user identifier. **Never use the phone number as the linking key** — phone numbers get recycled.

## Age verification — the silver lining

Vipps `userinfo` returns `birthdate` (verified by BankID at Vipps signup). This is **stronger than our current self-attested checkbox**. We could:
- Auto-stamp `age_confirmed_at` from a verified birthdate
- Block under-15 signups for Strikketorget actions automatically
- Display a "Verifisert med BankID" badge on Vipps-linked profiles → boosts trust on listings

## Required env vars

```
VIPPS_CLIENT_ID=...
VIPPS_CLIENT_SECRET=...
VIPPS_SUBSCRIPTION_KEY=...
VIPPS_MERCHANT_SERIAL_NUMBER=...
VIPPS_BASE_URL=https://apitest.vipps.no   # or https://api.vipps.no for prod
```

## Files to create

| File | Purpose |
|---|---|
| `src/lib/vipps-oidc.ts` | PKCE helpers, token exchange, userinfo fetch |
| `src/pages/api/auth/vipps/start.ts` | Initiates flow, sets state cookie, redirects to Vipps |
| `src/pages/api/auth/vipps/callback.ts` | Handles return, exchanges code, creates/links Supabase user |
| `src/pages/api/auth/vipps/merge.ts` | Confirms email-merge prompts |
| Migration | `vipps_sub` and `vipps_linked_at` on profiles |
| `LoginForm.tsx` | Add "Logg inn med Vipps" button |

## Estimated effort

- Without Vipps credentials in hand: 0 hours (blocked)
- With sandbox credentials: ~6 hours coding + 2 hours testing in MT environment
- Add 1–2 days lead time for the merge prompt UX, error states, and the schema migration deploy

## What to do today

1. Apply for Vipps Login in the portal.
2. While you wait for approval, keep magic link + Google + email/password as the live options.
3. When credentials arrive, drop them into `.dev.vars` and into Cloudflare Workers secrets, then come back to this plan.

## References

- Vipps Login API docs: <https://developer.vippsmobilepay.com/docs/APIs/login-api/>
- OIDC flow spec: <https://developer.vippsmobilepay.com/docs/APIs/login-api/login-api-howto>
- Vergemålsloven § 12 — the law that lets us drop our floor from 18 to 15 (referenced in privacy/terms)
