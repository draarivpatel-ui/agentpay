// AgentPay policy engine.
// Pure functions for policy normalization, merchant and category matching,
// velocity checks, policy evaluation and deterministic risk scoring.
// The engine never reads the clock, never generates randomness and never
// touches the network: the caller supplies every timestamp and history entry.

export const ACTIONS = ['allow', 'review', 'block'];
export const TIERS = ['guest', 'standard', 'verified', 'premium'];
export const TIER_RANK = { guest: 0, standard: 1, verified: 2, premium: 3 };
export const HIT_WEIGHTS = { block: 22, review: 10, allow: 4 };
export const UNKNOWN_HIT_WEIGHT = 10;
export const HIT_PENALTY_CAP = 40;
export const AMOUNT_PENALTY_CAP = 20;
export const VELOCITY_PENALTY_CAP = 24;
export const BASE_SCORE = 62;
export const TIER_ADJUST = { guest: -14, standard: 0, verified: 8, premium: 14 };
export const REVIEW_THRESHOLD = 45;
const MINUTE_MS = 60000;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveNumber(value) {
  return isFiniteNumber(value) && value > 0;
}

function isIntAtLeast(value, min) {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= min;
}

export function slugify(name) {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'policy';
}

// Validate and fill defaults on a policy definition. Throws on anything that
// would make evaluation ambiguous, so bad policies cannot silently pass.
export function normalizePolicy(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Policy Must Be An Object');
  }
  if (typeof input.name !== 'string' || input.name.trim() === '') {
    throw new TypeError('Policy Name Is Required');
  }
  const action = input.action === undefined ? 'review' : input.action;
  if (!ACTIONS.includes(action)) {
    throw new RangeError('Action Must Be Allow, Review, Or Block');
  }
  if (!isPositiveNumber(input.maxAmount)) {
    throw new RangeError('Max Amount Must Be A Positive Number');
  }
  const merchant = input.merchant === undefined || input.merchant === '' ? '*' : input.merchant;
  if (typeof merchant !== 'string') {
    throw new TypeError('Merchant Must Be A String Or Omitted For Any Merchant');
  }
  const category = input.category === undefined || input.category === '' ? '*' : input.category;
  if (typeof category !== 'string') {
    throw new TypeError('Category Must Be A String Or Omitted For Any Category');
  }
  const windowMinutes = input.windowMinutes === undefined ? 60 : input.windowMinutes;
  if (!isIntAtLeast(windowMinutes, 1)) {
    throw new RangeError('Window Minutes Must Be An Integer Of At Least One');
  }
  const maxTxPerWindow = input.maxTxPerWindow === undefined ? 5 : input.maxTxPerWindow;
  if (!isIntAtLeast(maxTxPerWindow, 1)) {
    throw new RangeError('Max Transactions Per Window Must Be An Integer Of At Least One');
  }
  const maxSpendPerWindow = input.maxSpendPerWindow === undefined ? null : input.maxSpendPerWindow;
  if (maxSpendPerWindow !== null && !isPositiveNumber(maxSpendPerWindow)) {
    throw new RangeError('Max Spend Per Window Must Be A Positive Number Or Null');
  }
  const allowedHours = input.allowedHours === undefined ? [0, 24] : input.allowedHours;
  if (
    !Array.isArray(allowedHours) ||
    allowedHours.length !== 2 ||
    !isFiniteNumber(allowedHours[0]) ||
    !isFiniteNumber(allowedHours[1]) ||
    allowedHours[0] < 0 ||
    allowedHours[1] > 24 ||
    allowedHours[0] >= allowedHours[1]
  ) {
    throw new RangeError('Allowed Hours Must Be A Start And End Pair With Start Before End');
  }
  const trustTierMin = input.trustTierMin === undefined ? 'guest' : input.trustTierMin;
  if (!TIERS.includes(trustTierMin)) {
    throw new RangeError('Trust Tier Must Be Guest, Standard, Verified, Or Premium');
  }
  const enabled = input.enabled === undefined ? true : input.enabled;
  if (typeof enabled !== 'boolean') {
    throw new TypeError('Enabled Must Be A Boolean');
  }
  return Object.freeze({
    id: input.id === undefined ? slugify(input.name) : String(input.id),
    name: input.name,
    merchant,
    category,
    action,
    maxAmount: input.maxAmount,
    windowMinutes,
    maxTxPerWindow,
    maxSpendPerWindow,
    allowedHours: [allowedHours[0], allowedHours[1]],
    trustTierMin,
    enabled
  });
}

