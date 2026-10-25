// AgentPay app wiring.
// Owns in memory state, renders every section, and bridges the policy engine,
// the simulated agent, the simulated checkout and the AG Grid ledger with its
// fallback table. Nothing here persists: a reload resets the demo.
// The presentation layer is a financial command deck: the hero pipeline and
// the score waterfall are computed on load by the same engine the console runs.

document.documentElement.classList.add('js');

import { normalizePolicy, evaluatePolicies, riskScore, merchantMatches, categoryMatches } from './engine.js';
import { append, verifyChain } from './ledger.js';
import { runAgent, CATALOG } from './agent.js';
import { createCheckout, isWired } from './checkout.js';
import { defaultPolicies, seedTransactions, seedAudit } from './data.js';
import { esc, fmtMoney, fmtTs, statusTone, chipHtml, scoreBarHtml, hitsLabel, actionLabel } from './format.js';
import { renderLedgerTable } from './table-fallback.js';

const LEDGER_COLUMNS = [
  { key: 'id', label: 'Tx Id', kind: 'text' },
  { key: 'ts', label: 'Timestamp', kind: 'ts', numeric: true },
  { key: 'merchant', label: 'Merchant', kind: 'text' },
  { key: 'category', label: 'Category', kind: 'text' },
  { key: 'amount', label: 'Amount', kind: 'money', numeric: true },
  { key: 'status', label: 'Status', kind: 'status' },
  { key: 'score', label: 'Risk Score', kind: 'score', numeric: true },
  { key: 'hitsCount', label: 'Rule Hits', kind: 'hits', numeric: true },
  { key: 'tier', label: 'Trust Tier', kind: 'text' },
  { key: 'agent', label: 'Agent', kind: 'text' },
  { key: 'channel', label: 'Channel', kind: 'text' }
];

const GRID_WIDTHS = {
  id: 118, ts: 150, merchant: 170, category: 118, amount: 112, status: 118,
  score: 156, hitsCount: 104, tier: 116, agent: 92, channel: 160
};

// The hero sample: a real proposal from the synthetic catalog, scored on page
// load by the real engine. $1,800 against a $1,500 travel ceiling with a
// standard tier under a verified gate, so the demo shows the gate catching
// something and holding it for review.
const HERO_PROPOSAL = {
  id: 'prop-hero-sample',
  agent: 'Atlas',
  merchant: 'Loopline Travel',
  category: 'Travel',
  item: 'Rail Pass',
  amount: 1800,
  currency: 'USD',
  tier: 'standard',
  ts: Date.UTC(2026, 9, 24, 14, 0, 0)
};

const state = {
  policies: defaultPolicies(),
  rows: [],
  audit: [],
  queue: [],
  runCount: 0,
  session: { approved: 0, blocked: 0, volume: 0 },
  gridApi: null,
  fallback: null,
  usingAgGrid: false
};

const $ = (id) => document.getElementById(id);

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function tierWord(value) {
  const s = String(value || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function decisionWord(decision) {
  return decision === 'blocked' ? 'Blocked' : decision === 'review' ? 'Review' : 'Approved';
}

function decisionTone(decision) {
  return decision === 'blocked' ? 'bad' : decision === 'review' ? 'warn' : 'ok';
}

function rowsSorted() {
  return state.rows.slice().sort((a, b) => b.ts - a.ts);
}

function addAudit(action, entity, before, after, actor, ts) {
  state.audit = append(state.audit, {
    ts: ts === undefined ? Date.now() : ts,
    actor: actor === undefined ? 'owner' : actor,
    action,
    entity,
    before: before === undefined ? null : before,
    after: after === undefined ? null : after
  });
  renderAudit();
}

// ---------- Number tickers ----------

const tickerState = new Map();

function tickTo(el, target, format) {
  if (!el) return;
  const prev = tickerState.has(el) ? tickerState.get(el) : 0;
  tickerState.set(el, target);
  if (prev === target || prefersReducedMotion()) {
    el.textContent = format(target);
    return;
  }
  const start = performance.now();
  const duration = 560;
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(prev + (target - prev) * eased);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ---------- Entrance reveals and section tracking ----------

function initReveals() {
  const items = Array.from(document.querySelectorAll('[data-reveal]'));
  if (!items.length) return;
  if (!('IntersectionObserver' in window) || prefersReducedMotion()) {
    for (const item of items) item.classList.add('is-in');
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    }
  }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });
  for (const item of items) io.observe(item);
}

