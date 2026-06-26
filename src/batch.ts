/**
 * batch.ts — Bulk document generation runner.
 * Pulls deals from Pipedrive, renders PDFs, uploads to Drive, attaches to deals.
 * Handles 300+ documents with concurrency control and error recovery.
 */
import * as fs   from 'fs';
import * as path from 'path';
import { getDeal, getAllDeals, getOrganization, getDealProducts, attachFileToDeal } from './pipedrive';
import { normalizeQuote, normalizeInvoice } from './normalize';
import { renderToPdf } from './render';
import { uploadPdf } from './drive';
import { DocumentMode, BatchOptions, DocumentRecord } from './types';

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(__dirname, '..', 'output');

// ─── Safe filename builder ────────────────────────────────────────────────────
function buildFileName(doc: DocumentRecord): string {
  const type   = doc.typeWord;                                       // INVOICE
  const num    = doc.docNumber.replace(/[^a-zA-Z0-9]/g, '');        // 262818
  const org    = doc.orgName.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/ +/g, '_'); // City_of_Seattle
  const date   = new Date(doc.issueDate).toISOString().slice(0, 7); // 2026-06
  return `${type}_${num}_${org}_${date}.pdf`;
}

// ─── Process a single deal ────────────────────────────────────────────────────
async function processDeal(
  dealId:   number,
  mode:     DocumentMode,
  dryRun:   boolean,
): Promise<{ dealId: number; success: boolean; fileName?: string; error?: string }> {
  try {
    console.log(`\n[Deal #${dealId}] Fetching...`);

    const deal     = await getDeal(dealId);
    const orgId    = deal.org_id?.value || deal.org_id;
    if (!orgId) throw new Error('No organization linked to this deal');

    const org      = await getOrganization(orgId);
    const products = await getDealProducts(dealId);

    if (products.length === 0 && mode !== 'statement') {
      console.log(`  ⚠️  Skipping — no products on deal`);
      return { dealId, success: true, fileName: 'skipped (no products)' };
    }

    // Normalize
    const doc = mode === 'quote'
      ? normalizeQuote(deal, org, products)
      : normalizeInvoice(deal, org, products);

    const fileName = buildFileName(doc);
    console.log(`  📄 Rendering: ${fileName}`);

    if (dryRun) {
      console.log(`  🔍 Dry run — skipping PDF generation and upload`);
      return { dealId, success: true, fileName };
    }

    // Render PDF
    const pdf = await renderToPdf(doc, ASSETS_DIR);

    // Save locally
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const localPath = path.join(OUTPUT_DIR, fileName);
    fs.writeFileSync(localPath, pdf);
    console.log(`  💾 Saved locally: ${localPath}`);

    // Upload to Google Drive
    await uploadPdf(pdf, fileName, doc.orgName, doc.issueDate);

    // Attach to Pipedrive deal
    await attachFileToDeal(dealId, fileName, pdf);

    console.log(`  ✅ Done: ${fileName}`);
    return { dealId, success: true, fileName };

  } catch (err: any) {
    console.error(`  ❌ Deal #${dealId} failed: ${err.message}`);
    return { dealId, success: false, error: err.message };
  }
}

// ─── Concurrency pool ─────────────────────────────────────────────────────────
async function runPool<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  let i = 0;

  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: concurrency }, worker);
  await Promise.all(workers);
  return results;
}

// ─── Main batch runner ────────────────────────────────────────────────────────
export async function runBatch(options: BatchOptions) {
  const { mode, dryRun = false, concurrency = 3 } = options;

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`GraffitiCo Document Batch — ${mode.toUpperCase()}S`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'} | Concurrency: ${concurrency}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // Get deal IDs to process
  let dealIds = options.dealIds;
  if (!dealIds) {
    console.log('Fetching all open deals from Pipedrive...');
    const deals = await getAllDeals('open');
    dealIds = deals.map(d => d.id);
    console.log(`Found ${dealIds.length} open deals\n`);
  }

  const tasks = dealIds.map(id => () => processDeal(id, mode, dryRun));
  const results = await runPool(tasks, concurrency);

  // ── Summary ──
  const succeeded = results.filter(r => r.success);
  const failed    = results.filter(r => !r.success);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`BATCH COMPLETE`);
  console.log(`  ✅ Succeeded: ${succeeded.length}`);
  console.log(`  ❌ Failed:    ${failed.length}`);
  if (failed.length > 0) {
    console.log('\nFailed deals:');
    failed.forEach(r => console.log(`  Deal #${r.dealId}: ${r.error}`));
  }
  console.log('═══════════════════════════════════════════════════════\n');

  return results;
}
