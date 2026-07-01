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
/**
 * index.ts — CLI entry point for GraffitiCo document generation.
 *
 * Usage:
 *   npm run generate -- --mode invoice
 *   npm run generate -- --mode quote --deals 12345,67890
 *   npm run generate -- --mode invoice --dry-run
 *   npm run generate -- --mode invoice --deals 12345 --paid
 */
const path = __importStar(require("path"));
const dotenv = __importStar(require("dotenv"));
// Load .env from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const batch_1 = require("./batch");
const tax_1 = require("./tax");
const pipedrive_1 = require("./pipedrive");
// ─── Parse CLI args ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
};
const has = (flag) => args.includes(flag);
// ─── Tax commands (separate from quote/invoice/statement generation) ─────────
const command = args[0];
if (command === 'tax') {
    const dealId = parseInt(args[1]);
    if (isNaN(dealId)) {
        console.error('\n❌ Usage: npm run generate -- tax <dealId>\n');
        process.exit(1);
    }
    (async () => {
        try {
            console.log(`\nLooking up tax rate for deal #${dealId}...`);
            const deal = await (0, pipedrive_1.getDeal)(dealId);
            const orgId = deal?.org_id?.value ?? deal?.org_id;
            if (!orgId)
                throw new Error(`Deal #${dealId} has no organization attached`);
            const org = await (0, pipedrive_1.getOrganization)(orgId);
            const rawAddr = org?.address;
            if (!rawAddr || typeof rawAddr !== 'string') {
                throw new Error('Organization has no address on file in Pipedrive');
            }
            const { parseAddressString } = await Promise.resolve().then(() => __importStar(require('./tax')));
            const { street, city, zip } = parseAddressString(rawAddr);
            if (!street || !zip) {
                throw new Error(`Could not extract a complete address (street + zip) from: "${rawAddr}". ` +
                    `Parsed as → street: "${street || 'MISSING'}", city: "${city || 'MISSING'}", zip: "${zip || 'MISSING'}". ` +
                    `Please add a 5-digit zip code to this organization's address in Pipedrive.`);
            }
            await (0, tax_1.applyTaxToDeal)(dealId, street, city, zip, deal?.org_id?.name ?? '');
            process.exit(0);
        }
        catch (err) {
            console.error('\n❌ Tax lookup failed:', err.message);
            process.exit(1);
        }
    })();
}
else if (command === 'tax-refresh-all') {
    const dryRunTax = has('--dry-run');
    const taxConcurrency = parseInt(get('--concurrency') || '3', 10);
    (async () => {
        try {
            const results = await (0, tax_1.refreshAllTaxRates)({ dryRun: dryRunTax, concurrency: taxConcurrency });
            const changed = results.filter(r => r.direction === 'increased' || r.direction === 'decreased');
            if (changed.length > 0) {
                console.log('\n⚠️  RATE CHANGES REQUIRING ATTENTION:');
                console.log('─────────────────────────────────────────────────────');
                for (const r of changed) {
                    const arrow = r.direction === 'increased' ? '🔺' : '🔻';
                    const prev = r.previous !== null ? (r.previous * 100).toFixed(4) + '%' : 'n/a';
                    const curr = (r.current * 100).toFixed(4) + '%';
                    console.log(`  ${arrow} ${r.orgName.padEnd(40)} ${prev} → ${curr}`);
                }
                console.log('─────────────────────────────────────────────────────\n');
            }
            process.exit(0);
        }
        catch (err) {
            console.error('\n❌ Tax refresh failed:', err.message);
            process.exit(1);
        }
    })();
}
else {
    const mode = (get('--mode') || 'invoice');
    const dealsRaw = get('--deals');
    const dealIds = dealsRaw ? dealsRaw.split(',').map(Number) : undefined;
    const dryRun = has('--dry-run');
    const concurrency = parseInt(get('--concurrency') || '3', 10);
    // ─── Validate env ─────────────────────────────────────────────────────────────
    const required = ['PIPEDRIVE_API_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_DRIVE_FOLDER_ID'];
    const missing = required.filter(k => !process.env[k]);
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
    (0, batch_1.runBatch)({ mode, dealIds, dryRun, concurrency })
        .then(() => process.exit(0))
        .catch(err => {
        console.error('\n❌ Fatal error:', err);
        process.exit(1);
    });
}
