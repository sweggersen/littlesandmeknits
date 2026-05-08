#!/usr/bin/env npx tsx
/**
 * Strikketorget — Marketplace reset script
 *
 * Deletes all listings, conversations, and messages from test accounts.
 * Keeps user accounts and profiles intact for re-seeding.
 *
 * Usage:
 *   npx tsx scripts/marketplace-reset.ts
 *   npx tsx scripts/marketplace-reset.ts --all   # also delete test user accounts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  Object.entries(process.env).forEach(([k, v]) => { if (v) result[k] = v; });
  for (const file of ['.env.local', '.env', '.dev.vars']) {
    try {
      for (const line of readFileSync(resolve(process.cwd(), file), 'utf-8').split('\n')) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"#]*)"?\s*$/);
        if (m) result[m[1].trim()] = m[2].trim();
      }
    } catch {}
  }
  return result;
}

const env = loadEnv();
const SUPABASE_URL = env.PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('\n  Missing env vars. Set PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY\n');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EMAIL_DOMAIN = '@test.strikketorget.no';
const deleteAccounts = process.argv.includes('--all');

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║     Strikketorget — Marketplace Reset             ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  // Find test users
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const testUsers = (users?.users ?? []).filter(u => u.email?.endsWith(EMAIL_DOMAIN));
  const testIds = testUsers.map(u => u.id);

  if (testIds.length === 0) {
    console.log('  No test accounts found. Nothing to reset.\n');
    return;
  }

  console.log(`  Found ${testIds.length} test accounts:`);
  for (const u of testUsers) {
    console.log(`    ${u.email}`);
  }

  // Delete messages (must go before conversations due to FK)
  const { count: msgs } = await admin
    .from('marketplace_messages')
    .delete({ count: 'exact' })
    .in('sender_id', testIds);
  console.log(`\n  \x1b[32m✓\x1b[0m Deleted ${msgs ?? 0} messages`);

  // Delete conversations where test user is seller or buyer
  const { count: convos1 } = await admin
    .from('marketplace_conversations')
    .delete({ count: 'exact' })
    .in('seller_id', testIds);
  const { count: convos2 } = await admin
    .from('marketplace_conversations')
    .delete({ count: 'exact' })
    .in('buyer_id', testIds);
  console.log(`  \x1b[32m✓\x1b[0m Deleted ${(convos1 ?? 0) + (convos2 ?? 0)} conversations`);

  // Delete listings
  const { count: listings } = await admin
    .from('listings')
    .delete({ count: 'exact' })
    .in('seller_id', testIds);
  console.log(`  \x1b[32m✓\x1b[0m Deleted ${listings ?? 0} listings`);

  if (deleteAccounts) {
    console.log('\n  Deleting test accounts...');
    for (const u of testUsers) {
      const { error } = await admin.auth.admin.deleteUser(u.id);
      if (error) {
        console.log(`  \x1b[33m!\x1b[0m Failed to delete ${u.email}: ${error.message}`);
      } else {
        console.log(`  \x1b[32m✓\x1b[0m Deleted ${u.email}`);
      }
    }
  } else {
    console.log('\n  Accounts kept intact. Use --all to also delete accounts.');
  }

  console.log('\n  Done. Run `npx tsx scripts/marketplace-seed.ts` to re-seed.\n');
}

main().catch((err) => {
  console.error('\nReset failed:', err);
  process.exit(1);
});