// Validate a proposal. Returns the input unchanged (a validated view) so the
// caller keeps its object identity and extra display fields.
export function normalizeProposal(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Proposal Must Be An Object');
  }
  if (typeof input.merchant !== 'string' || input.merchant.trim() === '') {
    throw new TypeError('Proposal Merchant Is Required');
  }
  if (!isPositiveNumber(input.amount)) {
    throw new TypeError('Proposal Amount Must Be A Positive Number');
  }
  if (!isFiniteNumber(input.ts)) {
    throw new TypeError('Proposal Timestamp Must Be A Finite Number');
  }
  const tier = input.tier === undefined ? 'guest' : input.tier;
  if (!TIERS.includes(tier)) {
    throw new RangeError('Proposal Tier Must Be Guest, Standard, Verified, Or Premium');
  }
  return input;
}

function sameName(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

export function merchantMatches(policy, proposal) {
  return policy.merchant === '*' || sameName(policy.merchant, proposal.merchant);
}

export function categoryMatches(policy, proposal) {
  return policy.category === '*' || sameName(policy.category, proposal.category);
}

// Count prior transactions for the proposal merchant inside a sliding window
// ending at the proposal timestamp. The cutoff itself is exclusive: an entry
// exactly windowMinutes old has left the window, an entry at the proposal
// timestamp is still in it. Malformed history entries are skipped, not thrown.
export function velocityFor(history, proposal, windowMinutes) {
  if (!isIntAtLeast(windowMinutes, 1)) {
    throw new RangeError('Window Minutes Must Be An Integer Of At Least One');
  }
  const cutoff = proposal.ts - windowMinutes * MINUTE_MS;
  let count = 0;
  let spend = 0;
  const list = Array.isArray(history) ? history : [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || !isFiniteNumber(entry.ts)) continue;
    if (entry.ts > proposal.ts || entry.ts <= cutoff) continue;
    if (typeof entry.merchant !== 'string') continue;
    if (!sameName(entry.merchant, proposal.merchant)) continue;
    count += 1;
    spend += isFiniteNumber(entry.amount) ? entry.amount : 0;
  }
  return { windowMinutes, count, spend, cutoff };
}

function hitFor(policy, rule, detail) {
  return { policyId: policy.id, policyName: policy.name, rule, severity: policy.action, detail };
}

