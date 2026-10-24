# AgentPay | PayPal AI Hackathon

Name: AgentPay, a policy and audit console for AI shopping agents

Description:
AgentPay answers the question every AI shopping agent will eventually raise: who says it can spend the money? It is a policy console where a person sets spend rules for an autonomous buyer, and every proposed purchase must pass through them before any money moves.

Set ceilings, category rules, velocity limits, time windows, and per merchant trust tiers in the Policy Studio. Atlas, a simulated shopping agent, proposes purchases from a synthetic catalog. A deterministic risk engine scores every proposal, shows the exact rule hits behind the score, and issues a verdict that policy can always override. Borderline buys wait in an approval queue for a human decision, and every action lands in a hash chained audit trail with before and after states that reverify on every render.

The transaction ledger runs on AG Grid with sorting, filtering, grouping, and pagination, plus a full vanilla fallback table if the grid cannot load. The checkout step is clearly labeled SIMULATED, with the PayPal sandbox wiring point documented in the README for judges to wire a real client ID. Seventy seven unit tests cover the policy engine, risk scoring, velocity checks, and audit chain.

Built with: vanilla JavaScript, AG Grid Community, node:test, and a deterministic rule engine of our own design. No live payment APIs are called in the demo.

Try it: https://aariv.me/agentpay/
Code: https://github.com/draarivpatel-ui/agentpay
