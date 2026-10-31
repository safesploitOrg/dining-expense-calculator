import { percentageOfPence, splitProportionally, CURRENCY_SYMBOLS } from './money.js';

export const SCHEMA_VERSION = 2;
export const MAX_PARTICIPANTS = 50;
export const MAX_ITEMS = 500;
export const MAX_PRICE_PENCE = 9999999;
export const MAX_QUANTITY = 99;

export function makeId(prefix = 'id') {
  if (typeof globalThis.crypto?.randomUUID === 'function') return `${prefix}-${globalThis.crypto.randomUUID()}`;
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}-${[...bytes].map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

export function createBill(title = 'New bill') {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: makeId('bill'),
    title,
    currency: 'GBP',
    serviceChargeBps: 1000,
    receiptTotalPence: null,
    requiresServiceReview: false,
    legacyRatesBps: [],
    participants: [],
    items: [],
    createdAt: new Date().toISOString(),
  };
}

export function validateBill(bill) {
  if (!bill || typeof bill !== 'object' || Array.isArray(bill) || bill.schemaVersion !== SCHEMA_VERSION ||
      typeof bill.id !== 'string' || typeof bill.title !== 'string' || bill.title.length > 100 ||
      !Object.hasOwn(CURRENCY_SYMBOLS, bill.currency) || !Number.isInteger(bill.serviceChargeBps) ||
      bill.serviceChargeBps < 0 || bill.serviceChargeBps > 10000 ||
      !(bill.receiptTotalPence === null || (Number.isSafeInteger(bill.receiptTotalPence) && bill.receiptTotalPence >= 0)) ||
      typeof bill.requiresServiceReview !== 'boolean' || !Array.isArray(bill.legacyRatesBps) ||
      !Array.isArray(bill.participants) || !Array.isArray(bill.items) ||
      bill.participants.length > MAX_PARTICIPANTS || bill.items.length > MAX_ITEMS) {
    throw new Error('Invalid saved bill format; the original data has been preserved.');
  }
  if (bill.legacyRatesBps.some(rate => !Number.isInteger(rate) || rate < 0 || rate > 10000)) {
    throw new Error('Invalid legacy service charge data.');
  }
  const ids = new Set();
  const names = new Set();
  for (const person of bill.participants) {
    if (!person || typeof person.id !== 'string' || !person.id || typeof person.name !== 'string' ||
        !person.name.trim() || person.name.length > 50 || ids.has(person.id) ||
        names.has(person.name.trim().toLocaleLowerCase('en-GB'))) throw new Error('Invalid saved participant.');
    ids.add(person.id);
    names.add(person.name.trim().toLocaleLowerCase('en-GB'));
  }
  const itemIds = new Set();
  for (const item of bill.items) {
    if (!item || typeof item.id !== 'string' || !item.id || itemIds.has(item.id) ||
        typeof item.description !== 'string' || !item.description.trim() || item.description.length > 120 ||
        !Number.isSafeInteger(item.pricePence) || item.pricePence < 0 || item.pricePence > MAX_PRICE_PENCE ||
        !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_QUANTITY ||
        !Array.isArray(item.participantIds) || item.participantIds.length === 0 ||
        item.participantIds.length !== new Set(item.participantIds).size ||
        item.participantIds.some(id => !ids.has(id))) throw new Error('Invalid saved item.');
    itemIds.add(item.id);
  }
  return bill;
}

export function addParticipant(bill, name) {
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!clean || clean.length > 50) throw new Error('Name must contain 1–50 characters.');
  if (bill.participants.length >= MAX_PARTICIPANTS) throw new Error('Maximum of 50 diners reached.');
  if (bill.participants.some(p => p.name.toLocaleLowerCase('en-GB') === clean.toLocaleLowerCase('en-GB'))) {
    throw new Error('That diner already exists. Select their name instead.');
  }
  const person = { id: makeId('person'), name: clean };
  bill.participants.push(person);
  return person;
}

export function removeParticipant(bill, id) {
  if (bill.items.some(item => item.participantIds.includes(id))) {
    throw new Error('This diner has allocated items. Reassign or remove those items first.');
  }
  const index = bill.participants.findIndex(person => person.id === id);
  if (index === -1) throw new Error('Diner not found.');
  bill.participants.splice(index, 1);
}

export function normaliseItem(bill, input, existingId = null) {
  const description = String(input.description ?? '').trim().replace(/\s+/g, ' ');
  const ids = input.participantIds;
  if (!description || description.length > 120) throw new Error('Description must contain 1–120 characters.');
  if (!Number.isSafeInteger(input.pricePence) || input.pricePence < 0 || input.pricePence > MAX_PRICE_PENCE) {
    throw new Error('Invalid item price.');
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_QUANTITY) {
    throw new Error('Quantity must be between 1 and 99.');
  }
  if (!Array.isArray(ids) || !ids.length || ids.length !== new Set(ids).size ||
      ids.some(id => !bill.participants.some(person => person.id === id))) {
    throw new Error('Select at least one valid diner for this item.');
  }
  return { id: existingId || makeId('item'), description, pricePence: input.pricePence,
    quantity: input.quantity, participantIds: [...ids] };
}

export function addItem(bill, input) {
  if (bill.items.length >= MAX_ITEMS) throw new Error('Maximum of 500 items reached.');
  const item = normaliseItem(bill, input);
  bill.items.push(item);
  return item;
}

export function editItem(bill, id, input) {
  const index = bill.items.findIndex(item => item.id === id);
  if (index < 0) throw new Error('Item not found.');
  bill.items[index] = normaliseItem(bill, input, id);
  return bill.items[index];
}

export function deleteItem(bill, id) {
  const index = bill.items.findIndex(item => item.id === id);
  if (index < 0) throw new Error('Item not found.');
  return bill.items.splice(index, 1)[0];
}

/** A bill-wide service calculation; ensures sum of all diner totals equals grand total. */
export function calculateBill(bill) {
  validateBill(bill);
  const shares = bill.participants.map(person => ({ id: person.id, name: person.name,
    subtotalPence: 0, servicePence: 0, totalPence: 0 }));
  const indexById = new Map(shares.map((share, index) => [share.id, index]));
  let subtotalPence = 0;
  for (const item of bill.items) {
    const lineTotal = item.pricePence * item.quantity;
    if (!Number.isSafeInteger(lineTotal)) throw new RangeError('Item line exceeds safe integer range.');
    subtotalPence += lineTotal;
    const portions = splitProportionally(lineTotal, item.participantIds.map(() => 1));
    item.participantIds.forEach((id, i) => { shares[indexById.get(id)].subtotalPence += portions[i]; });
  }
  const servicePence = percentageOfPence(subtotalPence, bill.serviceChargeBps);
  const servicePortions = splitProportionally(servicePence, shares.map(share => share.subtotalPence));
  shares.forEach((share, index) => {
    share.servicePence = servicePortions[index];
    share.totalPence = share.subtotalPence + share.servicePence;
  });
  const grandTotalPence = subtotalPence + servicePence;
  return { shares, subtotalPence, servicePence, grandTotalPence,
    differencePence: bill.receiptTotalPence === null ? null : grandTotalPence - bill.receiptTotalPence };
}