function initScrollspy() {
  const links = Array.from(document.querySelectorAll('.topnav a[href^="#"]'));
  const map = new Map();
  for (const link of links) {
    const section = document.getElementById(link.getAttribute('href').slice(1));
    if (section) map.set(section, link);
  }
  if (!map.size || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const link = map.get(entry.target);
      if (!link) continue;
      for (const other of links) other.removeAttribute('aria-current');
      link.setAttribute('aria-current', 'true');
    }
  }, { rootMargin: '-35% 0px -55% 0px' });
  for (const section of map.keys()) io.observe(section);
}

// ---------- Hero pipeline and score waterfall ----------

function buildHeroVerdict() {
  const policies = defaultPolicies();
  const evaluation = evaluatePolicies(policies, HERO_PROPOSAL, []);
  const scored = riskScore(HERO_PROPOSAL, evaluation);
  return { policies, evaluation, scored };
}

function checkHtml(kind, name, detail) {
  return (
    '<div class="check ' + kind + '">' +
    '<span class="check-mark" aria-hidden="true"></span>' +
    '<span class="check-name">' + esc(name) + '</span>' +
    '<span class="check-detail">' + esc(detail) + '</span>' +
    '</div>'
  );
}

function signed(value) {
  return value > 0 ? '+' + value : String(value);
}

function costed(value) {
  return value > 0 ? '-' + value : String(value);
}

function renderHeroPipeline(verdict) {
  const el = $('hero-pipeline');
  if (!el) return;
  const p = HERO_PROPOSAL;
  const evaluation = verdict.evaluation;
  const scored = verdict.scored;
  const hits = evaluation.hits;
  const matched = verdict.policies.find((policy) => merchantMatches(policy, p) && categoryMatches(policy, p));
  const byRule = (rule) => hits.find((h) => h.rule === rule);

  const checks = [];
  if (matched) {
    const ceiling = byRule('ceiling');
    checks.push(ceiling
      ? checkHtml('hit', 'Ceiling', ceiling.detail)
      : checkHtml('clear', 'Ceiling', 'Under The ' + fmtMoney(matched.maxAmount) + ' Ceiling'));

    const velocity = byRule('velocity.count') || byRule('velocity.spend');
    const velocityText = evaluation.velocity
      ? evaluation.velocity.count + ' Of ' + matched.maxTxPerWindow + ' Prior In The ' + matched.windowMinutes + ' Min Window'
      : 'No Window Recorded';
    checks.push(velocity
      ? checkHtml('hit', 'Velocity', velocity.detail)
      : checkHtml('clear', 'Velocity', velocityText));

    const hours = byRule('hours');
    checks.push(hours
      ? checkHtml('hit', 'Hours', hours.detail)
      : checkHtml('clear', 'Hours', 'Inside ' + matched.allowedHours[0] + ' To ' + matched.allowedHours[1] + ' UTC'));

    const tier = byRule('tier');
    checks.push(tier
      ? checkHtml('hit', 'Tier', tier.detail)
      : checkHtml('clear', 'Tier', 'Meets The ' + tierWord(matched.trustTierMin) + ' Minimum'));
  } else {
    for (const h of hits) checks.push(checkHtml('hit', h.rule, h.detail));
  }

  const verdictLine = scored.decision === 'blocked'
    ? 'Blocked By Policy'
    : scored.decision === 'review'
      ? 'Held For Human Review'
      : 'Cleared To Spend';
  const s = scored.signals;

  el.innerHTML =
    '<div class="pipe-node">' +
    '<p class="node-label">Proposal</p>' +
    '<p class="p-merchant">' + esc(p.merchant) + '</p>' +
    '<p class="p-item">' + esc(p.item) + '</p>' +
    '<p class="p-meta">' + esc(p.category) + ' / ' + esc(tierWord(p.tier)) + ' Tier / ' + esc(p.agent) + '</p>' +
    '<p class="p-amount">' + esc(fmtMoney(p.amount)) + '</p>' +
    '</div>' +
    '<div class="pipe-link" aria-hidden="true"></div>' +
    '<div class="pipe-node gate">' +
    '<p class="node-label">Policy Gate</p>' +
    '<p class="gate-policy">' + esc(matched ? matched.name : 'No Policy Matched') + '</p>' +
    checks.join('') +
    '</div>' +
    '<div class="pipe-link" aria-hidden="true"></div>' +
    '<div class="pipe-node verdict bracket">' +
    '<p class="node-label">Verdict</p>' +
    '<p class="v-score">' + scored.score + '</p>' +
    '<p class="v-label">Composite Score</p>' +
    chipHtml(decisionWord(scored.decision), decisionTone(scored.decision)) +
    '<p class="v-line">' + esc(verdictLine) + '</p>' +
    '<p class="v-signals">Base ' + s.base + ' / Tier ' + signed(s.tierAdjust) +
    ' / Amount ' + costed(s.amountPenalty) + ' / Velocity ' + costed(s.velocityPenalty) +
    ' / Hits ' + costed(s.hitPenalty) + '</p>' +
    '</div>';
}

