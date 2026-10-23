/** Integer-penny monetary helpers. No JavaScript floating-point currency addition. */
export const CURRENCY_SYMBOLS = Object.freeze({ GBP: '£', USD: '$', EUR: '€' });
const FORMATTERS = Object.fromEntries(Object.keys(CURRENCY_SYMBOLS).map(currency =>
  [currency, new Intl.NumberFormat('en-GB', { style: 'currency', currency })]));
export const GBP = FORMATTERS.GBP;

export function formatMoney(pence, currency = 'GBP') {
  if (!Number.isSafeInteger(pence) || !FORMATTERS[currency]) throw new RangeError('Invalid currency or minor-unit amount');
  // Explicit labels for USD distinguish it clearly from UK pounds.
  return FORMATTERS[currency].format(pence / 100);
}


export function formatGBP(pence) {
  if (!Number.isSafeInteger(pence)) throw new RangeError('Invalid amount in pennies');
  return formatMoney(pence, 'GBP');
}

export function parsePence(value) {
  const normalized = String(value ?? '').trim().replace(/^[£$€]\s*/, '').replace(',', '.');
  if (!/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(normalized)) {
    throw new RangeError('Enter a valid positive price (e.g. 12.50), up to 99,999.99.');
  }
  const [whole, fractional = ''] = normalized.split('.');
  return Number(whole) * 100 + Number(fractional.padEnd(2, '0'));
}

export function parsePercentageBps(value) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(normalized)) {
    throw new RangeError('Enter a percentage from 0 to 100, with at most two decimal places.');
  }
  const [whole, fraction = ''] = normalized.split('.');
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (bps > 10000) throw new RangeError('Service charge must not exceed 100%.');
  return bps;
}

export function displayPercentage(bps) {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new RangeError('Invalid percentage');
  return String(bps / 100);
}

// Half-up rounding, using exact integer arithmetic.
export function percentageOfPence(pence, bps) {
  if (!Number.isSafeInteger(pence) || pence < 0 || !Number.isInteger(bps) || bps < 0 || bps > 10000) {
    throw new RangeError('Invalid percentage calculation');
  }
  return Number((BigInt(pence) * BigInt(bps) + 5000n) / 10000n);
}

/** Distribute integer pennies by non-negative integer weights using largest remainders. */
export function splitProportionally(totalPence, weights) {
  if (!Number.isSafeInteger(totalPence) || totalPence < 0 || !Array.isArray(weights) ||
      weights.some(weight => !Number.isSafeInteger(weight) || weight < 0)) {
    throw new RangeError('Invalid split');
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(sum) || (totalPence > 0 && sum === 0)) throw new RangeError('Cannot split without weights');
  if (sum === 0) return weights.map(() => 0);
  const divisor = BigInt(sum);
  const exact = weights.map(weight => BigInt(totalPence) * BigInt(weight));
  const result = exact.map(value => Number(value / divisor));
  let remainder = totalPence - result.reduce((a, b) => a + b, 0);
  const order = weights.map((_, index) => index).sort((a, b) => {
    const fractionA = exact[a] % divisor;
    const fractionB = exact[b] % divisor;
    return fractionA === fractionB ? a - b : (fractionA > fractionB ? -1 : 1);
  });
  for (const index of order) {
    if (remainder-- <= 0) break;
    result[index] += 1;
  }
  return result;
}
