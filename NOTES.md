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
  sorting, text and number filters, pagination and keyboard navigation (row grouping is an
  Enterprise feature, so the Grouped Table toggle swaps in the built in table). When
  the CDN cannot load, that built in vanilla JS table takes over automatically with sorting, text and
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
- The transaction ledger is the centerpiece: AG Grid Community sorting and filtering, plus a built
  in table with grouped subtotals, one toggle away and automatic when the CDN is unreachable.
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

## Refinement Pass 2026-10-24

A defect and polish sweep over the deployed build. No art direction, feature or dependency
changed. Tests before the pass, 77 passing. Tests after the pass, 77 passing.

Defects found and fixed.

- The page threw a TypeError on every normal load. `defaultPolicies()` returned raw policy
  objects without `allowedHours` or `enabled`, and both `renderHeroPipeline` (via
  `matched.allowedHours[0]`) and `renderPolicies` (via `p.allowedHours[0]` and `p.enabled`)
  read those fields directly. The hero pipeline, policy studio, queue, ledger and audit all
  died at init because `init()` aborted at the first render. Fix, `data.js` now routes each
  starter policy through `normalizePolicy` and spreads it into a fresh unfrozen copy, so the
  defaults the engine fills in (hours 0 to 24, enabled true) are present for the renderers
  and the toggle handler can still write `enabled`. The hero sample verdict is unchanged
  (score 22, review, ceiling and tier hits) because `evaluatePolicies` was already
  normalizing internally.
- Token level contrast near misses, computed with the WCAG formula from the oklch tokens.
  `--faint` on `--ink-2` measured 4.39 to 1 (the audit chip `.chip.faint` renders that pair
  at 0.72rem), now raised from L 0.60 to L 0.62, which measures 4.76 to 1 on `--ink-2` and
  improves every other faint surface. `--bad-strong` at 0.45 alpha measured 2.20 to 1 as the
  danger button border, raised to 0.6 alpha for 3.08 to 1 against `--ink-0`, past the 3 to 1
  non text boundary bar. All other text pairs on their real backgrounds measure 4.7 to 1 or
  better.
- `theme-color` was `#0b0f16`, close to but not the canvas token. Computed `--ink-0` from the
  CSS Color 4 algorithm is `#060b10`, so the meta now matches the page background exactly.

Checked and found already sound. Every id the JS looks up exists in the HTML (26 references,
including the dynamically rendered add policy form), no duplicate ids, no dead event
listeners, no console paths reachable on load now that the init throw is fixed. The fallback
ledger table keeps native controls with real labels and `aria-sort`. Skip link, focus visible
rings, aria live regions on the queue, receipt, grid status, policy error and agent output
are all in place. Reduced motion is fully honored in CSS and the reveal and ticker code paths
check `prefers-reduced-motion` before animating; the only JS animation runs on
requestAnimationFrame, which pauses in hidden tabs, and the only CSS animation is decorative
pipeline flow. Copy carries no em or en dashes, no emoji, no all caps kickers, and no
text-transform anywhere. No layout overflows at 320 px, the wide fallback table scrolls
inside its own container and every grid collapses to single column by 640 px.

Noted, not forced. The AG Grid CDN stylesheet and script stay external by design (the built
in fallback table covers the offline case). The `ag-*` selectors in the stylesheet style the
grid library's own runtime DOM and are not removable without breaking the themed grid.
