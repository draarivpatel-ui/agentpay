// Simulated agent tests: determinism, shape, and generation limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgent, CATALOG, AGENT_NAME } from '../js/agent.js';

const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);
const TIERS = ['guest', 'standard', 'verified', 'premium'];

test('the same seed and start timestamp produce identical proposals', () => {
  const a = runAgent(7, 5, T0);
  const b = runAgent(7, 5, T0);
  assert.deepEqual(a, b);
});

test('runAgent returns exactly the requested count', () => {
  assert.equal(runAgent(7, 5, T0).length, 5);
  assert.equal(runAgent(7, 1, T0).length, 1);
});

test('proposal ids are unique within a run', () => {
  const proposals = runAgent(42, 8, T0);
  assert.equal(new Set(proposals.map((p) => p.id)).size, proposals.length);
});

test('every amount is a positive finite number rounded to cents', () => {
  for (const p of runAgent(42, 10, T0)) {
    assert.ok(Number.isFinite(p.amount) && p.amount > 0, 'amount positive for ' + p.id);
    assert.ok(Math.abs(p.amount * 100 - Math.round(p.amount * 100)) < 1e-6, 'cents precision for ' + p.id);
  }
});

test('every merchant comes from the catalog', () => {
  const names = new Set(CATALOG.map((c) => c.merchant));
  for (const p of runAgent(42, 10, T0)) {
    assert.ok(names.has(p.merchant), 'catalog merchant for ' + p.id);
  }
});

test('every tier is one of the four known tiers', () => {
  for (const p of runAgent(42, 10, T0)) {
    assert.ok(TIERS.includes(p.tier), 'known tier for ' + p.id);
  }
});

test('timestamps are strictly increasing and after the start', () => {
  const proposals = runAgent(42, 8, T0);
  assert.ok(proposals[0].ts > T0);
  for (let i = 1; i < proposals.length; i++) {
    assert.ok(proposals[i].ts >= proposals[i - 1].ts, 'monotonic at ' + i);
  }
});

test('a different seed produces a different run', () => {
  const a = runAgent(7, 5, T0);
  const b = runAgent(8, 5, T0);
  assert.notDeepStrictEqual(a, b);
});

test('proposals carry the agent name, currency and item fields', () => {
  for (const p of runAgent(42, 6, T0)) {
    assert.equal(p.agent, AGENT_NAME);
    assert.equal(p.currency, 'USD');
    assert.equal(typeof p.item, 'string');
    assert.ok(p.item.length > 0);
    assert.equal(typeof p.category, 'string');
    assert.ok(p.category.length > 0);
  }
});

test('runAgent rejects invalid counts', () => {
  assert.throws(() => runAgent(7, 0, T0), /Count Must Be An Integer Of At Least One/);
  assert.throws(() => runAgent(7, 26, T0), /Count Is Capped At Twenty Five/);
});
