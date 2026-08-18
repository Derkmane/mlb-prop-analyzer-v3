import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HHR_DISPLAY_APP_CSS,
  HHR_DISPLAY_APP_JS,
} from '../src/adapters/index.js';
import { RESEARCH_DISPLAY_MARKETS } from '../src/application/index.js';
import { BATTER_HHR_MARKET_KEY } from '../src/features/batter-hhr/manifest.js';
import { BATTER_HITS_MARKET_KEY } from '../src/features/batter-hits/manifest.js';

test('live research board keeps Hits and HHR as its two current source markets', () => {
  assert.deepEqual(RESEARCH_DISPLAY_MARKETS, [
    BATTER_HITS_MARKET_KEY,
    BATTER_HHR_MARKET_KEY,
  ]);
});

test('all three category panels are visible and ranked picks read top to bottom', () => {
  assert.match(HHR_DISPLAY_APP_CSS, /#category-tabs \{ display: none; \}/u);
  assert.match(HHR_DISPLAY_APP_CSS, /#category-panels \{ display: grid; gap: 18px; \}/u);
  assert.match(
    HHR_DISPLAY_APP_CSS,
    /\.pick-list \{ grid-template-columns: 1fr !important; counter-reset: product-pick-rank; \}/u,
  );
  assert.match(HHR_DISPLAY_APP_CSS, /content: "#" counter\(product-pick-rank\)/u);
  assert.match(HHR_DISPLAY_APP_JS, /const revealEveryCategory = \(\) =>/u);
  assert.match(HHR_DISPLAY_APP_JS, /panel\.hidden = false/u);
  assert.match(HHR_DISPLAY_APP_JS, /new MutationObserver/u);

  // Presentation may not recompute or reorder the server's canonical list.
  assert.equal(HHR_DISPLAY_APP_JS.includes('.sort('), false);
});

test('desktop cards and probability/context columns stay compact', () => {
  assert.match(HHR_DISPLAY_APP_CSS, /\.shell \{ width: min\(1120px, 100%\); \}/u);
  assert.match(HHR_DISPLAY_APP_CSS, /width: min\(980px, 100%\);/u);
  assert.match(HHR_DISPLAY_APP_CSS, /\.prob-grid \{ max-width: 760px; \}/u);
  assert.match(HHR_DISPLAY_APP_CSS, /\.analysis-grid \{ max-width: 820px; \}/u);
});

test('last five games render as a compact readable five-column visual against the current line', () => {
  assert.match(HHR_DISPLAY_APP_CSS, /\.last-five-graph/u);
  assert.match(HHR_DISPLAY_APP_CSS, /width: min\(620px, 100%\);/u);
  assert.match(HHR_DISPLAY_APP_CSS, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/u);
  assert.match(HHR_DISPLAY_APP_CSS, /\.last-five-line/u);
  assert.match(HHR_DISPLAY_APP_CSS, /\.last-five-bar\.cash/u);
  assert.match(HHR_DISPLAY_APP_CSS, /\.last-five-bar\.miss/u);
  assert.match(HHR_DISPLAY_APP_CSS, /font-size: \.76rem;/u);
  assert.match(HHR_DISPLAY_APP_CSS, /font-size: \.74rem;/u);
  assert.match(HHR_DISPLAY_APP_JS, /const decorateLastFiveGraph = \(lastFive\) =>/u);
  assert.match(HHR_DISPLAY_APP_JS, /String\(lineChip\?\.textContent \|\| ''\)\.slice\(5\)/u);
  assert.match(HHR_DISPLAY_APP_JS, /currentLine \/ plotMaximum/u);
  assert.match(HHR_DISPLAY_APP_JS, /result\.actual \/ plotMaximum/u);
  assert.match(HHR_DISPLAY_APP_JS, /Green = cash · Red = miss · Gold = void/u);
  assert.match(HHR_DISPLAY_APP_JS, /lastFive\.replaceChildren\(graph\)/u);

  // The graph is presentation only; outcomes arrive from the server.
  assert.doesNotMatch(HHR_DISPLAY_APP_JS, /settleObserved|settleHigher|settleLower/u);
  assert.equal(HHR_DISPLAY_APP_JS.includes('.sort('), false);
});
