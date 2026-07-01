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
const http = __importStar(require("http"));
const path = __importStar(require("path"));
const dotenv = __importStar(require("dotenv"));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const batch_1 = require("./batch");
const tax_1 = require("./tax");
const pipedrive_1 = require("./pipedrive");
const PORT = parseInt(process.env.PORT || '3000', 10);
const STAGE_TRIGGERS = {
    56: 'quote',
    156: 'invoice',
};
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
function send(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}
async function autoTaxDeal(dealId) {
    try {
        const deal = await (0, pipedrive_1.getDeal)(dealId);
        const orgId = deal?.org_id?.value ?? deal?.org_id;
        if (!orgId)
            return;
        const org = await (0, pipedrive_1.getOrganization)(orgId);
        const rawAddr = org?.address;
        if (!rawAddr || typeof rawAddr !== 'string')
            return;
        const { street, city, zip } = (0, tax_1.parseAddressString)(rawAddr);
        if (!street || !zip) {
            console.log(`  ⚠️  Tax skipped for deal #${dealId} — incomplete address: "${rawAddr}"`);
            return;
        }
        await (0, tax_1.applyTaxToDeal)(dealId, street, city, zip, org?.name ?? '');
    }
    catch (err) {
        console.error(`  ❌ Tax auto-populate failed for deal #${dealId}:`, err.message);
    }
}
async function handler(req, res) {
    const url = req.url || '/';
    const method = req.method || 'GET';
    console.log(`${method} ${url}`);
    if (method === 'GET' && url === '/health') {
        return send(res, 200, { status: 'ok', service: 'graffitico-docs' });
    }
    if (method === 'POST' && url === '/webhook/pipedrive') {
        const body = await parseBody(req);
        console.log('FULL WEBHOOK BODY:', JSON.stringify(body).slice(0, 500));
        const current = body.current || body.data || {};
        const previous = body.previous || body.meta?.previous || {};
        const dealId = current.id;
        const stageId = Number(current.stage_id);
        const prevStageId = Number(previous.stage_id);
        console.log(`Deal #${dealId} | Stage: ${prevStageId} → ${stageId}`);
        if (!dealId) {
            return send(res, 200, { ignored: true, reason: 'no deal id' });
        }
        // New deal created — auto-populate tax immediately
        if (!prevStageId && dealId) {
            console.log(`\n🧾 New deal #${dealId} — auto-populating tax rate`);
            setImmediate(() => autoTaxDeal(dealId));
            return send(res, 200, { accepted: true, dealId, action: 'tax-lookup' });
        }
        if (stageId === prevStageId) {
            return send(res, 200, { ignored: true, reason: 'stage unchanged' });
        }
        const mode = STAGE_TRIGGERS[stageId];
        if (!mode) {
            console.log(`No trigger for stage ID: ${stageId}`);
            return send(res, 200, { ignored: true, reason: `no trigger for stage: ${stageId}` });
        }
        console.log(`\n🔔 Deal #${dealId} moved to stage ${stageId} → generating ${mode}`);
        setImmediate(async () => {
            try {
                await autoTaxDeal(dealId);
                await (0, batch_1.runBatch)({ mode, dealIds: [dealId], concurrency: 1 });
            }
            catch (err) {
                console.error(`❌ Generation failed for deal #${dealId}:`, err.message);
            }
        });
        return send(res, 200, { accepted: true, dealId, mode, stageId });
    }
    if (method === 'POST' && url === '/generate') {
        const body = await parseBody(req);
        const dealId = parseInt(body.dealId, 10);
        const mode = body.mode;
        if (!dealId || !mode) {
            return send(res, 400, { error: 'dealId and mode are required' });
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
    return send(res, 404, { error: 'Not found' });
}
const server = http.createServer(handler);
server.listen(PORT, () => {
    console.log(`\n🚀 GraffitiCo Docs webhook server running on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Webhook: http://localhost:${PORT}/webhook/pipedrive`);
    console.log(`   Manual: POST http://localhost:${PORT}/generate\n`);
});
exports.default = server;
