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
  assert.match(HHR_DISPLAY_APP_JS, /new MutationObserver\(revealEveryCategory\)/u);

  // Presentation may not recompute or reorder the server's canonical list.
  assert.equal(HHR_DISPLAY_APP_JS.includes('.sort('), false);
});
