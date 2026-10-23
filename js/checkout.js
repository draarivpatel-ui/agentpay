// AgentPay simulated checkout stub.
// This module never touches the network and never moves real money. It
// exists so the demo has a complete flow (approve, then checkout, then
// ledger row) and so the real sandbox wiring has exactly one obvious home.

// PAYPAL SANDBOX WIRING POINT. See README, section "Sandbox Wiring".
// Today: SANDBOX_CLIENT_ID is empty and createCheckout() returns a simulated
// receipt. When a sandbox client id is available:
//   1. Paste the client id into the SANDBOX_CLIENT_ID constant below, or set
//      window.PAYPAL_SANDBOX_CLIENT_ID before js/app.js runs.
//   2. Uncomment the PayPal JS SDK script tag in index.html where it is
//      marked, and put the same client id there.
//   3. Replace the body of createCheckout() with real Orders API calls
//      against the sandbox environment.
//   4. Update the UI labels from "Simulated" to "Sandbox" so the page stays
//      honest about what is real.
export const SANDBOX_CLIENT_ID =
  (typeof window !== 'undefined' && window.PAYPAL_SANDBOX_CLIENT_ID) || '';

export function isWired() {
  return typeof SANDBOX_CLIENT_ID === 'string' && SANDBOX_CLIENT_ID.length > 0;
}

function orderNumber(proposal) {
  let h = 0x811c9dc5;
  const text = proposal.id + ':' + proposal.ts;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).toUpperCase().padStart(8, '0');
}

// Return a simulated receipt for an approved proposal. Deterministic per
// proposal: the same proposal always yields the same order id, so re running
// a demo does not fork the ledger.
export function createCheckout(proposal, ts) {
  const at = typeof ts === 'number' ? ts : Date.now();
  return {
    orderId: 'SIM-' + orderNumber(proposal),
    status: 'Simulated Complete',
    provider: 'Simulated PayPal Sandbox',
    merchant: proposal.merchant,
    amount: proposal.amount,
    currency: proposal.currency || 'USD',
    live: false,
    wired: isWired(),
    ts: at
  };
}
