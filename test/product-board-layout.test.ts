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

test('every prop card puts one bold market-side-line identity immediately beside the player name', () => {
  assert.match(HHR_DISPLAY_APP_CSS, /\.pick-title-row \{/u);
  assert.match(HHR_DISPLAY_APP_CSS, /align-items: baseline;/u);
  assert.match(HHR_DISPLAY_APP_CSS, /\.pick-title-row \.player-name \{[\s\S]*font-weight: 900;/u);
  assert.match(HHR_DISPLAY_APP_CSS, /\.pick-callout \{[\s\S]*font-weight: 900;/u);
  assert.match(HHR_DISPLAY_APP_CSS, /\.pick-callout\.higher \{/u);
  assert.match(HHR_DISPLAY_APP_CSS, /\.pick-callout\.lower \{/u);
  assert.match(HHR_DISPLAY_APP_CSS, /\.pick-source-hidden \{ display: none !important; \}/u);
  assert.match(HHR_DISPLAY_APP_JS, /const decoratePickIdentity = \(card\) =>/u);
  assert.ok(HHR_DISPLAY_APP_JS.includes("card.querySelector('.chip.higher, .chip.lower')"));
  assert.ok(HHR_DISPLAY_APP_JS.includes("marketText + ' · ' + sideText + ' ' + lineText.slice(5)"));
  assert.ok(HHR_DISPLAY_APP_JS.includes("document.querySelectorAll('.pick-card')"));
  assert.match(HHR_DISPLAY_APP_JS, /observer\.observe\(archivedEvidenceNode/u);
  assert.match(HHR_DISPLAY_APP_JS, /titleRow\.append\(playerName, callout\)/u);
  assert.match(HHR_DISPLAY_APP_JS, /marketBadge\.classList\.add\('pick-source-hidden'\)/u);
  assert.match(HHR_DISPLAY_APP_JS, /sideChip\.classList\.add\('pick-source-hidden'\)/u);
  assert.match(HHR_DISPLAY_APP_JS, /lineChip\.classList\.add\('pick-source-hidden'\)/u);

  // This is display-only: no ranking, settlement, or probability math is introduced.
  assert.equal(HHR_DISPLAY_APP_JS.includes('.sort('), false);
  assert.doesNotMatch(HHR_DISPLAY_APP_JS, /settleObserved|settleHigher|settleLower/u);
  assert.doesNotMatch(HHR_DISPLAY_APP_JS, /pWinGivenGrades\s*[+\-*/]/u);
});

test('desktop cards put details left and a compact Last-5 graph on the right', () => {
  assert.match(HHR_DISPLAY_APP_CSS, /\.shell \{ width: min\(1120px, 100%\); \}/u);
  assert.match(HHR_DISPLAY_APP_CSS, /width: min\(980px, 100%\);/u);
  assert.match(HHR_DISPLAY_APP_CSS, /\.pick-card-content \{/u);
  assert.match(
    HHR_DISPLAY_APP_CSS,
    /grid-template-columns: minmax\(0, 1fr\) 340px;/u,
  );
  assert.match(HHR_DISPLAY_APP_CSS, /\.last-five-section \{ min-width: 0; \}/u);
  assert.match(HHR_DISPLAY_APP_CSS, /width: min\(330px, 100%\);/u);
  assert.match(
    HHR_DISPLAY_APP_CSS,
    /@media \(max-width: 860px\) \{[\s\S]*\.pick-card-content \{ grid-template-columns: 1fr; \}/u,
  );
  assert.match(HHR_DISPLAY_APP_JS, /const arrangeCardWithSideGraph = \(card, lastFive\) =>/u);
  assert.match(HHR_DISPLAY_APP_JS, /details\.append\(probabilities, analysis\)/u);
  assert.match(HHR_DISPLAY_APP_JS, /content\.append\(details, lastFiveSection\)/u);
  assert.match(HHR_DISPLAY_APP_JS, /arrangeCardWithSideGraph\(card, lastFive\)/u);
});

test('last five games remain a five-column visual against the current line', () => {
  assert.match(HHR_DISPLAY_APP_CSS, /\.last-five-graph/u);
  assert.match(HHR_DISPLAY_APP_CSS, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/u);
  assert.match(HHR_DISPLAY_APP_CSS, /\.last-five-line/u);
  assert.match(HHR_DISPLAY_APP_CSS, /\.last-five-bar\.cash/u);
  assert.match(HHR_DISPLAY_APP_CSS, /\.last-five-bar\.miss/u);
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