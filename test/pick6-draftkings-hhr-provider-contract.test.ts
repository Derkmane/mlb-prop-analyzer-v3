import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
  normalizeOddsApiBatterHhrCapture,
} from '../src/features/batter-hhr/index.js';

const fixture = JSON.parse(
  readFileSync('fixtures/sanitized/the-odds-api/pick6-draftkings-ladder-v1.json', 'utf8'),
) as any;

function capture(boardSource: 'pick6' | 'draftkings') {
  const source = fixture[boardSource];
  return {
    captureVersion: 1,
    capturedAt: fixture.capturedAt,
    request: {
      provider: 'The Odds API',
      bookmaker: boardSource === 'pick6' ? 'pick6' : 'draftkings',
      region: boardSource === 'pick6' ? 'us_dfs' : 'us',
      marketKeys: ['batter_hits_runs_rbis', 'batter_hits_runs_rbis_alternate'],
    },
    sourceSnapshotSha256: source.responseSha256,
    response: source.response,
  };
}

test('DraftKings HHR alternate-only ladder preserves source, lines, sides, and missing baseline', () => {
  const offers = normalizeOddsApiBatterHhrCapture(capture('draftkings'));
  assert.ok(offers.length > 0);
  assert.equal(offers.every((offer) => offer.boardSource === 'draftkings'), true);
  assert.equal(offers.every((offer) => offer.bookmaker === 'draftkings'), true);
  assert.equal(offers.every((offer) => offer.region === 'us'), true);
  assert.equal(
    offers.every((offer) => offer.settlementRuleVersion === BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_VERSION),
    true,
  );
  assert.equal(offers.every((offer) => offer.providerMarketKey === 'batter_hits_runs_rbis_alternate'), true);
  assert.equal(offers.every((offer) => offer.offerType === 'alternate'), true);
  assert.equal(offers.every((offer) => offer.offerTypeReason === 'NO_PLAYER_BASELINE'), true);
  assert.equal(offers.every((offer) => offer.selectedSide === 'higher'), true);
  assert.deepEqual([...new Set(offers.map((offer) => offer.line))].sort((a, b) => a - b), [0.5, 1.5, 2.5, 3.5, 4.5]);
  assert.equal(offers.every((offer) => offer.multiplier === null), true);
  assert.equal(offers.every((offer) => offer.providerSid === null), true);
});

test('Pick6 HHR unavailable board remains empty and cannot acquire a settlement rule by substitution', () => {
  const offers = normalizeOddsApiBatterHhrCapture(capture('pick6'));
  assert.deepEqual(offers, []);
});