function renderWaterfall(verdict) {
  const el = $('engine-waterfall');
  if (!el) return;
  const s = verdict.scored.signals;
  const scale = Math.max(s.base, 1);
  const rows = [
    { label: 'Base Score', value: s.base, tone: 'base' },
    { label: 'Tier Adjust', value: s.tierAdjust, tone: s.tierAdjust >= 0 ? 'ok' : 'bad' },
    { label: 'Amount Penalty', value: -s.amountPenalty, tone: 'bad' },
    { label: 'Velocity Penalty', value: -s.velocityPenalty, tone: 'bad' },
    { label: 'Rule Hit Penalty', value: -s.hitPenalty, tone: 'bad' }
  ];
  let html = '';
  for (const row of rows) {
    const width = Math.round(Math.abs(row.value) / scale * 100);
    html +=
      '<div class="w-row">' +
      '<span class="w-label">' + esc(row.label) + '</span>' +
      '<span class="w-bar" aria-hidden="true"><span class="w-fill ' + row.tone + '" style="width:' + width + '%"></span></span>' +
      '<span class="w-value">' + esc(signed(row.value)) + '</span>' +
      '</div>';
  }
  const totalWidth = Math.round(verdict.scored.score / scale * 100);
  html +=
    '<div class="w-row w-total">' +
    '<span class="w-label">Composite Score</span>' +
    '<span class="w-bar" aria-hidden="true"><span class="w-fill accent" style="width:' + totalWidth + '%"></span></span>' +
    '<span class="w-value">' + verdict.scored.score + '</span>' +
    '</div>';
  el.innerHTML = html;
}

// ---------- Policies ----------

function policyRowHtml(p) {
  const actionTone = p.action === 'block' ? 'bad' : p.action === 'review' ? 'warn' : 'ok';
  return (
    '<article class="policy-row' + (p.enabled ? '' : ' is-off') + '" data-id="' + esc(p.id) + '">' +
    '<div class="p-id">' +
    '<h3>' + esc(p.name) + '</h3>' +
    '<p class="p-scope">Merchant ' + (p.merchant === '*' ? 'Any' : esc(p.merchant)) +
    ' / Category ' + (p.category === '*' ? 'Any' : esc(p.category)) + '</p>' +
    '</div>' +
    '<dl class="p-data">' +
    '<div><dt>Ceiling</dt><dd>' + esc(fmtMoney(p.maxAmount)) + '</dd></div>' +
    '<div><dt>Window</dt><dd>' + p.windowMinutes + ' Min</dd></div>' +
    '<div><dt>Tx Cap</dt><dd>' + p.maxTxPerWindow + '</dd></div>' +
    '<div><dt>Spend Cap</dt><dd>' + (p.maxSpendPerWindow == null ? 'None' : esc(fmtMoney(p.maxSpendPerWindow))) + '</dd></div>' +
    '<div><dt>Tier Min</dt><dd>' + esc(tierWord(p.trustTierMin)) + '</dd></div>' +
    '<div><dt>Hours</dt><dd>' + p.allowedHours[0] + ' To ' + p.allowedHours[1] + ' UTC</dd></div>' +
    '</dl>' +
    '<div class="p-act">' + chipHtml(tierWord(p.action), actionTone) + '</div>' +
    '<div class="p-ctl">' +
    '<label class="switch">' +
    '<input type="checkbox" data-role="toggle"' + (p.enabled ? ' checked' : '') + ' aria-label="Enable ' + esc(p.name) + '">' +
    '<span>' + (p.enabled ? 'Enabled' : 'Disabled') + '</span>' +
    '</label>' +
    '<button type="button" class="btn small ghost" data-role="remove" aria-label="Remove ' + esc(p.name) + '">Remove</button>' +
    '</div>' +
    '</article>'
  );
}

