import assert from 'node:assert/strict';
import test from 'node:test';

import { selectOneModelSidePerProp } from '../scripts/m10-selected-side-grade-metrics-utils.mjs';

function row({
  boardSource = 'draftkings',
  selectedSide = 'higher',
  pWinGivenGrades = 0.65,
  pWin = pWinGivenGrades,
  pLoss = 1 - pWinGivenGrades,
  outcome = 'win',
} = {}) {
  return Object.freeze({
    boardSource,
    providerBookmakerKey: boardSource,
    providerRegion: boardSource === 'draftkings' ? 'us' : 'us_dfs',
    providerEventId: 'event-one-sided-hhr',
    providerGameId: 5059999,
    providerPlayerId: 4242,
    providerMarketKey: 'batter_hits_runs_rbis_alternate',
    offerType: 'alternate',
    selectedSide,
    postedLine: 0.5,
    officialHits: 2,
    settlementVersion: 'core-observed-discrete-settlement-v1',
    archivedPWin: pWin,
    archivedPLoss: pLoss,
    archivedPVoid: 0,
    archivedPWinGivenGrades: pWinGivenGrades,
    outcome,
  });
}

test('active-source one-sided HHR retains the archived side when P(Win | grades) is at least 0.5', () => {
  const higher = row({ pWinGivenGrades: 0.65 });
  const result = selectOneModelSidePerProp([higher]);

  assert.equal(result.pairs.length, 0);
  assert.equal(result.singletons.length, 1);
  assert.deepEqual(result.selectedRows, [higher]);
});

test('active-source one-sided HHR never invents an opposite side when the archived side is below 0.5', () => {
  const higher = row({ pWinGivenGrades: 0.35, pWin: 0.35, pLoss: 0.65, outcome: 'loss' });
  const result = selectOneModelSidePerProp([higher]);

  assert.equal(result.pairs.length, 0);
  assert.equal(result.singletons.length, 1);
  assert.deepEqual(result.selectedRows, []);
  assert.equal(result.singletons[0].row, higher);
  assert.equal(result.singletons[0].selected, null);
});

test('active HHR keeps Pick6 and DraftKings singleton identities separate', () => {
  const draftkings = row({ boardSource: 'draftkings', pWinGivenGrades: 0.65 });
  const pick6 = row({ boardSource: 'pick6', selectedSide: 'lower', pWinGivenGrades: 0.7, pWin: 0.7, pLoss: 0.3 });
  const result = selectOneModelSidePerProp([draftkings, pick6]);

  assert.equal(result.pairs.length, 0);
  assert.equal(result.singletons.length, 2);
  assert.equal(result.selectedRows.length, 2);
  assert.deepEqual(
    result.selectedRows.map((entry) => entry.boardSource).sort(),
    ['draftkings', 'pick6'],
  );
});

test('normal two-sided active HHR still requires complementary probabilities and outcomes', () => {
  const higher = row({ selectedSide: 'higher', pWinGivenGrades: 0.65, pWin: 0.65, pLoss: 0.35, outcome: 'win' });
  const lower = row({ selectedSide: 'lower', pWinGivenGrades: 0.35, pWin: 0.35, pLoss: 0.65, outcome: 'loss' });

  const valid = selectOneModelSidePerProp([higher, lower]);
  assert.equal(valid.pairs.length, 1);
  assert.equal(valid.singletons.length, 0);
  assert.deepEqual(valid.selectedRows, [higher]);

  assert.throws(
    () => selectOneModelSidePerProp([higher, { ...lower, archivedPWinGivenGrades: 0.4 }]),
    /failed complementary probability integrity/u,
  );
});

test('singleton compatibility remains unavailable to non-HHR markets', () => {
  const hits = Object.freeze({
    ...row(),
    providerMarketKey: 'batter_hits',
    offerType: 'baseline',
  });
  assert.throws(
    () => selectOneModelSidePerProp([hits]),
    /must contain exactly one Higher and one Lower row/u,
  );
});
