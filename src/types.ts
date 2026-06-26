/**
 * types.ts — Shared TypeScript types for GraffitiCo document generation.
 * The DocumentRecord is the normalized data model that feeds the template.
 * Every Pipedrive → document mapping goes through this shape.
 */

export type DocumentMode = 'quote' | 'invoice' | 'statement';

// ─── Line item (Quote & Invoice) ─────────────────────────────────────────────
export interface LineItem {
  name:      string;
  desc:      string;   // long description shown in document
  freq:      string;   // billing frequency label (e.g. "Monthly")
  qty:       number;
  unitPrice: number;
  amount:    number;
}

// ─── Statement row (one per facility) ────────────────────────────────────────
export interface StatementRow {
  jobNumber: string;
  assetId:   string;
  facility:  string;
  invoiceNo: string;
  subtotal:  number;
  taxRate:   number;   // combined rate as decimal, e.g. 0.105 = 10.5%
  taxAmount: number;
  total:     number;
}

// ─── Tax line ────────────────────────────────────────────────────────────────
export interface TaxLine {
  label:  string;   // e.g. "Seattle City"
  rate:   string;   // display string e.g. "4.05%"
  amount: number;
}

// ─── Meta card rows (right side of header) ───────────────────────────────────
export interface MetaRow {
  label: string;
  value: string;
}

// ─── The normalized document record ──────────────────────────────────────────
export interface DocumentRecord {
  mode: DocumentMode;

  // Header
  typeWord:    string;   // "QUOTE" | "INVOICE" | "STATEMENT"
  docNumber:   string;   // e.g. "#3465" or "KC_2025-12"
  statusPill:  string;   // e.g. "Valid 30 Days" | "Net 15" | "Due Jan 31"

  // Bill To
  recipientName:  string;
  recipientLines: string[];   // address lines

  // Service Address
  serviceName:  string;
  serviceLines: string[];

  // Meta card
  metaRows:   MetaRow[];
  totalLabel: string;   // "Quote Total" | "Amount Due" | "Total Due"

  // Subject band
  subject: string;

  // Line items (quote & invoice)
  items: LineItem[];

  // Statement rows
  statementRows: StatementRow[];

  // Totals
  subtotal:  number;
  taxes:     TaxLine[];
  total:     number;

  // Invoice-only
  paymentLine?: string;
  markPaid?:    boolean;

  // Footer
  footerNote:  string;
  disclaimer?: string;   // quote only

  // Watermark
  showBadge: boolean;

  // Source deal ID (for Pipedrive file attachment)
  dealId: number;

  // Metadata for Drive filing
  orgName:   string;
  issueDate: string;   // ISO date string
}

// ─── Raw Pipedrive deal product (from GET /deals/:id/products) ───────────────
export interface PipedriveDealProduct {
  id:              number;
  deal_id:         number;
  product_id:      number;
  name:            string;
  item_price:      number;
  quantity:        number;
  discount:        number;
  sum:             number;
  currency:        string;
  enabled_flag:    boolean;
  billing_frequency?: string;
  billing_frequency_cycles?: number;
  comments?:       string;
  description?:    string;
  [key: string]:   any;   // custom fields keyed by hash
}

// ─── Batch job options ────────────────────────────────────────────────────────
export interface BatchOptions {
  dealIds?:    number[];     // specific deals; omit to run all open deals
  mode:        DocumentMode;
  dryRun?:     boolean;      // generate but don't upload
  concurrency?: number;      // parallel renders (default 3)
}