function formatUsd(value) {
  const rounded = Math.round(value * 100) / 100;
  return '$' + rounded.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Score one proposal against every enabled, matching policy. When no policy
// matches, the proposal falls to review with a no.match hit, because spending
// without a policy should never be silent.
export function evaluatePolicies(policies, proposal, history = []) {
  const checked = normalizeProposal(proposal);
  const list = Array.isArray(policies) ? policies : [];
  const matching = [];
  const hits = [];
  let widestWindow = 0;

  for (const raw of list) {
    const policy = normalizePolicy(raw);
    if (!policy.enabled) continue;
    if (!merchantMatches(policy, checked)) continue;
    if (!categoryMatches(policy, checked)) continue;
    matching.push(policy);
    if (policy.windowMinutes > widestWindow) widestWindow = policy.windowMinutes;

    if (checked.amount > policy.maxAmount) {
      hits.push(hitFor(policy, 'ceiling', 'Amount ' + formatUsd(checked.amount) + ' Exceeds The ' + formatUsd(policy.maxAmount) + ' Ceiling'));
    }
    const velocity = velocityFor(history, checked, policy.windowMinutes);
    if (velocity.count >= policy.maxTxPerWindow) {
      hits.push(hitFor(policy, 'velocity.count', 'Velocity Cap Reached In The ' + policy.windowMinutes + ' Minute Window (' + velocity.count + ' Prior, Limit ' + policy.maxTxPerWindow + ')'));
    }
    if (policy.maxSpendPerWindow !== null && velocity.spend + checked.amount > policy.maxSpendPerWindow) {
      hits.push(hitFor(policy, 'velocity.spend', 'Window Spend ' + formatUsd(velocity.spend + checked.amount) + ' Exceeds The ' + formatUsd(policy.maxSpendPerWindow) + ' Cap'));
    }
    const hour = new Date(checked.ts).getUTCHours();
    if (hour < policy.allowedHours[0] || hour >= policy.allowedHours[1]) {
      hits.push(hitFor(policy, 'hours', 'Hour ' + hour + ' UTC Is Outside The Allowed Window ' + policy.allowedHours[0] + ' To ' + policy.allowedHours[1]));
    }
    if (TIER_RANK[checked.tier] < TIER_RANK[policy.trustTierMin]) {
      hits.push(hitFor(policy, 'tier', 'Trust Tier ' + checked.tier + ' Is Below The Required ' + policy.trustTierMin));
    }
  }

  if (matching.length === 0) {
    return {
      decision: 'review',
      matched: 0,
      hits: [{
        policyId: null,
        policyName: null,
        rule: 'no.match',
        severity: 'review',
        detail: 'No Enabled Policy Matches This Merchant And Category'
      }],
      velocity: null
    };
  }

  const decision = hits.some((h) => h.severity === 'block')
    ? 'blocked'
    : hits.some((h) => h.severity === 'review')
      ? 'review'
      : 'approved';

  return {
    decision,
    matched: matching.length,
    hits,
    velocity: velocityFor(history, checked, widestWindow)
  };
}

// Deterministic composite score. Same proposal and same evaluation always
// produce the same score and decision, on every machine, on every run.
// A policy verdict always wins over the score: a block hit blocks even when
// the composite is high, and a clean evaluation cannot score below the review
// threshold without dropping to review.
export function riskScore(proposal, evaluation) {
  const checked = normalizeProposal(proposal);
  const tier = TIERS.includes(checked.tier) ? checked.tier : 'guest';
  const tierAdjust = TIER_ADJUST[tier];
  const amountPenalty = Math.min(AMOUNT_PENALTY_CAP, Math.floor(Math.max(0, checked.amount) / 100) * 2);
  const velocityCount = evaluation && evaluation.velocity ? evaluation.velocity.count : 0;
  const velocityPenalty = velocityCount >= 4 ? Math.min(VELOCITY_PENALTY_CAP, (velocityCount - 3) * 6) : 0;
  let hitPenalty = 0;
  const hits = evaluation && Array.isArray(evaluation.hits) ? evaluation.hits : [];
  for (const h of hits) {
    hitPenalty += HIT_WEIGHTS[h.severity] !== undefined ? HIT_WEIGHTS[h.severity] : UNKNOWN_HIT_WEIGHT;
  }
  hitPenalty = Math.min(HIT_PENALTY_CAP, hitPenalty);
  const raw = BASE_SCORE + tierAdjust - amountPenalty - velocityPenalty - hitPenalty;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  let decision;
  const policyDecision = evaluation ? evaluation.decision : 'review';
  if (policyDecision === 'blocked') {
    decision = 'blocked';
  } else if (policyDecision === 'review') {
    decision = 'review';
  } else {
    decision = score < REVIEW_THRESHOLD ? 'review' : 'approved';
  }

  return {
    score,
    decision,
    signals: { base: BASE_SCORE, tierAdjust, amountPenalty, velocityPenalty, hitPenalty }
  };
}