function renderPolicies() {
  $('policy-grid').innerHTML = state.policies.map(policyRowHtml).join('') + addPolicyFormHtml();
}

function addPolicyFormHtml() {
  const categories = Array.from(new Set(CATALOG.map((c) => c.category)));
  return (
    '<form class="add-policy" id="add-policy" novalidate>' +
    '<h3>Add A Policy</h3>' +
    '<div class="field span2"><label for="pf-name">Policy Name</label>' +
    '<input id="pf-name" name="name" type="text" required placeholder="Vendor Cap"></div>' +
    '<div class="field"><label for="pf-merchant">Merchant, Blank Means Any</label>' +
    '<input id="pf-merchant" name="merchant" type="text" placeholder="Any"></div>' +
    '<div class="field"><label for="pf-category">Category</label>' +
    '<select id="pf-category" name="category">' +
    '<option value="">Any</option>' +
    categories.map((c) => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('') +
    '</select></div>' +
    '<div class="field"><label for="pf-max">Amount Ceiling In USD</label>' +
    '<input id="pf-max" name="maxAmount" type="number" min="0.01" step="0.01" required placeholder="250"></div>' +
    '<div class="field"><label for="pf-window">Window In Minutes</label>' +
    '<input id="pf-window" name="windowMinutes" type="number" min="1" step="1" placeholder="60"></div>' +
    '<div class="field"><label for="pf-maxtx">Max Transactions Per Window</label>' +
    '<input id="pf-maxtx" name="maxTxPerWindow" type="number" min="1" step="1" placeholder="5"></div>' +
    '<div class="field"><label for="pf-maxspend">Max Spend Per Window In USD, Blank Means None</label>' +
    '<input id="pf-maxspend" name="maxSpendPerWindow" type="number" min="0.01" step="0.01" placeholder="None"></div>' +
    '<div class="field"><label for="pf-tier">Minimum Trust Tier</label>' +
    '<select id="pf-tier" name="trustTierMin">' +
    ['guest', 'standard', 'verified', 'premium'].map((t) => '<option value="' + t + '">' + tierWord(t) + '</option>').join('') +
    '</select></div>' +
    '<div class="field"><label for="pf-action">Action On Violation</label>' +
    '<select id="pf-action" name="action">' +
    '<option value="allow">Allow</option>' +
    '<option value="review" selected>Review</option>' +
    '<option value="block">Block</option>' +
    '</select></div>' +
    '<div class="form-foot">' +
    '<button type="submit" class="btn primary">Add Policy</button>' +
    '<p class="form-error" id="policy-error" aria-live="assertive"></p>' +
    '</div>' +
    '</form>'
  );
}

function bindPolicyEvents() {
  const grid = $('policy-grid');
  grid.addEventListener('change', (ev) => {
    const input = ev.target.closest('input[data-role="toggle"]');
    if (!input) return;
    const card = input.closest('.policy-row');
    const id = card.getAttribute('data-id');
    const raw = state.policies.find((p) => p.id === id);
    if (!raw) return;
    raw.enabled = input.checked;
    input.parentElement.querySelector('span').textContent = raw.enabled ? 'Enabled' : 'Disabled';
    card.classList.toggle('is-off', !raw.enabled);
    addAudit('policy.updated', 'policy:' + id, { enabled: !raw.enabled }, { enabled: raw.enabled });
  });
  grid.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-role="remove"]');
    if (!btn) return;
    const card = btn.closest('.policy-row');
    const id = card.getAttribute('data-id');
    const raw = state.policies.find((p) => p.id === id);
    state.policies = state.policies.filter((p) => p.id !== id);
    addAudit('policy.removed', 'policy:' + id, raw ? { name: raw.name, action: raw.action } : null, null);
    renderPolicies();
  });
  grid.addEventListener('submit', (ev) => {
    const form = ev.target.closest('#add-policy');
    if (!form) return;
    ev.preventDefault();
    submitAddPolicy(form);
  });
}

