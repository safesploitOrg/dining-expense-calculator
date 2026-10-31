"""Cross-browser user journeys. Run: python -m unittest discover -s tests/browser -v"""
import functools
import base64
import re
import http.server
import os
from pathlib import Path
import threading
import unittest
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'public'
BROWSER_NAME = os.getenv('BROWSER_NAME', 'chromium')
EMBEDDED_TEST = os.getenv('LOCAL_EMBEDDED') == '1'  # Restricted browser cannot navigate URLs.

def embedded_module_uri(path):
    path = path.resolve()
    source = path.read_text()
    def rewrite(match):
        dependency = (path.parent / match.group(2)).resolve()
        return match.group(1) + embedded_module_uri(dependency) + match.group(3)
    source = re.sub(r"(from\s+['\"])(\.[^'\"]+)(['\"])", rewrite, source)
    return 'data:text/javascript;base64,' + base64.b64encode(source.encode()).decode()

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

class BrowserWorkflows(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(PUBLIC)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}/'
        cls.playwright = sync_playwright().start()
        browser_type = getattr(cls.playwright, BROWSER_NAME)
        kwargs = {'headless': True}
        if BROWSER_NAME == 'chromium' and os.getenv('SYSTEM_CHROMIUM'):
            kwargs['executable_path'] = os.getenv('SYSTEM_CHROMIUM')
            kwargs['args'] = ['--no-sandbox', '--disable-dev-shm-usage']
        cls.browser = browser_type.launch(**kwargs)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 390, 'height': 844})
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.load_app()
        expect(self.page.locator('#grand-total')).to_have_text('£0.00')

    def load_app(self):
        if not EMBEDDED_TEST:
            self.page.goto(self.base, wait_until='networkidle')
            return
        html = (PUBLIC / 'index.html').read_text()
        html = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]+>', '', html)
        html = re.sub(r'<script type="module"[^>]+></script>', '', html)
        self.page.set_content(html)
        self.page.add_style_tag(content=(PUBLIC / 'assets/css/styles.css').read_text())
        if not hasattr(self, '_storage_initialised'):
            self.page.evaluate('''() => {
              const data = new Map();
              Object.defineProperty(window, 'localStorage', {configurable:true, value:{
                getItem:k=>data.get(k)??null, setItem:(k,v)=>data.set(k,v), removeItem:k=>data.delete(k)
              }});
            }''')
            self._storage_initialised = True
        module = embedded_module_uri(PUBLIC / 'assets/js/app.js')
        serial = getattr(self, '_load_serial', 0)
        self._load_serial = serial + 1
        self.page.evaluate('(src) => import(src)', module + '#session-' + str(serial))

    def tearDown(self):
        self.assertEqual(self.errors, [], f'Unexpected browser errors: {self.errors}')
        self.context.close()

    def person(self, name):
        self.page.locator('#participant-name').fill(name)
        self.page.locator('#participant-form button').click()
        expect(self.page.locator('#participants')).to_contain_text(name)

    def item(self, description, price, quantity='1'):
        self.page.locator('#item-description').fill(description)
        self.page.locator('#item-price').fill(price)
        self.page.locator('#item-quantity').fill(quantity)
        self.page.locator('#save-item').click()

    def test_camera_menu_requests_spatial_tsv_and_separates_columns(self):
        self.person('Alex')
        self.page.locator('#scan-mode').select_option('menu')
        self.page.evaluate(r"""() => {
            window.__hasRequestedTSV = false;
            const rows = [
              [10, 15, ['Tea', '$2.99']], [157, 15, ['Pie', '$5.99']],
              [10, 75, ['Soup', '$4.00']], [157, 75, ['Juice', '$3.00']],
            ];
            const tsv = ['level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'];
            rows.forEach(([left, top, parts], index) => {
              let x = left;
              parts.forEach((word, wordIndex) => {
                const width = Math.max(14, word.length * 8);
                tsv.push([5,1,1,1,index+1,wordIndex+1,x,top,width,16,96,word].join('\t'));
                x += width + 8;
              });
            });
            window.Tesseract = {
              createWorker: async () => ({
                recognize: async (_blob, _options, output) => {
                  window.__hasRequestedTSV = output?.tsv === true;
                  return {data:{text:'Tea $2.99 Pie $5.99\nSoup $4.00 Juice $3.00', tsv: tsv.join('\n')}};
                },
                terminate: async () => {}
              })
            };
        }""")
        self.page.locator('#receipt-image').set_input_files(str(ROOT / 'tests/fixtures/test-receipt.png'))
        expect(self.page.locator('.scan-row')).to_have_count(4)
        self.assertTrue(self.page.evaluate('window.__hasRequestedTSV'), 'OCR requested Tesseract TSV word positions')
        expect(self.page.locator('#receipt-suggestions')).to_contain_text('2 columns separated')
        expect(self.page.locator('#scan-progress')).to_contain_text('4 awaiting review')
        self.assertEqual([field.input_value() for field in self.page.locator('.scan-description').all()], ['Tea', 'Soup', 'Pie', 'Juice'])
        expect(self.page.locator('#item-count')).to_have_text('0 items')
        self.page.get_by_role('button', name='Set bill currency to USD').click()
        self.page.locator('.scan-row').nth(0).get_by_role('button', name='Add to bill').click()
        expect(self.page.locator('#grand-total')).to_have_text('US$3.29')

    def test_noisy_two_column_menu_recovery_currency_guard_and_explicit_add(self):
        self.person('Alex')
        self.page.locator('#scan-mode').select_option('menu')
        self.page.locator('details.paste-details summary').click()
        sample = (ROOT / 'tests/fixtures/menu-ocr-noisy.txt').read_text()
        self.page.locator('#receipt-text').fill(sample)
        self.page.get_by_role('button', name='Review pasted items').click()
        expect(self.page.locator('.scan-row')).to_have_count(20)
        expect(self.page.locator('#item-count')).to_have_text('0 items')
        expect(self.page.locator('#scan-progress')).to_have_text('0 added · 20 awaiting review · 0 skipped')
        expect(self.page.locator('#receipt-suggestions')).to_contain_text('Detected USD prices')
        expect(self.page.locator('#scanned-item-picker option')).to_have_count(21)
        self.page.locator('.scan-row').nth(0).get_by_role('button', name='Add to bill').click()
        expect(self.page.locator('.scan-row').nth(0).locator('.scan-row-error')).to_contain_text('USD')
        expect(self.page.locator('#item-count')).to_have_text('0 items')
        self.page.get_by_role('button', name='Set bill currency to USD').click()
        expect(self.page.locator('#bill-currency')).to_have_value('USD')
        expect(self.page.locator('#grand-total')).to_have_text('US$0.00')
        self.page.locator('.scan-row').nth(0).get_by_role('button', name='Add to bill').click()
        expect(self.page.locator('#item-count')).to_have_text('1 item')
        expect(self.page.locator('#grand-total')).to_have_text('US$20.89')
        self.page.locator('#bill-currency').select_option('GBP')
        expect(self.page.locator('#bill-currency')).to_have_value('USD')
        expect(self.page.locator('#app-alert')).to_contain_text('Currency cannot be changed')
        # Names and prices from the scan can still prefill Section 03 without immediate commitment.
        self.page.locator('#scanned-item-picker').select_option('1')
        expect(self.page.locator('#item-description')).to_have_value('Chicken Parmesan')
        expect(self.page.locator('#item-price')).to_have_value('16.99')
        expect(self.page.locator('#item-count')).to_have_text('1 item')
        self.page.locator('#save-item').click()
        expect(self.page.locator('#item-count')).to_have_text('2 items')
        expect(self.page.locator('.scan-row').nth(1).locator('.scan-state')).to_contain_text('Added to bill')

    def test_receipt_total_currency_never_relabels_dollars_as_pounds(self):
        self.person('Alex')
        self.page.locator('details.paste-details summary').click()
        self.page.locator('#receipt-text').fill('Cake $5.00\nTOTAL $5.50')
        self.page.get_by_role('button', name='Review pasted items').click()
        self.page.get_by_role('button', name='Use printed receipt total US$5.50').click()
        expect(self.page.locator('#receipt-total')).to_have_value('')
        expect(self.page.locator('#app-alert')).to_contain_text('currency differs')
        self.page.get_by_role('button', name='Set bill currency to USD').click()
        self.page.get_by_role('button', name='Use printed receipt total US$5.50').click()
        expect(self.page.locator('#receipt-total')).to_have_value('5.50')
        self.page.locator('.scan-row').get_by_role('button', name='Add to bill').click()
        expect(self.page.locator('#reconciliation')).to_contain_text('Matches the printed')
        expect(self.page.locator('#grand-total')).to_have_text('US$5.50')

    def test_menu_mode_prevents_receipt_metadata_and_keeps_manual_input(self):
        self.person('Alex')
        self.page.locator('#scan-mode').select_option('menu')
        self.page.locator('details.paste-details summary').click()
        self.page.locator('#receipt-text').fill('Salad £10.00\nService charge £1.25\nTOTAL £11.25')
        self.page.get_by_role('button', name='Review pasted items').click()
        expect(self.page.locator('.scan-row')).to_have_count(1)
        self.assertEqual(self.page.get_by_role('button', name='Use printed receipt total £11.25').count(), 0)
        expect(self.page.locator('#receipt-review')).to_contain_text('A menu lists available dishes')
        self.item('Manual dish', '4.00')
        expect(self.page.locator('#item-count')).to_have_text('1 item')
        expect(self.page.locator('.scan-row .scan-state')).to_have_text('Awaiting review')

    def test_global_service_charge_and_browser_refresh(self):
        self.person('Alex')
        self.item('Pizza', '40.00')
        self.person('Sam')
        self.item('Salad', '35.00')
        expect(self.page.locator('#grand-total')).to_have_text('£82.50')
        self.page.locator('.rate-preset[data-rate="15"]').click()
        expect(self.page.locator('#grand-total')).to_have_text('£86.25')
        self.load_app() if EMBEDDED_TEST else self.page.reload(wait_until='networkidle')
        expect(self.page.locator('#grand-total')).to_have_text('£86.25')
        expect(self.page.locator('#item-count')).to_have_text('2 items')

    def test_shared_item_edit_and_undo_delete(self):
        self.person('Alex')
        self.person('Sam')
        self.page.get_by_role('button', name='Assign item to Alex').click()
        self.item('Bottle', '10.01')
        expect(self.page.locator('#grand-total')).to_have_text('£11.01')
        self.page.get_by_role('button', name='Edit Bottle').click()
        self.page.locator('#item-price').fill('11.00')
        self.page.locator('#save-item').click()
        expect(self.page.locator('#grand-total')).to_have_text('£12.10')
        self.page.get_by_role('button', name='Delete Bottle').click()
        expect(self.page.locator('#grand-total')).to_have_text('£0.00')
        self.page.get_by_role('button', name='Undo').click()
        expect(self.page.locator('#grand-total')).to_have_text('£12.10')

    def test_receipt_text_review_and_reconcile(self):
        self.person('Alex')
        self.page.locator('details.paste-details summary').click()
        self.page.locator('#receipt-text').fill('Burger 14.50\nFries 4.00\nService charge 12.5% 2.31\nTOTAL 20.81')
        self.page.get_by_role('button', name='Review pasted items').click()
        expect(self.page.locator('.scan-row')).to_have_count(2)
        self.page.get_by_role('button', name='Use detected service 12.5%').click()
        self.page.get_by_role('button', name='Use printed receipt total £20.81').click()
        # Detection alone never commits anything to the bill.
        expect(self.page.locator('#item-count')).to_have_text('0 items')
        expect(self.page.locator('#scanned-item-picker option')).to_have_count(3)
        self.page.locator('.scan-row').nth(0).locator('.scan-description').fill('Cheese Burger')
        self.page.locator('.scan-row').nth(0).get_by_role('button', name='Add to bill').click()
        expect(self.page.locator('#item-count')).to_have_text('1 item')
        self.page.locator('.scan-row').nth(1).get_by_role('button', name='Add to bill').click()
        expect(self.page.locator('#grand-total')).to_have_text('£20.81')
        expect(self.page.locator('.scan-state')).to_contain_text(['Added to bill', 'Added to bill'])
        expect(self.page.locator('#items')).to_contain_text('Cheese Burger')
        expect(self.page.locator('#reconciliation')).to_contain_text('Matches the printed')

    def test_camera_image_through_mocked_local_ocr_worker(self):
        # Network-independent integration of file input, image preparation,
        # worker lifecycle and review. The actual Tesseract model still needs
        # a separate online real-device acceptance test before release.
        self.person('Alex')
        self.page.evaluate("""() => {
          window.__workersTerminated = 0;
          window.Tesseract = {
            createWorker: async () => ({
              recognize: async image => ({ data: { text: 'Burger 14.50\\nFries 4.00\\nTOTAL 18.50' } }),
              terminate: async () => { window.__workersTerminated += 1; }
            })
          };
        }""")
        self.page.locator('#receipt-image').set_input_files(str(ROOT / 'tests/fixtures/test-receipt.png'))
        expect(self.page.locator('.scan-row')).to_have_count(2)
        self.assertEqual(self.page.evaluate('window.__workersTerminated'), 1)
        expect(self.page.locator('#item-count')).to_have_text('0 items')
        self.page.locator('.scan-row').nth(0).get_by_role('button', name='Add to bill').click()
        self.page.locator('.scan-row').nth(1).get_by_role('button', name='Add to bill').click()
        expect(self.page.locator('#grand-total')).to_have_text('£20.35')

    def test_service_rate_updates_immediately_on_mobile_and_preserves_valid_rate(self):
        self.person('Alex')
        self.item('Pizza', '20.00')
        expect(self.page.locator('#grand-total')).to_have_text('£22.00')
        rate = self.page.locator('#service-rate')
        rate.fill('15')  # Input event, without Enter, Tab or blur
        expect(self.page.locator('#grand-total')).to_have_text('£23.00')
        expect(self.page.locator('#settings-total')).to_have_text('£23.00')
        expect(self.page.locator('#settings-service-info')).to_have_text('Including £3.00 service')
        rate.fill('12.5')
        expect(self.page.locator('#grand-total')).to_have_text('£22.50')
        rate.fill('105')
        expect(rate).to_have_attribute('aria-invalid', 'true')
        expect(self.page.locator('#grand-total')).to_have_text('£22.50')
        rate.press('Tab')
        expect(rate).to_have_value('12.5')
        self.page.locator('#receipt-total').fill('22.50')
        expect(self.page.locator('#reconciliation')).to_contain_text('Matches the printed')
        # The same browser localStorage state should survive a reload.
        self.load_app() if EMBEDDED_TEST else self.page.reload(wait_until='networkidle')
        expect(self.page.locator('#grand-total')).to_have_text('£22.50')
        expect(self.page.locator('#service-rate')).to_have_value('12.5')

    def test_scanned_dropdown_prefills_without_adding_and_manual_entry_is_independent(self):
        self.person('Alex')
        self.page.locator('details.paste-details summary').click()
        self.page.locator('#receipt-text').fill('Lemonade 3.50\nPasta 12.50\nTOTAL 16.00')
        self.page.get_by_role('button', name='Review pasted items').click()
        expect(self.page.locator('#item-count')).to_have_text('0 items')
        expect(self.page.locator('#item-suggestions option')).to_have_count(2)
        self.page.locator('#scanned-item-picker').select_option('0')
        expect(self.page.locator('#item-description')).to_have_value('Lemonade')
        expect(self.page.locator('#item-price')).to_have_value('3.50')
        expect(self.page.locator('#item-count')).to_have_text('0 items')
        self.page.locator('#item-description').fill('Fresh Lemonade')
        self.page.locator('#item-price').fill('3.00')
        self.page.locator('#save-item').click()
        expect(self.page.locator('#item-count')).to_have_text('1 item')
        expect(self.page.locator('.scan-row').nth(0).locator('.scan-state')).to_contain_text('Added to bill')
        expect(self.page.locator('.scan-row').nth(0).locator('.scan-add')).to_be_disabled()
        expect(self.page.locator('#scanned-item-picker option')).to_have_count(2)
        self.item('Manual Tea', '2.00')
        expect(self.page.locator('#items')).to_contain_text('Manual Tea')
        expect(self.page.locator('#grand-total')).to_have_text('£5.50')
        expect(self.page.locator('.scan-row').nth(1).locator('.scan-state')).to_have_text('Awaiting review')

    def test_scan_row_edit_skip_restore_and_invalid_price_never_commits(self):
        self.person('Alex')
        self.page.locator('details.paste-details summary').click()
        self.page.locator('#receipt-text').fill('Burg3r 14.50\nSoup 5.50')
        self.page.get_by_role('button', name='Review pasted items').click()
        rows = self.page.locator('.scan-row')
        rows.nth(1).get_by_role('button', name='Skip').click()
        expect(rows.nth(1).locator('.scan-state')).to_have_text('Skipped — not added')
        expect(self.page.locator('#scan-progress')).to_contain_text('1 skipped')
        rows.nth(0).locator('.scan-description').fill('Burger')
        rows.nth(0).locator('.scan-price').fill('??')
        rows.nth(0).get_by_role('button', name='Add to bill').click()
        expect(self.page.locator('#item-count')).to_have_text('0 items')
        expect(rows.nth(0).locator('.scan-state')).to_have_text('Awaiting review')
        expect(rows.nth(0).locator('.scan-row-error')).to_contain_text('valid positive price')
        rows.nth(0).locator('.scan-price').fill('14.00')
        rows.nth(0).get_by_role('button', name='Add to bill').click()
        expect(self.page.locator('#grand-total')).to_have_text('£15.40')
        expect(rows.nth(0).locator('.scan-add')).to_be_disabled()
        rows.nth(1).get_by_role('button', name='Restore item').click()
        rows.nth(1).get_by_role('button', name='Use in Add an item').click()
        expect(self.page.locator('#item-description')).to_have_value('Soup')
        expect(self.page.locator('#item-price')).to_have_value('5.50')
        expect(self.page.locator('#item-count')).to_have_text('1 item')
        self.page.locator('#save-item').click()
        expect(self.page.locator('#grand-total')).to_have_text('£21.45')
        expect(self.page.locator('#scan-progress')).to_have_text('2 added · 0 awaiting review · 0 skipped')

    def test_adding_diners_after_scanning_updates_receipt_owner_choices(self):
        self.page.locator('details.paste-details summary').click()
        self.page.locator('#receipt-text').fill('<svg onload=alert(1)> Latte 3.50')
        self.page.get_by_role('button', name='Review pasted items').click()
        expect(self.page.locator('.scan-row')).to_have_count(1)
        self.assertEqual(self.page.locator('.scan-row svg').count(), 0)
        self.person('Alex')
        self.person('Sam')
        owner = self.page.locator('.scan-row .scan-owner')
        owner.select_option(label='Alex')
        self.page.locator('.scan-row').get_by_role('button', name='Add to bill').click()
        expect(self.page.locator('#item-count')).to_have_text('1 item')
        self.assertEqual(self.page.locator('#items svg').count(), 0)
        expect(self.page.locator('#splits')).to_contain_text('Alex')
        self.page.set_viewport_size({'width': 320, 'height': 720})
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth - window.innerWidth'), 2)

    def test_mixed_legacy_rates_require_review_and_preserve_original(self):
        self.page.evaluate('''() => {
          localStorage.removeItem('dining.bill.v2');
          localStorage.setItem('expenses', JSON.stringify({ Alex: [
            {name:'Alex', itemCost:10, itemDescription:'Tea',serviceChargePercentage:.1},
            {name:'Alex', itemCost:20, itemDescription:'Food',serviceChargePercentage:.15}
          ] }));
        }''')
        self.load_app() if EMBEDDED_TEST else self.page.reload(wait_until='networkidle')
        expect(self.page.locator('#migration-notice')).to_be_visible()
        expect(self.page.locator('#grand-total')).to_have_text('Pending review')
        self.page.get_by_role('button', name='Use 15%').click()
        self.page.get_by_role('button', name='Apply current percentage to all items').click()
        expect(self.page.locator('#grand-total')).to_have_text('£34.50')
        self.assertIsNotNone(self.page.evaluate("localStorage.getItem('expenses')"))

    def test_template_creates_new_session_without_items(self):
        self.person('Alex')
        self.item('Coffee', '3.00')
        self.page.locator('#template-name').fill('Team lunch')
        self.page.locator('#template-form button').click()
        self.page.on('dialog', lambda d: d.accept())
        self.page.get_by_role('button', name='Start bill from Team lunch').click()
        expect(self.page.locator('#item-count')).to_have_text('0 items')
        expect(self.page.locator('#participants')).to_contain_text('Alex')

    def test_mobile_layout_and_untrusted_text(self):
        self.person('Alex')
        self.item('<img src=x onerror=alert(1)>', '3.50')
        expect(self.page.locator('.item-main strong')).to_have_text('<img src=x onerror=alert(1)>')
        self.assertEqual(self.page.locator('.item-main img').count(), 0)
        overflow = self.page.evaluate('document.documentElement.scrollWidth - window.innerWidth')
        self.assertLessEqual(overflow, 2, f'Mobile horizontal overflow: {overflow}px')
        self.page.set_viewport_size({'width': 1440, 'height': 900})
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth - window.innerWidth'), 2)

if __name__ == '__main__':
    unittest.main()
