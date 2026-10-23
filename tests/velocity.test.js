// Velocity check tests: sliding window count and spend per merchant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { velocityFor, evaluatePolicies } from '../js/engine.js';

const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);
const MIN = 60000;

const proposal = (over = {}) => ({
  id: 'prop-1',
  merchant: 'Circuit Lane',
  category: 'Electronics',
  amount: 50,
  tier: 'standard',
  ts: T0,
  ...over
});

const entry = (merchant, amount, ts) => ({ merchant, amount, ts });

test('counts and sums same merchant entries inside the window', () => {
  const history = [
    entry('Circuit Lane', 50, T0 - 10 * MIN),
    entry('Circuit Lane', 50, T0 - 20 * MIN)
  ];
  const v = velocityFor(history, proposal(), 60);
  assert.equal(v.count, 2);
  assert.equal(v.spend, 100);
  assert.equal(v.windowMinutes, 60);
  assert.equal(v.cutoff, T0 - 60 * MIN);
});

test('entries older than the window are excluded', () => {
  const history = [entry('Circuit Lane', 50, T0 - 61 * MIN)];
  assert.equal(velocityFor(history, proposal(), 60).count, 0);
});

test('an entry at exactly the proposal timestamp is included', () => {
  const history = [entry('Circuit Lane', 50, T0)];
  assert.equal(velocityFor(history, proposal(), 60).count, 1);
});

test('an entry exactly at the cutoff has just left the window', () => {
  const history = [entry('Circuit Lane', 50, T0 - 60 * MIN)];
  const v = velocityFor(history, proposal(), 60);
  assert.equal(v.count, 0);
  assert.equal(v.spend, 0);
});

test('entries from other merchants are ignored', () => {
  const history = [entry('Northwind Supplies', 500, T0 - 5 * MIN)];
  const v = velocityFor(history, proposal(), 60);
  assert.equal(v.count, 0);
  assert.equal(v.spend, 0);
});

test('entries after the proposal timestamp are ignored', () => {
  const history = [entry('Circuit Lane', 50, T0 + 5 * MIN)];
  assert.equal(velocityFor(history, proposal(), 60).count, 0);
});

test('an empty history produces zero count and zero spend', () => {
  const v = velocityFor([], proposal(), 60);
  assert.equal(v.count, 0);
  assert.equal(v.spend, 0);
});

test('a wider window captures entries a narrower window misses', () => {
  const history = [entry('Circuit Lane', 50, T0 - 45 * MIN)];
  assert.equal(velocityFor(history, proposal(), 120).count, 1);
  assert.equal(velocityFor(history, proposal(), 30).count, 0);
});

test('malformed history entries are skipped without throwing', () => {
  const history = [
    null,
    { ts: 'not a number' },
    { merchant: 'Circuit Lane', amount: 10, ts: T0 - 5 * MIN }
  ];
  const v = velocityFor(history, proposal(), 60);
  assert.equal(v.count, 1);
  assert.equal(v.spend, 10);
});

test('the count cap fires at the boundary and not below it', () => {
  const policies = [{ name: 'V', maxAmount: 1000, maxTxPerWindow: 2, windowMinutes: 60, action: 'block' }];
  const two = [
    entry('Circuit Lane', 10, T0 - 10 * MIN),
    entry('Circuit Lane', 10, T0 - 20 * MIN)
  ];
  const one = [entry('Circuit Lane', 10, T0 - 10 * MIN)];
  const hit = evaluatePolicies(policies, proposal({ amount: 50 }), two);
  const pass = evaluatePolicies(policies, proposal({ amount: 50 }), one);
  assert.equal(hit.hits.some((h) => h.rule === 'velocity.count'), true);
  assert.equal(pass.hits.length, 0);
});

test('the spend cap fires above the boundary and not at it', () => {
  const policies = [{ name: 'S', maxAmount: 1000, maxSpendPerWindow: 100, action: 'review' }];
  const history = [entry('Circuit Lane', 80, T0 - 5 * MIN)];
  const atCap = evaluatePolicies(policies, proposal({ amount: 20 }), history);
  const overCap = evaluatePolicies(policies, proposal({ amount: 20.5 }), history);
  assert.equal(atCap.decision, 'approved');
  assert.equal(overCap.decision, 'review');
  assert.equal(overCap.hits[0].rule, 'velocity.spend');
});
