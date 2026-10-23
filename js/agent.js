// AgentPay simulated shopping agent.
// Atlas is a scripted generator, not a live model: the same seed and start
// timestamp always produce the same proposals. There is no network call and
// no randomness beyond the seeded generator.

import { TIERS } from './engine.js';

export const AGENT_NAME = 'Atlas';

// Synthetic merchant catalog. Categories here are the same strings the
// default policies match on, so the demo flows connect end to end.
export const CATALOG = [
  {
    merchant: 'Northwind Supplies',
    category: 'Office',
    base: 180,
    items: ['Standing Desk Converter', 'Ergo Chair', 'Monitor Arm', 'Desk Lamp']
  },
  {
    merchant: 'Circuit Lane',
    category: 'Electronics',
    base: 420,
    items: ['USB C Hub', 'Mechanical Keyboard', 'Noise Cancelling Headset', '4K Webcam']
  },
  {
    merchant: 'Bean Pipeline',
    category: 'Food',
    base: 24,
    items: ['Coffee Beans 2 Lb', 'Cold Brew Kit', 'Espresso Cup Set', 'Pour Over Kettle']
  },
  {
    merchant: 'Page and Parcel',
    category: 'Books',
    base: 32,
    items: ['Design Systems Book', 'Operations Handbook', 'Security Primer', 'Field Notes Set']
  },
  {
    merchant: 'Glowhart Studios',
    category: 'Software',
    base: 120,
    items: ['Design Tool Seat', 'Font License', 'Icon Pack', 'Motion Preset Bundle']
  },
  {
    merchant: 'Trailhead Outfitters',
    category: 'Outdoor',
    base: 95,
    items: ['Trail Pack', 'Insulated Bottle', 'Camp Stool', 'Headlamp']
  },
  {
    merchant: 'Marrow Fitness',
    category: 'Fitness',
    base: 75,
    items: ['Kettlebell 16 Kg', 'Yoga Mat', 'Resistance Set', 'Foam Roller']
  },
  {
    merchant: 'Prisma Print Lab',
    category: 'Print',
    base: 48,
    items: ['Poster Print', 'Photo Book', 'Canvas Wrap', 'Sticker Sheet']
  },
  {
    merchant: 'Kernel Host',
    category: 'Cloud',
    base: 260,
    items: ['Compute Credits', 'Object Storage Tier', 'Edge CDN Plan', 'Managed Database']
  },
  {
    merchant: 'Loopline Travel',
    category: 'Travel',
    base: 340,
    items: ['Rail Pass', 'Airport Transfer', 'Hotel Night', 'Lounge Day Pass']
  }
];

// Mulberry32: tiny, fast, deterministic. Good enough for synthetic data,
// never used for anything security related.
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

// Produce `count` proposals with monotonically increasing timestamps. About
// one proposal in twelve is a big ticket purchase, which is what makes the
// ceiling and velocity rules actually fire during a demo.
export function runAgent(seed, count, startTs) {
  if (!Number.isInteger(seed)) {
    throw new TypeError('Seed Must Be An Integer');
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new TypeError('Count Must Be An Integer Of At Least One');
  }
  if (count > 25) {
    throw new RangeError('Count Is Capped At Twenty Five To Keep Runs Light');
  }
  if (!Number.isFinite(startTs)) {
    throw new TypeError('Start Timestamp Must Be A Finite Number');
  }
  const rand = mulberry32(seed);
  const proposals = [];
  let ts = startTs;
  for (let i = 0; i < count; i++) {
    const entry = CATALOG[Math.floor(rand() * CATALOG.length)];
    const item = entry.items[Math.floor(rand() * entry.items.length)];
    const bigTicket = rand() < 0.08;
    const amount = round2(entry.base * (0.5 + rand() * 1.6) * (bigTicket ? 4 : 1));
    const tier = TIERS[Math.floor(rand() * TIERS.length)];
    ts += Math.floor(rand() * 45 + 1) * 60000;
    proposals.push({
      id: 'prop-' + seed + '-' + i,
      agent: AGENT_NAME,
      merchant: entry.merchant,
      category: entry.category,
      item,
      amount,
      currency: 'USD',
      tier,
      ts
    });
  }
  return proposals;
}
