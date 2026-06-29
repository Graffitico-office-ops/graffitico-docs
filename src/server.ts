import * as http from 'http';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { runBatch } from './batch';
import { DocumentMode } from './types';

const PORT = parseInt(process.env.PORT || '3000', 10);

const STAGE_TRIGGERS: Record<string, DocumentMode> = {
  'Quote Sent': 'quote',
  'Job Done': 'invoice',
  'Invoice Prep': 'invoice',
  '56': 'quote',
  '156': 'invoice',
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

async function handler(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = req.url || '/';
  const method = req.method || 'GET';
  console.log(`${method} ${url}`);

  if (method === 'GET' && url === '/health') {
    return send(res, 200, { status: 'ok', service: 'graffitico-docs' });
  }

  if (method === 'POST' && url === '/webhook/pipedrive') {
    const body = await parseBody(req);
    const event = body.event || '';
    const current = body.current || {};
    const previous = body.previous || {};

    console.log('RAW WEBHOOK:', JSON.stringify({ event, stage_id_current: current.stage_id, stage_id_previous: previous.stage_id }));

    if (!event.includes('deal')) {
      return send(res, 200, { ignored: true, reason: 'not a deal event' });
    }

    const dealId = current.id;
    const stageName = String(current.stage_id || '');
    const prevStageName = String(previous.stage_id || '');

    console.log(`Stage: "${prevStageName}" → "${stageName}"`);

    if (stageName === prevStageName) {
      return send(res, 200, { ignored: true, reason: 'stage unchanged' });
    }

    const mode = STAGE_TRIGGERS[stageName];
    if (!mode) {
      console.log(`No trigger for stage: ${stageName}`);
      return send(res, 200, { ignored: true, reason: `no trigger for stage: ${stageName}` });
    }

    console.log(`\n🔔 Deal #${dealId} moved to stage "${stageName}" → generating ${mode}`);

    setImmediate(async () => {
      try {
        await runBatch({ mode, dealIds: [dealId], concurrency: 1 });
      } catch (err: any) {
        console.error(`❌ Generation failed for deal #${dealId}:`, err.message);
      }
    });

    return send(res, 200, { accepted: true, dealId, mode, stage: stageName });
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
