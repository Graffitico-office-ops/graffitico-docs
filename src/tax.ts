/**
 * tax.ts — WA DOR tax rate lookup + Pipedrive sync for GraffitiCo
 * Pulls live combined sales tax rate from Washington State DOR's public API
 * and writes it to the deal's tax fields. Tracks rate changes over time.
 */

import fetch from 'node-fetch';
import { XMLParser } from 'fast-xml-parser';
import { getDeal, getOrganization, getAllDeals, updateDeal } from './pipedrive';
import { DEAL, COUNTY_OPTION_IDS } from './fields';

// ─── Simple rate-limit (matches pipedrive.ts pattern) ────────────────────────
let lastDorCall = 0;
async function throttleDor() {
  const now = Date.now();
  const gap = 250 - (now - lastDorCall);
  if (gap > 0) await new Promise(r => setTimeout(r, gap));
  lastDorCall = Date.now();
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaxResult {
  taxCode:   string;
  rate:      number;
  localRate: number;
  stateRate: number;
  cityName:  string;
  county:    string;
}

export type RateChangeDirection = 'increased' | 'decreased' | 'unchanged' | 'new';

export interface RateChangeResult {
  dealId:       number;
  orgName:      string;
  address:      string;
  previous:     number | null;
  current:      number;
  direction:    RateChangeDirection;
  deltaPercent: number;
  taxCode:      string;
  county:       string;
  cityName:     string;
}

// ─── WA DOR API lookup ────────────────────────────────────────────────────────
// ─── Parse a raw Pipedrive address string into street/city/zip ──────────────
// Handles addresses like:
//   "Pacific Medical Centers - Beacon Hill, 1200 12th Avenue South, Seattle, WA, USA"
// Strategy: find the segment containing a 5-digit zip (if present), otherwise
// fall back to the last 3 comma-separated segments as city/state/country,
// and treat the segment just before that as the street — stripping any
// leading "Business Name - " prefix from the street segment.

export function parseAddressString(raw: string): { street: string; city: string; zip: string } {
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);

  // Try to find a 5-digit zip anywhere in the string
  const zipMatch = raw.match(/\b(\d{5})(-\d{4})?\b/);
  const zip = zipMatch ? zipMatch[1] : '';

  // Last part is usually country (USA), second-to-last is "WA" or "WA 98108"
  // Work backwards: [..., street, city, state(+zip), country?]
  let cityIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^[A-Z]{2}(\s+\d{5})?$/.test(parts[i]) || parts[i] === 'USA') {
      continue; // skip state/zip/country segments
    }
    cityIdx = i;
    break;
  }

  const city = cityIdx >= 0 ? parts[cityIdx] : '';
  let street = cityIdx > 0 ? parts[cityIdx - 1] : (parts[0] || '');

  // Strip a leading "Business Name - " prefix from the street if present
  // e.g. "Pacific Medical Centers - Beacon Hill" + next part "1200 12th Avenue South"
  // If street segment doesn't start with a number, it's likely a place name —
  // use the NEXT segment instead (the actual numbered street).
  if (street && !/^\d/.test(street) && cityIdx - 2 >= 0) {
    street = parts[cityIdx - 2];
  }
  // Handle the dash-prefixed place name within a single segment too:
  // "Pacific Medical Centers - Beacon Hill" → not numeric, already handled above.
  // But if street itself contains " - " and a numbered part follows in same segment:
  const dashSplit = street.split(' - ');
  if (dashSplit.length > 1 && /^\d/.test(dashSplit[dashSplit.length - 1])) {
    street = dashSplit[dashSplit.length - 1];
  }

  return { street: street.trim(), city: city.trim(), zip: zip.trim() };
}
export async function lookupTaxRate(
  street: string,
  city: string,
  zip: string,
): Promise<TaxResult> {
  await throttleDor();

  const qs = new URLSearchParams({
    output: 'xml',
    addr: street,
    city: city,
    zip: zip,
  }).toString();

  const url = `https://webgis.dor.wa.gov/webapi/AddressRates.aspx?${qs}`;
  const res = await fetch(url, { timeout: 8000 } as any);
  if (!res.ok) throw new Error(`DOR API HTTP ${res.status}`);
  const xmlText = await res.text();

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const parsed = parser.parse(xmlText);
  const response = parsed?.response;

  if (!response) {
    throw new Error(`DOR API returned unexpected format for: ${street}, ${city} ${zip}`);
  }

  const resultCode = parseInt(String(response.code), 10);

  // Codes 0-5 are usable results (some indicate the address was auto-corrected
  // and should ideally be reviewed). Codes 6, 7, 9 are real failures.
  if (resultCode > 5 || isNaN(resultCode)) {
    const hint = response.debughint ? ` — ${response.debughint}` : '';
    throw new Error(`DOR API could not resolve address (code ${resultCode})${hint} for: ${street}, ${city} ${zip}`);
  }

  const totalRate = parseFloat(response.rate);
  const localRate = parseFloat(response.localrate);
  const stateRate = parseFloat((totalRate - localRate).toFixed(4));

  const addressLine = response.addressline;
  // PTBA = "Public Transportation Benefit Area" — strip that suffix to get a clean county-ish label
  const county = addressLine?.ptba ? addressLine.ptba.replace(' PTBA', '') : '';

  return {
    taxCode:  String(response.loccode),
    rate:     totalRate,
    localRate,
    stateRate,
    cityName: city, // DOR doesn't return a clean city name field — use what was passed in
    county:   county || 'King', // fallback — most GraffitiCo service area is King Co.
  };
}

