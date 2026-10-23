import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptText, OCR_SCRIPT_URL } from '../../public/assets/js/receipt.js';

test('recognises purchased items, total and service without double-counting', () => {
  const scan = parseReceiptText('BURGER 14.50\nFRIES 4.00\nService charge 12.5% 2.31\nTOTAL 20.81');
  assert.deepEqual(scan.items.map(i => i.pricePence), [1450, 400]);
  assert.equal(scan.suggestedServiceBps, 1250);
  assert.equal(scan.printedServicePence, 231);
  assert.equal(scan.receiptTotalPence, 2081);
});
test('derives optional service rate from subtotal and printed service amount', () => {
  const scan = parseReceiptText('Tea 4.00\nCake 6.00\nSub Total 10.00\nService Charge 1.25\nGrand Total 11.25\nVAT 1.86');
  assert.equal(scan.items.length, 2);
  assert.equal(scan.suggestedServiceBps, 1250);
  assert.equal(scan.receiptTotalPence, 1125);
});
test('does not mistake date/VAT/cash/total for purchased items', () => {
  const scan = parseReceiptText('2026-10-23 13:35\nVAT 0.60\nCash 5.00\nTotal 5.00\nTable 12 10.00\nSoup 5.00');
  assert.deepEqual(scan.items.map(x => x.description), ['Soup']);
});
test('reports empty and inconsistent OCR data without inventing items', () => {
  const missing = parseReceiptText('Unreadable faded receipt');
  assert.equal(missing.items.length, 0);
  assert.ok(missing.warnings.some(message => /No priced items/.test(message)));
  const mismatch = parseReceiptText('Food 5.00\nSubtotal 10.00');
  assert.ok(mismatch.warnings.some(message => /do not match/.test(message)));
});
test('bounds untrusted receipt text length and pins the external OCR script', () => {
  assert.throws(() => parseReceiptText('x'.repeat(18001)));
  assert.match(OCR_SCRIPT_URL, /tesseract\.js@7\.0\.0/);
});
