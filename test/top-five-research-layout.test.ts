import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIVE_DISPLAY_APP_CSS,
  LIVE_DISPLAY_APP_JS,
} from '../src/adapters/ui/top-five-research-layout.js';

test('live UI highlights Top Five while every eligible pick keeps full research analysis', () => {
  assert.match(LIVE_DISPLAY_APP_JS, /Top Five Research Highlight/u);
  assert.match(LIVE_DISPLAY_APP_JS, /Additional Researched Picks/u);
  assert.match(LIVE_DISPLAY_APP_JS, /cards\.slice\(0, 5\)/u);
  assert.match(LIVE_DISPLAY_APP_JS, /cards\.slice\(5\)/u);
  assert.match(LIVE_DISPLAY_APP_JS, /Eligible picks above 50% · up to 20/u);
  assert.match(
    LIVE_DISPLAY_APP_JS,
    /every eligible pick receives full research analysis/u,
  );
  assert.match(
    LIVE_DISPLAY_APP_JS,
    /Every additional qualifying pick receives the same full research analysis/u,
  );
  assert.match(
    LIVE_DISPLAY_APP_JS,
    /highlight does not change probability, eligibility, order, or category size/u,
  );
  assert.match(LIVE_DISPLAY_APP_CSS, /\.top-five-research-shell/u);
  assert.match(LIVE_DISPLAY_APP_CSS, /\.additional-picks-shell/u);

  // Positions 6-20 retain the same analysis, last-five, and calibration blocks
  // already rendered into every server-provided pick card.
  assert.doesNotMatch(
    LIVE_DISPLAY_APP_CSS,
    /\.additional-picks-list \.analysis-grid[\s\S]*display: none !important;/u,
  );
  assert.doesNotMatch(
    LIVE_DISPLAY_APP_CSS,
    /\.additional-picks-list \.last-five-section[\s\S]*display: none !important;/u,
  );
  assert.doesNotMatch(
    LIVE_DISPLAY_APP_CSS,
    /\.additional-picks-list \.calibration[\s\S]*display: none !important;/u,
  );
  assert.doesNotMatch(
    LIVE_DISPLAY_APP_CSS,
    /\.additional-picks-list \.pick-card-content\s*\{[^}]*grid-template-columns:\s*1fr/u,
  );

  // Presentation consumes server order only; it may not add ranking or settlement math.
  assert.equal(LIVE_DISPLAY_APP_JS.includes('.sort('), false);
  assert.doesNotMatch(LIVE_DISPLAY_APP_JS, /settleObserved|settleHigher|settleLower/u);
  assert.doesNotMatch(LIVE_DISPLAY_APP_JS, /pWinGivenGrades\s*[+\-*/]/u);
});

test('live UI renders W-L-V performance evidence in every category panel', () => {
  assert.match(LIVE_DISPLAY_APP_CSS, /\.category-performance-record/u);
  assert.match(LIVE_DISPLAY_APP_JS, /categoryPerformance\?\.categories/u);
  assert.match(LIVE_DISPLAY_APP_JS, /W-L-V/u);
  assert.match(LIVE_DISPLAY_APP_JS, /summary\.wins \+ '-' \+ summary\.losses \+ '-' \+ summary\.voids/u);
  assert.match(LIVE_DISPLAY_APP_JS, /summary\.decidedPicks/u);
  assert.match(LIVE_DISPLAY_APP_JS, /win rate/u);
  assert.match(LIVE_DISPLAY_APP_JS, /Record unavailable · no completed grading evidence yet/u);
  assert.match(LIVE_DISPLAY_APP_JS, /for \(const panel of categoryPanelsNode\.querySelectorAll\('\[data-category-panel\]'\)\)/u);
});

test('category W-L-V decoration is idempotent under the MutationObserver', () => {
  assert.match(
    LIVE_DISPLAY_APP_JS,
    /existing instanceof HTMLElement && existing\.dataset\.performanceKey === performanceKey\) return;/u,
  );
  assert.match(LIVE_DISPLAY_APP_JS, /record\.dataset\.performanceKey = performanceKey/u);
  assert.match(LIVE_DISPLAY_APP_JS, /existing\.replaceWith\(record\)/u);
  assert.doesNotMatch(LIVE_DISPLAY_APP_JS, /if \(existing\) existing\.remove\(\);/u);
});
