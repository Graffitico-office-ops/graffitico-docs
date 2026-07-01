
/**
 * fields.ts — Pipedrive field key constants for GraffitiCo
 * Mapped from organizationFields, dealFields, and productFields API responses.
 * Update here if fields change in Pipedrive — nowhere else needs to change.
 */

// ─── Organization fields ─────────────────────────────────────────────────────
export const ORG = {
  NAME:              'name',
  ADDRESS:           'address',                               // service/physical address
  ADDRESS_FORMATTED: 'address_formatted_address',             // formatted version
  BILLING_ADDRESS:   '3e090be3d9d50f9c629c15f27799e006382d06f3',
  BILLING_FORMATTED: '3e090be3d9d50f9c629c15f27799e006382d06f3_formatted_address',
  EVERCLEAN_SUB:     '4ddb6380d1dbac24737d42bf703f64532d45a19d',
  COMPANY_CAM:       'f0ccf514cbefe8de9af68a68d6b2cb6d1409d51d',
  ORG_TYPE:          '5e25c30011502f555ab8a9b6e697d4feec5446c5',
} as const;

// ─── Deal fields ──────────────────────────────────────────────────────────────
export const DEAL = {
  ID:                'id',
  TITLE:             'title',         // used as subject line on documents
  ORG_ID:            'org_id',
  PERSON_ID:         'person_id',
  OWNER:             'user_id',
  VALUE:             'value',
  STATUS:            'status',
  ADD_TIME:          'add_time',
  // ── Billing / tax custom fields ──
  BILLING_FREQUENCY: '6171071f21fecc513ba3a0bf4f7fed1e434d8f57',
  CITY_TAX_PCT:      'f91c299e32911a99993a6be7176e4139b1579d56',
  STATE_TAX_PCT:     '2f90f4deb5877133de52d2da8a84b30eef1ffc88',
  NET_TAX_PCT:       'a5ba7c1b07d1c0f044fb144f667e08b0d62ddd70',
  TAX_CODE:          'b9c8af49a8221cc4d8ab0725bfa45cae31f4e5ef',
  COUNTY:            '83ce917919683aa762241953519997b7aa6b19ee',
  PREV_TAX_PCT:      '90582e909714bf1011dc2bd4ba5ea48376f22b3e',
  TAX_LAST_CHECKED:  'f2f0422535be21c7635552a0d41df16dc5c2fcc4',
  // ── Job / pricing custom fields ──
  PRICE_RECURRING:   'a1e6b227433f23f57d4b719e96c32b91387e5ccb',
  QTY_SERVICES:      'a8b12c5caef16d6e701f41a1c6a3cc126c483ef5',
  MONTHLY_RATE:      '828a9b9d588dadf503e33481315426b288c72b25',
  JOBBER_JOB_NUM:    '632132e105dba7078561bd4d67e2d3482848c8c6',
  JOBBER_JOB_LINK:   '2002cc076191fdfebca3e7593ed95f5ba5a68678',
  COMPANY_CAM:       '7597304b4a179a217a8db7d46847b34f84b1e6d2',
  // ── Job specs ──
  JOB_TYPE:          'cf301ad2016cb550d544fd4e07e496d533c4c2df',
  JOB_SQFT:          '4544e2dcef61e34dc34986c8ccd4444ee5eb39e5',
} as const;

// ─── Product fields (on deal line items) ─────────────────────────────────────
export const PRODUCT = {
  NAME:              'name',
  DESCRIPTION:       'description',
  QUOTE_DESCRIPTION: '2ff3340b5caca311aa1fdc22918281dd66f203d4',  // custom long-form desc for quotes
  BILLING_FREQUENCY: 'billing_frequency',   // one-time | monthly | quarterly | annually
  UNIT_PRICES:       'unit_prices',
  QUANTITY:          'quantity',
  AMOUNT:            'sum',                 // total line amount (unit_price × qty)
  ITEM_PRICE:        'item_price',
} as const;

// ─── Billing frequency option labels ─────────────────────────────────────────
export const BILLING_FREQ_LABELS: Record<string, string> = {
  'one-time':      'One-time',
  'weekly':        'Weekly',
  'monthly':       'Monthly',
  'quarterly':     'Quarterly',
  'semi-annually': 'Every 6 months',
  'annually':      'Annually',
};

// ─── County → tax label map (for document display) ───────────────────────────
export const COUNTY_TAX_LABELS: Record<string, string> = {
  'King':       'King County',
  'Snohomish':  'Snohomish County',
  'Pierce':     'Pierce County',
  'Thurston':   'Thurston County',
  'Kitsap':     'Kitsap County',
  'Lewis':      'Lewis County',
  'Skagit':     'Skagit County',
  'Kittitas':   'Kittitas County',
};
// ─── County → Pipedrive option ID map ────────────────────────────────────────
// These are the numeric IDs Pipedrive uses for the County single-option field.
// Writing the label (e.g. "King") won't work — must use the ID.
export const COUNTY_OPTION_IDS: Record<string, number> = {
  'King':       133,
  'Snohomish':  134,
  'Pierce':     135,
  'Thurston':   136,
  'Kitsap':     137,
  'Lewis':      138,
  'Skagit':     139,
  'Kittitas':   140,
};

