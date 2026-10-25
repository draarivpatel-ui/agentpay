# AgentPay

A policy and audit console for AI shopping agents that spend through PayPal. An owner configures
spend policies, a simulated agent proposes purchases, a deterministic risk engine scores every
proposal against those policies, and every decision lands in an approval queue and an immutable,
hash chained audit trail with before and after states.

The checkout step is simulated end to end. Nothing in this repo moves real money, calls PayPal, or
claims to.

## What It Is

AgentPay is built for a specific question: when an autonomous agent is allowed to spend, who
checks its work? The console answers it with four connected surfaces.

1. **Policy Studio.** The owner writes policies with per merchant limits, category rules, amount
   ceilings, velocity caps (transaction count and spend per sliding window), time windows in UTC
   hours, and minimum trust tiers. Policies can be added, toggled, and removed, and every change
   is appended to the audit trail.
2. **Simulated Agent.** Atlas is a scripted generator, not a live model. Runs are seeded, so the
   same run always proposes the same purchases from a synthetic catalog of ten merchants.
3. **Deterministic Risk Engine.** Every proposal is scored against every enabled, matching policy.
   Rule hits, velocity checks, and trust tiers produce a 0 to 100 score and a decision. Same
   inputs, same outputs, on every machine, with no clock reads inside the engine.
4. **Approval Queue, Ledger, And Audit Trail.** Proposals wait for a human decision. Approving
   runs the simulated checkout stub and writes a ledger row. The ledger is the centerpiece: an
   AG Grid Community table with sorting and filtering, plus a built in vanilla JS table that groups
   rows with counts and subtotals (one click away, and automatic when the CDN cannot load). The audit trail is append only, hash chained, and
   reverified on every render, with expandable before and after states.

## Features That Work Today

- Policy Studio: add, enable and disable, and remove policies at run time.
- Seeded agent runs of 3, 5, or 8 proposals, each scored before entering the queue.
- Rule hits for amount ceilings, transaction count velocity, window spend velocity, UTC time
  windows, and trust tier minimums, plus a `no.match` default that sends unmatched spending to
  review instead of silently allowing it.
- A deterministic 0 to 100 risk score with visible signals (base, tier adjust, amount penalty,
  velocity penalty, hit penalty).
- An approval queue with approve and reject actions and a clearly labeled simulated checkout step.
- An AG Grid Community v32 ledger (loaded from the jsDelivr CDN) with sortable columns, text and
  number filters, pagination, and keyboard navigation. Row grouping is an AG Grid Enterprise
  feature, so grouping lives in the built in table instead.
- A built in table, one click away through the Grouped Table toggle and used automatically when
  the AG Grid CDN is unreachable, that keeps
  sorting, text and status filters, and grouped sections with row counts and amount subtotals.
- An append only audit trail with FNV 1a hash chaining, chain verification, and before and after
  state diffs per entry.
- 77 tests (171 assertions) across 5 test files, all offline.

## How The Risk Engine Decides

Each enabled policy whose merchant and category match the proposal can raise rule hits. A hit
carries the severity of its policy action: `block` policies hit hard, `review` policies hit
medium, and `allow` policies record informational hits.

| Rule | Fires when |
| --- | --- |
| `ceiling` | The amount exceeds the policy max amount. |
| `velocity.count` | Prior transactions for the merchant inside the window reach the per window cap. |
| `velocity.spend` | Prior window spend plus this amount exceeds the per window spend cap. |
| `hours` | The proposal hour (UTC) falls outside the allowed start and end pair. |
| `tier` | The proposal trust tier ranks below the policy minimum. |
| `no.match` | No enabled policy matched at all, which sends the proposal to review. |

Decision precedence: any `block` severity hit means blocked, otherwise any `review` severity hit
means review, otherwise the composite score decides, and a score below 45 drops a clean proposal
to review. The score starts at 62, adjusts by trust tier (guest minus 14, premium plus 14),
subtracts penalties for amount size (capped at 20), velocity (capped at 24), and rule hits
(capped at 40), and clamps to 0 through 100. A policy verdict always beats the score: a block hit
blocks even at a high score.

