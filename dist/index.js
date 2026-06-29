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
// ─── Parse CLI args ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
};
const has = (flag) => args.includes(flag);
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
