# Testing and verification — Dining Split

**Implementation package:** v2.0.2, 2026-10-23  
**Upstream baseline:** main at `c580c89bfdc96336317c3eee841caf15a2b45187`, 2025-04-06.

## Commands

```bash
npm ci --ignore-scripts --no-fund
npm run lint
npm run test:unit
npm run security:check
npm run check

# Requires Python 3 + Playwright browser engine(s), installs require network
python3 -m pip install playwright==1.57.0
python3 -m playwright install chromium firefox webkit
BROWSER_NAME=chromium python3 -m unittest discover -s tests/browser -p 'test_*.py' -v
BROWSER_NAME=firefox python3 -m unittest discover -s tests/browser -p 'test_*.py' -v
BROWSER_NAME=webkit python3 -m unittest discover -s tests/browser -p 'test_*.py' -v
```

Restricted browser sandbox fallback (NOT equivalent to a real navigational E2E test):

```bash
LOCAL_EMBEDDED=1 SYSTEM_CHROMIUM=/usr/bin/chromium \
  python3 -m unittest discover -s tests/browser -p 'test_*.py' -v
```

The fallback uses `set_content` with a temporary module rewrite and without the production CSP, because sandbox Chromium returns `net::ERR_BLOCKED_BY_ADMINISTRATOR` on **all** URL navigations, including localhost and `data:`. It verifies DOM behaviour and responsive layout only; it cannot prove HTTP/CSP/service-worker/network functionality. The CI command intentionally does **not** enable it.

## Required coverage

| Layer | Scenarios |
|---|---|
| Unit: money | Decimal parsing, invalid input, exact half-up rates, proportional pennies, deterministic sums |
| Unit: bill | Global charge change, multi-diner shared item, edit/delete, invalid participant/item |
| Unit: migration/storage | Original dictionary, consistent/conflicting service percentages, corrupt data backup, template format |
| Unit: receipt | Item/service/total separation; noisy sample menu yielding 20 candidates; two-column TSV grouping, multiple pairs on one line, mixed £/$/€ currencies, corrupted TSV fallback, limits and hostile input |
| Chromium/Firefox/WebKit E2E | Add diners/items, global charge change, localStorage refresh, shared item edit/delete/undo, per-line OCR text edit/add/skip, menu/receipt mode, dollar-priced scan guard and bill currency switching, scanned-item dropdown prefill without commit, immediate rate input, templates, migration, safe DOM, responsive layout |
| Mock OCR browser E2E | Browser image picker/resize, mocked worker invocation/termination, TSV output request, two-column spatial separation, per-line review and add |
| Real OCR manual acceptance | Representative two-column menus plus printed receipts with 0%, 10%, 12.5%, 15% and no service; varying fonts, crumples and lighting |
| PWA | HTTPS install, first-load cache, offline load, clear app data, update SW cache/version |
| Accessibility | Keyboard flow, focus/labels, 200% zoom, contrast, reduced motion and real-device voiceover |

### Local package evidence

The implementation was built with no third-party npm dependencies. Local unit, source and basic security commands were executed. Chromium DOM tests were executed with a non-network embedded harness because the local browser policy blocks navigation. Read the final delivery report for counts and status: command results are revision-sensitive, not proof that an uploaded/merged copy was tested.

### CI security enforcement

`.github/workflows/ci.yml` runs `npm ci`, syntax/markup checks, unit tests, basic security checks, `npm audit --audit-level=high`, CodeQL security-and-quality analysis, and Playwright browsers. Deployment runs only on `workflow_dispatch` from `main`, after both CI job families complete successfully. `github-pages` environment rules and mandatory status checks **must be configured in repository settings** to complete governance; these cannot be enforced merely by providing the file.

The local `security-check.mjs` is **explicitly a limited DOM/secret pattern/CSP gate**, not Gitleaks or a full security audit. The CodeQL job uploads scan findings; the repository owner must enable and verify severity-based Code Scanning rulesets because a clean action exit alone does not prove that findings cannot be merged. Its success means only those checks were satisfied. `npm audit`, remote CodeQL analysis and full navigational Playwright engines require online CI and were **not** run in the local offline generation environment.

### Release acceptance blockers

1. Remove old `.github/workflows/static.yml` from the live repository so it cannot bypass CI.
2. Run the default Playwright tests against a real HTTP server on all three browser engines and resolve any failures. Run CodeQL and dependency audit online and enforce the configured finding severity gate.
3. Run online real Tesseract.js OCR with actual phone camera uploads and receipts; check CSP and network requests for privacy.
4. Verify offline PWA after first load, service worker version updates, and behaviour under 200% zoom/accessibility testing.
5. Require explicit project-owner approval for OCR T2 release and record relevant risk acceptance.
