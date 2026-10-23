import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewedReceiptItem } from '../../public/assets/js/domain/receipt-review.js';
import { createBill, addParticipant, addItem, calculateBill } from '../../public/assets/js/domain/bill.js';

test('reviewed OCR description and price are corrected before explicit commit', () => {
  const bill = createBill();
  const alex = addParticipant(bill, 'Alex');
  const draft = reviewedReceiptItem({ description: '  Burg3r  Meal ', price: '14,50', participantIds: [alex.id] });
  assert.equal(draft.description, 'Burg3r Meal');
  assert.equal(draft.pricePence, 1450);
  assert.equal(bill.items.length, 0, 'preview is not a bill mutation');
  draft.description = 'Burger Meal';
  draft.pricePence = 1400;
  addItem(bill, draft);
  assert.equal(bill.items.length, 1);
  assert.equal(calculateBill(bill).grandTotalPence, 1540);
});

test('malformed OCR names, prices, and missing diner cannot be approved', () => {
  const base = { description: 'Soup', price: '5.50', participantIds: ['alex'] };
  assert.throws(() => reviewedReceiptItem({ ...base, description: '' }), /item name/i);
  assert.throws(() => reviewedReceiptItem({ ...base, price: '£1,2,3' }), /price/i);
  assert.throws(() => reviewedReceiptItem({ ...base, price: 'not a number' }), /price/i);
  assert.throws(() => reviewedReceiptItem({ ...base, participantIds: [] }), /diner/i);
  assert.throws(() => reviewedReceiptItem({ ...base, participantIds: ['alex', 'alex'] }), /diner/i);
});

test('reviewed OCR input keeps multi-diner assignments but never overrides manual items', () => {
  const bill = createBill();
  const alex = addParticipant(bill, 'Alex');
  const sam = addParticipant(bill, 'Sam');
  addItem(bill, { description: 'Hand entered tea', pricePence: 220, quantity: 1, participantIds: [alex.id] });
  const draft = reviewedReceiptItem({ description: 'Fries', price: '4.00', participantIds: [alex.id, sam.id] });
  assert.deepEqual(draft.participantIds, [alex.id, sam.id]);
  assert.equal(bill.items.length, 1);
  addItem(bill, draft);
  assert.equal(bill.items[0].description, 'Hand entered tea');
  assert.equal(bill.items.length, 2);
  assert.equal(calculateBill(bill).grandTotalPence, 682);
});
