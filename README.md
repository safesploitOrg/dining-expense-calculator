# Dining Split — Restaurant Bill Calculator

A lightweight, mobile-first, **local-first** web application for figuring out what everyone owes at a restaurant. Powered by vanilla JavaScript and hosted as a static site; no account, backend or registration required.

**Version:** `2.0.2` (implementation patch package, not yet published/tagged)  
**Source:** https://github.com/safesploitOrg/dining-expense-calculator  
**Publishing root:** `public/`

## Features

- Add diners once, then tap one or more names to allocate an item.
- Change the **single global service charge** any time; all items and per-person totals recalculate **as you type**, including on mobile, without modifying existing items.
- Use integer 2-decimal minor units (pence/cents) and basis-point percentages, applying service **once to the bill subtotal** and distributing pennies deterministically.
- Add/edit/delete items; repeat frequently used items from the Quick Add list; undo a deletion.
- Allocate items to one diner or split equally across several diners.
- GBP, USD and EUR support without exchange conversion; the bill currency is locked once any saved item or receipt total exists. Mixed-currency OCR is flagged or blocked.
- Optional receipt total reconciliation: warns on mismatches.
- **Receipt and menu modes** for browser-local Tesseract.js OCR. Multi-column menus use bounded word-position analysis (when TSV is available) with a tolerant plain-text fallback; each item name/price remains an untrusted suggestion in an individual review queue. Edit, assign diners, explicitly Add to bill or Skip/Restore. No bulk auto-import.
- OCR results appear in a Section 03 **scanned-item dropdown** and name autocomplete; choosing a suggestion prefills the form but **does not add an item** until you press Add item. Manual entry always remains available. Pasted menu or receipt text also supported.
- Save reusable diner/charge templates; use Share or Copy Summary to settle up.
- Progressive Web App app shell: installable on supported devices, core bill management works offline after first successful online visit.
- Migrates historic `localStorage.expenses` safely; **does not delete the original key**. If old items had mixed service charges, a rate confirmation is mandatory before final totals are shown/shared.
- Data remains in browser localStorage until explicitly replaced/cleared, or the browser clears site data. **There is no 24-hour expiry** (an outdated claim in the earlier README).

## Run locally

Requires Node.js 22+ for development/test commands; *runtime is ordinary modern browser JavaScript.*

```bash
npm ci --ignore-scripts
npm run check
python3 -m http.server 8000 --directory public
```

Open **http://localhost:8000**. Do not open `public/index.html` using `file://`: ES modules and service workers require a web origin. Production hosting must use HTTPS (e.g. GitHub Pages).

### Browser tests

