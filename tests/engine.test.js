// Policy engine tests: normalization, matching, and end to end evaluation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePolicy,
  merchantMatches,
  categoryMatches,
  evaluatePolicies
} from '../js/engine.js';

const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);
const MIN = 60000;

const proposal = (over = {}) => ({
  id: 'prop-1',
  merchant: 'Circuit Lane',
  category: 'Electronics',
  amount: 80,
  tier: 'standard',
  ts: T0,
  ...over
});

test('normalizePolicy fills action, merchant and category defaults', () => {
  const p = normalizePolicy({ name: 'Office Cap', maxAmount: 500 });
  assert.equal(p.action, 'review');
  assert.equal(p.merchant, '*');
  assert.equal(p.category, '*');
});

test('normalizePolicy fills window and velocity defaults', () => {
  const p = normalizePolicy({ name: 'Office Cap', maxAmount: 500 });
  assert.equal(p.windowMinutes, 60);
  assert.equal(p.maxTxPerWindow, 5);
  assert.equal(p.maxSpendPerWindow, null);
});

test('normalizePolicy fills tier, hours and enabled defaults', () => {
  const p = normalizePolicy({ name: 'Office Cap', maxAmount: 500 });
  assert.equal(p.trustTierMin, 'guest');
  assert.deepEqual(p.allowedHours, [0, 24]);
  assert.equal(p.enabled, true);
});

test('normalizePolicy derives a slug id and keeps explicit ids', () => {
  assert.equal(normalizePolicy({ name: 'Electronics Ceiling', maxAmount: 900 }).id, 'electronics-ceiling');
  assert.equal(normalizePolicy({ id: 'custom-1', name: 'X', maxAmount: 10 }).id, 'custom-1');
});

test('normalizePolicy throws when the name is missing', () => {
  assert.throws(() => normalizePolicy({ maxAmount: 100 }), /Policy Name Is Required/);
});

test('normalizePolicy throws on a non positive ceiling', () => {
  assert.throws(() => normalizePolicy({ name: 'X', maxAmount: -5 }), /Max Amount Must Be A Positive Number/);
  assert.throws(() => normalizePolicy({ name: 'X', maxAmount: 'lots' }), /Max Amount Must Be A Positive Number/);
});

test('normalizePolicy throws on an unknown action', () => {
  assert.throws(() => normalizePolicy({ name: 'X', maxAmount: 10, action: 'deny' }), /Action Must Be Allow, Review, Or Block/);
});

test('normalizePolicy throws on an unknown trust tier', () => {
  assert.throws(() => normalizePolicy({ name: 'X', maxAmount: 10, trustTierMin: 'diamond' }), /Trust Tier Must Be/);
});

test('normalizePolicy throws when allowed hours run backwards', () => {
  assert.throws(() => normalizePolicy({ name: 'X', maxAmount: 10, allowedHours: [17, 9] }), /Allowed Hours Must Be/);
});

test('normalizePolicy throws on a zero or fractional velocity window', () => {
  assert.throws(() => normalizePolicy({ name: 'X', maxAmount: 10, windowMinutes: 0 }), /Window Minutes Must Be An Integer Of At Least One/);
  assert.throws(() => normalizePolicy({ name: 'X', maxAmount: 10, windowMinutes: 1.5 }), /Window Minutes Must Be An Integer Of At Least One/);
});

test('merchantMatches is case insensitive and supports the wildcard', () => {
  const p = normalizePolicy({ name: 'P', maxAmount: 100, merchant: 'Circuit Lane' });
  assert.equal(merchantMatches(p, { merchant: 'circuit lane' }), true);
  assert.equal(merchantMatches(p, { merchant: 'Globex' }), false);
  const any = normalizePolicy({ name: 'P', maxAmount: 100 });
  assert.equal(merchantMatches(any, { merchant: 'Anything At All' }), true);
});

test('categoryMatches is case insensitive and supports the wildcard', () => {
  const p = normalizePolicy({ name: 'P', maxAmount: 100, category: 'Electronics' });
  assert.equal(categoryMatches(p, { category: 'electronics' }), true);
  assert.equal(categoryMatches(p, { category: 'Food' }), false);
  const any = normalizePolicy({ name: 'P', maxAmount: 100 });
  assert.equal(categoryMatches(any, { category: 'Whatever' }), true);
});

test('a proposal under every limit is approved', () => {
  const r = evaluatePolicies([{ name: 'Everyday', maxAmount: 500, action: 'allow' }], proposal(), []);
  assert.equal(r.decision, 'approved');
  assert.equal(r.matched, 1);
  assert.equal(r.hits.length, 0);
  assert.equal(r.velocity.count, 0);
});