function submitAddPolicy(form) {
  const errorEl = $('policy-error');
  errorEl.textContent = '';
  const spendRaw = $('pf-maxspend').value.trim();
  const raw = {
    name: $('pf-name').value.trim(),
    merchant: $('pf-merchant').value.trim(),
    category: $('pf-category').value,
    action: $('pf-action').value,
    trustTierMin: $('pf-tier').value,
    maxAmount: parseFloat($('pf-max').value),
    windowMinutes: parseInt($('pf-window').value, 10),
    maxTxPerWindow: parseInt($('pf-maxtx').value, 10),
    maxSpendPerWindow: spendRaw === '' ? null : parseFloat(spendRaw)
  };
  try {
    const normalized = normalizePolicy(raw);
    state.policies.push({ ...normalized });
    addAudit('policy.created', 'policy:' + normalized.id, null, {
      id: normalized.id,
      name: normalized.name,
      action: normalized.action,
      maxAmount: normalized.maxAmount
    });
    renderPolicies();
  } catch (err) {
    errorEl.textContent = 'Could Not Add Policy: ' + err.message;
  }
}

// ---------- Agent And Queue ----------

function hitsListHtml(hits) {
  if (!hits || hits.length === 0) {
    return '<p class="no-hits">No Rule Hits</p>';
  }
  return (
    '<ul class="hits">' +
    hits.map((h) => '<li><strong>' + esc(h.rule) + '</strong> ' + esc(h.detail) + '</li>').join('') +
    '</ul>'
  );
}

function queueCardHtml(item, withActions) {
  const p = item.proposal;
  const tone = decisionTone(item.scored.decision);
  const actions = withActions
    ? (
      '<div class="queue-actions">' +
      '<button type="button" class="btn primary" data-approve="' + esc(p.id) + '" aria-label="Approve proposal for ' + esc(p.merchant) + '">Approve</button>' +
      '<button type="button" class="btn danger" data-reject="' + esc(p.id) + '" aria-label="Reject proposal for ' + esc(p.merchant) + '">Reject</button>' +
      '<span class="queue-note">Checkout is simulated, no live funds move.</span>' +
      '</div>'
    )
    : '<p class="queue-note">Queued below for your decision.</p>';
  return (
    '<article class="queue-card ' + tone + '">' +
    '<div class="q-head">' +
    '<div>' +
    '<h3>' + esc(p.merchant) + '</h3>' +
    '<p class="q-meta">' + esc(p.item) + ' / ' + esc(p.category) + ' / ' + esc(tierWord(p.tier)) + ' Tier / ' + esc(fmtTs(p.ts)) + '</p>' +
    '</div>' +
    '<div class="q-side">' +
    chipHtml(decisionWord(item.scored.decision), tone) +
    '<span class="q-amount">' + esc(fmtMoney(p.amount)) + '</span>' +
    '</div>' +
    '</div>' +
    scoreBarHtml(item.scored.score) +
    hitsListHtml(item.evaluation.hits) +
    actions +
    '</article>'
  );
}

function ticketHtml(item) {
  const p = item.proposal;
  const tone = decisionTone(item.scored.decision);
  return (
    '<article class="ticket ' + tone + '">' +
    '<div class="t-id">' +
    '<span class="t-merchant">' + esc(p.merchant) + '</span>' +
    '<span class="t-item">' + esc(p.item) + '</span>' +
    '</div>' +
    '<span class="t-cat">' + esc(p.category) + ' / ' + esc(tierWord(p.tier)) + ' Tier</span>' +
    scoreBarHtml(item.scored.score) +
    chipHtml(decisionWord(item.scored.decision), tone) +
    '<span class="t-amount">' + esc(fmtMoney(p.amount)) + '</span>' +
    '</article>'
  );
}

