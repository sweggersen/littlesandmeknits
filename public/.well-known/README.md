# /.well-known/

This directory is served at the root of the deployed site
(`https://littlesandmeknits.com/.well-known/...`) and holds standardised
verification files various services require.

## apple-developer-merchantid-domain-association

Required to enable **Apple Pay** in Stripe Checkout. To set up:

1. Go to Stripe Dashboard → Settings → Payment methods → Apple Pay.
2. Click "Add a new domain" and enter `littlesandmeknits.com`.
3. Stripe gives you a verification file — download it.
4. Place it in this directory as
   `apple-developer-merchantid-domain-association` (no extension).
5. Commit, deploy, then click "Verify" in Stripe.

Once verified, Apple Pay appears automatically on Stripe Checkout for
visitors on supported devices/browsers. Repeat per environment (staging
domain, prod domain).

Google Pay needs no domain file — it's enabled implicitly via Stripe
once your account passes their checks.

## Other files

- `assetlinks.json` — Android App Links (if/when we ship a PWA-to-app).
- `apple-app-site-association` — Universal Links (same trigger).

Neither is needed today.
