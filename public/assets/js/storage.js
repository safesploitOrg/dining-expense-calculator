import { createBill, validateBill } from './domain/bill.js';
import { CURRENCY_SYMBOLS } from './domain/money.js';
import { migrateLegacy } from './domain/legacy.js';
export const BILL_KEY = 'dining.bill.v2';
export const LEGACY_KEY = 'expenses';
export const TEMPLATES_KEY = 'dining.templates.v2';

export function loadBill(storage = localStorage) {
  const current = storage.getItem(BILL_KEY);
  if (current !== null) {
    try { return { bill: validateBill(JSON.parse(current)), migrated: false, error: null }; }
    catch (error) { return { bill: createBill(), migrated: false,
      error: `The current saved bill could not be read (${error.message}). Its original data has NOT been overwritten.` }; }
  }
  const original = storage.getItem(LEGACY_KEY);
  if (original !== null) {
    try { return { bill: validateBill(migrateLegacy(JSON.parse(original))), migrated: true, error: null }; }
    catch (error) { return { bill: createBill(), migrated: false,
      error: `Legacy data could not be imported (${error.message}). Its original data has NOT been overwritten.` }; }
  }
  return { bill: createBill(), migrated: false, error: null };
}

export function saveBill(bill, storage = localStorage) {
  validateBill(bill);
  storage.setItem(BILL_KEY, JSON.stringify(bill));
}

export function loadTemplates(storage = localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(TEMPLATES_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(t => t && typeof t.name === 'string' && t.name.length <= 60 &&
      Array.isArray(t.participantNames) && t.participantNames.every(n => typeof n === 'string' && n.length <= 50) &&
      (!t.currency || Object.hasOwn(CURRENCY_SYMBOLS, t.currency)) &&
      Number.isInteger(t.serviceChargeBps) && t.serviceChargeBps >= 0 && t.serviceChargeBps <= 10000).slice(0, 20);
  } catch { return []; }
}

export function saveTemplates(templates, storage = localStorage) {
  if (!Array.isArray(templates) || templates.length > 20) throw new Error('Template limit reached.');
  storage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
}

export function createTemplate(bill, name) {
  const cleanName = String(name ?? '').trim().slice(0, 60);
  if (!cleanName) throw new Error('Please enter a template name.');
  return { name: cleanName, currency: bill.currency, serviceChargeBps: bill.serviceChargeBps,
    participantNames: bill.participants.map(p => p.name) };
}

export function applyTemplate(template) {
  const bill = createBill(template.name);
  bill.serviceChargeBps = template.serviceChargeBps;
  bill.currency = template.currency || 'GBP';
  // Import trusted validated user data only; names checked by addParticipant.
  return bill;
}