function renderAgentOutput(items) {
  const el = $('agent-output');
  const wasEmpty = !el.querySelector('.ticket');
  if (!items || items.length === 0) {
    el.innerHTML = '<p class="empty">No Runs Yet. Run The Agent To Propose Purchases.</p>';
    el.classList.remove('just-filled');
    return;
  }
  el.innerHTML = items.map(ticketHtml).join('');
  el.classList.toggle('just-filled', wasEmpty);
}

function renderQueue() {
  const el = $('queue-list');
  const pending = state.queue.filter((q) => q.status === 'pending').reverse();
  const wasEmpty = !el.querySelector('.queue-card');
  el.innerHTML = pending.length
    ? pending.map((item) => queueCardHtml(item, true)).join('')
    : '<p class="empty">The Queue Is Empty. Run The Agent To Propose Purchases.</p>';
  el.classList.toggle('just-filled', wasEmpty && pending.length > 0);
}

function runAgentBatch() {
  const count = parseInt($('agent-count').value, 10) || 5;
  state.runCount += 1;
  const seed = 20261112 + state.runCount * 7919;
  const proposals = runAgent(seed, count, Date.now());
  const produced = proposals.map((p) => {
    const evaluation = evaluatePolicies(state.policies, p, state.rows);
    const scored = riskScore(p, evaluation);
    const item = { proposal: p, evaluation, scored, status: 'pending' };
    state.queue.push(item);
    return item;
  });
  for (const item of produced) {
    addAudit('proposal.scored', 'proposal:' + item.proposal.id, null, {
      merchant: item.proposal.merchant,
      amount: item.proposal.amount,
      decision: item.scored.decision,
      score: item.scored.score
    }, 'system', item.proposal.ts);
  }
  renderAgentOutput(produced);
  renderQueue();
  renderStats();
}

function rowFromItem(item, status, channel) {
  return {
    id: item.receipt ? item.receipt.orderId : 'tx-' + item.proposal.id,
    ts: item.receipt ? item.receipt.ts : Date.now(),
    merchant: item.proposal.merchant,
    category: item.proposal.category,
    amount: item.proposal.amount,
    currency: 'USD',
    status,
    score: item.scored.score,
    hitsCount: item.evaluation.hits.length,
    tier: item.proposal.tier,
    agent: item.proposal.agent,
    channel
  };
}

function approveProposal(id) {
  const item = state.queue.find((q) => q.proposal.id === id && q.status === 'pending');
  if (!item) return;
  item.status = 'approved';
  item.receipt = createCheckout(item.proposal);
  state.rows.push(rowFromItem(item, 'Approved', 'Simulated Checkout'));
  state.session.approved += 1;
  state.session.volume += item.proposal.amount;
  addAudit('decision.approved', 'proposal:' + item.proposal.id, {
    status: 'Pending',
    decision: item.scored.decision,
    score: item.scored.score
  }, { status: 'Approved', orderId: item.receipt.orderId });
  addAudit('checkout.simulated', 'order:' + item.receipt.orderId, null, item.receipt, 'system');
  renderReceipt(item);
  refreshLedger();
  renderQueue();
  renderStats();
}

function rejectProposal(id) {
  const item = state.queue.find((q) => q.proposal.id === id && q.status === 'pending');
  if (!item) return;
  item.status = 'rejected';
  state.rows.push(rowFromItem(item, 'Blocked', 'Manual Review'));
  state.session.blocked += 1;
  addAudit('decision.rejected', 'proposal:' + item.proposal.id, {
    status: 'Pending',
    decision: item.scored.decision,
    score: item.scored.score
  }, { status: 'Blocked', channel: 'Manual Review' });
  refreshLedger();
  renderQueue();
  renderStats();
}

