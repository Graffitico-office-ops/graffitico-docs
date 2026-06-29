/**
 * server.ts — Webhook server for GraffitiCo document generation.
 * Listens for Pipedrive stage-change events and generates documents automatically.
 *
 * Endpoints:
 *   GET  /health              — Health check
 *   POST /webhook/pipedrive   — Pipedrive stage-change webhook
 *   POST /generate            — Manual trigger: { dealId, mode }
 */
import * as http from 'http';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { getDeal } from './pipedrive';
import { runBatch } from './batch';
import { DocumentMode } from './types';

const PORT = parseInt(process.env.PORT || '3000', 10);

// ─── Pipeline stage → document mode mapping ───────────────────────────────────
// Stage names from your Pipedrive pipelines.
// Add more stage names here as you roll out to other pipelines.
const STAGE_TRIGGERS: Record<string, DocumentMode> = {
  'Quote Sent':  'quote',
  'Job Done':    'invoice',
  'Invoice Prep': 'invoice',
  '56':  'quote',
  '156': 'invoice',
};
  // A/R pipelines — invoice prep stage
  'Invoice Prep': 'invoice',
};

// ─── Parse JSON body ──────────────────────────────────────────────────────────
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

// ─── Send JSON response ───────────────────────────────────────────────────────
function send(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ─── Request handler ──────────────────────────────────────────────────────────
async function handler(req: http.IncomingMessage, res: http.ServerResponse) {
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
    const event    = body.event || '';
    const current  = body.current || {};
    const previous = body.previous || {};

    if (!event.includes('deal')) {
      return send(res, 200, { ignored: true, reason: 'not a deal event' });
    }

   const dealId       = current.id;
    // Debug: log the full payload so we can see what Pipedrive sends
    console.log('Webhook payload:', JSON.stringify({ event, current_stage: current.stage_id, prev_stage: previous.stage_id, current_stage_name: current.stage_name }, null, 2));
    const stageName     = String(current.stage_id?.name || current.stage_id || current.stage_name || '');
    const prevStageName = String(previous.stage_id?.name || previous.stage_id || previous.stage_name || '');
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
        await runBatch({ mode, dealIds: [dealId], concurrency: 1 });
      } catch (err: any) {
        console.error(`❌ Generation failed for deal #${dealId}:`, err.message);
      }
    });

    return send(res, 200, { accepted: true, dealId, mode, stage: stageName });
  }

  // ── Manual trigger ──
  if (method === 'POST' && url === '/generate') {
    const body = await parseBody(req);
    const dealId = parseInt(body.dealId, 10);
    const mode   = body.mode as DocumentMode;

    if (!dealId || !mode) {
      return send(res, 400, { error: 'dealId and mode are required' });
    }

    if (!['quote', 'invoice', 'statement'].includes(mode)) {
      return send(res, 400, { error: 'mode must be quote | invoice | statement' });
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

export default server;
