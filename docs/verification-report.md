# SFW v1.1 completion and verification — Dining Split v2.0.2

**Date:** 2026-10-23 (Europe/London)  
**Basis:** v2.0.1 user-approved ZIP package; original public upstream was `safesploitOrg/dining-expense-calculator` `main` at `c580c89bfdc96336317c3eee841caf15a2b45187` (2025-04-06).  
**Status:** Local implementation ZIP only. No authorised push, PR, merge, tag or public deployment.  
**SFW:** Profile **B** browser-only; core UI/currency change **T1** and untrusted OCR/image/third-party worker **T2**. Human owner release sign-off remains pending.

## Outcome and objective

A user-supplied two-column restaurant menu (dollar-denominated) generated readable OCR text but **0 recognised line items** in v2.0.1. The primary cause was a restrictive GBP-only price expression and line-ending assumption; the existing parser also risked pairing items from different columns. The v2.0.2 implementation adds:

- `$`, `£` and `€` decimal recognition, including text with noise after prices and multiple item–price pairs in one line.
- **Spatial OCR:** request Tesseract TSV word boxes; validate bounds; cautiously distinguish two-column menus from one-column receipts; regroup rows by position. If word positions are unavailable or mostly incomplete, fall back to the tolerant text parser and warn users.
- **Mode choice:** Menu suggestions (available dishes only, no printed amount assumptions) or itemised receipt (purchased items and optional total/service suggestions).
- GBP/USD/EUR bill-level currency selector with no conversion. Changing currency after a stored amount is blocked, and a scanned item's mismatched currency must not be imported or silently relabelled. A receipt total in a different currency is also blocked.
- OCR candidate uncertainty labels, manual name/price corrections, individual explicit Add, Skip/Restore, or Section 03 prefill. No automatic import; no backend or payment capability.
- Existing `dining.bill.v2` key and schema retained; old bills remain GBP and load unchanged. New templates include currency; older templates default to GBP.

### Source-backed regression fixture

`tests/fixtures/menu-ocr-noisy.txt` is derived from the OCR text provided in the conversation for the example two-column menu; the image itself is **not redistributed** in the ZIP. With `mode: 'menu'`, deterministic parsing produces **20 candidate lines**, including Grilled Salmon $18.99, Chicken Parmesan $16.99, Ribeye Steak $24.99 and Coffee $2.49. Some names are visibly noisy (e.g. a dish name preceded by stray characters) and require human correction. The 20/20 assertion applies to **supplied OCR text**, not a real photo-to-model benchmark.

## Files changed relative to v2.0.1

