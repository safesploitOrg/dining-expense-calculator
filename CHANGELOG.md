# Changelog — Dining Expense Calculator / Dining Split

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and semantic versioning. Entries through 2025 are grounded in **actual GitHub releases and commit messages**, not reconstructed or invented tags. Dates use the source timestamps (UTC calendar dates); later commits without a published release are explicitly labelled as untagged.

## [2.0.2] — 2026-10-23 (local patch package; **not published or tagged**)

### Fixed
- **Zero detections on dollar-priced menus:** currency recognition now accepts `£`, `$` and `€` (including comma decimals) and recognises money even when OCR adds trailing punctuation. The user's example noisy two-column menu text now yields **20 editable candidates instead of 0** in a deterministic regression fixture; this is a parser assertion, not proof that real OCR perfectly transcribes the photo.
- **Merged columns:** request Tesseract TSV bounding boxes and perform bounded spatial word/line regrouping with heuristic two-column separation. If TSV is unavailable or unusually incomplete, use tolerant multi-pair plain-text parsing and display an explicit fallback warning.
- Multiple **name–price** pairs can now be separated from a single recognised line; obvious headings, service, tax and total lines remain excluded from items.

### Added
- A deliberate **Receipt / Menu** mode selector in Section 04. Menu mode provides available-item suggestions but **does not infer purchases, printed receipt totals or service rates**.
- Bill settings currency selector (GBP/USD/EUR) with strict safeguards: no FX conversion, no currency relabelling after any item or receipt total is saved, currency-mismatch errors on scanned items and printed totals, mixed-currency/unknown-currency warnings.
- Per-candidate **Check OCR** tags for noisy/low-confidence text, and currency labels alongside recognised items; no automatic approval, addition or payment amount changes.
- Unit regression tests using the user's exact noisy text sample (lightly normalised fixture), synthetic word-coordinate two-column TSV, one-column receipts, malformed/huge TSV, mixed currency, conservative fallback and legacy-template compatibility. Additional Chromium interaction tests for scan modes, dollar-priced menu review, currency mismatch and mocked TSV request.

### Compatibility and security
- Existing `dining.bill.v2` storage schema/key is retained. Old GBP bills and templates load as before; templates now remember currency for new saves (older templates default to GBP). Core calculator and manual entry remain browser-only.
- OCR untrusted parsing and remotely loaded worker remain **SFW T2** risks. Unit/mocked browser testing cannot replace actual Tesseract/photo/mobile/CSP verification or human owner approval before release.

## [2.0.1] — 2026-10-23 (local patch package; **not published or tagged**)

### Fixed
- **Service charge and receipt-total inputs recalculate on every valid `input` event**, including touchscreen keyboards, without requiring Enter or focus loss. Invalid/unfinished inputs retain the last valid amount; fields normalise on blur.
- Show a live total and service breakdown alongside Bill settings so updates are visible immediately on a mobile screen.
- No bulk OCR import by default: each recognised receipt line is **individually reviewed, corrected, assigned, explicitly added or skipped**. Already-added rows are locked to avoid accidental duplicate insertion.

### Added
- Dedicated **recognised-item dropdown in Section 03**; selecting a line prefills the name and price but does not add an expense until the user confirms the normal form.
- In Section 04, each scanned line offers **Add to bill**, **Use in Add an item** and **Skip/Restore**. Edited OCR names appear as browser-local manual autocomplete suggestions.
- Candidate progress counter, editable line fields, no-op on OCR-only detection, and preservation of unrelated manual entries.
- Unit and Chromium interaction regression tests for corrected/invalid OCR values, selective add/skip, manual input independence, duplicate prevention, immediate service-rate editing and persistence.
- Service worker cache version bumped and new receipt-review module included for offline core module imports.

### Security / compatibility
- OCR images and text stay uncommitted to bill storage until an explicit Add action. Per-line malformed prices and absent diners are rejected. No new npm production dependencies or network origins.
- v2 schema retained without data migration; uncommitted scanned suggestions remain session-only. On-demand Tesseract.js still requires independent real-browser and phone testing before owner-approved T2 release.

## [2.0.0] — 2026-10-23 (implementation package; **not published or tagged**)

