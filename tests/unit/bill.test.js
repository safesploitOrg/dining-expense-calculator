import test from 'node:test';
import assert from 'node:assert/strict';
import { createBill, addParticipant, removeParticipant, addItem, editItem, deleteItem, calculateBill, validateBill } from '../../public/assets/js/domain/bill.js';

function fixture() {
  const bill = createBill('Dinner');
  const alex = addParticipant(bill, 'Alex');
  const sam = addParticipant(bill, 'Sam');
  const jamie = addParticipant(bill, 'Jamie');
  return { bill, alex, sam, jamie };
}
test('global service rate recalculates every existing item without mutation', () => {
  const { bill, alex, sam } = fixture();
  addItem(bill, { description: 'Pizza', pricePence: 4000, quantity: 1, participantIds: [alex.id] });
  addItem(bill, { description: 'Salad', pricePence: 3500, quantity: 1, participantIds: [sam.id] });
  addItem(bill, { description: 'Soup', pricePence: 2500, quantity: 1, participantIds: [alex.id] });
  const originalItems = structuredClone(bill.items);
  assert.equal(calculateBill(bill).grandTotalPence, 11000);
  bill.serviceChargeBps = 1500;
  const total = calculateBill(bill);
  assert.equal(total.grandTotalPence, 11500);
  assert.equal(total.servicePence, 1500);
  assert.deepEqual(bill.items, originalItems);
  assert.equal(total.shares.reduce((s, p) => s + p.totalPence, 0), total.grandTotalPence);
});
test('shared single penny is allocated deterministically and never lost', () => {
  const { bill, alex, sam, jamie } = fixture();
  addItem(bill, { description: 'Shared', pricePence: 1, quantity: 1, participantIds: [alex.id, sam.id, jamie.id] });
  bill.serviceChargeBps = 0;
  assert.deepEqual(calculateBill(bill).shares.map(p => p.totalPence), [1, 0, 0]);
});
test('proportional service pennies allocated to participants with exact reconciliation', () => {
  const { bill, alex, sam, jamie } = fixture();
  addItem(bill, { description: 'For Alex', pricePence: 101, quantity: 1, participantIds: [alex.id] });
  addItem(bill, { description: 'For Sam', pricePence: 199, quantity: 1, participantIds: [sam.id] });
  addItem(bill, { description: 'Shared pudding', pricePence: 499, quantity: 1, participantIds: [alex.id, sam.id, jamie.id] });
  bill.serviceChargeBps = 1250;
  bill.receiptTotalPence = 899;
  const total = calculateBill(bill);
  assert.equal(total.subtotalPence, 799);
  assert.equal(total.servicePence, 100);
  assert.equal(total.grandTotalPence, 899);
  assert.equal(total.differencePence, 0);
  assert.equal(total.shares.reduce((a, p) => a + p.totalPence, 0), 899);
  assert.equal(total.shares.reduce((a, p) => a + p.servicePence, 0), 100);
});
test('updates/deletes an item by stable ID', () => {
  const { bill, alex } = fixture();
  const item = addItem(bill, { description: 'Coke', pricePence: 300, quantity: 1, participantIds: [alex.id] });
  editItem(bill, item.id, { description: 'Diet Coke', pricePence: 350, quantity: 2, participantIds: [alex.id] });
  assert.equal(bill.items[0].id, item.id);
  assert.equal(calculateBill(bill).subtotalPence, 700);
  deleteItem(bill, item.id);
  assert.equal(calculateBill(bill).grandTotalPence, 0);
});
test('rejects duplicate names, missing participants, unsafe quantities, and removal while in use', () => {
  const { bill, alex } = fixture();
  assert.throws(() => addParticipant(bill, 'alex'));
  assert.throws(() => addItem(bill, { description: 'Item', pricePence: 10, quantity: 1, participantIds: [] }));
  assert.throws(() => addItem(bill, { description: 'Item', pricePence: 10, quantity: 0, participantIds: [alex.id] }));
  assert.throws(() => addItem(bill, { description: 'Item', pricePence: 10, quantity: 1, participantIds: ['bogus'] }));
  addItem(bill, { description: '<script>evil()</script>', pricePence: 10, quantity: 1, participantIds: [alex.id] });
  assert.throws(() => removeParticipant(bill, alex.id));
  assert.ok(validateBill(bill));
});
test('no participants/items is a valid £0 bill', () => {
  const total = calculateBill(createBill());
  assert.equal(total.grandTotalPence, 0);
  assert.deepEqual(total.shares, []);
});
