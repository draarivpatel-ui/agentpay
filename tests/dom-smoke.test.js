import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePolicy, evaluatePolicies, riskScore } from '../js/engine.js';
import { append, verifyChain } from '../js/ledger.js';
import { runAgent, CATALOG } from '../js/agent.js';
import { defaultPolicies, seedTransactions, seedAudit } from '../js/data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(repoRoot, 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(repoRoot, 'js/app.js'), 'utf8');

test('DOM Smoke 01: index.html starts with HTML5 doctype and lang=en', () => {
  assert.match(indexHtml.trimStart(), /^<!DOCTYPE html>/i);
  assert.match(indexHtml, /<html\s+lang="en"/i);
});

test('DOM Smoke 02: index.html contains UTF-8 charset and responsive viewport meta tags', () => {
  assert.match(indexHtml, /<meta\s+charset="utf-8">/i);
  assert.match(indexHtml, /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1">/i);
});

test('DOM Smoke 03: index.html contains non-empty title and meta description', () => {
  assert.match(indexHtml, /<title>AgentPay,\s*Policy And Audit Console For AI Shopping Agents<\/title>/);
  assert.match(indexHtml, /<meta\s+name="description"\s+content="[^"]{40,}">/);
});

test('DOM Smoke 04: OpenGraph and Twitter meta tags are complete', () => {
  assert.match(indexHtml, /property="og:title"\s+content="[^"]+"/);
  assert.match(indexHtml, /property="og:description"\s+content="[^"]+"/);
  assert.match(indexHtml, /property="og:type"\s+content="website"/);
  assert.match(indexHtml, /property="og:url"\s+content="https:\/\/[^"]+"/);
  assert.match(indexHtml, /name="twitter:card"\s+content="summary_large_image"/);
});

test('DOM Smoke 05: inline SVG favicon and theme-color meta exist in <head>', () => {
  assert.match(indexHtml, /<meta\s+name="theme-color"\s+content="#060b10">/);
  assert.match(indexHtml, /<link\s+rel="icon"\s+href="data:image\/svg\+xml,/);
});

test('DOM Smoke 06: index.html contains exactly one <h1> element', () => {
  const h1Matches = indexHtml.match(/<h1\b[^>]*>/gi) || [];
  assert.equal(h1Matches.length, 1);
});

test('DOM Smoke 07: heading hierarchy in index.html never skips levels', () => {
  const levels = [...indexHtml.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  assert.equal(levels.length, 8);
  assert.equal(levels[0], 1);
  for (let i = 1; i < levels.length; i += 1) {
    assert.ok(
      levels[i] <= levels[i - 1] + 1,
      `Heading level jumped from h${levels[i - 1]} to h${levels[i]}`
    );
  }
});

test('DOM Smoke 08: all 32 id attributes in index.html are unique', () => {
  const ids = [...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 32);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length, 'Duplicate IDs found in index.html');
});

test('DOM Smoke 09: accessible skip-link points to #main and target landmark exists', () => {
  assert.match(indexHtml, /<a\s+class="skip-link"\s+href="#main">/);
  assert.match(indexHtml, /<main\s+id="main">/);
});

test('DOM Smoke 10: <noscript> fallback banner is present inside <body>', () => {
  assert.match(indexHtml, /<noscript>[\s\S]*?<\/noscript>/);
});

test('DOM Smoke 11: semantic landmarks (header, nav, main, footer) are present', () => {
  assert.match(indexHtml, /<header\b[^>]*>/);
  assert.match(indexHtml, /<nav\b[^>]*>/);
  assert.match(indexHtml, /<main\s+id="main">/);
  assert.match(indexHtml, /<footer>/);
});

test('DOM Smoke 12: all primary console and workbench section IDs exist in index.html', () => {
  const requiredIds = [
    'main', 'hero-title', 'hero-pipeline', 'console',
    'stat-pending', 'stat-approved', 'stat-blocked', 'stat-volume',
    'policies', 'policy-grid', 'agent', 'agent-count', 'run-agent', 'agent-output',
    'approvals', 'receipt-line', 'queue-list', 'engine', 'engine-waterfall',
    'ledger', 'grid-status', 'ledger-view', 'grid-wrap',
    'audit', 'audit-chain', 'audit-list'
  ];
  const htmlIds = new Set([...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  for (const id of requiredIds) {
    assert.ok(htmlIds.has(id), `Expected ID #${id} in index.html`);
  }
});

test('DOM Smoke 13: every aria-labelledby target in index.html resolves to an existing ID', () => {
  const htmlIds = new Set([...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const refs = [...indexHtml.matchAll(/\baria-labelledby="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 6);
  for (const ref of refs) {
    assert.ok(htmlIds.has(ref), `aria-labelledby target #${ref} is missing in index.html`);
  }
});

test('DOM Smoke 14: every label[for] attribute in index.html resolves to an existing form control ID', () => {
  const htmlIds = new Set([...indexHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const forIds = [...indexHtml.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(forIds.length >= 1);
  for (const id of forIds) {
    assert.ok(htmlIds.has(id), `label[for="${id}"] has no matching control ID`);
  }
});

test('DOM Smoke 15: aria-live polite regions exist for agent output, receipt line, and grid status', () => {
  assert.match(indexHtml, /id="agent-output"\s+aria-live="polite"/);
  assert.match(indexHtml, /id="receipt-line"\s+aria-live="polite"/);
  assert.match(indexHtml, /id="grid-status"\s+aria-live="polite"/);
});

test('DOM Smoke 16: styles.css enforces overflow-x: clip on html and body', () => {
  assert.match(stylesCss, /overflow-x:\s*clip/);
});

test('DOM Smoke 17: styles.css provides :focus-visible outline and reduced-motion guard', () => {
  assert.match(stylesCss, /:focus-visible\s*\{[\s\S]*?outline:/);
  assert.match(stylesCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('DOM Smoke 18: styles.css enforces tabular-nums for numeric alignment', () => {
  assert.match(stylesCss, /font-variant-numeric:\s*tabular-nums/);
});

test('DOM Smoke 19: zero em-dashes or en-dashes across HTML, CSS, and UI JS', () => {
  assert.equal(/[\u2013\u2014]/.test(indexHtml), false);
  assert.equal(/[\u2013\u2014]/.test(stylesCss), false);
  assert.equal(/[\u2013\u2014]/.test(appJs), false);
});

test('DOM Smoke 20: zero emoji characters across HTML, CSS, and UI JS', () => {
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert.equal(emojiRegex.test(indexHtml), false);
  assert.equal(emojiRegex.test(stylesCss), false);
  assert.equal(emojiRegex.test(appJs), false);
});

test('DOM Smoke 21: zero uppercase CSS transforms in styles.css', () => {
  assert.equal(/text-transform\s*:\s*uppercase/i.test(stylesCss), false);
});

test('DOM Smoke 22: zero Todo/Fixme/Lorem placeholders or personal email leaks in HTML, CSS, and JS', () => {
  const combined = `${indexHtml}\n${stylesCss}\n${appJs}`;
  assert.equal(/\b(?:TODO|FIXME|XXX|HACK|lorem ipsum)\b/i.test(combined), false);
  assert.equal(/[a-z0-9._%+-]+@gmail\.com/i.test(combined), false);
});

test('DOM Smoke 23: footer explicitly discloses simulated checkout and synthetic data', () => {
  assert.match(indexHtml, /AgentPay does not move\s+real money and has no live PayPal integration/i);
  assert.match(indexHtml, /href="LICENSE"/);
  assert.match(indexHtml, /href="NOTES\.md"/);
});

test('DOM Smoke 24: defaultPolicies and seedTransactions initialize cleanly and evaluate deterministically', () => {
  const now = Date.UTC(2026, 9, 23, 14, 0, 0);
  const policies = defaultPolicies().map(normalizePolicy);
  const txs = seedTransactions(now);
  assert.ok(policies.length >= 4);
  assert.ok(txs.length >= 8);
  const sample = {
    id: 'prop-smoke-1',
    ts: now,
    merchant: CATALOG[0].merchant,
    category: CATALOG[0].category,
    amount: 42,
    tier: 'verified',
    agent: 'Atlas'
  };
  const evalA = evaluatePolicies(policies, sample, txs);
  const evalB = evaluatePolicies(policies, sample, txs);
  assert.deepEqual(evalA, evalB);
  const score = riskScore(sample, evalA);
  assert.ok(score.score >= 0 && score.score <= 100);
});

test('DOM Smoke 25: seedAudit hash chain verifies intact and append preserves chain integrity', () => {
  const now = Date.UTC(2026, 9, 23, 15, 0, 0);
  const chain = seedAudit(now);
  assert.ok(chain.length >= 3);
  assert.equal(verifyChain(chain), true);
  const updated = append(chain, {
    ts: now,
    actor: 'operator',
    action: 'policy.toggle',
    entity: 'pol-1',
    before: { enabled: true },
    after: { enabled: false }
  });
  assert.equal(updated.length, chain.length + 1);
  assert.equal(verifyChain(updated), true);
});

test('DOM Smoke 26: runAgent generates deterministic proposal batches matching select options (3, 5, 8)', () => {
  const t0 = Date.UTC(2026, 9, 23, 12, 0, 0);
  for (const count of [3, 5, 8]) {
    assert.match(indexHtml, new RegExp(`<option value="${count}"`));
    const batch1 = runAgent(1, count, t0);
    const batch2 = runAgent(1, count, t0);
    assert.equal(batch1.length, count);
    assert.deepEqual(batch1, batch2);
  }
});
