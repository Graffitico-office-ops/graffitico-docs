/**
 * index.ts — CLI entry point for GraffitiCo document generation.
 *
 * Usage:
 *   npm run generate -- --mode invoice
 *   npm run generate -- --mode quote --deals 12345,67890
 *   npm run generate -- --mode invoice --dry-run
 *   npm run generate -- --mode invoice --deals 12345 --paid
 */
import * as path from 'path';
import * as fs   from 'fs';
import * as dotenv from 'dotenv';

// Load .env from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { runBatch } from './batch';
import { DocumentMode } from './types';

// ─── Parse CLI args ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get  = (flag: string) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};
const has = (flag: string) => args.includes(flag);

const mode    = (get('--mode') || 'invoice') as DocumentMode;
const dealsRaw = get('--deals');
const dealIds  = dealsRaw ? dealsRaw.split(',').map(Number) : undefined;
const dryRun   = has('--dry-run');
const concurrency = parseInt(get('--concurrency') || '3', 10);

// ─── Validate env ─────────────────────────────────────────────────────────────
const required = ['PIPEDRIVE_API_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_DRIVE_FOLDER_ID'];
const missing  = required.filter(k => !process.env[k]);

if (missing.length > 0) {
  console.error('\n❌ Missing required environment variables:');
  missing.forEach(k => console.error(`   ${k}`));
  console.error('\nCopy .env.example to .env and fill in the values.');
  console.error('Run `npm run auth` first to get your GOOGLE_REFRESH_TOKEN.\n');
  process.exit(1);
}

if (!['quote', 'invoice', 'statement'].includes(mode)) {
  console.error(`\n❌ Invalid --mode "${mode}". Use: quote | invoice | statement\n`);
  process.exit(1);
}

// ─── Run ──────────────────────────────────────────────────────────────────────
runBatch({ mode, dealIds, dryRun, concurrency })
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ Fatal error:', err);
    process.exit(1);
  });