test('a block policy ceiling turns the decision to blocked', () => {
  const r = evaluatePolicies([{ name: 'Ceiling', maxAmount: 100, action: 'block' }], proposal({ amount: 250 }), []);
  assert.equal(r.decision, 'blocked');
  assert.equal(r.hits[0].rule, 'ceiling');
  assert.equal(r.hits[0].severity, 'block');
});

test('a review policy ceiling turns the decision to review', () => {
  const r = evaluatePolicies([{ name: 'Ceiling', maxAmount: 100, action: 'review' }], proposal({ amount: 250 }), []);
  assert.equal(r.decision, 'review');
  assert.equal(r.hits[0].rule, 'ceiling');
  assert.equal(r.hits[0].severity, 'review');
});

test('a proposal outside allowed hours is blocked by an hours rule', () => {
  const policies = [{ name: 'Hours', maxAmount: 1000, action: 'block', allowedHours: [9, 17] }];
  const night = evaluatePolicies(policies, proposal({ ts: Date.UTC(2026, 9, 23, 3, 0, 0) }), []);
  assert.equal(night.decision, 'blocked');
  assert.equal(night.hits[0].rule, 'hours');
});

test('a proposal inside allowed hours passes the hours rule', () => {
  const r = evaluatePolicies([{ name: 'Hours', maxAmount: 1000, action: 'block', allowedHours: [9, 17] }], proposal(), []);
  assert.equal(r.decision, 'approved');
});

test('a proposal below the minimum trust tier hits the tier rule', () => {
  const policies = [{ name: 'Gate', maxAmount: 1000, action: 'review', trustTierMin: 'verified' }];
  const r = evaluatePolicies(policies, proposal({ tier: 'guest' }), []);
  assert.equal(r.decision, 'review');
  assert.equal(r.hits[0].rule, 'tier');
});

test('a proposal at the required trust tier passes the tier rule', () => {
  const r = evaluatePolicies([{ name: 'Gate', maxAmount: 1000, action: 'review', trustTierMin: 'verified' }], proposal({ tier: 'verified' }), []);
  assert.equal(r.decision, 'approved');
});

test('a disabled policy is ignored entirely', () => {
  const r = evaluatePolicies([{ name: 'Off', maxAmount: 100, action: 'block', enabled: false }], proposal({ amount: 250 }), []);
  assert.equal(r.matched, 0);
  assert.equal(r.decision, 'review');
  assert.equal(r.hits[0].rule, 'no.match');
});

test('a proposal matching no policy falls to review with a no.match hit', () => {
  const r = evaluatePolicies([{ name: 'P', maxAmount: 100, action: 'block', merchant: 'Northwind Supplies' }], proposal({ amount: 250 }), []);
  assert.equal(r.matched, 0);
  assert.equal(r.decision, 'review');
  assert.equal(r.hits[0].rule, 'no.match');
});

test('a block severity hit wins over a review severity hit', () => {
  const policies = [
    { name: 'Review Cap', maxAmount: 50, action: 'review' },
    { name: 'Block Cap', maxAmount: 80, action: 'block' }
  ];
  const r = evaluatePolicies(policies, proposal({ amount: 100 }), []);
  assert.equal(r.decision, 'blocked');
  assert.equal(r.hits.length, 2);
});

test('the transaction count cap fires at the exact boundary', () => {
  const policies = [{ name: 'V', maxAmount: 1000, maxTxPerWindow: 2, windowMinutes: 60, action: 'block' }];
  const history = [
    { merchant: 'Circuit Lane', amount: 10, ts: T0 - 10 * MIN },
    { merchant: 'Circuit Lane', amount: 10, ts: T0 - 20 * MIN }
  ];
  const r = evaluatePolicies(policies, proposal({ amount: 50 }), history);
  assert.equal(r.decision, 'blocked');
  assert.equal(r.hits[0].rule, 'velocity.count');
});

test('the window spend cap fires when prior spend plus amount exceeds it', () => {
  const policies = [{ name: 'S', maxAmount: 1000, maxSpendPerWindow: 100, action: 'review' }];
  const history = [{ merchant: 'Circuit Lane', amount: 80, ts: T0 - 5 * MIN }];
  const r = evaluatePolicies(policies, proposal({ amount: 30 }), history);
  assert.equal(r.decision, 'review');
  assert.equal(r.hits[0].rule, 'velocity.spend');
});
