// AgentPay app wiring.
// Owns in memory state, renders every section, and bridges the policy engine,
// the simulated agent, the simulated checkout and the AG Grid ledger with its
// fallback table. Nothing here persists: a reload resets the demo.

import { normalizePolicy, evaluatePolicies, riskScore } from './engine.js';
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
const GRID_GROUPABLE = ['merchant', 'category', 'status', 'tier', 'agent', 'channel'];

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

// ---------- Policies ----------

function policyCardHtml(p) {
  const actionTone = p.action === 'block' ? 'bad' : p.action === 'review' ? 'warn' : 'ok';
  return (
    '<article class="card policy-card" data-id="' + esc(p.id) + '">' +
    '<div class="policy-top">' +
    '<h3>' + esc(p.name) + '</h3>' +
    chipHtml(tierWord(p.action), actionTone) +
    '</div>' +
    '<p class="policy-scope">Merchant: ' + (p.merchant === '*' ? 'Any' : esc(p.merchant)) +
    ', Category: ' + (p.category === '*' ? 'Any' : esc(p.category)) + '</p>' +
    '<dl class="policy-stats">' +
    '<div><dt>Ceiling</dt><dd>' + esc(fmtMoney(p.maxAmount)) + '</dd></div>' +
    '<div><dt>Window</dt><dd>' + p.windowMinutes + ' Min</dd></div>' +
    '<div><dt>Max Tx</dt><dd>' + p.maxTxPerWindow + '</dd></div>' +
    '<div><dt>Max Spend</dt><dd>' + (p.maxSpendPerWindow == null ? 'None' : esc(fmtMoney(p.maxSpendPerWindow))) + '</dd></div>' +
    '<div><dt>Tier Min</dt><dd>' + tierWord(p.trustTierMin) + '</dd></div>' +
    '<div><dt>Hours</dt><dd>' + p.allowedHours[0] + ' To ' + p.allowedHours[1] + ' UTC</dd></div>' +
    '</dl>' +
    '<div class="policy-foot">' +
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
  $('policy-grid').innerHTML = state.policies.map(policyCardHtml).join('') + addPolicyFormHtml();
}

function addPolicyFormHtml() {
  const categories = Array.from(new Set(CATALOG.map((c) => c.category)));
  return (
    '<form class="card add-policy" id="add-policy" novalidate>' +
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
    '<div class="span2 form-foot">' +
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
    const card = input.closest('.policy-card');
    const id = card.getAttribute('data-id');
    const raw = state.policies.find((p) => p.id === id);
    if (!raw) return;
    raw.enabled = input.checked;
    input.parentElement.querySelector('span').textContent = raw.enabled ? 'Enabled' : 'Disabled';
    addAudit('policy.updated', 'policy:' + id, { enabled: !raw.enabled }, { enabled: raw.enabled });
  });
  grid.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-role="remove"]');
    if (!btn) return;
    const card = btn.closest('.policy-card');
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
  const actions = withActions
    ? (
      '<div class="queue-actions">' +
      '<button type="button" class="btn primary" data-approve="' + esc(p.id) + '" aria-label="Approve proposal for ' + esc(p.merchant) + '">Approve</button>' +
      '<button type="button" class="btn danger" data-reject="' + esc(p.id) + '" aria-label="Reject proposal for ' + esc(p.merchant) + '">Reject</button>' +
      '<span class="queue-note">Checkout is simulated, no live funds move.</span>' +
      '</div>'
    )
    : '<p class="queue-note">Queued Below For Your Decision.</p>';
  return (
    '<article class="card queue-card">' +
    '<div class="queue-top">' +
    '<div>' +
    '<h3>' + esc(p.merchant) + '</h3>' +
    '<p class="queue-meta">' + esc(p.item) + ', ' + esc(p.category) + ', ' + tierWord(p.tier) + ' Tier, ' + esc(fmtTs(p.ts)) + '</p>' +
    '</div>' +
    '<div class="queue-side">' +
    chipHtml(decisionWord(item.scored.decision), decisionTone(item.scored.decision)) +
    '<span class="queue-amount">' + esc(fmtMoney(p.amount)) + '</span>' +
    '</div>' +
    '</div>' +
    scoreBarHtml(item.scored.score) +
    hitsListHtml(item.evaluation.hits) +
    actions +
    '</article>'
  );
}