## Sandbox Wiring

This is exactly where a real PayPal sandbox client id plugs in when one is available. Until then
every label in the UI says simulated, because it is.

1. **Constant.** `js/checkout.js` defines `SANDBOX_CLIENT_ID`. It reads
   `window.PAYPAL_SANDBOX_CLIENT_ID` first, so you can also set that global before `js/app.js`
   runs. Paste your sandbox client id into either place.
2. **SDK Tag.** `index.html` has a commented script tag marked
   `PAYPAL SANDBOX WIRING` in the head. Uncomment it and replace `YOUR_SANDBOX_CLIENT_ID` with the
   same sandbox client id.
3. **Call Site.** Replace the body of `createCheckout(proposal, ts)` in `js/checkout.js` with real
   Orders API calls against the sandbox environment. It currently returns a simulated receipt
   object (`orderId`, `status`, `provider`, `amount`, `live: false`, `wired`) and makes no network
   request of any kind.
4. **Relabel.** When the sandbox is actually wired, update the UI labels from "Simulated" to
   "Sandbox" so the page stays honest about what is real. `isWired()` in `js/checkout.js` already
   reports whether a client id is present, and the receipt line in the approval queue uses it.

## Running Locally

The app is a static single page app with zero build step and zero dependencies to install. Serve
it over HTTP so the ES modules and the AG Grid CDN load:

```
python3 -m http.server 8080
# then open http://localhost:8080
```

Without network access, the AG Grid script fails to load and the built in fallback table renders
the ledger automatically. Everything else works offline.

Run the tests with Node 18 or newer (no install step, no network):

```
node --test tests/
```

## Project Structure

```
agentpay/
  index.html              Single page app entry, semantic sections, AG Grid CDN tags
  styles.css              Design system: one dark palette, system font stack, responsive
  package.json            Module type and test script only, zero dependencies
  LICENSE                 MIT
  README.md
  NOTES.md                Build notes from the overnight session
  js/
    engine.js             Policy normalization, evaluation, velocity checks, risk score
    ledger.js             Append only hash chained audit ledger with diffing
    agent.js              Seeded simulated shopping agent and synthetic catalog
    checkout.js           Simulated checkout stub and the sandbox wiring point
    data.js               Synthetic seed policies, ledger rows and audit entries
    format.js             Shared formatting and escaped HTML helpers
    table-fallback.js     Built in ledger table for when the CDN is unreachable
    app.js                State, rendering, event wiring, AG Grid bootstrap
  tests/
    engine.test.js        Policy normalization and evaluation
    risk.test.js          Score determinism, thresholds, clamps, decision mapping
    velocity.test.js      Sliding window count and spend checks
    ledger.test.js        Immutable append, hash chain, verification, diffing
    agent.test.js         Seeded generation, shape, and limits
```

## Design And Accessibility

- One cohesive dark navy palette with a single blue accent and semantic status colors.
- System font stack, generous whitespace, Title Case headings, no emoji icons, no all caps labels,
  and no em dashes or en dashes anywhere in the copy.
- Semantic landmarks (`header`, `nav`, `main`, `section`, `footer`), labelled sections, aria live
  regions for queue and receipt updates, aria labels on every icon free control, a skip link, and
  visible focus rings.
- Every interactive control is a native button, input, select or checkbox, so the whole page is
  keyboard operable. AG Grid adds its own keyboard cell navigation when present.
- Fully responsive from desktop down to phones, and `prefers reduced motion` disables transitions.

## Data And Honesty

- All data in this app is synthetic and generated at load from fixed seeds. The page footer says
  so, and so does this README.
- There is no live PayPal integration, no pending integration claim, no pilot, no customer, no
  testimonial, and no metric in this repo that was not produced by the test suite or the app
  itself.
- The audit hash is FNV 1a 32 bit. It makes tampering visible in a demo; it is not cryptographic,
  and the code comments say exactly that.

## License And Author

MIT. See `LICENSE`. Written by Aariv Patel.
