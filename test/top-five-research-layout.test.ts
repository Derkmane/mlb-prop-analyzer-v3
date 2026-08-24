import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIVE_DISPLAY_APP_CSS,
  LIVE_DISPLAY_APP_JS,
} from '../src/adapters/ui/top-five-research-layout.js';

test('live UI separates Top Five Research from the remaining eligible category picks', () => {
  assert.match(LIVE_DISPLAY_APP_JS, /Top Five Research/u);
  assert.match(LIVE_DISPLAY_APP_JS, /Remaining Eligible Picks/u);
  assert.match(LIVE_DISPLAY_APP_JS, /cards\.slice\(0, 5\)/u);
  assert.match(LIVE_DISPLAY_APP_JS, /cards\.slice\(5\)/u);
  assert.match(LIVE_DISPLAY_APP_JS, /Eligible picks above 50% · up to 20/u);
  assert.match(
    LIVE_DISPLAY_APP_JS,
    /research subset does not change probability, eligibility, order, or category size/u,
  );
  assert.match(LIVE_DISPLAY_APP_CSS, /\.top-five-research-shell/u);
  assert.match(LIVE_DISPLAY_APP_CSS, /\.additional-picks-shell/u);
  assert.match(
    LIVE_DISPLAY_APP_CSS,
    /\.additional-picks-list \.analysis-grid,[\s\S]*display: none !important;/u,
  );

  // Presentation consumes server order only; it may not add ranking or settlement math.
  assert.equal(LIVE_DISPLAY_APP_JS.includes('.sort('), false);
  assert.doesNotMatch(LIVE_DISPLAY_APP_JS, /settleObserved|settleHigher|settleLower/u);
  assert.doesNotMatch(LIVE_DISPLAY_APP_JS, /pWinGivenGrades\s*[+\-*/]/u);
});