function renderReceipt(item) {
  const el = $('receipt-line');
  const r = item.receipt;
  el.innerHTML =
    chipHtml('Simulated Checkout Complete', 'ok') +
    ' <span>Order ' + esc(r.orderId) + ' for ' + esc(r.merchant) + ', ' + esc(fmtMoney(r.amount)) + '. ' +
    (r.wired
      ? 'Sandbox client id detected by the stub.'
      : 'Sandbox client id not set, so the simulated stub ran instead of any PayPal call.') +
    '</span>';
}

// ---------- Ledger ----------

function agGridLib() {
  const agGrid = typeof window !== 'undefined' ? window.agGrid : undefined;
  return agGrid && (typeof agGrid.createGrid === 'function' || typeof agGrid.Grid === 'function') ? agGrid : null;
}

// AG Grid Community has no row grouping (that is an Enterprise feature), so grouping with
// subtotals lives in the built in table. The view toggle swaps between the two.
function mountAgGrid(wrap, agGrid) {
  const gridOptions = {
    rowData: rowsSorted(),
    columnDefs: LEDGER_COLUMNS.map((col) => {
          const def = {
            field: col.key,
            headerName: col.label,
            width: GRID_WIDTHS[col.key] || 120,
            sortable: true,
            resizable: true,
            filter: col.numeric ? 'agNumberColumnFilter' : true
          };
          if (col.key === 'merchant' || col.key === 'channel') def.flex = 1;
          const cellClasses = [];
          if (col.kind === 'ts' || col.kind === 'money' || col.kind === 'score' || col.kind === 'hits' || col.key === 'id') {
            cellClasses.push('cell-mono');
          }
          if (col.numeric && col.key !== 'ts') {
            cellClasses.push('cell-num');
            def.headerClass = 'ag-right-aligned-header';
          }
          if (cellClasses.length) def.cellClass = cellClasses.join(' ');
          if (col.kind === 'status') def.cellRenderer = (p) => chipHtml(p.value, statusTone(p.value));
          else if (col.kind === 'score') def.cellRenderer = (p) => scoreBarHtml(p.value);
          else if (col.kind === 'money') def.cellRenderer = (p) => esc(fmtMoney(p.value));
          else if (col.kind === 'ts') def.cellRenderer = (p) => esc(fmtTs(p.value));
          else if (col.kind === 'hits') def.cellRenderer = (p) => esc(hitsLabel(p.value));
          return def;
        }),
    defaultColDef: { sortable: true, filter: true, resizable: true, minWidth: 96 },
    pagination: true,
    paginationPageSize: 25,
    paginationPageSizeSelector: [25, 50, 100],
    animateRows: true,
    getRowId: (params) => String(params.data.id)
  };
  if (typeof agGrid.createGrid === 'function') {
    state.gridApi = agGrid.createGrid(wrap, gridOptions);
  } else {
    new agGrid.Grid(wrap, gridOptions);
    state.gridApi = gridOptions.api;
  }
  state.usingAgGrid = true;
}

function unmountLedger(wrap) {
  if (state.gridApi && typeof state.gridApi.destroy === 'function') state.gridApi.destroy();
  state.gridApi = null;
  state.fallback = null;
  state.usingAgGrid = false;
  wrap.innerHTML = '';
}

function mountTable(wrap) {
  state.fallback = renderLedgerTable(wrap, LEDGER_COLUMNS, rowsSorted);
}

function initLedger() {
  const wrap = $('grid-wrap');
  const status = $('grid-status');
  const toggle = $('ledger-view');
  const agGrid = agGridLib();
  try {
    if (agGrid) {
      mountAgGrid(wrap, agGrid);
      status.textContent = 'Ledger rendered with AG Grid Community from the jsDelivr CDN. Sort and filter any column, or switch to the grouped table.';
      if (toggle) {
        toggle.hidden = false;
        toggle.addEventListener('click', () => {
          const grouped = toggle.getAttribute('aria-pressed') !== 'true';
          unmountLedger(wrap);
          if (grouped) {
            mountTable(wrap);
            status.textContent = 'Built in table. Pick a column under Group By to see row counts and amount subtotals per group.';
          } else {
            mountAgGrid(wrap, agGrid);
            status.textContent = 'Ledger rendered with AG Grid Community from the jsDelivr CDN. Sort and filter any column, or switch to the grouped table.';
          }
          toggle.setAttribute('aria-pressed', String(grouped));
          toggle.textContent = grouped ? 'Back To AG Grid' : 'Grouped Table';
        });
      }
      return;
    }
  } catch (err) {
    unmountLedger(wrap);
  }
  state.usingAgGrid = false;
  status.textContent = 'AG Grid was not available, so the built in table is rendering the ledger. Sorting, filtering and grouping still work.';
  mountTable(wrap);
}

