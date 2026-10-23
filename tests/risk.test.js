// Risk scoring tests: deterministic composite score and decision mapping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicies, riskScore } from '../js/engine.js';

const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);

const proposal = (over = {}) => ({
  id: 'prop-1',
  merchant: 'Circuit Lane',
  category: 'Electronics',
  amount: 80,
  tier: 'standard',
  ts: T0,
  ...over
});

const cleanEval = {
  decision: 'approved',
  matched: 1,
  hits: [],
  velocity: { windowMinutes: 60, count: 0, spend: 0, cutoff: T0 - 3600000 }
};

test('a clean standard tier proposal scores exactly 62 and approves', () => {
  const r = riskScore(proposal(), cleanEval);
  assert.equal(r.score, 62);
  assert.equal(r.decision, 'approved');
  assert.equal(r.signals.base, 62);
  assert.equal(r.signals.hitPenalty, 0);
});

test('risk scoring is deterministic across repeated calls', () => {
  const a = riskScore(proposal(), cleanEval);
  const b = riskScore(proposal(), cleanEval);
  assert.deepEqual(a, b);
  const policies = [{ name: 'Everyday', maxAmount: 500, action: 'allow' }];
  const e1 = riskScore(proposal(), evaluatePolicies(policies, proposal(), []));
  const e2 = riskScore(proposal(), evaluatePolicies(policies, proposal(), []));
  assert.deepEqual(e1, e2);
});

test('a guest tier large amount drops to 28 and reviews', () => {
  const r = riskScore(proposal({ amount: 5000, tier: 'guest' }), cleanEval);
  assert.equal(r.score, 28);
  assert.equal(r.decision, 'review');
  assert.equal(r.signals.tierAdjust, -14);
  assert.equal(r.signals.amountPenalty, 20);
});

test('a premium tier small amount rises to 76 and approves', () => {
  const r = riskScore(proposal({ tier: 'premium' }), cleanEval);
  assert.equal(r.score, 76);
  assert.equal(r.decision, 'approved');
  assert.equal(r.signals.tierAdjust, 14);
});

test('the score clamps at zero under stacked penalties', () => {
  const evalBlocked = {
    decision: 'blocked',
    matched: 1,
    hits: [{ severity: 'block' }, { severity: 'review' }],
    velocity: null
  };
  const r = riskScore(proposal({ amount: 5000, tier: 'guest' }), evalBlocked);
  assert.equal(r.score, 0);
  assert.equal(r.decision, 'blocked');
});

test('the score never leaves the zero to one hundred band', () => {
  for (const tier of ['guest', 'standard', 'verified', 'premium']) {
    const r = riskScore(proposal({ tier }), cleanEval);
    assert.ok(r.score >= 0 && r.score <= 100, 'score in band for ' + tier);
  }
});

test('a velocity count of eight costs twenty four points and reviews', () => {
  const evalBusy = { ...cleanEval, velocity: { windowMinutes: 60, count: 8, spend: 0, cutoff: T0 } };
  const r = riskScore(proposal(), evalBusy);
  assert.equal(r.score, 38);
  assert.equal(r.decision, 'review');
  assert.equal(r.signals.velocityPenalty, 24);
});

test('a velocity count of five costs twelve points and still approves', () => {
  const evalWarm = { ...cleanEval, velocity: { windowMinutes: 60, count: 5, spend: 0, cutoff: T0 } };
  const r = riskScore(proposal(), evalWarm);
  assert.equal(r.score, 50);
  assert.equal(r.decision, 'approved');
});

test('a review hit costs ten points and the decision stays review', () => {
  const evalReview = { ...cleanEval, decision: 'review', hits: [{ severity: 'review' }] };
  const r = riskScore(proposal(), evalReview);
  assert.equal(r.score, 52);
  assert.equal(r.decision, 'review');
});

test('a policy block verdict wins even when the composite score is high', () => {
  const evalBlocked = { ...cleanEval, decision: 'blocked', hits: [{ severity: 'block' }] };
  const r = riskScore(proposal({ tier: 'premium' }), evalBlocked);
  assert.equal(r.score, 54);
  assert.equal(r.decision, 'blocked');
});

test('the amount penalty starts at one hundred dollars and caps at twenty', () => {
  assert.equal(riskScore(proposal({ amount: 99 }), cleanEval).score, 62);
  assert.equal(riskScore(proposal({ amount: 100 }), cleanEval).score, 60);
  const big = riskScore(proposal({ amount: 1000 }), cleanEval);
  assert.equal(big.score, 42);
  assert.equal(big.decision, 'review');
  assert.equal(big.signals.amountPenalty, 20);
});

test('allow severity hits are informational and cost four points', () => {
  const evalInfo = { ...cleanEval, hits: [{ severity: 'allow' }] };
  const r = riskScore(proposal(), evalInfo);
  assert.equal(r.score, 58);
  assert.equal(r.decision, 'approved');
});

test('the hit penalty caps at forty points', () => {
  const evalBlocked = {
    decision: 'blocked',
    matched: 2,
    hits: [
      { severity: 'block' },
      { severity: 'block' },
      { severity: 'block' },
      { severity: 'block' }
    ],
    velocity: null
  };
  const r = riskScore(proposal({ amount: 5000, tier: 'guest' }), evalBlocked);
  assert.equal(r.signals.hitPenalty, 40);
  assert.equal(r.score, 0);
  assert.equal(r.decision, 'blocked');
});
