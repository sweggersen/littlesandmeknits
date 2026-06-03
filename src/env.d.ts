/// <reference types="astro/client" />

// Make `import { env } from 'cloudflare:workers'` typecheck. The
// actual runtime binding is provided by @astrojs/cloudflare /
// wrangler at deploy time; this is the type-side declaration so
// `astro check` (TypeScript) can resolve the module.
declare module 'cloudflare:workers' {
  export const env: Env;
}

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
  VIPPS_ENV: 'test' | 'prod';
  VIPPS_CLIENT_ID: string;
  VIPPS_CLIENT_SECRET: string;
  VIPPS_SUBSCRIPTION_KEY: string;
  VIPPS_MSN: string;
  LOGIN_INVITE_KEY: string;
  // Observability (june26.md §1.7) — optional; absent = telemetry no-ops.
  SENTRY_DSN?: string;
  // Runtime kill-switches (june26.md §1.4) — engaged when set to a truthy
  // string ('on'/'1'/'true'/'yes'). Flip in the Cloudflare dashboard to halt
  // a class of money movement without a redeploy. See docs/INCIDENT_RUNBOOK.md.
  KILL_PURCHASES?: string;   // block new buyer charges (listings, commissions, promotions, patterns)
  KILL_PAYOUTS?: string;     // block escrow capture/release to sellers (incl. cron auto-release)
  KILL_COMMISSIONS?: string; // block commission ("Strikk for meg") payments specifically
  // Generic feature flags are read as FLAG_<NAME>; add explicit keys here as
  // they stabilise. Indexer keeps ad-hoc flag reads typechecking.
  [key: `KILL_${string}`]: string | undefined;
  [key: `FLAG_${string}`]: string | undefined;
}

declare namespace App {
  interface Locals extends Runtime {
    isStrikketorget?: boolean;
    inMarketSession?: boolean;
    prevSection?: 'market' | 'studio' | 'lmk' | null;
    /** Set by middleware for auth-gated path prefixes (and read-along
     *  on other routes so pages can render personalised content
     *  without making a second auth call). May be null on public routes. */
    user?: import('@supabase/supabase-js').User | null;
  }
}

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
  readonly PUBLIC_STRIPE_PUBLISHABLE_KEY: string;
  readonly PUBLIC_SITE_URL: string;
  readonly PUBLIC_VAPID_KEY: string;
  // Privacy-respecting product analytics (june26.md §1.7) — e.g. Plausible.
  // Absent = no analytics script + Web Vitals reporting no-ops.
  readonly PUBLIC_ANALYTICS_SRC?: string;
  readonly PUBLIC_ANALYTICS_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
