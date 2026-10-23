import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePence, parsePercentageBps, displayPercentage, formatGBP, percentageOfPence, splitProportionally } from '../../public/assets/js/domain/money.js';

test('accepts ordinary prices as exact integer pennies', () => {
  assert.equal(parsePence('£12.50'), 1250);
  assert.equal(parsePence('12,50'), 1250);
  assert.equal(parsePence('0.01'), 1);
  assert.equal(parsePence('1'), 100);
  assert.equal(parsePence('99999.99'), 9999999);
  assert.equal(formatGBP(1250), '£12.50');
});
test('rejects invalid/ambiguous monetary values', () => {
  for (const input of ['12.345', '12,345', '-1.00', '1.2.3', 'Infinity', '1e9', '1,234.50', '100000', '', '£ABC']) {
    assert.throws(() => parsePence(input), RangeError, input);
  }
});
test('supports 12.5% as basis points, rejecting oversized rates', () => {
  assert.equal(parsePercentageBps('12.5'), 1250);
  assert.equal(parsePercentageBps('12,50'), 1250);
  assert.equal(displayPercentage(1250), '12.5');
  for (const input of ['101', '12.345', '-1', '', 'NaN']) assert.throws(() => parsePercentageBps(input));
});
test('rounds service charge once, half up, in exact pennies', () => {
  assert.equal(percentageOfPence(5, 1000), 1);
  assert.equal(percentageOfPence(4, 1000), 0);
  assert.equal(percentageOfPence(10000, 1250), 1250);
  assert.equal(percentageOfPence(500000000000, 1250), 62500000000);
});
test('largest-remainder sharing handles pennies and exact sums', () => {
  assert.deepEqual(splitProportionally(2, [1, 1, 1]), [1, 1, 0]);
  assert.deepEqual(splitProportionally(11, [1, 1, 1]), [4, 4, 3]);
  assert.deepEqual(splitProportionally(0, [0, 0]), [0, 0]);
  assert.throws(() => splitProportionally(1, [0, 0]));
});
test('deterministic property check: all splits sum to total', () => {
  for (let total = 0; total < 1000; total += 7) {
    for (let diners = 1; diners <= 12; diners++) {
      const weights = Array.from({ length: diners }, (_, index) => index + 1);
      assert.equal(splitProportionally(total, weights).reduce((a, b) => a + b, 0), total);
    }
  }
});
