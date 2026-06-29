"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeQuote = normalizeQuote;
exports.normalizeInvoice = normalizeInvoice;
exports.normalizeStatement = normalizeStatement;
const fields_1 = require("./fields");
// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(date) {
    if (!date)
        return '';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function addDays(dateStr, days) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return fmt(d.toISOString());
}
function formatAddress(org, fieldKey) {
    const formatted = org[`${fieldKey}_formatted_address`] || org[fieldKey]?.value || '';
    if (!formatted)
        return [];
    // Split "308 Occidental Ave. S #500, Seattle, WA 98104" into lines
    return formatted.split(',').map((s) => s.trim()).filter(Boolean);
}
function getCountyLabel(deal) {
    const countyOption = deal[fields_1.DEAL.COUNTY];
    if (!countyOption)
        return '';
    // Pipedrive returns option label via resolved fields; adjust if raw ID returned
    if (typeof countyOption === 'object')
        return countyOption.label || '';
    return String(countyOption);
}
function getTaxLines(deal, subtotal) {
    const cityPct = parseFloat(deal[fields_1.DEAL.CITY_TAX_PCT]) || 0;
    const statePct = parseFloat(deal[fields_1.DEAL.STATE_TAX_PCT]) || 0;
    const county = getCountyLabel(deal);
    const countyLabel = county ? (fields_1.COUNTY_TAX_LABELS[county] || county) : 'Local';
    const taxes = [];
    if (cityPct > 0) {
        taxes.push({
            label: countyLabel,
            rate: `${cityPct.toFixed(2)}%`,
            amount: parseFloat((subtotal * (cityPct / 100)).toFixed(2)),
        });
    }
    if (statePct > 0) {
        taxes.push({
            label: 'Washington State',
            rate: `${statePct.toFixed(2)}%`,
            amount: parseFloat((subtotal * (statePct / 100)).toFixed(2)),
        });
    }
    return taxes;
}
function getBillingFreqLabel(deal) {
    const raw = deal[fields_1.DEAL.BILLING_FREQUENCY];
    if (!raw)
        return '';
    if (typeof raw === 'object')
        return raw.label || '';
    return fields_1.BILLING_FREQ_LABELS[raw] || raw;
}
// ─── Quote normalizer ─────────────────────────────────────────────────────────
function normalizeQuote(deal, org, products) {
    const docNum = `#${deal.id}`;
    const issueDate = fmt(deal[fields_1.DEAL.ADD_TIME] || deal.add_time);
    const validUntil = deal.add_time ? addDays(deal.add_time, 30) : '';
    const ownerName = deal.user_id?.name || '';
    const ownerFirst = ownerName.split(' ')[0] || ownerName;
    const items = products.map(p => ({
        name: p[fields_1.PRODUCT.NAME] || p.name,
        desc: p[fields_1.PRODUCT.QUOTE_DESCRIPTION] || p[fields_1.PRODUCT.DESCRIPTION] || p.description || '',
        freq: fields_1.BILLING_FREQ_LABELS[p[fields_1.PRODUCT.BILLING_FREQUENCY]] || p[fields_1.PRODUCT.BILLING_FREQUENCY] || '',
        qty: p[fields_1.PRODUCT.QUANTITY] || 1,
        unitPrice: p[fields_1.PRODUCT.ITEM_PRICE] || 0,
        amount: p[fields_1.PRODUCT.AMOUNT] || 0,
    }));
    const subtotal = items.reduce((s, i) => s + i.amount, 0);
    const taxes = getTaxLines(deal, subtotal);
    const total = taxes.reduce((s, t) => s + t.amount, subtotal);
    const metaRows = [
        { label: 'Quote No.', value: docNum },
        { label: 'Sent', value: issueDate },
        { label: 'Valid For', value: '30 days' },
        { label: 'Prepared By', value: ownerFirst },
    ];
    const billingAddr = formatAddress(org, fields_1.ORG.BILLING_ADDRESS);
    const serviceAddr = formatAddress(org, 'address');
    return {
        mode: 'quote',
        typeWord: 'QUOTE',
        docNumber: docNum,
        statusPill: validUntil ? `Valid until ${validUntil}` : 'Valid 30 Days',
        recipientName: org[fields_1.ORG.NAME] || '',
        recipientLines: billingAddr.length ? billingAddr : serviceAddr,
        serviceName: org[fields_1.ORG.NAME] || '',
        serviceLines: serviceAddr,
        metaRows,
        totalLabel: 'Quote Total',
        subject: deal[fields_1.DEAL.TITLE] || '',
        items,
        statementRows: [],
        subtotal,
        taxes,
        total,
        footerNote: 'If you have any questions, reply to this email or call the office. Upon completion of the job, you will receive an invoice with a link to completion photos.',
        disclaimer: 'Graffiti vandalism always damages building substrates and removal includes the risk of additional damage. While we take pride in using best-in-class safety methods, GraffitiCo is not liable for damage to structures, electrical systems, security systems or alarms, or any other part of the property during service. It is the responsibility of the property manager to secure all personal and company property, especially any fragile areas or alarm systems.',
        showBadge: true,
        dealId: deal.id,
        orgName: org[fields_1.ORG.NAME] || '',
        issueDate: deal.add_time || new Date().toISOString(),
    };
}
// ─── Invoice normalizer ───────────────────────────────────────────────────────
function normalizeInvoice(deal, org, products) {
    const docNum = `#${deal.id}`;
    const issueDate = fmt(deal[fields_1.DEAL.ADD_TIME] || deal.add_time);
    // Payment terms: default Net 15, shown in status pill
    const terms = getBillingFreqLabel(deal) ? 'Net 15' : 'Net 15';
    const dueDate = deal.add_time ? addDays(deal.add_time, 15) : '';
    const items = products.map(p => ({
        name: p[fields_1.PRODUCT.NAME] || p.name,
        desc: p[fields_1.PRODUCT.DESCRIPTION] || p.description || '',
        freq: fields_1.BILLING_FREQ_LABELS[p[fields_1.PRODUCT.BILLING_FREQUENCY]] || p[fields_1.PRODUCT.BILLING_FREQUENCY] || '',
        qty: p[fields_1.PRODUCT.QUANTITY] || 1,
        unitPrice: p[fields_1.PRODUCT.ITEM_PRICE] || 0,
        amount: p[fields_1.PRODUCT.AMOUNT] || 0,
    }));
    const subtotal = items.reduce((s, i) => s + i.amount, 0);
    const taxes = getTaxLines(deal, subtotal);
    const total = taxes.reduce((s, t) => s + t.amount, subtotal);
    const metaRows = [
        { label: 'Invoice No.', value: docNum },
        { label: 'Issued', value: issueDate },
        { label: 'Terms', value: terms },
        { label: 'Due', value: dueDate },
    ];
    const billingAddr = formatAddress(org, fields_1.ORG.BILLING_ADDRESS);
    const serviceAddr = formatAddress(org, 'address');
    return {
        mode: 'invoice',
        typeWord: 'INVOICE',
        docNumber: docNum,
        statusPill: terms,
        recipientName: org[fields_1.ORG.NAME] || '',
        recipientLines: billingAddr.length ? billingAddr : serviceAddr,
        serviceName: org[fields_1.ORG.NAME] || '',
        serviceLines: serviceAddr,
        metaRows,
        totalLabel: 'Amount Due',
        subject: deal[fields_1.DEAL.TITLE] || '',
        items,
        statementRows: [],
        subtotal,
        taxes,
        total,
        paymentLine: `Payment due by ${dueDate} (${terms}). Pay by check, ACH, or card — a secure payment link is included in your email.`,
        footerNote: 'Thank you for your continued partnership — we want to continue to be your best, most cost-effective graffiti solution!',
        showBadge: true,
        dealId: deal.id,
        orgName: org[fields_1.ORG.NAME] || '',
        issueDate: deal.add_time || new Date().toISOString(),
    };
}
// ─── Statement normalizer ─────────────────────────────────────────────────────
// Takes an array of deals for one organization and builds a statement.
function normalizeStatement(deals, org, period, // e.g. "December 2025"
refNum, // e.g. "KC_2025-12"
dueDate) {
    const billingAddr = formatAddress(org, fields_1.ORG.BILLING_ADDRESS);
    const serviceAddr = formatAddress(org, 'address');
    const statementRows = deals.map(deal => {
        const subtotal = parseFloat(deal.value || 0);
        const cityPct = parseFloat(deal[fields_1.DEAL.CITY_TAX_PCT]) || 0;
        const statePct = parseFloat(deal[fields_1.DEAL.STATE_TAX_PCT]) || 0;
        const netPct = cityPct + statePct;
        const taxAmount = parseFloat((subtotal * (netPct / 100)).toFixed(2));
        const total = subtotal + taxAmount;
        return {
            jobNumber: String(deal[fields_1.DEAL.JOBBER_JOB_NUM] || deal.id),
            assetId: '', // populate from custom field if added later
            facility: deal[fields_1.DEAL.TITLE] || org[fields_1.ORG.NAME],
            invoiceNo: `#${deal.id}`,
            subtotal,
            taxRate: netPct / 100,
            taxAmount,
            total,
        };
    });
    const subtotal = statementRows.reduce((s, r) => s + r.subtotal, 0);
    const taxTotal = statementRows.reduce((s, r) => s + r.taxAmount, 0);
    const total = subtotal + taxTotal;
    const metaRows = [
        { label: 'Statement', value: refNum },
        { label: 'Issued', value: fmt(new Date().toISOString()) },
        { label: 'Due', value: dueDate },
        { label: 'Facilities', value: `${deals.length} buildings` },
    ];
    return {
        mode: 'statement',
        typeWord: 'STATEMENT',
        docNumber: refNum,
        statusPill: `Due ${dueDate}`,
        recipientName: org[fields_1.ORG.NAME] || '',
        recipientLines: billingAddr.length ? billingAddr : serviceAddr,
        serviceName: `${deals.length} facilities`,
        serviceLines: [`${period} statement`, `Reference: ${refNum}`],
        metaRows,
        totalLabel: 'Total Due',
        subject: `Services Rendered · ${period}`,
        items: [],
        statementRows,
        subtotal,
        taxes: [{ label: 'Tax Total', rate: '', amount: taxTotal }],
        total,
        footerNote: `Thank you for your continued partnership as we strive to be your most reliable graffiti resolution service!`,
        showBadge: true,
        dealId: deals[0]?.id || 0,
        orgName: org[fields_1.ORG.NAME] || '',
        issueDate: new Date().toISOString(),
    };
}
