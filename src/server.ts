import * as http from 'http';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { runBatch } from './batch';
import { DocumentMode } from './types';
import { applyTaxToDeal, parseAddressString } from './tax';
import { getDeal, getOrganization } from './pipedrive';

const PORT = parseInt(process.env.PORT || '3000', 10);

const STAGE_TRIGGERS: Record<number, DocumentMode> = {
  56: 'quote',
  156: 'invoice',
};

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function autoTaxDeal(dealId: number): Promise<void> {
  try {
    const deal  = await getDeal(dealId);
    const orgId = deal?.org_id?.value ?? deal?.org_id;
    if (!orgId) return;

    const org     = await getOrganization(orgId);
    const rawAddr = org?.address;
    if (!rawAddr || typeof rawAddr !== 'string') return;

    const { street, city, zip } = parseAddressString(rawAddr);
    if (!street || !zip) {
      console.log(`  ⚠️  Tax skipped for deal #${dealId} — incomplete address: "${rawAddr}"`);
      return;
    }

    await applyTaxToDeal(dealId, street, city, zip, org?.name ?? '');
  } catch (err: any) {
    console.error(`  ❌ Tax auto-populate failed for deal #${dealId}:`, err.message);
  }
}

async function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = req.url || '/';
  const method = req.method || 'GET';
  console.log(`${method} ${url}`);

  if (method === 'GET' && url === '/health') {
    return send(res, 200, { status: 'ok', service: 'graffitico-docs' });
  }

  if (method === 'POST' && url === '/webhook/pipedrive') {
    const body = await parseBody(req);

    console.log('FULL WEBHOOK BODY:', JSON.stringify(body).slice(0, 500));

    const current  = body.current  || body.data || {};
    const previous = body.previous || body.meta?.previous || {};

    const dealId      = current.id;
    const stageId     = Number(current.stage_id);
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
        await runBatch({ mode, dealIds: [dealId], concurrency: 1 });
      } catch (err: any) {
        console.error(`❌ Generation failed for deal #${dealId}:`, err.message);
      }
    });

    return send(res, 200, { accepted: true, dealId, mode, stageId });
  }

  if (method === 'POST' && url === '/generate') {
    const body = await parseBody(req);
    const dealId = parseInt(body.dealId, 10);
    const mode = body.mode as DocumentMode;

    if (!dealId || !mode) {
      return send(res, 400, { error: 'dealId and mode are required' });
    }

    console.log(`\n📋 Manual trigger: Deal #${dealId} → ${mode}`);

    setImmediate(async () => {
      try {
        await runBatch({ mode, dealIds: [dealId], concurrency: 1 });
      } catch (err: any) {
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

export default server;
