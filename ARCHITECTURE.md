# ARCHITECTURE — Dining Split v2.0.2

**Status:** As-built implementation package, pending real-network OCR/browser deployment acceptance.  
**Last updated:** 2026-10-23  
**Source baseline:** GitHub `safesploitOrg/dining-expense-calculator`, `main` `c580c89bfdc96336317c3eee841caf15a2b45187` (2025-04-06).  
**Classification:** SFW Profile B; T1 core calculator/data/UI, T2 receipt OCR (untrusted parser + third-party executable code). No backend or managed IaC.

## Goals and non-goals

- Goal: calculate and share accurate restaurant splits quickly on mobile, preserving historic data safely.
- Goal: no registration, server storage, photo upload or tracking.
- Goal: static GitHub Pages compatible, offline core app after caching, optional browser-local receipt/menu scanning.
- Non-goal: payment collection, bank integration, automatic settlement, restaurant POS integration, AI cloud OCR or account synchronisation.

## Components

```text
Browser / GitHub Pages (HTTPS)
  public/index.html + assets/css/styles.css        UI, forms, accessible cards
  public/assets/js/app.js                          State controller, DOM rendering/events
  public/assets/js/domain/bill.js                  Bill schema, validation, mutations, totals
  public/assets/js/domain/money.js                 GBP/USD/EUR formatting, 2-decimal minor units, exact splits
  public/assets/js/domain/legacy.js                Non-destructive v1 migration
  public/assets/js/storage.js                      LocalStorage v2 + templates
  public/assets/js/receipt.js                      Currency-aware parser, spatial TSV layout and OCR adapter
  public/assets/js/domain/receipt-review.js         Pure validation of edited OCR candidates
     [on-demand] Tesseract.js 7.0.0 (jsDelivr)     Remote library, local image processing
     [on-demand] OCR worker/core/lang assets       Fetched by OCR library, browser worker
  public/sw.js + manifest + icons                  Versioned app-shell cache / PWA
  browser localStorage                             Bill + templates, never receipt photos
```

### Important trust boundaries

| Boundary | Source | Handling |
|---|---|---|
| Human-entered names/item text | Untrusted DOM input | Length limits, duplicate prevention; render via `textContent`, no HTML insertion |
| Image and OCR text | Untrusted file/parser data | Image 10 MB, 40 MP guard, resize to max 2400 px, text 18,000 chars/200 lines, price correction and user confirmation |
| Remote OCR library/worker/language | Third-party CDN code | Version-pinned JS URL, restricted CSP, on-demand only; real CDN engine not vendored or integration-tested offline |
| Browser localStorage | Mutable/untrusted client state | Schema validation on read/write, v1 migration, preserve old key; block writes on unreadable v2 data |
| PWA service worker | Same-origin installable code | Explicit cache asset allowlist, never caches OCR text, pictures, dynamic responses or third-party URLs |
| CI/deployment | GitHub repository/Actions | PR/main tests; manual dispatch + protected GitHub Pages environment required for T2 release |

## Data shape

```js
{
  schemaVersion: 2,
  id: 'bill-uuid',
  title: 'Friday dinner',
  currency: 'GBP',
  serviceChargeBps: 1250, // 12.5%
  receiptTotalPence: 899, // nullable
  requiresServiceReview: false,
  legacyRatesBps: [],
  participants: [{ id: 'p-uuid', name: 'Alex' }],
  items: [{ id: 'i-uuid', description: 'Burger', pricePence: 1450, quantity: 1, participantIds: ['p-uuid'] }],
  createdAt: '2026-10-23T00:00:00.000Z'
}
```

`localStorage["dining.bill.v2"]` stores one active bill; `localStorage["dining.templates.v2"]` stores up to 20 reusable name/rate/currency lists without purchased items. Older templates without a currency default to GBP. Original `localStorage["expenses"]` remains as an unmodified backup after migration.

## Calculation policy

- `lineTotalPence = pricePence × quantity` (integer).
- Each shared line is divided equally across its selected participants with exact deterministic remainder assignment (selected-participant order).
- `subtotalPence = Σ lineTotalPence`.
- `servicePence = roundHalfUp(subtotalPence × serviceChargeBps / 10,000)` **once for the bill**, not per line.
- Service pennies allocated to diners in proportion to their personal subtotals, using largest remainders, with participant-list order breaking ties.
- `grandTotalPence = subtotalPence + servicePence` and **always equals Σ participant.totalPence**.
- Printed receipt total is a comparison value, not automatically added to or subtracted from the bill.
- Service percentage and optional printed total are processed via `input` events, immediately updating the stored bill and a compact in-settings mobile preview. Invalid intermediate values keep the last valid state without destructive overwrites.

Integer calculations use BigInt internally when multiplying to avoid precision loss. The same 2-decimal minor-unit storage is used for GBP, USD and EUR, formatted by Intl.NumberFormat('en-GB'). The existing v2 schema/key remains unchanged, preserving previous GBP bill data. A currency may be changed only before any saved item or receipt total exists; there is **no FX conversion or silent relabelling**.

