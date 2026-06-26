/**
 * normalize.ts — Transforms raw Pipedrive data into a DocumentRecord.
 * This is the field-mapping layer: Pipedrive keys → document model.
 */
import { DocumentRecord, DocumentMode, LineItem, TaxLine, MetaRow } from './types';
import { DEAL, ORG, PRODUCT, BILLING_FREQ_LABELS, COUNTY_TAX_LABELS } from './fields';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(date: string | null | undefined): string {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return fmt(d.toISOString());
}

function formatAddress(org: any, fieldKey: string): string[] {
  const formatted = org[`${fieldKey}_formatted_address`] || org[fieldKey]?.value || '';
  if (!formatted) return [];
  // Split "308 Occidental Ave. S #500, Seattle, WA 98104" into lines
  return formatted.split(',').map((s: string) => s.trim()).filter(Boolean);
}

function getCountyLabel(deal: any): string {
  const countyOption = deal[DEAL.COUNTY];
  if (!countyOption) return '';
  // Pipedrive returns option label via resolved fields; adjust if raw ID returned
  if (typeof countyOption === 'object') return countyOption.label || '';
  return String(countyOption);
}

function getTaxLines(deal: any, subtotal: number): TaxLine[] {
  const cityPct:  number = parseFloat(deal[DEAL.CITY_TAX_PCT])  || 0;
  const statePct: number = parseFloat(deal[DEAL.STATE_TAX_PCT]) || 0;
  const county = getCountyLabel(deal);
  const countyLabel = county ? (COUNTY_TAX_LABELS[county] || county) : 'Local';

  const taxes: TaxLine[] = [];

  if (cityPct > 0) {
    taxes.push({
      label:  countyLabel,
      rate:   `${cityPct.toFixed(2)}%`,
      amount: parseFloat((subtotal * (cityPct / 100)).toFixed(2)),
    });
  }

  if (statePct > 0) {
    taxes.push({
      label:  'Washington State',
      rate:   `${statePct.toFixed(2)}%`,
      amount: parseFloat((subtotal * (statePct / 100)).toFixed(2)),
    });
  }

  return taxes;
}

function getBillingFreqLabel(deal: any): string {
  const raw = deal[DEAL.BILLING_FREQUENCY];
  if (!raw) return '';
  if (typeof raw === 'object') return raw.label || '';
  return BILLING_FREQ_LABELS[raw] || raw;
}

// ─── Quote normalizer ─────────────────────────────────────────────────────────
export function normalizeQuote(deal: any, org: any, products: any[]): DocumentRecord {
  const docNum = `#${deal.id}`;
  const issueDate = fmt(deal[DEAL.ADD_TIME] || deal.add_time);
  const validUntil = deal.add_time ? addDays(deal.add_time, 30) : '';
  const ownerName = deal.user_id?.name || '';
  const ownerFirst = ownerName.split(' ')[0] || ownerName;

  const items: LineItem[] = products.map(p => ({
    name:      p[PRODUCT.NAME] || p.name,
    desc:      p[PRODUCT.QUOTE_DESCRIPTION] || p[PRODUCT.DESCRIPTION] || p.description || '',
    freq:      BILLING_FREQ_LABELS[p[PRODUCT.BILLING_FREQUENCY]] || p[PRODUCT.BILLING_FREQUENCY] || '',
    qty:       p[PRODUCT.QUANTITY] || 1,
    unitPrice: p[PRODUCT.ITEM_PRICE] || 0,
    amount:    p[PRODUCT.AMOUNT] || 0,
  }));

  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const taxes    = getTaxLines(deal, subtotal);
  const total    = taxes.reduce((s, t) => s + t.amount, subtotal);

  const metaRows: MetaRow[] = [
    { label: 'Quote No.',    value: docNum },
    { label: 'Sent',         value: issueDate },
    { label: 'Valid For',    value: '30 days' },
    { label: 'Prepared By',  value: ownerFirst },
  ];

  const billingAddr  = formatAddress(org, ORG.BILLING_ADDRESS);
  const serviceAddr  = formatAddress(org, 'address');

  return {
    mode:           'quote',
    typeWord:       'QUOTE',
    docNumber:      docNum,
    statusPill:     validUntil ? `Valid until ${validUntil}` : 'Valid 30 Days',
    recipientName:  org[ORG.NAME] || '',
    recipientLines: billingAddr.length ? billingAddr : serviceAddr,
    serviceName:    org[ORG.NAME] || '',
    serviceLines:   serviceAddr,
    metaRows,
    totalLabel:     'Quote Total',
    subject:        deal[DEAL.TITLE] || '',
    items,
    statementRows:  [],
    subtotal,
    taxes,
    total,
    footerNote:     'If you have any questions, reply to this email or call the office. Upon completion of the job, you will receive an invoice with a link to completion photos.',
    disclaimer:     'Graffiti vandalism always damages building substrates and removal includes the risk of additional damage. While we take pride in using best-in-class safety methods, GraffitiCo is not liable for damage to structures, electrical systems, security systems or alarms, or any other part of the property during service. It is the responsibility of the property manager to secure all personal and company property, especially any fragile areas or alarm systems.',
    showBadge:      true,
    dealId:         deal.id,
    orgName:        org[ORG.NAME] || '',
    issueDate:      deal.add_time || new Date().toISOString(),
  };
}