// ─── Compare old vs new rate ──────────────────────────────────────────────────

function classifyChange(
  previous: number | null,
  current: number,
): { direction: RateChangeDirection; deltaPercent: number } {
  if (previous === null) return { direction: 'new', deltaPercent: 0 };
  const delta = parseFloat(((current - previous) * 100).toFixed(4));
  if (Math.abs(delta) < 0.0001) return { direction: 'unchanged', deltaPercent: 0 };
  return {
    direction:    delta > 0 ? 'increased' : 'decreased',
    deltaPercent: Math.abs(delta),
  };
}

// ─── Apply tax to a single deal ───────────────────────────────────────────────

export async function applyTaxToDeal(
  dealId:  number,
  street:  string,
  city:    string,
  zip:     string,
  orgName: string = '',
): Promise<RateChangeResult> {
  const deal        = await getDeal(dealId);
  const rawPrevious = deal?.[DEAL.NET_TAX_PCT];
  const previous     = rawPrevious ? parseFloat(rawPrevious) / 100 : null;

  const tax = await lookupTaxRate(street, city, zip);
  const { direction, deltaPercent } = classifyChange(previous, tax.rate);
  const pct = (n: number) => (n * 100).toFixed(4);

  await updateDeal(dealId, {
    [DEAL.TAX_CODE]:         tax.taxCode,
    [DEAL.CITY_TAX_PCT]:     pct(tax.localRate),
    [DEAL.STATE_TAX_PCT]:    pct(tax.stateRate),
    [DEAL.PREV_TAX_PCT]:     previous !== null ? pct(previous) : '',
    ...(COUNTY_OPTION_IDS[tax.county]
      ? { [DEAL.COUNTY]: COUNTY_OPTION_IDS[tax.county] }
      : {}),
  });

  const result: RateChangeResult = {
    dealId,
    orgName,
    address:  `${street}, ${city} ${zip}`,
    previous,
    current:  tax.rate,
    direction,
    deltaPercent,
    taxCode:  tax.taxCode,
    county:   tax.county,
    cityName: tax.cityName,
  };

  logRateChange(result);
  return result;
}

// ─── Console output with indicators ──────────────────────────────────────────

const INDICATOR: Record<RateChangeDirection, string> = {
  increased: '🔺 INCREASED',
  decreased: '🔻 DECREASED',
  unchanged: '✅ No change',
  new:       '🆕 First lookup',
};

