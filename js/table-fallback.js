// AgentPay built in ledger table.
// This renders when the AG Grid CDN script cannot load (offline demo, blocked
// CDN, jsDelivr outage). It keeps the abilities that matter for the demo:
// column sorting, text and status filters, and grouped sections with row
// counts and amount subtotals. Keyboard operable: every control is a native
// button, input or select.

import { esc, fmtMoney, fmtTs, statusTone, chipHtml, scoreBarHtml, hitsLabel } from './format.js';

const GROUPABLE = ['merchant', 'category', 'status', 'tier', 'agent', 'channel'];
const STATUS_VALUES = ['Approved', 'Review', 'Blocked', 'Refunded'];

// columns: [{ key, label, kind, numeric }], getRows: () => array of rows.
// Returns { refresh } so the app can re-render after ledger changes.
export function renderLedgerTable(container, columns, getRows) {
  let sortKey = 'ts';
  let sortDir = 'desc';
  let query = '';
  let groupBy = '';
  let statusFilter = 'All';

  const groupOptions = columns
    .filter((c) => GROUPABLE.includes(c.key))
    .map((c) => '<option value="' + esc(c.key) + '">' + esc(c.label) + '</option>')
    .join('');
  const statusOptions = ['All'].concat(STATUS_VALUES)
    .map((s) => '<option value="' + esc(s) + '">' + esc(s) + '</option>')
    .join('');

  container.innerHTML =
    '<div class="tf-shell">' +
    '<div class="tf-controls">' +
    '<input type="search" class="tf-search" placeholder="Filter Rows" aria-label="Filter Ledger Rows By Text">' +
    '<label class="tf-pick">Group By ' +
    '<select class="tf-group" aria-label="Group Rows By"><option value="">None</option>' + groupOptions + '</select>' +
    '</label>' +
    '<label class="tf-pick">Status ' +
    '<select class="tf-status" aria-label="Filter Rows By Status">' + statusOptions + '</select>' +
    '</label>' +
    '<span class="tf-count" aria-live="polite"></span>' +
    '</div>' +
    '<div class="table-scroll">' +
    '<table class="tf-table">' +
    '<caption class="visually-hidden">Transaction Ledger, Synthetic And Session Data</caption>' +
    '<thead><tr>' +
    columns.map((c) =>
      '<th scope="col" data-key="' + esc(c.key) + '"' + (c.numeric ? ' class="num"' : '') + '>' +
      '<button type="button" data-key="' + esc(c.key) + '">' + esc(c.label) + '</button>' +
      '</th>'
    ).join('') +
    '</tr></thead>' +
    '<tbody></tbody>' +
    '</table>' +
    '</div>' +
    '</div>';

  const tbody = container.querySelector('.tf-table tbody');
  const theadRow = container.querySelector('.tf-table thead tr');
  const search = container.querySelector('.tf-search');
  const groupSel = container.querySelector('.tf-group');
  const statusSel = container.querySelector('.tf-status');
  const countEl = container.querySelector('.tf-count');

  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    renderBody();
  });
  groupSel.addEventListener('change', () => {
    groupBy = groupSel.value;
    renderBody();
  });
  statusSel.addEventListener('change', () => {
    statusFilter = statusSel.value;
    renderBody();
  });
  theadRow.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-key]');
    if (!btn) return;
    const key = btn.getAttribute('data-key');
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
    renderBody();
  });

  function visibleRows() {
    let rows = getRows().slice();
    if (statusFilter !== 'All') rows = rows.filter((r) => r.status === statusFilter);
    if (query) {
      rows = rows.filter((r) => {
        const haystack = [r.id, r.merchant, r.category, r.tier, r.agent, r.channel, r.status]
          .map((v) => String(v == null ? '' : v).toLowerCase())
          .join(' ');
        return haystack.indexOf(query) !== -1;
      });
    }
    const col = columns.find((c) => c.key === sortKey) || columns[0];
    const dir = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (col.numeric) return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
      return String(av == null ? '' : av).localeCompare(String(bv == null ? '' : bv)) * dir;
    });
    return rows;
  }

  function cellHtml(row, col) {
    const v = row[col.key];
    switch (col.kind) {
      case 'money': return esc(fmtMoney(v));
      case 'ts': return esc(fmtTs(v));
      case 'status': return chipHtml(v == null ? '' : v, statusTone(v));
      case 'score': return scoreBarHtml(v);
      case 'hits': return esc(hitsLabel(v));
      default: return esc(v == null ? '' : v);
    }
  }

  function rowHtml(row) {
    return '<tr>' + columns.map((c) => {
      const cls = c.numeric ? ' class="num"' : '';
      return '<td' + cls + '>' + cellHtml(row, c) + '</td>';
    }).join('') + '</tr>';
  }

  function emptyHtml() {
    return '<tr class="tf-empty"><td colspan="' + columns.length + '">No Rows Match The Current Filters</td></tr>';
  }

  function renderBody() {
    const rows = visibleRows();
    const all = getRows().length;
    if (groupBy) {
      const groups = new Map();
      for (const r of rows) {
        const key = String(r[groupBy] == null ? 'None' : r[groupBy]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }
      const label = (columns.find((c) => c.key === groupBy) || {}).label || groupBy;
      let html = '';
      for (const [key, list] of groups) {
        const subtotal = list.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
        html += '<tr class="tf-group"><th colspan="' + columns.length + '" scope="colgroup">' +
          esc(label) + ': ' + esc(key) +
          '<span class="tf-sub">' + list.length + (list.length === 1 ? ' Row, ' : ' Rows, ') + esc(fmtMoney(subtotal)) + '</span>' +
          '</th></tr>';
        html += list.map(rowHtml).join('');
      }
      tbody.innerHTML = rows.length ? html : emptyHtml();
    } else {
      tbody.innerHTML = rows.map(rowHtml).join('') || emptyHtml();
    }
    countEl.textContent = rows.length === all
      ? all + ' Rows Shown'
      : rows.length + ' Of ' + all + ' Rows Shown';
    for (const th of theadRow.children) {
      if (th.getAttribute('data-key') === sortKey) {
        th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
      } else {
        th.removeAttribute('aria-sort');
      }
    }
  }

  renderBody();
  return { refresh: renderBody };
}