function refreshLedger() {
  if (state.usingAgGrid && state.gridApi) {
    const data = rowsSorted();
    if (typeof state.gridApi.setGridOption === 'function') {
      state.gridApi.setGridOption('rowData', data);
    } else if (typeof state.gridApi.setRowData === 'function') {
      state.gridApi.setRowData(data);
    }
  } else if (state.fallback) {
    state.fallback.refresh();
  }
}

// ---------- Stats And Audit ----------

function renderStats() {
  tickTo($('stat-pending'), state.queue.filter((q) => q.status === 'pending').length, (v) => String(Math.round(v)));
  tickTo($('stat-approved'), state.session.approved, (v) => String(Math.round(v)));
  tickTo($('stat-blocked'), state.session.blocked, (v) => String(Math.round(v)));
  tickTo($('stat-volume'), state.session.volume, (v) => fmtMoney(v));
}

const AUDIT_TONES = { decision: 'accent', checkout: 'ok', policy: 'warn', proposal: 'faint' };

function auditTone(action) {
  return AUDIT_TONES[String(action).split('.')[0]] || 'faint';
}

function renderAudit() {
  const chipEl = $('audit-chain');
  if (chipEl) {
    const ok = verifyChain(state.audit);
    chipEl.textContent = ok ? 'Chain Verified' : 'Chain Broken';
    chipEl.className = 'chip ' + (ok ? 'ok' : 'bad');
  }
  const list = $('audit-list');
  if (!list) return;
  const items = state.audit.slice(-30).reverse();
  list.innerHTML = items.map((e) => (
    '<li class="audit-item">' +
    '<div class="a-row">' +
    '<span class="a-seq">#' + String(e.seq).padStart(4, '0') + '</span>' +
    chipHtml(actionLabel(e.action), auditTone(e.action)) +
    '<span class="a-entity">' + esc(e.entity) + '</span>' +
    '<span class="a-actor">' + esc(e.actor) + '</span>' +
    '<span class="a-time">' + esc(fmtTs(e.ts)) + '</span>' +
    '</div>' +
    '<p class="a-hash">Hash ' + esc(e.hash) + ' / Prev ' + esc(e.prevHash) + '</p>' +
    '<details class="a-body">' +
    '<summary>Before And After States</summary>' +
    '<pre class="json">before: ' + esc(JSON.stringify(e.before, null, 2)) + '\n' +
    ' after: ' + esc(JSON.stringify(e.after, null, 2)) + '</pre>' +
    '</details>' +
    '</li>'
  )).join('');
}

// ---------- Init ----------

function bindGlobalEvents() {
  $('run-agent').addEventListener('click', runAgentBatch);
  $('queue-list').addEventListener('click', (ev) => {
    const approveBtn = ev.target.closest('button[data-approve]');
    if (approveBtn) {
      approveProposal(approveBtn.getAttribute('data-approve'));
      return;
    }
    const rejectBtn = ev.target.closest('button[data-reject]');
    if (rejectBtn) {
      rejectProposal(rejectBtn.getAttribute('data-reject'));
    }
  });
}

function init() {
  const now = Date.now();
  state.rows = seedTransactions(now);
  state.audit = seedAudit(now);
  const verdict = buildHeroVerdict();
  renderHeroPipeline(verdict);
  renderWaterfall(verdict);
  renderPolicies();
  bindPolicyEvents();
  renderAgentOutput(null);
  renderQueue();
  renderStats();
  renderAudit();
  initLedger();
  bindGlobalEvents();
  initReveals();
  initScrollspy();
}

init();
