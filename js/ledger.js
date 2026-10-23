// AgentPay audit ledger.
// Append only, hash chained entries. append() never mutates the array it is
// given: it returns a new array with one more record. Hashes are FNV 1a 32
// bit, which is not cryptographic, and this file says so: the chain exists to
// make tampering visible in a demo, not to resist a determined attacker.

const GENESIS = 'genesis';

export function hashFor(payload) {
  let h = 0x811c9dc5;
  const text = String(payload);
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function canonicalize(record) {
  return JSON.stringify({
    seq: record.seq,
    ts: record.ts,
    actor: record.actor,
    action: record.action,
    entity: record.entity,
    before: record.before,
    after: record.after,
    prevHash: record.prevHash
  });
}

function requireText(entry, field) {
  const value = entry[field];
  if (typeof value !== 'string' || value.trim() === '') {
    const label = field.charAt(0).toUpperCase() + field.slice(1);
    throw new TypeError(label + ' Is Required');
  }
  return value;
}

// Append one validated entry. Fields required on the input: actor, action,
// entity (nonempty strings) and ts (a finite number). before and after are
// optional and default to null. The new record carries seq, prevHash and hash.
export function append(entries, entry) {
  if (!Array.isArray(entries)) {
    throw new TypeError('Entries Must Be An Array');
  }
  if (!entry || typeof entry !== 'object') {
    throw new TypeError('Entry Must Be An Object');
  }
  const actor = requireText(entry, 'actor');
  const action = requireText(entry, 'action');
  const entity = requireText(entry, 'entity');
  if (!Number.isFinite(entry.ts)) {
    throw new TypeError('Timestamp Must Be A Finite Number');
  }
  const before = entry.before === undefined ? null : entry.before;
  const after = entry.after === undefined ? null : entry.after;
  const prev = entries.length > 0 ? entries[entries.length - 1] : null;
  const record = {
    seq: prev ? prev.seq + 1 : 1,
    ts: entry.ts,
    actor,
    action,
    entity,
    before,
    after,
    prevHash: prev ? prev.hash : GENESIS
  };
  record.hash = hashFor(canonicalize(record));
  return entries.concat([record]);
}

// Recompute every hash and every link. Returns true only when the whole chain
// is intact: sequence numbers run 1..n, each prevHash matches the previous
// hash, and each stored hash matches the record contents.
export function verifyChain(entries) {
  if (!Array.isArray(entries)) return false;
  let prevHash = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || typeof e !== 'object') return false;
    if (e.seq !== i + 1) return false;
    if (e.prevHash !== prevHash) return false;
    if (e.hash !== hashFor(canonicalize(e))) return false;
    prevHash = e.hash;
  }
  return true;
}

// Compare two state snapshots field by field. Returns changes sorted by field
// name, each as { field, kind, from, to } with kind one of added, removed,
// changed. Nested objects are compared by JSON text, which is deterministic
// here because snapshots are built by this app, not parsed from user input.
export function diff(before, after) {
  const b = before && typeof before === 'object' ? before : {};
  const a = after && typeof after === 'object' ? after : {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();
  const changes = [];
  for (const field of keys) {
    const had = Object.prototype.hasOwnProperty.call(b, field);
    const has = Object.prototype.hasOwnProperty.call(a, field);
    if (had && has && JSON.stringify(b[field]) === JSON.stringify(a[field])) continue;
    changes.push({
      field,
      kind: !had ? 'added' : !has ? 'removed' : 'changed',
      from: had ? b[field] : null,
      to: has ? a[field] : null
    });
  }
  return changes;
}