export function logRateChange(r: RateChangeResult): void {
  const indicator = INDICATOR[r.direction];
  const current   = (r.current * 100).toFixed(4) + '%';
  const previous  = r.previous !== null ? (r.previous * 100).toFixed(4) + '%' : 'none';
  const delta = (r.direction === 'increased' || r.direction === 'decreased')
    ? ` (+/- ${r.deltaPercent.toFixed(4)} pts)`
    : '';

  console.log(
    `  ${indicator}${delta}  |  ${r.orgName || `Deal #${r.dealId}`}  |  ` +
    `${r.cityName} (${r.county} Co.) Code ${r.taxCode}  |  ${previous} → ${current}`,
  );
}

// ─── Batch rate refresh across all open deals ────────────────────────────────

export async function refreshAllTaxRates(options: {
  dryRun?: boolean;
  concurrency?: number;
}): Promise<RateChangeResult[]> {
  const { dryRun = false, concurrency = 3 } = options;

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('GraffitiCo — Tax Rate Refresh');
  console.log(dryRun ? 'DRY RUN — no changes will be written' : 'LIVE RUN');
  console.log('═══════════════════════════════════════════════════════\n');

  const allDeals      = await getAllDeals('open');
  const dealsWithOrg  = allDeals.filter(d => d.org_id);
  console.log(`Found ${dealsWithOrg.length} open deals with organizations.\n`);

  const results: RateChangeResult[] = [];
  let increased = 0, decreased = 0, unchanged = 0, newCount = 0, errors = 0;

  let i = 0;
  async function worker() {
    while (i < dealsWithOrg.length) {
      const deal  = dealsWithOrg[i++];
      const orgId = deal.org_id?.value ?? deal.org_id;
      try {
const org      = await getOrganization(orgId);
const rawAddr  = org?.address;

// Skip deals where the org has no address string at all
if (!rawAddr || typeof rawAddr !== 'string') continue;

const { street, city, zip } = parseAddressString(rawAddr);

// Skip deals where we can't extract a street + zip from the address
if (!street || !zip) {
  console.log(`  ⚠️  Skipping deal #${deal.id} (${deal.org_id?.name ?? 'unknown'}) — incomplete address: "${rawAddr}"`);
  errors++;
  continue;
}

let r: RateChangeResult;
if (dryRun) {
  const tax = await lookupTaxRate(street, city, zip);
  const rawPrev = deal[DEAL.NET_TAX_PCT];
  const prev    = rawPrev ? parseFloat(rawPrev) / 100 : null;
  const { direction, deltaPercent } = classifyChange(prev, tax.rate);
  r = {
    dealId:  deal.id,
    orgName: deal.org_id?.name ?? '',
    address: `${street}, ${city} ${zip}`,
    previous: prev,
    current: tax.rate,
    direction,
    deltaPercent,
    taxCode:  tax.taxCode,
    county:   tax.county,
    cityName: tax.cityName,
  };
  logRateChange(r);
} else {
  r = await applyTaxToDeal(
    deal.id,
    street,
    city,
    zip,
    deal.org_id?.name ?? '',
  );
}
        results.push(r);

        if (r.direction === 'increased') increased++;
        else if (r.direction === 'decreased') decreased++;
        else if (r.direction === 'unchanged') unchanged++;
        else newCount++;

      } catch (err: any) {
        console.error(`  ❌ Deal #${deal.id} failed: ${err.message}`);
        errors++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`🔺 Increased:  ${increased}`);
  console.log(`🔻 Decreased:  ${decreased}`);
  console.log(`✅ Unchanged:  ${unchanged}`);
  console.log(`🆕 New:        ${newCount}`);
  console.log(`❌ Errors:     ${errors}`);
  console.log(`Total:         ${results.length + errors}`);
  if (dryRun) console.log('\n⚠️  Dry run — nothing written to Pipedrive');
  console.log('═══════════════════════════════════════════════════════\n');

  return results;
}