### Added
- Mobile-first restaurant entry UI with participant chips, editable item forms, item autocomplete and quick-repeat actions.
- Shared-item allocation across selected diners, item quantity, per-person totals and deterministic allocation of rounding pennies.
- One bill-wide service percentage with quick 0%, 10%, 12.5%, 15% presets and instant recalculation of **all** existing items.
- Printed receipt total comparison and mismatch warnings.
- Optional camera/photo receipt scanning with lazy-loaded Tesseract.js 7.0.0, bounded image preparation, browser-local recognition, editable parsed item review and allocation; alternative pasted receipt text.
- Shared summary through Web Share / clipboard fallback, saved reusable participant/service templates, deletion undo.
- Versioned localStorage schema (`dining.bill.v2`), non-destructive migration of historic `expenses`, and explicit review for mixed legacy service charges.
- Installable PWA app shell with offline core assets, manifest and icons (OCR assets **not guaranteed offline**).
- Repository policy (`AGENTS.md`, SFW 1.1.0), as-built `ARCHITECTURE.md`, `SECURITY.md`, threat model and testing instructions.
- Node unit tests, Python Playwright browser workflow tests, CI quality/security/CodeQL/browser jobs, and manual approval deployment path.

### Changed
- Restructured static publish output into `public/` and moved business logic into independently testable ESM modules.
- Currency represented by integer pennies, rates by integer basis points; service charge calculated once and proportionally allocated.
- Removed legacy Bootstrap/jQuery dependency and six-column mobile table.
- Replaced unconditional auto-deploy workflow with a CI-gated, **manually triggered** Pages deploy job (requires removal of original `static.yml` when applying to the repository).
- Explicitly documented that browser storage does **not** expire after 24 hours; old README claim was not implemented.

### Security / verification
- Local SFW check results and limitations are captured in `docs/testing.md` and `docs/verification-report.md`. OCR CDN use is a T2 release trust boundary; owner release approval remains pending.
- Existing saved `expenses` is not removed; unreadable data is preserved with recovery export before reset.

## Untagged development — 2025-04-06

- Added an item deletion button — commit [`0e6f8d207`](https://github.com/safesploitOrg/dining-expense-calculator/commit/0e6f8d207).
- Visual improvements — commit [`964636ac6`](https://github.com/safesploitOrg/dining-expense-calculator/commit/964636ac6).
- GitHub Pages workflow updates — commits [`2ec629d5f`](https://github.com/safesploitOrg/dining-expense-calculator/commit/2ec629d5f), [`f6582bbc0`](https://github.com/safesploitOrg/dining-expense-calculator/commit/f6582bbc0); merged through PRs #13–#15.

## Untagged development — 2024-03-13

- HTML/markup updates — commits [`05bd01b40`](https://github.com/safesploitOrg/dining-expense-calculator/commit/05bd01b40), [`71edc7082`](https://github.com/safesploitOrg/dining-expense-calculator/commit/71edc7082) and [`7ac30bd97`](https://github.com/safesploitOrg/dining-expense-calculator/commit/7ac30bd97), including merges #10–#12. Original commit subjects do not provide sufficient detail to assert larger functional changes.

## [1.2.0] — 2023-12-05 (published release)

Source: [GitHub release v1.2.0](https://github.com/safesploitOrg/dining-expense-calculator/releases/tag/v1.2.0).

- Added **Clear expenses** button.
- Added browser localStorage persistence.
- Supporting commits include [`6e3bbed24`](https://github.com/safesploitOrg/dining-expense-calculator/commit/6e3bbed24) (`clear expenses button`), [`2be8ea13d`](https://github.com/safesploitOrg/dining-expense-calculator/commit/2be8ea13d) (`Refactoring`) and [`3686266c6`](https://github.com/safesploitOrg/dining-expense-calculator/commit/3686266c6) (`Delete legacy directory`).

## [1.1.0] — 2023-12-05 (published release)

Source: [GitHub release v1.1.0](https://github.com/safesploitOrg/dining-expense-calculator/releases/tag/v1.1.0).

- Added a prompt when reloading the page, per official release notes.

## Initial development — 2023-11-01 to 2023-11-13 (untagged)

- Initial repository and page setup: [`36f87464a`](https://github.com/safesploitOrg/dining-expense-calculator/commit/36f87464a), [`b70d0157e`](https://github.com/safesploitOrg/dining-expense-calculator/commit/b70d0157e), [`bdcfde146`](https://github.com/safesploitOrg/dining-expense-calculator/commit/bdcfde146).
- Original Pages workflow and README: [`83d37ac92`](https://github.com/safesploitOrg/dining-expense-calculator/commit/83d37ac92), [`a52c0a9e2`](https://github.com/safesploitOrg/dining-expense-calculator/commit/a52c0a9e2).
- Initial modularisation and planning: [`60ee2d645`](https://github.com/safesploitOrg/dining-expense-calculator/commit/60ee2d645), [`c12a3adbb`](https://github.com/safesploitOrg/dining-expense-calculator/commit/c12a3adbb).

[1.2.0]: https://github.com/safesploitOrg/dining-expense-calculator/releases/tag/v1.2.0
[1.1.0]: https://github.com/safesploitOrg/dining-expense-calculator/releases/tag/v1.1.0
