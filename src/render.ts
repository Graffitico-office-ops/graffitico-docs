/**
 * render.ts — Renders a DocumentRecord to PDF via Handlebars + Puppeteer.
 * Output: Buffer (PDF bytes) ready to save or upload.
 */
import * as fs   from 'fs';
import * as path from 'path';
import Handlebars from 'handlebars';
import { DocumentRecord, StatementRow, TaxLine, LineItem } from './types';

// ─── Money formatter ──────────────────────────────────────────────────────────
function money(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-$' : '$') + abs;
}

// ─── Build template context from DocumentRecord ───────────────────────────────
function buildContext(doc: DocumentRecord, logoSrc: string, badgeSrc: string) {
  const isInvoice   = doc.mode === 'invoice';
  const isQuote     = doc.mode === 'quote';
  const isStatement = doc.mode === 'statement';
  const isLineMode  = isQuote || isInvoice;

  // Format line items
  const items = doc.items.map((item: LineItem) => ({
    ...item,
    unitPriceFmt: money(item.unitPrice),
    amountFmt:    money(item.amount),
  }));

  // Format tax lines
  const taxes = doc.taxes.map((t: TaxLine) => ({
    ...t,
    amountFmt: money(t.amount),
  }));

  // Format statement rows with zebra striping
  const statementRows = doc.statementRows.map((r: StatementRow, i: number) => ({
    ...r,
    subtotalFmt:    money(r.subtotal),
    taxRateDisplay: r.taxRate ? `${(r.taxRate * 100).toFixed(2)}%` : '—',
    taxAmountFmt:   money(r.taxAmount),
    totalFmt:       money(r.total),
    rowStyle: i % 2 === 1
      ? 'background:rgba(0,34,68,.035);border-bottom:1px solid rgba(0,34,68,.07);vertical-align:top;'
      : 'background:#fff;border-bottom:1px solid rgba(0,34,68,.07);vertical-align:top;',
  }));

  return {
    // Mode flags
    isInvoice, isQuote, isStatement, isLineMode,
    showPaid: isInvoice && !!doc.markPaid,

    // Header
    typeWord:   doc.typeWord,
    docNumber:  doc.docNumber,
    statusPill: doc.statusPill,

    // Addresses
    recipientName:  doc.recipientName,
    recipientLines: doc.recipientLines,
    serviceName:    doc.serviceName,
    serviceLines:   doc.serviceLines,

    // Meta card
    metaRows:   doc.metaRows,
    totalLabel: doc.totalLabel,

    // Subject
    subject: doc.subject,

    // Tables
    items,
    statementRows,

    // Totals
    subtotalFmt: money(doc.subtotal),
    taxes,
    totalFmt:    money(doc.total),

    // Invoice payment
    paymentLine: doc.paymentLine || '',

    // Footer
    footerNote:  doc.footerNote,
    disclaimer:  doc.disclaimer || '',

    // Watermark
    showBadge: doc.showBadge,

    // Asset paths (base64-inlined for PDF)
    logoSrc,
    badgeSrc,
  };
}

// ─── Inline images as base64 data URIs ───────────────────────────────────────
function imageToDataUri(filePath: string, mime: string): string {
  if (!fs.existsSync(filePath)) return '';
  const data = fs.readFileSync(filePath).toString('base64');
  return `data:${mime};base64,${data}`;
}

// ─── Compile template (cached) ────────────────────────────────────────────────
let _compiled: HandlebarsTemplateDelegate | null = null;

function getTemplate(): HandlebarsTemplateDelegate {
  if (!_compiled) {
    const src = fs.readFileSync(path.join(__dirname, 'template.hbs'), 'utf8');
    _compiled = Handlebars.compile(src);
  }
  return _compiled!;
}

// ─── Main render function ─────────────────────────────────────────────────────
export async function renderToPdf(doc: DocumentRecord, assetsDir: string): Promise<Buffer> {
  // Inline images so PDF renderer doesn't need file system access
  const logoSrc  = imageToDataUri(path.join(assetsDir, 'graffitico-logo.svg'),  'image/svg+xml');
  const badgeSrc = imageToDataUri(path.join(assetsDir, 'everclean-badge.png'),  'image/png');

  const context  = buildContext(doc, logoSrc, badgeSrc);
  const html     = getTemplate()(context);

  // Launch Puppeteer
  const puppeteer = await import('puppeteer');
  const browser   = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();

    // Set content and wait for fonts/images
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // US Letter, zero margins (document's own padding acts as margin)
    const pdf = await page.pdf({
      format:          'Letter',
      printBackground: true,
      margin:          { top: '0', right: '0', bottom: '0', left: '0' },
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

// ─── Also export HTML render (for preview/debug) ─────────────────────────────
export function renderToHtml(doc: DocumentRecord, assetsDir: string): string {
  const logoSrc  = imageToDataUri(path.join(assetsDir, 'graffitico-logo.svg'),  'image/svg+xml');
  const badgeSrc = imageToDataUri(path.join(assetsDir, 'everclean-badge.png'),  'image/png');
  const context  = buildContext(doc, logoSrc, badgeSrc);
  return getTemplate()(context);
}