Install [Python Playwright](https://playwright.dev/python/docs/intro) and browsers on a developer machine:

```bash
python3 -m pip install playwright==1.57.0
python3 -m playwright install chromium firefox webkit
BROWSER_NAME=chromium python3 -m unittest discover -s tests/browser -p 'test_*.py' -v
BROWSER_NAME=firefox python3 -m unittest discover -s tests/browser -p 'test_*.py' -v
BROWSER_NAME=webkit python3 -m unittest discover -s tests/browser -p 'test_*.py' -v
```

The restricted project-generation environment used here blocks Chromium navigation. A **reduced** interaction-only fallback can be run using `LOCAL_EMBEDDED=1 SYSTEM_CHROMIUM=/usr/bin/chromium ...`, but it removes CSP and cannot prove real navigation, service-worker or CDN OCR behaviour. **Do not substitute it for release browser gates.**

## Usage

1. Add the diners (e.g. Alex, Sam and Jamie).
2. Tap diner chips; for shared dishes select several.
3. Select the bill currency (GBP, USD or EUR) **before** adding items, then add items with price **per unit** and quantity, or repeat prior items via Quick Add.
4. If the restaurant changes service from 10% to 12.5%, type the new rate in Bill settings. The inline preview, every person and the grand total recalculate immediately, without pressing Enter.
5. Optionally enter the restaurant's final total to compare differences. This also recalculates as you type. Invalid partial numbers retain the previous valid value until corrected.
6. Choose **Itemised receipt** or **Restaurant menu** in Section 04, then select **Take a photo** or paste extracted text. In menu mode the suggestions are available dishes, not proof anyone ordered them; in receipt mode you may separately choose a detected total/service charge. **Nothing is imported automatically.** Review every **name | price | diner** and explicitly choose **Add to bill**, **Skip**, or **Use in Add an item**. Section 03 manual entry remains independent; a scan dropdown selection alone never adds an item.
7. Share the summary; optionally save your group as a template for next time.

**Your example menu (USD):** In Section 04 select **Restaurant menu**, choose the photo, or paste OCR text. A scan similar to your example can suggest roughly 20 items (including $18.99 Grilled Salmon and $24.99 Ribeye Steak), but names may still need editing. Before adding anything, set bill currency to **USD** (use the scan's currency suggestion button while the bill is empty). The app never treats dollars as pounds or a menu total as a receipt total.

**Known constraint:** When OCR word positions are unavailable, text parsing is more tolerant but cannot always separate merged columns reliably. Always compare against the original image. Currency recognition is limited to £/$/€ and does not perform currency conversion.

**Receipt OCR caveat:** First use downloads the Tesseract.js engine and language/worker assets from jsDelivr and its configured sources. The receipt image is recognised **in the browser**, not sent to our server. OCR itself is **not guaranteed offline**; the bill calculator and saved data are available offline after the app shell has been cached. Recognised values are untrusted and require review. Camera capture depends on browser permission and device support. No real-camera or remote-OCR acceptance test was run in this package environment.

## Data migration & recovery

Existing versions used `localStorage["expenses"]`, grouped by user name, with per-item decimal `serviceChargePercentage` values. On first load of v2:

- `expenses` is read **without modification** and converted to `dining.bill.v2` with stable IDs.
- Equal old rates become the bill's global rate.
- Mixed old rates become an **unconfirmed** 0% placeholder while all items remain; select an old rate (or manually enter a new rate), then explicitly confirm before paying/sharing.
- Invalid/truncated saved data is **not overwritten automatically**: a recovery notice appears with a raw JSON backup action. Starting a new bill then requires explicit confirmation.
- Once the new data key exists it takes precedence. The old `expenses` key is preserved as a backup.

**Recommendation before production migration:** Export/copy existing browser localStorage from the old site and test migration with realistic records in a staging hostname. If the old and new site URLs have different origins, localStorage does not automatically follow you; use the same origin/path or perform a deliberate export/import migration.

## Deployment to GitHub Pages

**Important:** The old repository includes `.github/workflows/static.yml`, which auto-deploys without verification. **Remove it when applying this full project ZIP**; leaving it active bypasses the new release gate.

1. Commit project contents, including `public/`, `package-lock.json`, tests, policy documents and `.github/workflows/ci.yml`. Do not publish `node_modules` or `tests` as static assets.
2. Configure Pages: **GitHub Actions** as source.
3. Protect `main` with required `quality`, three `browser` checks and `static_analysis`; restrict who may merge workflow changes. Configure `github-pages` environment with reviewers/approval appropriate to your SFW T2 release policy. Configure Code Scanning ruleset thresholds so high-severity findings actually block release; a successful SARIF upload alone is not a security decision.
4. Pull requests and pushes validate automatically. **Deployment does not run on a normal push**: a project owner must review security/verification evidence and **manually dispatch** "Validate and deploy Dining Split" on `main`. The deploy job depends on all test jobs.
5. Verify publicly deployed URL, mobile Safari/Chrome, camera OCR, CSP, installability, correct service charge, persistence and migration.

See [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), [docs/testing.md](docs/testing.md), [docs/threat-model.md](docs/threat-model.md), and [verification report](docs/verification-report.md).

## Libraries & licensing

Core runtime has **zero npm dependencies**; Python Playwright is used for browser test automation. OCR downloads [Tesseract.js v7.0.0](https://github.com/naptha/tesseract.js) on demand (Apache-2.0; check upstream licence/notices). This remote library is a supply-chain trust boundary, documented in SECURITY.md. UI assets and bill data stay local.

MIT licence, copyright © 2023 Zepher Ashe (existing project licence retained).
