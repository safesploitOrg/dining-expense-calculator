# SECURITY — Dining Split

## Security profile & owner approval

The application is a local-first static site with untrusted user-entered content and optional receipt/menu image parsing. Under the SFW v1.1 standard, its interactive UI is **Profile B**. Core bill calculation is **T1**, and accepting images into OCR plus downloading executable OCR assets is **T2**; a human project owner must approve the security-sensitive release before making this package public. This ZIP is not an approval or deployment.

## Privacy and data handling

- No user accounts, API, server-side application database, analytics or telemetry are implemented.
- Bill details and optional table templates are persisted in **this browser's localStorage** (unencrypted). Browser extensions, device users and any same-origin script can potentially access that storage; do not treat it as a secure vault.
- Original `expenses` data remains stored after migration. A data-recovery backup can be downloaded when data is corrupt; users must protect exported files.
- Receipt images are read into browser memory and processed via Tesseract.js. The application does **not** send images or OCR text to its own server.
- **Risk:** on-demand OCR JavaScript/worker/core code is supplied from third-party CDN(s) and executes with access to browser capabilities. Version pinning + CSP reduce but do not eliminate supply-chain risk; CDN-hosted code is not covered by a verified bundled integrity hash. Do not present this as full offline or independently audited OCR.
- Receipt text remains in temporary DOM input while the scan review is visible; it is cleared on discard (or scan replacement), not persisted to application localStorage. Approved item descriptions and prices enter the bill only on explicit Add.
- No expiry timer is implemented: clearing site data or replacing a bill removes it from the application, but historical `expenses` remains unless users remove it via browser tools.

## Threat controls

| Threat | Implemented defence | Limitations |
|---|---|---|
| DOM XSS in names/receipt/item text | All user-controlled output created via `textContent`; no untrusted HTML injection | External OCR script remains a separate code trust boundary |
| Bad prices/overcharging | Strict numeric input; integer pennies, exact service allocation; totals reconciled | Does not automatically model vouchers/discounts/tips |
| OCR parsing tricks | 18k text / 240 line and 900k TSV / 4,500 word bounds, at most 250 candidates, manual review, no automatic import/charge update | Heuristic menu/receipt parsing may still misassociate lines and prices |
| Image denial of service | 10 MB limit, 40 MP guard, resize to max 2400 px, terminate OCR worker | Browser decode can still consume substantial RAM on malicious images |
| Cross-currency miscalculation | Explicit GBP/USD/EUR symbol recognition, printed-total currency guard, no implicit FX conversions, currency locked once money amounts exist | OCR may omit currency symbols; the user must confirm source and destination |
| Corrupt browser storage | Schema validation; no silent overwrite on parse errors; backup export | LocalStorage is not encrypted and lacks multi-device sync |
| Third-party code compromise | Pinned tesseract.js v7.0.0 URL; strict CSP with narrowly scoped WebAssembly compilation | No SRI for remote runtime; worker and language defaults supplied by upstream |
| Unverified production changes | Gated PR/push checks; GitHub Pages release is manual dispatch after passing jobs | The owner must configure environment reviewers/branch rulesets; repo ZIP cannot enforce external settings |

The page CSP permits `script-src 'wasm-unsafe-eval'` specifically for the WebAssembly OCR engine; it does **not** permit ordinary `unsafe-eval`. Service workers cache the same-origin shell and never deliberately cache image data or personal inputs.

## Reporting vulnerabilities

Please use the GitHub repository's [Security advisories](https://github.com/safesploitOrg/dining-expense-calculator/security/advisories) (private reporting, if enabled) or contact the maintainer through a private channel. **Do not post receipts, private names, malicious proof-of-concept data or credentials to public issues.**

## CI and release conditions

- Required: Node syntax/structure checks, unit tests, basic DOM and literal-secret pattern/CSP checks, CodeQL SAST, dependency audit, Playwright workflows on Chromium, Firefox and WebKit.
- The local basic pattern scanner is **not** a replacement for dedicated secret scanning. CodeQL analyses JavaScript but uploading findings does **not** automatically block merges or releases. Configure Code Scanning severity thresholds/rulesets and verify their enforcement. If a dedicated scanner is required, integrate a maintained tool such as Gitleaks CLI under a properly reviewed and enforced CI gate, with baselines where needed.
- **Critically:** Remove the repository's old `.github/workflows/static.yml` when migrating. Otherwise that workflow can still deploy without passing any CI checks.
- Protect `main`, set Pages source to GitHub Actions, require CI statuses including `static_analysis`, enforce Code Scanning findings policy, protect `github-pages` environment with human approvers, and use explicit manual `workflow_dispatch` for the T2 release.
- Run real Tesseract OCR/camera acceptance tests on Safari/iOS and Chrome/Android before production, including multi-column menus, mixed currencies and low-confidence review. **These were not executed in this offline generation environment.**

## Incident / rollback

- Revert to the last known good source commit and manually rerun the protected Pages deployment job.
- Do not automatically delete or rewrite `localStorage` after rollback; v2 keys may remain alongside preserved v1 data.
- In the event of compromise via remote OCR code, disable the scan UI/CDN permission and redeploy a safe build; check for exposure of data in affected browsers, then notify users appropriately.
- No server-side logs/health endpoints exist; availability can be monitored using GitHub Pages endpoint checks outside this repository.
