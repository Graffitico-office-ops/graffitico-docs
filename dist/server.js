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
 * server.ts — Webhook server for GraffitiCo document generation.
 * Listens for Pipedrive stage-change events and generates documents automatically.
 *
 * Endpoints:
 *   GET  /health              — Health check
 *   POST /webhook/pipedrive   — Pipedrive stage-change webhook
 *   POST /generate            — Manual trigger: { dealId, mode }
 */
const http = __importStar(require("http"));
const path = __importStar(require("path"));
const dotenv = __importStar(require("dotenv"));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const batch_1 = require("./batch");
const PORT = parseInt(process.env.PORT || '3000', 10);
// ─── Pipeline stage → document mode mapping ───────────────────────────────────
// Stage names from your Pipedrive pipelines.
// Add more stage names here as you roll out to other pipelines.
const STAGE_TRIGGERS = {
    // Sales - Active 1-Offs
    'Quote Sent': 'quote',
    'Job Done': 'invoice',
    // A/R pipelines — invoice prep stage
    'Invoice Prep': 'invoice',
};
// ─── Parse JSON body ──────────────────────────────────────────────────────────
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            }
            catch {
                resolve({});
            }
        });
        req.on('error', reject);
    });
}
// ─── Send JSON response ───────────────────────────────────────────────────────
function send(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}
// ─── Request handler ──────────────────────────────────────────────────────────
async function handler(req, res) {
    const url = req.url || '/';
    const method = req.method || 'GET';
    console.log(`${method} ${url}`);
    // ── Health check ──
    if (method === 'GET' && url === '/health') {
        return send(res, 200, { status: 'ok', service: 'graffitico-docs' });
    }
    // ── Pipedrive webhook ──
    if (method === 'POST' && url === '/webhook/pipedrive') {
        const body = await parseBody(req);
        // Pipedrive sends: { event: 'updated.deal', current: {...}, previous: {...} }
        const event = body.event || '';
        const current = body.current || {};
        const previous = body.previous || {};
        if (!event.includes('deal')) {
            return send(res, 200, { ignored: true, reason: 'not a deal event' });
        }
        const dealId = current.id;
        const stageName = current.stage_id?.name || current.stage_name || '';
        const prevStageName = previous.stage_id?.name || previous.stage_name || '';
        // Only trigger if stage actually changed
        if (stageName === prevStageName) {
            return send(res, 200, { ignored: true, reason: 'stage unchanged' });
        }
        const mode = STAGE_TRIGGERS[stageName];
        if (!mode) {
            console.log(`  Stage "${stageName}" has no trigger configured — skipping`);
            return send(res, 200, { ignored: true, reason: `no trigger for stage: ${stageName}` });
        }
        console.log(`\n🔔 Deal #${dealId} moved to "${stageName}" → generating ${mode}`);
        // Run async so we can respond to Pipedrive immediately
        setImmediate(async () => {
            try {
                await (0, batch_1.runBatch)({ mode, dealIds: [dealId], concurrency: 1 });
            }
            catch (err) {
                console.error(`❌ Generation failed for deal #${dealId}:`, err.message);
            }
        });
        return send(res, 200, { accepted: true, dealId, mode, stage: stageName });
    }
    // ── Manual trigger ──
    if (method === 'POST' && url === '/generate') {
        const body = await parseBody(req);
        const dealId = parseInt(body.dealId, 10);
        const mode = body.mode;
        if (!dealId || !mode) {
            return send(res, 400, { error: 'dealId and mode are required' });
        }
        if (!['quote', 'invoice', 'statement'].includes(mode)) {
            return send(res, 400, { error: 'mode must be quote | invoice | statement' });
        }
        console.log(`\n📋 Manual trigger: Deal #${dealId} → ${mode}`);
        setImmediate(async () => {
            try {
                await (0, batch_1.runBatch)({ mode, dealIds: [dealId], concurrency: 1 });
            }
            catch (err) {
                console.error(`❌ Generation failed for deal #${dealId}:`, err.message);
            }
        });
        return send(res, 200, { accepted: true, dealId, mode });
    }
    // ── 404 ──
    return send(res, 404, { error: 'Not found' });
}
// ─── Start server ─────────────────────────────────────────────────────────────
const server = http.createServer(handler);
server.listen(PORT, () => {
    console.log(`\n🚀 GraffitiCo Docs webhook server running on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Webhook: http://localhost:${PORT}/webhook/pipedrive`);
    console.log(`   Manual: POST http://localhost:${PORT}/generate\n`);
});
exports.default = server;