function renderAgentOutput(items) {
  const el = $('agent-output');
  if (!items || items.length === 0) {
    el.innerHTML = '<p class="empty">No Runs Yet. Run The Agent To Propose Purchases.</p>';
    return;
  }
  el.innerHTML = items.map((item) => queueCardHtml(item, false)).join('');
}

function renderQueue() {
  const el = $('queue-list');
  const pending = state.queue.filter((q) => q.status === 'pending').reverse();
  el.innerHTML = pending.length
    ? pending.map((item) => queueCardHtml(item, true)).join('')
    : '<p class="empty">The Queue Is Empty. Run The Agent To Propose Purchases.</p>';
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

function initLedger() {
  const wrap = $('grid-wrap');
  const status = $('grid-status');
  const agGrid = typeof window !== 'undefined' ? window.agGrid : undefined;
  try {
    if (agGrid && (typeof agGrid.createGrid === 'function' || typeof agGrid.Grid === 'function')) {
      const gridOptions = {
        rowData: rowsSorted(),
        columnDefs: LEDGER_COLUMNS.map((col) => {
          const def = {
            field: col.key,
            headerName: col.label,
            width: GRID_WIDTHS[col.key] || 120,
            sortable: true,
            resizable: true,
            filter: col.numeric ? 'agNumberColumnFilter' : true,
            enableRowGroup: GRID_GROUPABLE.includes(col.key)
          };
          if (col.key === 'merchant' || col.key === 'channel') def.flex = 1;
          if (col.kind === 'status') def.cellRenderer = (p) => chipHtml(p.value, statusTone(p.value));
          else if (col.kind === 'score') def.cellRenderer = (p) => scoreBarHtml(p.value);
          else if (col.kind === 'money') def.cellRenderer = (p) => esc(fmtMoney(p.value));
          else if (col.kind === 'ts') def.cellRenderer = (p) => esc(fmtTs(p.value));
          else if (col.kind === 'hits') def.cellRenderer = (p) => esc(hitsLabel(p.value));
          return def;
        }),
        defaultColDef: { sortable: true, filter: true, resizable: true, minWidth: 96 },
        rowGroupPanelShow: 'always',
        pagination: true,
        paginationPageSize: 25,
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
      status.textContent = 'Ledger rendered with AG Grid Community from the jsDelivr CDN. Sort, filter and drag columns to the group panel.';
      return;
    }
  } catch (err) {
    wrap.innerHTML = '';
    state.usingAgGrid = false;
  }
  state.usingAgGrid = false;
  status.textContent = 'AG Grid was not available, so the built in table is rendering the ledger. Sorting, filtering and grouping still work.';
  state.fallback = renderLedgerTable(wrap, LEDGER_COLUMNS, rowsSorted);
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

function setText(id, value) {
  $(id).textContent = value;
}

function renderStats() {
  setText('stat-pending', String(state.queue.filter((q) => q.status === 'pending').length));
  setText('stat-approved', String(state.session.approved));
  setText('stat-blocked', String(state.session.blocked));
  setText('stat-volume', fmtMoney(state.session.volume));
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
    '<div class="audit-head">' +
    '<span class="seq">#' + e.seq + '</span>' +
    chipHtml(actionLabel(e.action), auditTone(e.action)) +
    '<span class="audit-entity">' + esc(e.entity) + '</span>' +
    '<span class="audit-actor">' + esc(e.actor) + '</span>' +
    '<span class="audit-time">' + esc(fmtTs(e.ts)) + '</span>' +
    '</div>' +
    '<details class="audit-body">' +
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
  renderPolicies();
  bindPolicyEvents();
  renderAgentOutput(null);
  renderQueue();
  renderStats();
  renderAudit();
  initLedger();
  bindGlobalEvents();
}

init();