## OCR and menu recognition workflow (v2.0.2)

1. User explicitly selects **Itemised receipt** or **Restaurant menu** in Section 04. The manual Section 03 item entry remains available in either mode.
2. User selects a camera image (browser/device dependent) or pastes text. The image is processed into an in-memory JPEG blob without an application-server upload.
3. Tesseract.js 7 loads on demand from a pinned versioned URL and runs in a browser worker. `worker.recognize(image, {}, { text: true, tsv: true })` obtains both text and TSV bounding boxes; v6+ otherwise returns only text by default. The worker always terminates when the attempt finishes.
4. **Spatial path:** TSV word coordinates are validated and bounded, optionally split into two columns only if priced entries exist independently in both; words are regrouped into lines within each column. This prevents horizontal menu columns being incorrectly combined. **Text fallback:** when TSV is missing, invalid or materially incomplete, the parser recognises multiple price pairs per OCR line and handles trailing punctuation/noise. Fallback candidates require the same approval as spatial candidates. Neither route guarantees correct OCR.
5. Monetary tokens accept `£`, `$` and `€`, including comma decimals; mixed currencies are flagged. Entries with an explicit currency incompatible with the bill are blocked until the user selects the matching currency **before adding any money amounts**. Unknown currency symbols are never silently converted. Item prices and user-entered amounts remain integer minor units; no exchange rate conversion exists.
6. **Menu mode** lists possible dishes and prices only. It never derives a payable total/service charge from the printed menu. **Receipt mode** additionally offers separately confirmed printed-total and service-rate suggestions. A printed total in a different currency is not imported.
7. Each potential item is created as an editable **pending suggestion** with name, price, selected diner and a warning when the OCR is noisy/low-confidence. The user chooses **Add to bill**, **Skip/Restore**, or **Use in Add an item** (Section 03). The Section 03 scanner dropdown only populates the manual form; it never creates a bill item by itself. Added review rows are locked to avoid duplicate clicks.
8. Imported items persist in localStorage; OCR image, spatial metadata, pasted text and pending suggestions do **not** persist. A new scan or discarding the current scan clears pending suggestions.

### Limits and remaining uncertainty

- The line parser works with the user's two-column menu sample, but names such as decorative headings or abbreviated dishes can still be wrong and are never guaranteed accurate. Some candidates are deliberately marked **Check OCR**.
- The spatial model is a heuristic two-column split, not general document-layout understanding. Receipts with complicated discounts, quantities, multiple taxes, bundles and multiple currencies require manual verification.
- Real Tesseract.js network/WASM integration against the supplied image is **not proven** by mocked browser tests; OCR CDN availability, actual device CSP, and camera quality require acceptance testing before a T2 public release.

## Browser storage / migration

`loadBill` first tries v2 JSON; if absent it reads v1 `expenses` and converts it. If v1 percentage values differ, migrated bill is flagged as unconfirmed and no computed final amount is shown until owner selects rate and confirms. If parse or validation fails, existing storage remains untouched and UI offers raw JSON export for recovery; the user may explicitly overwrite via New Bill.

## Offline/PWA

`sw.js` caches same-origin app shell paths on installation. Navigation prefers network with app fallback; static assets prefer cache. No image/receipt/OCR CDN assets are pre-cached: **camera OCR is not guaranteed offline**, whereas calculator and existing localStorage work after successful install/cache. Service worker requires HTTPS/localhost. App manifest includes PNG and SVG icons.

## CI and test layers

- `npm run test:unit` Node built-in runner: numeric/rounding, allocation, migration, storage, parser and negative tests.
- `npm run lint`: syntactic checks, duplicate HTML ID/assets checks.
- `npm run security:check`: basic DOM deny patterns, common hard-coded secret patterns, CSP assertions and CI manual gate check. **Not a complete SAST or secret scan.**
- CodeQL JavaScript `security-and-quality` analysis is an additional CI job; high-severity findings require an owner-configured Code Scanning ruleset to become a blocking alert policy.
- Browser user journeys: Python Playwright Chromium, Firefox, WebKit in CI, mobile 390px + desktop 1440px.
- Pages deployment in same workflow depends on quality, browser and CodeQL jobs, and is manual-only by `workflow_dispatch` on `main`, subject to environment protection.

### Residual risks and release work

- Remote OCR library and model asset integrity/availability (not locally vendored; no SRI hash); T2 review/sign-off required.
- Production CSP and real receipt/camera OCR in iOS Safari and Android Chrome require online/manual validation.
- Scanner policy should be expanded to maintained SAST/secret scanning with enforced severity gate if exposure grows.
- Browser data is per origin/device, not synced or automatically backed up.
- No automatic tip/discount/gratuity handling beyond bill-wide service; reconcile non-standard bills manually.

See `SECURITY.md`, `docs/threat-model.md`, `docs/testing.md` and `CHANGELOG.md`.
