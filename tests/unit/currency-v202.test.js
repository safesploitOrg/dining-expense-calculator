import test from 'node:test';
import assert from 'node:assert/strict';
import { createBill, addParticipant, addItem, calculateBill, validateBill } from '../../public/assets/js/domain/bill.js';
import { formatMoney, parsePence } from '../../public/assets/js/domain/money.js';
import { createTemplate, loadTemplates, saveTemplates } from '../../public/assets/js/storage.js';

test('GBP USD EUR all use exact 2-decimal minor units, without implicit FX conversion', () => {
  const bill = createBill();
  const person = addParticipant(bill, 'Alex');
  for (const currency of ['GBP', 'USD', 'EUR']) {
    bill.currency = currency;
    validateBill(bill);
    assert.equal(parsePence('18.99'), 1899);
    assert.match(formatMoney(1899, currency), /18\.99/);
  }
  bill.currency = 'USD';
  addItem(bill, { description: 'Salmon', pricePence: 1899, quantity: 1, participantIds: [person.id] });
  assert.equal(calculateBill(bill).grandTotalPence, 2089);
  assert.match(formatMoney(calculateBill(bill).grandTotalPence, 'USD'), /US\$20\.89/);
  assert.throws(() => formatMoney(100, 'JPY'), /Invalid/);
  bill.currency = 'ZZZ';
  assert.throws(() => validateBill(bill), /Invalid saved/);
});

test('templates remember currency and preserve pre-v2.0.2 GBP-only templates', () => {
  const bill = createBill();
  bill.currency = 'EUR';
  const t = createTemplate(bill, 'Weekend');
  assert.equal(t.currency, 'EUR');
  const data = new Map();
  const storage = {
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, val) { data.set(key, val); }
  };
  saveTemplates([t, { name: 'Old', serviceChargeBps: 1000, participantNames: [] }], storage);
  const templates = loadTemplates(storage);
  assert.deepEqual(templates.map(x => x.currency || 'GBP'), ['EUR', 'GBP']);
});
