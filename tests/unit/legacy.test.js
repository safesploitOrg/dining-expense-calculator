import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateLegacy } from '../../public/assets/js/domain/legacy.js';
import { calculateBill, addItem } from '../../public/assets/js/domain/bill.js';
import { loadBill, saveBill, loadTemplates, saveTemplates, createTemplate, BILL_KEY, LEGACY_KEY } from '../../public/assets/js/storage.js';
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem(key) { return data.get(key) ?? null; }, setItem(key, value) { data.set(key, value); }, removeItem(key) { data.delete(key); } };
}
test('imports original dictionary of items with a consistent service percentage', () => {
  const original = { Alex: [{ name: 'Alex', itemCost: 12.5, itemDescription: 'Pizza', serviceChargePercentage: 0.1 }],
    Sam: [{ name: 'Sam', itemCost: 7, itemDescription: 'Salad', serviceChargePercentage: 0.1 }] };
  const storage = fakeStorage({ [LEGACY_KEY]: JSON.stringify(original) });
  const result = loadBill(storage);
  assert.equal(result.migrated, true);
  assert.equal(result.bill.serviceChargeBps, 1000);
  assert.equal(calculateBill(result.bill).grandTotalPence, 2145);
  saveBill(result.bill, storage);
  assert.equal(storage.getItem(LEGACY_KEY), JSON.stringify(original));
  assert.ok(storage.getItem(BILL_KEY));
});
test('mixed historic rates are flagged and require deliberate selection', () => {
  const bill = migrateLegacy({ Alex: [
    { itemCost: 10, itemDescription: 'One', serviceChargePercentage: 0.1 },
    { itemCost: 20, itemDescription: 'Two', serviceChargePercentage: 0.15 }
  ] });
  assert.equal(bill.requiresServiceReview, true);
  assert.deepEqual(bill.legacyRatesBps, [1000, 1500]);
  assert.equal(bill.serviceChargeBps, 0);
  assert.equal(calculateBill(bill).subtotalPence, 3000);
});
test('invalid legacy input is not destroyed or silently overwritten', () => {
  const value = '{invalid json';
  const storage = fakeStorage({ [LEGACY_KEY]: value });
  const loaded = loadBill(storage);
  assert.match(loaded.error, /Legacy data could not be imported/);
  assert.equal(storage.getItem(LEGACY_KEY), value);
  assert.equal(storage.getItem(BILL_KEY), null);
});
test('invalid new-format input preserves original v2 data', () => {
  const storage = fakeStorage({ [BILL_KEY]: '{garbage', [LEGACY_KEY]: '{}' });
  const result = loadBill(storage);
  assert.ok(result.error);
  assert.equal(storage.getItem(BILL_KEY), '{garbage');
});
test('template persistence does not include line items and handles corrupted storage', () => {
  const bill = migrateLegacy({ Alex: [{ itemCost: 4, itemDescription: 'Tea', serviceChargePercentage: .125 }] });
  const tpl = createTemplate(bill, 'Lunch regulars');
  const storage = fakeStorage();
  saveTemplates([tpl], storage);
  const [loaded] = loadTemplates(storage);
  assert.equal(loaded.name, 'Lunch regulars');
  assert.equal(loaded.serviceChargeBps, 1250);
  assert.equal(JSON.stringify(loaded).includes('Tea'), false);
  storage.setItem('dining.templates.v2', '{bad');
  assert.deepEqual(loadTemplates(storage), []);
});
