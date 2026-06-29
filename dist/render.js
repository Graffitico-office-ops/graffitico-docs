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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderToPdf = renderToPdf;
exports.renderToHtml = renderToHtml;
/**
 * render.ts — Renders a DocumentRecord to PDF via Handlebars + Puppeteer.
 * Output: Buffer (PDF bytes) ready to save or upload.
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const handlebars_1 = __importDefault(require("handlebars"));
// ─── Money formatter ──────────────────────────────────────────────────────────
function money(n) {
    const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-$' : '$') + abs;
}
// ─── Build template context from DocumentRecord ───────────────────────────────
function buildContext(doc, logoSrc, badgeSrc) {
    const isInvoice = doc.mode === 'invoice';
    const isQuote = doc.mode === 'quote';
    const isStatement = doc.mode === 'statement';
    const isLineMode = isQuote || isInvoice;
    // Format line items
    const items = doc.items.map((item) => ({
        ...item,
        unitPriceFmt: money(item.unitPrice),
        amountFmt: money(item.amount),
    }));
    // Format tax lines
    const taxes = doc.taxes.map((t) => ({
        ...t,
        amountFmt: money(t.amount),
    }));
    // Format statement rows with zebra striping
    const statementRows = doc.statementRows.map((r, i) => ({
        ...r,
        subtotalFmt: money(r.subtotal),
        taxRateDisplay: r.taxRate ? `${(r.taxRate * 100).toFixed(2)}%` : '—',
        taxAmountFmt: money(r.taxAmount),
        totalFmt: money(r.total),
        rowStyle: i % 2 === 1
            ? 'background:rgba(0,34,68,.035);border-bottom:1px solid rgba(0,34,68,.07);vertical-align:top;'
            : 'background:#fff;border-bottom:1px solid rgba(0,34,68,.07);vertical-align:top;',
    }));
    return {
        // Mode flags
        isInvoice, isQuote, isStatement, isLineMode,
        showPaid: isInvoice && !!doc.markPaid,
        // Header
        typeWord: doc.typeWord,
        docNumber: doc.docNumber,
        statusPill: doc.statusPill,
        // Addresses
        recipientName: doc.recipientName,
        recipientLines: doc.recipientLines,
        serviceName: doc.serviceName,
        serviceLines: doc.serviceLines,
        // Meta card
        metaRows: doc.metaRows,
        totalLabel: doc.totalLabel,
        // Subject
        subject: doc.subject,
        // Tables
        items,
        statementRows,
        // Totals
        subtotalFmt: money(doc.subtotal),
        taxes,
        totalFmt: money(doc.total),
        // Invoice payment
        paymentLine: doc.paymentLine || '',
        // Footer
        footerNote: doc.footerNote,
        disclaimer: doc.disclaimer || '',
        // Watermark
        showBadge: doc.showBadge,
        // Asset paths (base64-inlined for PDF)
        logoSrc,
        badgeSrc,
    };
}
// ─── Inline images as base64 data URIs ───────────────────────────────────────
function imageToDataUri(filePath, mime) {
    if (!fs.existsSync(filePath))
        return '';
    const data = fs.readFileSync(filePath).toString('base64');
    return `data:${mime};base64,${data}`;
}
// ─── Compile template (cached) ────────────────────────────────────────────────
let _compiled = null;
function getTemplate() {
    if (!_compiled) {
        const src = fs.readFileSync(path.join(__dirname, 'template.hbs'), 'utf8');
        _compiled = handlebars_1.default.compile(src);
    }
    return _compiled;
}
// ─── Main render function ─────────────────────────────────────────────────────
async function renderToPdf(doc, assetsDir) {
    // Inline images so PDF renderer doesn't need file system access
    const logoSrc = imageToDataUri(path.join(assetsDir, 'graffitico-logo.svg'), 'image/svg+xml');
    const badgeSrc = imageToDataUri(path.join(assetsDir, 'everclean-badge.png'), 'image/png');
    const context = buildContext(doc, logoSrc, badgeSrc);
    const html = getTemplate()(context);
    // Launch Puppeteer
    const puppeteer = await Promise.resolve().then(() => __importStar(require('puppeteer')));
    const browser = await puppeteer.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    try {
        const page = await browser.newPage();
        // Set content and wait for fonts/images
        await page.setContent(html, { waitUntil: 'networkidle0' });
        // US Letter, zero margins (document's own padding acts as margin)
        const pdf = await page.pdf({
            format: 'Letter',
            printBackground: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
        });
        return Buffer.from(pdf);
    }
    finally {
        await browser.close();
    }
}
// ─── Also export HTML render (for preview/debug) ─────────────────────────────
function renderToHtml(doc, assetsDir) {
    const logoSrc = imageToDataUri(path.join(assetsDir, 'graffitico-logo.svg'), 'image/svg+xml');
    const badgeSrc = imageToDataUri(path.join(assetsDir, 'everclean-badge.png'), 'image/png');
    const context = buildContext(doc, logoSrc, badgeSrc);
    return getTemplate()(context);
}
