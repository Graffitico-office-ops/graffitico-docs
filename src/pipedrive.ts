/**
 * pipedrive.ts — Pipedrive API client for GraffitiCo document generation.
 * Handles rate limiting and pagination automatically.
 */
import fetch from 'node-fetch';
import { PipedriveDealProduct } from './types';

const TOKEN  = process.env.PIPEDRIVE_API_TOKEN!;
const DOMAIN = process.env.PIPEDRIVE_DOMAIN || 'graffitico';
const BASE   = `https://${DOMAIN}.pipedrive.com/api/v1`;

// ─── Simple rate-limit queue ──────────────────────────────────────────────────
// Pipedrive allows ~100 requests / 2 seconds per token.
// We stay safe at 40 req/s (one every 25ms).
let lastCall = 0;
async function throttle() {
  const now = Date.now();
  const gap = 25 - (now - lastCall);
  if (gap > 0) await new Promise(r => setTimeout(r, gap));
  lastCall = Date.now();
}

async function get(path: string, params: Record<string, any> = {}) {
  await throttle();
  const qs = new URLSearchParams({ api_token: TOKEN, ...params }).toString();
  const res = await fetch(`${BASE}${path}?${qs}`);
  if (!res.ok) throw new Error(`Pipedrive ${path} → HTTP ${res.status}`);
  const json: any = await res.json();
  if (!json.success) throw new Error(`Pipedrive error on ${path}: ${JSON.stringify(json.error)}`);
  return json;
}

// ─── Paginated fetcher ────────────────────────────────────────────────────────
async function getAll(path: string, params: Record<string, any> = {}): Promise<any[]> {
  const items: any[] = [];
  let start = 0;
  const limit = 100;
  while (true) {
    const json = await get(path, { ...params, start, limit });
    if (json.data) items.push(...(Array.isArray(json.data) ? json.data : [json.data]));
    if (!json.additional_data?.pagination?.more_items_in_collection) break;
    start += limit;
  }
  return items;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Fetch a single deal with all its fields */
export async function getDeal(dealId: number): Promise<any> {
  const json = await get(`/deals/${dealId}`);
  return json.data;
}

/** Fetch all open deals (paginated) */
export async function getAllDeals(status = 'open'): Promise<any[]> {
  return getAll('/deals', { status });
}

/** Fetch an organization by ID */
export async function getOrganization(orgId: number): Promise<any> {
  const json = await get(`/organizations/${orgId}`);
  return json.data;
}

/** Fetch all products attached to a deal */
export async function getDealProducts(dealId: number): Promise<PipedriveDealProduct[]> {
  return getAll(`/deals/${dealId}/products`);
}

/** Fetch all deals for an organization (for Statement aggregation) */
export async function getOrgDeals(orgId: number, status = 'open'): Promise<any[]> {
  return getAll('/deals', { org_id: orgId, status });
}

/** Fetch user (deal owner) info */
export async function getUser(userId: number): Promise<any> {
  const json = await get(`/users/${userId}`);
  return json.data;
}

/**
 * Attach a PDF file to a deal in Pipedrive (shows in the Files tab).
 * @param dealId    Pipedrive deal ID
 * @param fileName  e.g. "Invoice_262818_CityOfSeattle.pdf"
 * @param pdfBuffer The rendered PDF as a Buffer
 */
export async function attachFileToDeal(
  dealId: number,
  fileName: string,
  pdfBuffer: Buffer
): Promise<void> {
  await throttle();

  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', pdfBuffer, { filename: fileName, contentType: 'application/pdf' });
  form.append('deal_id', String(dealId));

  const res = await fetch(`${BASE}/files?api_token=${TOKEN}`, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pipedrive file upload failed (${res.status}): ${text}`);
  }

  const json: any = await res.json();
  if (!json.success) throw new Error(`Pipedrive file attach error: ${JSON.stringify(json)}`);

  console.log(`  📎 Attached to Pipedrive deal #${dealId}`);
}