// ─── Invoice normalizer ───────────────────────────────────────────────────────
export function normalizeInvoice(deal: any, org: any, products: any[]): DocumentRecord {
  const docNum    = `#${deal.id}`;
  const issueDate = fmt(deal[DEAL.ADD_TIME] || deal.add_time);

  // Payment terms: default Net 15, shown in status pill
  const terms    = getBillingFreqLabel(deal) ? 'Net 15' : 'Net 15';
  const dueDate  = deal.add_time ? addDays(deal.add_time, 15) : '';

  const items: LineItem[] = products.map(p => ({
    name:      p[PRODUCT.NAME] || p.name,
    desc:      p[PRODUCT.DESCRIPTION] || p.description || '',
    freq:      BILLING_FREQ_LABELS[p[PRODUCT.BILLING_FREQUENCY]] || p[PRODUCT.BILLING_FREQUENCY] || '',
    qty:       p[PRODUCT.QUANTITY] || 1,
    unitPrice: p[PRODUCT.ITEM_PRICE] || 0,
    amount:    p[PRODUCT.AMOUNT] || 0,
  }));

  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const taxes    = getTaxLines(deal, subtotal);
  const total    = taxes.reduce((s, t) => s + t.amount, subtotal);

  const metaRows: MetaRow[] = [
    { label: 'Invoice No.',  value: docNum },
    { label: 'Issued',       value: issueDate },
    { label: 'Terms',        value: terms },
    { label: 'Due',          value: dueDate },
  ];

  const billingAddr  = formatAddress(org, ORG.BILLING_ADDRESS);
  const serviceAddr  = formatAddress(org, 'address');

  return {
    mode:           'invoice',
    typeWord:       'INVOICE',
    docNumber:      docNum,
    statusPill:     terms,
    recipientName:  org[ORG.NAME] || '',
    recipientLines: billingAddr.length ? billingAddr : serviceAddr,
    serviceName:    org[ORG.NAME] || '',
    serviceLines:   serviceAddr,
    metaRows,
    totalLabel:     'Amount Due',
    subject:        deal[DEAL.TITLE] || '',
    items,
    statementRows:  [],
    subtotal,
    taxes,
    total,
    paymentLine:    `Payment due by ${dueDate} (${terms}). Pay by check, ACH, or card — a secure payment link is included in your email.`,
    footerNote:     'Thank you for your continued partnership — we want to continue to be your best, most cost-effective graffiti solution!',
    showBadge:      true,
    dealId:         deal.id,
    orgName:        org[ORG.NAME] || '',
    issueDate:      deal.add_time || new Date().toISOString(),
  };
}

// ─── Statement normalizer ─────────────────────────────────────────────────────
// Takes an array of deals for one organization and builds a statement.
export function normalizeStatement(
  deals:   any[],
  org:     any,
  period:  string,   // e.g. "December 2025"
  refNum:  string,   // e.g. "KC_2025-12"
  dueDate: string,   // e.g. "Jan 31, 2026"
): DocumentRecord {
  const billingAddr = formatAddress(org, ORG.BILLING_ADDRESS);
  const serviceAddr = formatAddress(org, 'address');

  const statementRows = deals.map(deal => {
    const subtotal  = parseFloat(deal.value || 0);
    const cityPct   = parseFloat(deal[DEAL.CITY_TAX_PCT])  || 0;
    const statePct  = parseFloat(deal[DEAL.STATE_TAX_PCT]) || 0;
    const netPct    = cityPct + statePct;
    const taxAmount = parseFloat((subtotal * (netPct / 100)).toFixed(2));
    const total     = subtotal + taxAmount;

    return {
      jobNumber: String(deal[DEAL.JOBBER_JOB_NUM] || deal.id),
      assetId:   '',   // populate from custom field if added later
      facility:  deal[DEAL.TITLE] || org[ORG.NAME],
      invoiceNo: `#${deal.id}`,
      subtotal,
      taxRate:   netPct / 100,
      taxAmount,
      total,
    };
  });

  const subtotal  = statementRows.reduce((s, r) => s + r.subtotal, 0);
  const taxTotal  = statementRows.reduce((s, r) => s + r.taxAmount, 0);
  const total     = subtotal + taxTotal;

  const metaRows: MetaRow[] = [
    { label: 'Statement',  value: refNum },
    { label: 'Issued',     value: fmt(new Date().toISOString()) },
    { label: 'Due',        value: dueDate },
    { label: 'Facilities', value: `${deals.length} buildings` },
  ];

  return {
    mode:           'statement',
    typeWord:       'STATEMENT',
    docNumber:      refNum,
    statusPill:     `Due ${dueDate}`,
    recipientName:  org[ORG.NAME] || '',
    recipientLines: billingAddr.length ? billingAddr : serviceAddr,
    serviceName:    `${deals.length} facilities`,
    serviceLines:   [`${period} statement`, `Reference: ${refNum}`],
    metaRows,
    totalLabel:     'Total Due',
    subject:        `Services Rendered · ${period}`,
    items:          [],
    statementRows,
    subtotal,
    taxes:          [{ label: 'Tax Total', rate: '', amount: taxTotal }],
    total,
    footerNote:     `Thank you for your continued partnership as we strive to be your most reliable graffiti resolution service!`,
    showBadge:      true,
    dealId:         deals[0]?.id || 0,
    orgName:        org[ORG.NAME] || '',
    issueDate:      new Date().toISOString(),
  };
}
