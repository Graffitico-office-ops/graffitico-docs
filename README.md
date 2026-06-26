# GraffitiCo Document Generation Service

Generates Quote, Invoice, and Statement PDFs from Pipedrive deal data.
Saves to Google Drive (shared team folder) and attaches to the source Deal in Pipedrive.

---

## First-time setup

### 1. Copy the assets folder
Copy the three image assets from the design bundle into `assets/`:
```
assets/
  graffitico-logo.svg
  everclean-badge.png
  graffitico-solid.jpeg
```

### 2. Create your .env file
```bash
cp .env.example .env
```
Fill in:
- `PIPEDRIVE_API_TOKEN` — from graffitico.pipedrive.com → Settings → Personal Preferences → API
- `GOOGLE_DRIVE_FOLDER_ID` — the ID from the URL of your GraffitiCo shared Drive folder
  (open the folder in Drive, copy the long ID from the URL)

### 3. Authorize Google Drive (one time only)
```bash
npm run auth
```
This opens a browser, you log in with your GraffitiCo Google account,
approve Drive access, and the refresh token is saved to your `.env` automatically.

### 4. Install dependencies
```bash
npm install
```

---

## Usage

### Generate invoices for all open deals
```bash
npm run generate -- --mode invoice
```

### Generate quotes for specific deals
```bash
npm run generate -- --mode quote --deals 12345,67890
```

### Dry run (no upload, just check it works)
```bash
npm run generate -- --mode invoice --dry-run
```

### Control concurrency (default 3 parallel)
```bash
npm run generate -- --mode invoice --concurrency 5
```

---

## What it does per document

1. Fetches deal + organization + products from Pipedrive API
2. Normalizes data into a DocumentRecord (field mapping in `src/fields.ts`)
3. Renders HTML via Handlebars template (`src/template.hbs`)
4. Converts to PDF via Puppeteer (US Letter, 816×1056px)
5. Saves locally to `./output/`
6. Uploads to Google Drive: `GraffitiCo / YYYY / Mon YYYY / OrgName / filename.pdf`
7. Attaches PDF to the Pipedrive Deal (visible in Files tab for whole team)

---

## File naming convention
```
INVOICE_262818_City_of_Seattle_FAS_2026-06.pdf
QUOTE_3465_Blanton_Turner_2026-11.pdf
STATEMENT_KC_2025-12_Sound_Transit_2025-12.pdf
```

---

## Field mapping
All Pipedrive → document field mappings are in `src/fields.ts`.
If GraffitiCo adds new custom fields in Pipedrive, update the constants there.

---

## Project structure
```
src/
  auth.ts        — One-time Google OAuth flow
  fields.ts      — All Pipedrive field key constants
  types.ts       — TypeScript types (DocumentRecord, etc.)
  pipedrive.ts   — Pipedrive API client
  normalize.ts   — Pipedrive data → DocumentRecord mapping
  template.hbs   — Handlebars HTML template (pixel-accurate port of design)
  render.ts      — HTML → PDF via Puppeteer
  drive.ts       — Google Drive upload client
  batch.ts       — Bulk generation queue with concurrency control
  index.ts       — CLI entry point
assets/
  graffitico-logo.svg
  everclean-badge.png
output/          — Local PDF backup (gitignored)
.env             — Your credentials (gitignored, never commit this)
.env.example     — Template showing required variables
```
