// Single boundary for runtime environment access. Every other file in
// the codebase imports `env` from HERE, never from `cloudflare:workers`
// directly. This keeps the runtime swappable: switching to Vercel,
// Node, Deno, etc. is one edit in this file instead of 40+ across
// pages and services.
//
// ESLint rule (see eslint.config.js): `no-restricted-imports` blocks
// `cloudflare:workers` everywhere except this file.

// eslint-disable-next-line no-restricted-imports
import { env as cloudflareEnv } from 'cloudflare:workers';

/**
 * The runtime environment bindings (Cloudflare secrets, KV namespaces,
 * R2 buckets, etc.). `Env` is a global type declared in env.d.ts.
 *
 * Import this everywhere instead of importing from 'cloudflare:workers':
 *
 *     import { env } from '../lib/env';
 *     stripe(env.STRIPE_SECRET_KEY);
 */
export const env: Env = cloudflareEnv as unknown as Env;
