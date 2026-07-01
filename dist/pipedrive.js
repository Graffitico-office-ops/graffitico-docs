"use strict";
/**
 * pipedrive.ts — Pipedrive API client for GraffitiCo document generation.
 * Handles rate limiting and pagination automatically.
 */
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeal = getDeal;
exports.getAllDeals = getAllDeals;
exports.getOrganization = getOrganization;
exports.getDealProducts = getDealProducts;
exports.getOrgDeals = getOrgDeals;
exports.getUser = getUser;
exports.attachFileToDeal = attachFileToDeal;
exports.updateDeal = updateDeal;
const https_1 = __importDefault(require("https"));
const TOKEN = process.env.PIPEDRIVE_API_TOKEN;
const DOMAIN = process.env.PIPEDRIVE_DOMAIN || 'graffitico';
const BASE = `https://${DOMAIN}.pipedrive.com/api/v1`;
// ─── Simple rate-limit queue ──────────────────────────────────────────────────
// Pipedrive allows ~100 requests / 2 seconds per token.
// We stay safe at 40 req/s (one every 25ms).
let lastCall = 0;
async function throttle() {
    const now = Date.now();
    const gap = 25 - (now - lastCall);
    if (gap > 0)
        await new Promise(r => setTimeout(r, gap));
    lastCall = Date.now();
}
// ─── Low-level HTTPS request helper ──────────────────────────────────────────
// Replaces `fetch` — fetch's keep-alive connection pooling was causing
// intermittent "Premature close" errors on Railway. This uses a fresh,
// non-pooled connection for every request instead.
function httpsRequest(url, method, headers = {}, body) {
    return new Promise((resolve, reject) => {
        const req = https_1.default.request(url, { method, headers, agent: new https_1.default.Agent({ keepAlive: false }), timeout: 30000 }, (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode || 0, json: JSON.parse(data) });
                }
                catch (e) {
                    reject(new Error(`Failed to parse Pipedrive response (${res.statusCode}): ${data.slice(0, 200)}`));
                }
            });
        });
        req.on('timeout', () => req.destroy(new Error('Request timeout')));
        req.on('error', reject);
        if (body && typeof body.pipe === 'function') {
            body.pipe(req); // form-data stream — pipe() auto-calls req.end()
        }
        else if (body) {
            req.write(body);
            req.end();
        }
        else {
            req.end();
        }
    });
}
async function get(path, params = {}) {
    await throttle();
    const qs = new URLSearchParams({ api_token: TOKEN, ...params }).toString();
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const { json } = await httpsRequest(`${BASE}${path}?${qs}`, 'GET');
            if (!json.success)
                throw new Error(`Pipedrive error: ${JSON.stringify(json.error)}`);
            return json;
        }
        catch (err) {
            lastErr = err;
            console.warn(`  ⚠️ Attempt ${attempt + 1} failed for ${path}: ${err.message}`);
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
    }
    throw lastErr;
}
// ─── Paginated fetcher ────────────────────────────────────────────────────────
async function getAll(path, params = {}) {
    const items = [];
    let start = 0;
    const limit = 100;
    while (true) {
        const json = await get(path, { ...params, start, limit });
        if (json.data)
            items.push(...(Array.isArray(json.data) ? json.data : [json.data]));
        if (!json.additional_data?.pagination?.more_items_in_collection)
            break;
        start += limit;
    }
    return items;
}
// ─── Public API ───────────────────────────────────────────────────────────────
/** Fetch a single deal with all its fields */
async function getDeal(dealId) {
    const json = await get(`/deals/${dealId}`);
    return json.data;
}
/** Fetch all open deals (paginated) */
async function getAllDeals(status = 'open') {
    return getAll('/deals', { status });
}
/** Fetch an organization by ID */
async function getOrganization(orgId) {
    const json = await get(`/organizations/${orgId}`);
    return json.data;
}
/** Fetch all products attached to a deal */
async function getDealProducts(dealId) {
    return getAll(`/deals/${dealId}/products`);
}
/** Fetch all deals for an organization (for Statement aggregation) */
async function getOrgDeals(orgId, status = 'open') {
    return getAll('/deals', { org_id: orgId, status });
}
/** Fetch user (deal owner) info */
async function getUser(userId) {
    const json = await get(`/users/${userId}`);
    return json.data;
}
/**
 * Attach a PDF file to a deal in Pipedrive (shows in the Files tab).
 * @param dealId    Pipedrive deal ID
 * @param fileName  e.g. "Invoice_262818_CityOfSeattle.pdf"
 * @param pdfBuffer The rendered PDF as a Buffer
 */
async function attachFileToDeal(dealId, fileName, pdfBuffer) {
    await throttle();
    const FormData = (await Promise.resolve().then(() => __importStar(require('form-data')))).default;
    const form = new FormData();
    form.append('file', pdfBuffer, { filename: fileName, contentType: 'application/pdf' });
    form.append('deal_id', String(dealId));
    const { status, json } = await httpsRequest(`${BASE}/files?api_token=${TOKEN}`, 'POST', form.getHeaders(), form);
    if (status < 200 || status >= 300) {
        throw new Error(`Pipedrive file upload failed (${status}): ${JSON.stringify(json)}`);
    }
    if (!json.success)
        throw new Error(`Pipedrive file attach error: ${JSON.stringify(json)}`);
    console.log(`  📎 Attached to Pipedrive deal #${dealId}`);
}
async function updateDeal(dealId, fields) {
    await throttle();
    const body = JSON.stringify(fields);
    const { status, json } = await httpsRequest(`${BASE}/deals/${dealId}?api_token=${TOKEN}`, 'PUT', { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body).toString() }, body);
    if (status < 200 || status >= 300)
        throw new Error(`Pipedrive update deal ${dealId} → HTTP ${status}`);
    if (!json.success)
        throw new Error(`Pipedrive update error: ${JSON.stringify(json.error)}`);
    return json;
}
