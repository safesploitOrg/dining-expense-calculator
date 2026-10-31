import { createBill, addParticipant, addItem } from './bill.js';

/** Converts original expenses localStorage dictionary. Does not mutate/delete the source. */
export function migrateLegacy(legacy) {
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) {
    throw new Error('Legacy expense data must be an object.');
  }
  const bill = createBill('Imported dining bill');
  const rates = new Set();
  const map = new Map();
  for (const [originalName, entries] of Object.entries(legacy)) {
    if (!Array.isArray(entries)) throw new Error('Legacy expense group has invalid rows.');
    const cleanName = originalName.trim() || 'Unnamed diner';
    let person = map.get(cleanName.toLocaleLowerCase('en-GB'));
    if (!person && entries.length) {
      person = addParticipant(bill, cleanName);
      map.set(cleanName.toLocaleLowerCase('en-GB'), person);
    }
    for (const expense of entries) {
      if (!expense || typeof expense !== 'object' ||
          !Number.isFinite(expense.itemCost) || expense.itemCost < 0 || expense.itemCost > 99999.99 ||
          !Number.isFinite(expense.serviceChargePercentage) || expense.serviceChargePercentage < 0 ||
          expense.serviceChargePercentage > 1) {
        throw new Error('Legacy expense contains invalid prices or service charges.');
      }
      // Legacy percentage is stored as a fraction (0.125 represents 12.5%).
      rates.add(Math.round(expense.serviceChargePercentage * 10000));
      addItem(bill, { description: String(expense.itemDescription || 'Unlabelled item'),
        pricePence: Math.round((expense.itemCost + Number.EPSILON) * 100), quantity: 1,
        participantIds: [person.id] });
    }
  }
  bill.legacyRatesBps = [...rates].sort((a, b) => a - b);
  if (rates.size === 1) bill.serviceChargeBps = bill.legacyRatesBps[0];
  else if (rates.size > 1) {
    bill.serviceChargeBps = 0; // No guessed global charge while the user reviews conflicting data.
    bill.requiresServiceReview = true;
  }
  return bill;
}