- `public/assets/js/receipt.js` — bounded currency/noisy-text parser; optional TSV spatial layout; conservative fallback; new OCR output request.
- `public/assets/js/app.js` — modes, result review, currency guard for scan and total, live bill currency UI, persisted app behaviour.
- `public/assets/js/domain/money.js` — minor-unit parsing and GBP/USD/EUR currency formatting helpers.
- `public/assets/js/domain/bill.js` — validate GBP/USD/EUR within existing bill schema.
- `public/assets/js/storage.js` — optional template currency with backward compatibility.
- `public/index.html`, `public/assets/css/styles.css` — mode choice, currency selection, per-row cues and responsive controls.
- `public/sw.js`, `package.json`, `package-lock.json` — version and offline app-shell cache update.
- `tests/fixtures/menu-ocr-noisy.txt` — reproduced OCR text without distributing the user's photo.
- `tests/unit/receipt-v202.test.js`, `tests/unit/currency-v202.test.js`, `tests/browser/test_workflows.py` — regression/negative tests including mocked TSV camera workflow and currency safeguards.
- `README.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `SECURITY.md`, `docs/threat-model.md`, `docs/testing.md`, this report and `docs/evidence/` — updated as-built documentation and verification logs.
- `AGENTS.md`, `docs/engineering/SFW_AI_ENGINEERING_STANDARD.md`, `.github/workflows/ci.yml` — retained and followed from v2.0.1.

## Verification

| Check | Status | Evidence and limits |
| --- | --- | --- |
| `npm ci --offline --ignore-scripts --no-audit --no-fund` | **PASS** | `docs/evidence/npm-install.txt`; no npm dependencies; **not** a live advisory audit |
| `npm run check` / Node unit tests | **PASS 38/38** | `docs/evidence/npm-check.txt`; 25 inherited + 13 new tests |
| JS syntax, HTML IDs and file checks | **PASS** | `npm run lint` within check. Not a full HTML/a11y validator |
| Local targeted security patterns / CI structure | **PASS (limited)** | `npm run security:check`; not a replacement for real SAST/secret scanner |
| Chromium embedded DOM integration | **PASS 15/15** | `docs/evidence/browser-dom-check.txt`; mocked browser file OCR and spatial TSV; DOM mode **removes CSP** and cannot verify navigation/network. |
| Mobile/desktop visual layout | **INSPECTED** | `docs/evidence/v202-*.png`; 390px and 1440px layouts checked; horizontal overflow 0px in those states |
| Workflow YAML syntax | **PASS** | `.github/workflows/ci.yml` parsed via PyYAML BaseLoader; no CI job execution in GitHub was observed |
| Real Chromium/Firefox/WebKit HTTP/CSP E2E | **NOT RUN** | Container Chromium denies localhost page navigation; CI must run all three with real HTTP origin |
| Real Tesseract v7 WASM worker/language on the provided photo | **NOT RUN** | OCR text fixture and mocked worker/TSV path only; no claim of actual image transcription accuracy |
| Online npm audit / GitHub CodeQL, enforceable security ruleset | **NOT RUN** | CI workflow present, external services/branch rulesets not executed/verified |
| Real Android/iOS camera, install/offline SW, WCAG manual checks | **NOT RUN** | Device/network release acceptance outstanding |
| Human T2 release approval | **PENDING** | No owner sign-off supplied; cannot publish this change as release-ready |

## Baseline, security and rollback

- **Baseline:** v2.0.1 verification reported **25/25 unit and 11/11 embedded Chromium interaction tests** passing. v2.0.2 introduces 13 new unit tests and four browser workflows. New tests expose the previous currency/column defect and confirm representative repairs; no documented previously passing test was intentionally removed.
- **Trust:** Image / OCR text / position data are untrusted and bounded; results are rendered as text and treated as suggestions. No receipt photo or OCR TSV is persisted to browser storage. Client-side image compression and remote OCR execution remain a T2 resource/supply-chain boundary.
- **Currency:** User-entered and approved amounts use two-decimal minor units for GBP/USD/EUR with **no FX conversion**. Source currency may be unreadable; when so, users must check against the printed source. Mixed-currency scans cannot silently commit unlabelled amounts.
- **Deployment gate:** GitHub Pages deploy remains `workflow_dispatch` on `main` with `needs: [quality, browser, static_analysis]`. The owner must remove the old upstream `.github/workflows/static.yml` workflow when integrating. GitHub branch protection, CodeQL severity gates and environment reviewer settings are **external** and not enforced simply by a ZIP.
- **Rollback:** Revert the static app to previous tested version and clear/update the service-worker app shell cache. The bill persistence schema/key is unchanged; old GBP bills continue to load. New USD/EUR bills cannot safely be used in v2.0.1 because its validator only supported GBP — **export/back up such bills and do not downgrade without a separate rollback/data plan**.

## Remaining release actions

1. Integrate on a review branch, inspect the diff, remove obsolete deploy workflow, configure repository protections and run online CI, audit, CodeQL and real browser navigation.
2. Test the *actual* supplied menu photo and representative receipts with real Tesseract assets on Chrome/Safari/Firefox plus mobile devices. Explicitly measure partial/mispaired detections and verify CSP/privacy.
3. Inspect accessibility, offline cache, version upgrades and sign off the T2 OCR security review before public release.
