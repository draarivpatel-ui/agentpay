// AgentPay seed data.
// Everything here is synthetic and generated at load time from a fixed seed,
// so the ledger, queue and audit trail look alive on first paint while still
// being fully deterministic. Nothing in this file represents a real merchant,
// a real transaction or a real person.

import { append } from './ledger.js';
import { CATALOG } from './agent.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// Five starter policies that demonstrate every rule the engine supports.
// Returned as fresh copies so toggling one cannot leak between reloads.
export function defaultPolicies() {
  return [
    {
      id: 'everyday-office',
      name: 'Everyday Office Spend',
      merchant: '*',
      category: 'Office',
      action: 'allow',
      maxAmount: 500,
      windowMinutes: 120,
      maxTxPerWindow: 6,
      maxSpendPerWindow: null,
      trustTierMin: 'guest'
    },
    {
      id: 'electronics-ceiling',
      name: 'Electronics Ceiling',
      merchant: '*',
      category: 'Electronics',
      action: 'block',
      maxAmount: 900,
      windowMinutes: 60,
      maxTxPerWindow: 5,
      maxSpendPerWindow: null,
      trustTierMin: 'standard'
    },
    {
      id: 'food-guardrail',
      name: 'Food And Coffee Guardrail',
      merchant: '*',
      category: 'Food',
      action: 'review',
      maxAmount: 60,
      windowMinutes: 240,
      maxTxPerWindow: 4,
      maxSpendPerWindow: null,
      trustTierMin: 'guest'
    },
    {
      id: 'cloud-watch',
      name: 'Cloud Spend Watch',
      merchant: '*',
      category: 'Cloud',
      action: 'block',
      maxAmount: 400,
      windowMinutes: 1440,
      maxTxPerWindow: 3,
      maxSpendPerWindow: 800,
      trustTierMin: 'verified'
    },
    {
      id: 'travel-gate',
      name: 'Travel Trust Gate',
      merchant: '*',
      category: 'Travel',
      action: 'review',
      maxAmount: 1500,
      windowMinutes: 720,
      maxTxPerWindow: 4,
      maxSpendPerWindow: null,
      trustTierMin: 'verified'
    }
  ].map((policy) => ({ ...policy }));
}

const TIERS_CYCLE = ['guest', 'standard', 'verified', 'premium'];

// Forty eight synthetic ledger rows spread across roughly eighteen days.
export function seedTransactions(now) {
  const rand = mulberry32(20261112);
  const rows = [];
  for (let i = 0; i < 48; i++) {
    const entry = CATALOG[Math.floor(rand() * CATALOG.length)];
    const amount = round2(entry.base * (0.4 + rand() * 1.8));
    const pick = rand();
    let status;
    let score;
    let hitsCount;
    if (pick < 0.6) {
      status = 'Approved';
      score = 72 + Math.floor(rand() * 26);
      hitsCount = rand() < 0.8 ? 0 : 1;
    } else if (pick < 0.76) {
      status = 'Review';
      score = 45 + Math.floor(rand() * 25);
      hitsCount = rand() < 0.5 ? 1 : 2;
    } else if (pick < 0.9) {
      status = 'Blocked';
      score = 6 + Math.floor(rand() * 38);
      hitsCount = rand() < 0.5 ? 1 : 2;
    } else {
      status = 'Refunded';
      score = 50 + Math.floor(rand() * 40);
      hitsCount = rand() < 0.5 ? 0 : 1;
    }
    rows.push({
      id: 'tx-' + (1000 + ((i * 37) % 900)),
      ts: now - i * 9 * 3600000 - Math.floor(rand() * 3 * 3600000),
      merchant: entry.merchant,
      category: entry.category,
      amount,
      currency: 'USD',
      status,
      score,
      hitsCount,
      tier: TIERS_CYCLE[Math.floor(rand() * TIERS_CYCLE.length)],
      agent: 'Atlas',
      channel: 'Seed Data'
    });
  }
  return rows;
}

// A short seeded audit history so the trail is never empty on first paint.
// Built through the real append() path, so the chain verifies on load.
export function seedAudit(now) {
  let entries = [];
  entries = append(entries, {
    ts: now - 46 * 3600000,
    actor: 'system',
    action: 'policy.created',
    entity: 'policy:everyday-office',
    before: null,
    after: { id: 'everyday-office', name: 'Everyday Office Spend', action: 'allow', maxAmount: 500 }
  });
  entries = append(entries, {
    ts: now - 45 * 3600000,
    actor: 'system',
    action: 'policy.created',
    entity: 'policy:electronics-ceiling',
    before: null,
    after: { id: 'electronics-ceiling', name: 'Electronics Ceiling', action: 'block', maxAmount: 900 }
  });
  entries = append(entries, {
    ts: now - 44 * 3600000,
    actor: 'system',
    action: 'policy.created',
    entity: 'policy:cloud-watch',
    before: null,
    after: { id: 'cloud-watch', name: 'Cloud Spend Watch', action: 'block', maxAmount: 400 }
  });
  entries = append(entries, {
    ts: now - 20 * 3600000,
    actor: 'owner',
    action: 'policy.updated',
    entity: 'policy:cloud-watch',
    before: { maxAmount: 500 },
    after: { maxAmount: 400 }
  });
  entries = append(entries, {
    ts: now - 2 * 3600000,
    actor: 'owner',
    action: 'decision.approved',
    entity: 'order:SIM-5C71AB2F',
    before: { status: 'Pending', score: 71 },
    after: { status: 'Approved', orderId: 'SIM-5C71AB2F' }
  });
  return entries;
}
