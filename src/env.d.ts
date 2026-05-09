/// <reference types="astro/client" />

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

interface Env {
  ASSETS: Fetcher;
  SESSION: KVNamespace;
  // Secrets — set via `wrangler secret put` or the Cloudflare dashboard
  SUPABASE_SERVICE_ROLE_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  RESEND_API_KEY: string;
  VAPID_PRIVATE_KEY: string;
  CRON_SECRET: string;
  BRING_API_UID: string;
  BRING_API_KEY: string;
  BRING_CUSTOMER_NUMBER: string;
}

declare namespace App {
  interface Locals extends Runtime {}
}

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
  readonly PUBLIC_STRIPE_PUBLISHABLE_KEY: string;
  readonly PUBLIC_SITE_URL: string;
  readonly PUBLIC_VAPID_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
