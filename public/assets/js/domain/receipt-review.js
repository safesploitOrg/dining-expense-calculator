import { parsePence } from './money.js';

/** Validate a reviewed OCR line. Deliberately does not mutate or import bill items. */
export function reviewedReceiptItem({ description, price, participantIds }) {
  const name = String(description ?? '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 120) throw new Error('Review the item name (1–120 characters) before adding.');
  if (!Array.isArray(participantIds) || !participantIds.length || new Set(participantIds).size !== participantIds.length) {
    throw new Error('Add or select at least one diner before adding this receipt item.');
  }
  return {
    description: name,
    pricePence: parsePence(price),
    quantity: 1,
    participantIds: [...participantIds],
  };
}
