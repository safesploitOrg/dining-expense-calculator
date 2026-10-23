import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseReceiptText, parseOcrResult, tsvToPositionedLines } from '../../public/assets/js/receipt.js';

const noisyImageSample = readFileSync(new URL('../fixtures/menu-ocr-noisy.txt', import.meta.url), 'utf8');

function tsvFixture(lines) {
  const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';
  const out = [header];
  for (const [rowIndex, row] of lines.entries()) {
    let x = row.x;
    for (const [wordIndex, word] of row.text.split(/\s+/).entries()) {
      const width = Math.max(12, word.length * 9);
      out.push([5, 1, 1, 1, rowIndex + 1, wordIndex + 1, x, row.y, width, 22, row.conf ?? 94, word].join('\t'));
      x += width + 8;
    }
  }
  return out.join('\n');
}

test('reported menu image OCR text returns 20 candidates rather than zero (USD)', () => {
  const result = parseReceiptText(noisyImageSample, { mode: 'menu' });
  assert.equal(result.items.length, 20);
  assert.equal(result.detectedCurrency, 'USD');
  assert.deepEqual(result.currenciesFound, ['USD']);
  assert.deepEqual(result.items.filter(x => x.description === 'Grilled Salmon').map(x => x.pricePence), [1899]);
  assert.deepEqual(result.items.filter(x => x.description === 'Chicken Parmesan').map(x => x.pricePence), [1699]);
  assert.deepEqual(result.items.filter(x => x.description === 'Ribeye Steak').map(x => x.pricePence), [2499]);
  assert.deepEqual(result.items.filter(x => x.description === 'Coffee').map(x => x.pricePence), [249]);
  assert.equal(result.receiptTotalPence, null, 'menus never establish an owed amount');
  assert.ok(result.items.some(x => x.confidence === 'review'));
  assert.ok(result.warnings.some(w => /menu lists/i.test(w)));
});

test('two priced name/price pairs in a single text line do not merge', () => {
  const result = parseReceiptText('Mozzarella Sticks - $7.99 Ribeye Steak - $24.99\nCaesar Salad - $10.99 Coffee - $2.49', { mode: 'menu' });
  assert.deepEqual(result.items.map(x => [x.description, x.pricePence]), [
    ['Mozzarella Sticks', 799], ['Ribeye Steak', 2499], ['Caesar Salad', 1099], ['Coffee', 249],
  ]);
});

test('layout-aware OCR splits two menu columns, even when OCR merges a horizontal line', () => {
  const lines = [
    { x: 75, y: 120, text: 'Mozzarella Sticks - $7.99' },
    { x: 580, y: 120, text: 'Grilled Salmon - $18.99' },
    { x: 75, y: 180, text: 'Bruschetta - $6.99' },
    { x: 580, y: 180, text: 'Ribeye Steak - $24.99' },
  ];
  const raw = 'Mozzarella Sticks - $7.99 Grilled Salmon - $18.99\nBruschetta - $6.99 Ribeye Steak - $24.99';
  const result = parseOcrResult({ text: raw, tsv: tsvFixture(lines), width: 1100 }, { mode: 'menu' });
  assert.equal(result.items.length, 4);
  assert.equal(result.usedLayout, true);
  assert.deepEqual(result.items.map(x => x.description), ['Mozzarella Sticks', 'Bruschetta', 'Grilled Salmon', 'Ribeye Steak']);
  assert.deepEqual(result.items.map(x => x.pricePence), [799, 699, 1899, 2499]);
});

test('one-column receipt prices remain paired with item names; metadata is recognised', () => {
  const lines = [
    { x: 80, y: 100, text: 'Burger - £14.50' },
    { x: 80, y: 150, text: 'Fries - £4.00' },
    { x: 80, y: 200, text: 'TOTAL £18.50' },
  ];
  const scan = parseOcrResult({ text: lines.map(x => x.text).join('\n'), tsv: tsvFixture(lines), width: 1100 });
  assert.equal(scan.items.length, 2);
  assert.equal(scan.receiptTotalPence, 1850);
  assert.equal(scan.detectedCurrency, 'GBP');
  assert.equal(scan.warnings.some(x => /2 columns/.test(x)), false);
});

test('menu mode does not treat service charges, subtotal or total as menu dishes', () => {
  const result = parseReceiptText('Fish - €16,50\nService Charge €2,00\nSUB TOTAL €16,50\nTOTAL €18,50', { mode: 'menu' });
  assert.deepEqual(result.items.map(x => x.description), ['Fish']);
  assert.equal(result.detectedCurrency, 'EUR');
  assert.equal(result.receiptTotalPence, null);
  assert.equal(result.items[0].pricePence, 1650);
});

test('mixed currency is surfaced explicitly, never converted and ambiguous unmarked entries stay unassigned', () => {
  const result = parseReceiptText('Soup £5.00\nTea $3.50\nBread 1.00', { mode: 'receipt' });
  assert.deepEqual(result.currenciesFound, ['GBP', 'USD']);
  assert.equal(result.detectedCurrency, null);
  assert.equal(result.items[2].currency, null);
  assert.ok(result.warnings.some(w => /Mixed currencies/.test(w)));
});

test('invalid OCR TSV never causes the scanner to crash or hallucinate items', () => {
  assert.equal(tsvToPositionedLines('junk', 1024), null);
  assert.equal(tsvToPositionedLines('x'.repeat(900001), 1024), null);
  const result = parseOcrResult({ text: 'Pizza $9.99', tsv: 'bad', width: 1024 }, { mode: 'menu' });
  assert.equal(result.items.length, 1);
  assert.equal(result.usedLayout, false);
  assert.ok(result.warnings.some(w => /position data/.test(w)));
  assert.throws(() => parseReceiptText('Hello', { mode: 'invalid' }), /mode/i);
});

test('no price and malicious-looking names never auto-add or execute anything', () => {
  const scan = parseReceiptText('<img src=x onerror=alert(1)> Brownie $4.50\nNot a dish / CALL 020 111 333', { mode: 'menu' });
  assert.equal(scan.items.length, 1);
  assert.equal(scan.items[0].pricePence, 450);
  assert.match(scan.items[0].description, /Brownie/);
});

test('unmarked amount inherits unambiguous currency from priced item or printed total only', () => {
  const scan = parseReceiptText('Burger $5.00\nFries 2.50\nTOTAL $7.50', { mode: 'receipt' });
  assert.equal(scan.detectedCurrency, 'USD');
  assert.equal(scan.items[1].currency, 'USD');
  assert.equal(scan.receiptTotalPence, 750);
});

test('TSV text is always bounded and invalid/no-data falls back safely', () => {
  const data = parseOcrResult({ text: 'Menu with no visible price', tsv: null, width: 1000 }, { mode: 'menu' });
  assert.deepEqual(data.items, []);
  assert.ok(data.warnings.some(x => /No priced items/.test(x)));
});


test('incomplete geometry cannot silently discard most otherwise recognised candidates', () => {
  const lines = [{ x: 25, y: 30, text: 'Soup - $4.00' }];
  const scan = parseOcrResult({ text: 'Soup $4.00\nTea $2.00\nCake $5.00\nJuice $3.00',
    tsv: tsvFixture(lines), width: 1000 }, { mode: 'menu' });
  assert.equal(scan.items.length, 4);
  assert.equal(scan.usedLayout, false);
  assert.ok(scan.warnings.some(w => /Too few items/.test(w)));
});
