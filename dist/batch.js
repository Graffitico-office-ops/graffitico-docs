"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runBatch = runBatch;
/**
 * batch.ts — Bulk document generation runner.
 * Pulls deals from Pipedrive, renders PDFs, uploads to Drive, attaches to deals.
 * Handles 300+ documents with concurrency control and error recovery.
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const pipedrive_1 = require("./pipedrive");
const normalize_1 = require("./normalize");
const render_1 = require("./render");
const drive_1 = require("./drive");
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(__dirname, '..', 'output');
// ─── Safe filename builder ────────────────────────────────────────────────────
function buildFileName(doc) {
    const type = doc.typeWord; // INVOICE
    const num = doc.docNumber.replace(/[^a-zA-Z0-9]/g, ''); // 262818
    const org = doc.orgName.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/ +/g, '_'); // City_of_Seattle
    const date = new Date(doc.issueDate).toISOString().slice(0, 7); // 2026-06
    return `${type}_${num}_${org}_${date}.pdf`;
}
// ─── Process a single deal ────────────────────────────────────────────────────
async function processDeal(dealId, mode, dryRun) {
    try {
        console.log(`\n[Deal #${dealId}] Fetching...`);
        const deal = await (0, pipedrive_1.getDeal)(dealId);
        const orgId = deal.org_id?.value || deal.org_id;
        if (!orgId)
            throw new Error('No organization linked to this deal');
        const org = await (0, pipedrive_1.getOrganization)(orgId);
        const products = await (0, pipedrive_1.getDealProducts)(dealId);
        if (products.length === 0 && mode !== 'statement') {
            console.log(`  ⚠️  Skipping — no products on deal`);
            return { dealId, success: true, fileName: 'skipped (no products)' };
        }
        // Normalize
        const doc = mode === 'quote'
            ? (0, normalize_1.normalizeQuote)(deal, org, products)
            : (0, normalize_1.normalizeInvoice)(deal, org, products);
        const fileName = buildFileName(doc);
        console.log(`  📄 Rendering: ${fileName}`);
        if (dryRun) {
            console.log(`  🔍 Dry run — skipping PDF generation and upload`);
            return { dealId, success: true, fileName };
        }
        // Render PDF
        const pdf = await (0, render_1.renderToPdf)(doc, ASSETS_DIR);
        // Save locally
        if (!fs.existsSync(OUTPUT_DIR))
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        const localPath = path.join(OUTPUT_DIR, fileName);
        fs.writeFileSync(localPath, pdf);
        console.log(`  💾 Saved locally: ${localPath}`);
        // Upload to Google Drive
        await (0, drive_1.uploadPdf)(pdf, fileName, doc.orgName, doc.issueDate);
        // Attach to Pipedrive deal
        await (0, pipedrive_1.attachFileToDeal)(dealId, fileName, pdf);
        console.log(`  ✅ Done: ${fileName}`);
        return { dealId, success: true, fileName };
    }
    catch (err) {
        console.error(`  ❌ Deal #${dealId} failed: ${err.message}`);
        return { dealId, success: false, error: err.message };
    }
}
// ─── Concurrency pool ─────────────────────────────────────────────────────────
async function runPool(tasks, concurrency) {
    const results = [];
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
async function runBatch(options) {
    const { mode, dryRun = false, concurrency = 3 } = options;
    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`GraffitiCo Document Batch — ${mode.toUpperCase()}S`);
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'} | Concurrency: ${concurrency}`);
    console.log('═══════════════════════════════════════════════════════\n');
    // Get deal IDs to process
    let dealIds = options.dealIds;
    if (!dealIds) {
        console.log('Fetching all open deals from Pipedrive...');
        const deals = await (0, pipedrive_1.getAllDeals)('open');
        dealIds = deals.map(d => d.id);
        console.log(`Found ${dealIds.length} open deals\n`);
    }
    const tasks = dealIds.map(id => () => processDeal(id, mode, dryRun));
    const results = await runPool(tasks, concurrency);
    // ── Summary ──
    const succeeded = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
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
