// AgentPay shared formatting and small render helpers.
// All helpers return escaped HTML where the input could be dynamic, because
// cell renderers feed innerHTML in both AG Grid and the fallback table.

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

export function fmtMoney(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

export function fmtTs(ts) {
  const d = new Date(ts);
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return day + ', ' + time;
}

export const STATUS_TONE = {
  Approved: 'ok',
  Review: 'warn',
  Blocked: 'bad',
  Refunded: 'faint',
  Pending: 'accent'
};

export function statusTone(status) {
  return STATUS_TONE[status] || 'faint';
}

export function chipHtml(text, tone) {
  return '<span class="chip ' + tone + '">' + esc(text) + '</span>';
}

export function scoreTone(score) {
  return score >= 70 ? 'ok' : score >= 45 ? 'warn' : 'bad';
}

export function scoreBarHtml(score) {
  const clamped = Math.max(0, Math.min(100, Number(score) || 0));
  return (
    '<span class="score-cell">' +
    '<span class="track" aria-hidden="true"><span class="fill ' + scoreTone(clamped) + '" style="width:' + clamped + '%"></span></span>' +
    '<span class="score-num">' + clamped + '</span>' +
    '</span>'
  );
}

export function hitsLabel(count) {
  const n = Number(count) || 0;
  if (n <= 0) return 'None';
  return n === 1 ? '1 Hit' : n + ' Hits';
}

export function actionLabel(action) {
  return String(action)
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
