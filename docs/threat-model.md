# Threat model — receipt/menu OCR and local-first bill calculations

**Updated:** 2026-10-23  
**SFW:** Profile B; OCR T2 due to untrusted images/parser and remote script execution.  
**Approval:** Pending human release sign-off.

| Asset / boundary | Plausible abuse or failure | Mitigation and verification | Residual risk |
|---|---|---|---|
| Browser-stored bill/participant data | Same-origin XSS reads or alters bill | textContent-only insertion, bounded fields, CSP; XSS negative browser test | Untrusted CDN code and browser extensions can still access storage |
| Prices and computed amount | Incorrect floating-point rounding / mutable per-item rates | Integer pennies, basis points, single global rate, largest-remainder allocation, deterministic/property tests | Unsupported restaurant pricing models require manual checking |
| Imported v1 records | Silent migration changes legacy charges or loses rows | Keep original `expenses`; select rate explicitly for mixed rates; block corrupt data; unit/browser tests | Legacy data with unusual precision is rounded to pence |
| Receipt photo and OCR text | Unwanted upload or permanent retention | No upload endpoint; in-memory compression, worker local recognition, discard buffers; no persistent image | Remote code supply chain, browser extensions, device access |
| Image decoder and OCR engine | Maliciously crafted high-resolution image exhausts RAM/CPU or exploits browser/OCR engine | 10 MB, 40 MP, 2400 px and 18k OCR text, 900k TSV and 4,500 word limits; worker termination, lazy load; T2 sign-off | Image decode itself may allocate more memory than expected; upstream CVEs possible |
| Menu and currency interpretation | Two-column layout mispairs prices, OCR misses symbols, dollar amounts treated as GBP, text garbage approved as dishes | TSV spatial column separation, multi-pair text parser, local review with warnings, editable name/price, bill-currency lock and mismatched-currency block | OCR confidence is heuristic; images must be reviewed and paid total verified |
| Receipt-text parsing | Forged `TOTAL`, service charge or OCR misreads create wrong payable amount | Filter common subtotal/service lines, show suggestions only, editable per-line add/skip, no bulk auto-import and reconciliation | Heuristic parse incomplete; human review mandatory |
| Third-party CDN | Compromise/injection of executable code, unavailable CDN, language model change | Pin tesseract.js v7.0.0, limited CSP, lazy load and error fallback | Worker/core models not vendored or independently checked; no SRI for remote JS |
| GitHub Pages release | Ungated publication of unsafe code | Replace old static.yml; manual workflow_dispatch depends on quality/browser/CodeQL; human approval/environment reviewers | Repo settings external to ZIP; owner must configure environment protection |

### Testing / release checklist

- [x] Financial invariants and migration negative-path unit tests.
- [x] Browser DOM-interaction tests for malicious text and receipt review; local Chromium only via restricted-environment fallback.
- [x] Mocked OCR-worker lifecycle and image-file pathway in Chromium.
- [ ] Real OCR with Tesseract remote assets and representative receipts in Chromium/Firefox/WebKit.
- [ ] Real iOS Safari / Android Chrome camera acceptance testing.
- [ ] Validate actual deployment CSP, security headers and service-worker offline behaviour on HTTPS.
- [ ] Independent security review of remote OCR asset provenance and dependency vulnerabilities.
- [ ] Set repo branch protection, Code Scanning alert ruleset + Pages environment reviewers; remove legacy deploy workflow on the live repo.
- [ ] Recorded project owner approval of T2 release/security evidence.

**Do not mark unchecked controls as passed based on this ZIP alone.**
