// Audit ledger tests: immutable append, hash chaining, verification, diffing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { append, verifyChain, diff, hashFor } from '../js/ledger.js';

const base = (over = {}) => ({
  ts: 1000,
  actor: 'owner',
  action: 'decision.approved',
  entity: 'proposal:prop-1',
  ...over
});

test('append returns a new array and never mutates the input', () => {
  const entries = [];
  const r1 = append(entries, base());
  assert.equal(entries.length, 0);
  assert.equal(r1.length, 1);
});

test('the first entry gets sequence one and the genesis prev hash', () => {
  const r1 = append([], base());
  assert.equal(r1[0].seq, 1);
  assert.equal(r1[0].prevHash, 'genesis');
  assert.equal(r1[0].ts, 1000);
  assert.equal(r1[0].actor, 'owner');
  assert.equal(r1[0].action, 'decision.approved');
  assert.equal(r1[0].entity, 'proposal:prop-1');
});

test('entry hashes are eight character hex strings', () => {
  const r1 = append([], base());
  assert.match(r1[0].hash, /^[0-9a-f]{8}$/);
});

test('the second entry links back to the first hash', () => {
  const r1 = append([], base());
  const r2 = append(r1, base({ ts: 2000, action: 'checkout.simulated' }));
  assert.equal(r2.length, 2);
  assert.equal(r2[1].seq, 2);
  assert.equal(r2[1].prevHash, r1[0].hash);
});

test('a chain of three entries verifies', () => {
  let entries = append([], base());
  entries = append(entries, base({ ts: 2000, action: 'checkout.simulated', entity: 'order:SIM-1' }));
  entries = append(entries, base({ ts: 3000, action: 'policy.updated', entity: 'policy:p1' }));
  assert.equal(verifyChain(entries), true);
});

test('a tampered action breaks verification', () => {
  let entries = append([], base());
  entries = append(entries, base({ ts: 2000 }));
  const tampered = entries.map((e, i) => (i === 0 ? { ...e, action: 'tampered' } : e));
  assert.equal(verifyChain(tampered), false);
});

test('a tampered hash breaks verification', () => {
  let entries = append([], base());
  entries = append(entries, base({ ts: 2000 }));
  const tampered = entries.map((e, i) => (i === 1 ? { ...e, hash: 'deadbeef' } : e));
  assert.equal(verifyChain(tampered), false);
});

test('removing a middle entry breaks the sequence check', () => {
  let entries = append([], base());
  entries = append(entries, base({ ts: 2000 }));
  entries = append(entries, base({ ts: 3000 }));
  const removed = entries.slice(1);
  assert.equal(verifyChain(removed), false);
});

test('append requires a nonempty actor', () => {
  assert.throws(() => append([], { action: 'a', entity: 'e', ts: 1 }), /Actor Is Required/);
});

test('append requires a nonempty action', () => {
  assert.throws(() => append([], { actor: 'owner', entity: 'e', ts: 1 }), /Action Is Required/);
});

test('append requires a nonempty entity', () => {
  assert.throws(() => append([], { actor: 'owner', action: 'a', ts: 1 }), /Entity Is Required/);
});

test('append requires a finite numeric timestamp', () => {
  assert.throws(() => append([], base({ ts: '1000' })), /Timestamp Must Be A Finite Number/);
});

test('before and after default to null', () => {
  const r1 = append([], base());
  assert.equal(r1[0].before, null);
  assert.equal(r1[0].after, null);
});

test('provided before and after states are preserved', () => {
  const r1 = append([], base({ before: { status: 'Pending' }, after: { status: 'Approved' } }));
  assert.deepEqual(r1[0].before, { status: 'Pending' });
  assert.deepEqual(r1[0].after, { status: 'Approved' });
});

test('diff reports removed, changed and added fields sorted by name', () => {
  const changes = diff({ a: 1, b: 2 }, { b: 3, c: 4 });
  assert.equal(changes.length, 3);
  assert.equal(changes[0].field, 'a');
  assert.equal(changes[0].kind, 'removed');
  assert.equal(changes[1].field, 'b');
  assert.equal(changes[1].kind, 'changed');
  assert.equal(changes[1].from, 2);
  assert.equal(changes[1].to, 3);
  assert.equal(changes[2].field, 'c');
  assert.equal(changes[2].kind, 'added');
});

test('diff against a null before state marks everything added', () => {
  const changes = diff(null, { x: 1, y: 2 });
  assert.equal(changes.length, 2);
  assert.equal(changes[0].kind, 'added');
  assert.equal(changes[1].kind, 'added');
});

test('diff of identical states is empty', () => {
  assert.deepEqual(diff({ a: 1, b: 'x' }, { a: 1, b: 'x' }), []);
});

test('diff detects a nested object change', () => {
  const changes = diff({ limits: { max: 10 } }, { limits: { max: 20 } });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].field, 'limits');
  assert.equal(changes[0].kind, 'changed');
});

test('hashFor is deterministic and input sensitive', () => {
  assert.equal(hashFor('abc'), hashFor('abc'));
  assert.notEqual(hashFor('abc'), hashFor('abd'));
});
