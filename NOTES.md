# AgentPay Build Notes

Written during the overnight build session on 2026-10-23 for the PayPal AI Hackathon (deadline
Nov 12). Everything below reflects the actual state of the repo at the end of that session, and
nothing here claims more than what was run and checked.

## What Was Built

AgentPay is a policy and audit console for AI shopping agents that spend through PayPal. It is a
static single page app (one `index.html`, vanilla HTML, CSS and JS, plus AG Grid Community from a
CDN) with zero build step and zero dependencies to install.

- **Policy Studio.** Five seeded starter policies plus a full add form. Each policy carries a
  merchant scope, a category scope, an amount ceiling, a velocity window with transaction count
  and spend caps, an allowed UTC hour range, a minimum trust tier, and an action on violation
  (allow, review, or block). Policies can be toggled and removed, and every change appends an
  audit entry.
- **Simulated Shopping Agent.** Atlas, a seeded generator over a ten merchant synthetic catalog,
  proposes 3, 5 or 8 purchases per run. The same seed always produces the same proposals.
- **Deterministic Risk Engine.** Rule hits (ceiling, velocity count, velocity spend, hours, tier,
  and a `no.match` default that sends unmatched spending to review), a 0 to 100 composite score
  with visible signals, and decision precedence where a policy verdict always beats the score.
- **Approval Queue And Simulated Checkout.** Pending proposals wait for a human decision.
  Approving runs the simulated checkout stub (no network, clearly labeled) and writes an Approved
  ledger row; rejecting writes a Blocked row.
- **Transaction Ledger.** The centerpiece. AG Grid Community v32 from the jsDelivr CDN with
  sorting, text and number filters, a row group panel, pagination and keyboard navigation. When
  the CDN cannot load, a built in vanilla JS table takes over automatically with sorting, text and
  status filters, and grouped sections with row counts and amount subtotals.
- **Audit Trail.** Append only, FNV 1a hash chained, verified on every render, with expandable
  before and after states per entry.

## Test Results (From The Actual Run)

Command, run from the repo root:

```
node --test tests/
```

Actual output summary:

```
tests 77
suites 0
pass 77
fail 0
cancelled 0
skipped 0
duration_ms 52.141042
```

Assertion calls counted by grep across the five test files: **171** (engine 53, risk 35, ledger
42, velocity 22, agent 19). That clears the 40 assertion minimum with room to spare, the runtime
is 0.05 seconds against the 30 second cap, and no test touches the network.

## Honest Caveats

- **Nothing was rendered tonight.** The session constraints forbade launching a browser, so the
  UI is verified by careful code review, `node --check` on all eight JS modules, and a Node smoke
  test of the full engine flow (seed data, scoring, simulated receipts). The visual pass is still
  owed before submission.
- **The AG Grid CDN tags were not live fetched.** They are pinned to v32.3.3 from knowledge of
  that version's dist layout. If the URL were wrong or jsDelivr were down, the page handles it:
  the script `onerror` and the missing `window.agGrid` global both route the ledger to the built
  in fallback table, which is complete but was also only logic reviewed, not exercised live.
- **The checkout is a stub and stays one.** It makes no network call and returns a simulated
  receipt. The sandbox wiring point is documented in `js/checkout.js` and the README, but it has
  never been run against a real sandbox because no client id exists yet.
- **Engine constants are product choices, not research.** The 62 base score, tier adjustments and
  penalty weights were picked to make the demo legible, not calibrated against real fraud data.
- **Time windows are UTC.** The UI says so, but a real deployment would want owner local time.
- **The audit hash is FNV 1a 32 bit.** Deterministic and tamper visible, not cryptographic, and
  the code says so.
- **No persistence.** State lives in memory; a reload resets the demo to synthetic seed data.

## Five Devpost Description Bullets

- A deterministic risk engine you can actually audit: rule hits, velocity checks, trust tiers and
  score clamps, with 77 passing tests proving the same proposal always gets the same decision.
- The transaction ledger is the centerpiece: AG Grid Community sorting, filtering and a row group
  panel, plus a built in fallback table that takes over automatically when the CDN is unreachable.
- Every decision lands in an append only, hash chained audit trail with before and after states,
  reverified on every render and expandable entry by entry.
- An honest simulated checkout: one documented wiring point where a PayPal sandbox client id
  plugs in later, clear labels today, and no claim of live integration anywhere.
- Zero build step and zero dependencies: a static single page app that deploys to GitHub Pages as
  is, with tests on the Node built in runner (`node --test tests/`).

## File Tree

```
agentpay/
  index.html              Single page app entry, semantic sections, AG Grid CDN tags
  styles.css              Design system: one dark palette, system font stack, responsive
  package.json            Module type and test script only, zero dependencies
  LICENSE                 MIT
  README.md
  NOTES.md                This file
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
    engine.test.js        Policy normalization and evaluation (24 tests)
    risk.test.js          Score determinism, thresholds, clamps, decisions (13 tests)
    velocity.test.js      Sliding window count and spend checks (11 tests)
    ledger.test.js        Immutable append, hash chain, verification, diffing (19 tests)
    agent.test.js         Seeded generation, shape, and limits (10 tests)
```
