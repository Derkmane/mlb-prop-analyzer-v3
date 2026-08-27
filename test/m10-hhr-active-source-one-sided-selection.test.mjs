import assert from 'node:assert/strict';
import test from 'node:test';

import { selectHhrModelSidesForEvidence } from '../scripts/m10-hhr-evidence-utils.mjs';

function row({
  boardSource = null,
  providerBookmakerKey = null,
  providerRegion = null,
  selectedSide = 'higher',
  pWinGivenGrades = 0.7,
  pWin = pWinGivenGrades,
  pLoss = 1 - pWin,
  outcome = 'win',
  eventId = '187cbd24b1e45a99e9ecaf256baeb7c1',
  gameId = 5059753,
  playerId = 1521,
}) {
  return Object.freeze({
    providerEventId: eventId,
    providerGameId: gameId,
    providerPlayerId: playerId,
    boardSource,
    providerBookmakerKey,
    providerRegion,
    providerMarketKey: 'batter_hits_runs_rbis_alternate',
    offerType: 'alternate',
    selectedSide,
    postedLine: 0.5,
    archivedPWin: pWin,
    archivedPLoss: pLoss,
    archivedPVoid: 0,
    archivedPWinGivenGrades: pWinGivenGrades,
    officialHits: 2,
    settlementVersion: 'observed-discrete-statistic-settlement-v1',
    outcome,
  });
}

test('DraftKings one-sided HHR alternate is selected without synthesizing a missing side', () => {
  const singleton = row({
    boardSource: 'draftkings',
    providerBookmakerKey: 'draftkings',
    providerRegion: 'us',
  });
  const result = selectHhrModelSidesForEvidence([singleton]);
  assert.deepEqual(result.selectedRows, [singleton]);
});

test('Pick6 one-sided HHR offer is selected when its archived selected-side probability is at least 50%', () => {
  const singleton = row({
    boardSource: 'pick6',
    providerBookmakerKey: 'pick6',
    providerRegion: 'us_dfs',
    pWinGivenGrades: 0.62,
    pWin: 0.62,
    pLoss: 0.38,
  });
  const result = selectHhrModelSidesForEvidence([singleton]);
  assert.deepEqual(result.selectedRows, [singleton]);
});

test('active-source singleton below 50% is not promoted into selected-side evidence', () => {
  const singleton = row({
    boardSource: 'draftkings',
    providerBookmakerKey: 'draftkings',
    providerRegion: 'us',
    pWinGivenGrades: 0.49,
    pWin: 0.49,
    pLoss: 0.51,
    outcome: 'loss',
  });
  const result = selectHhrModelSidesForEvidence([singleton]);
  assert.deepEqual(result.selectedRows, []);
});

test('duplicate same-side active-source rows still fail closed', () => {
  const first = row({
    boardSource: 'draftkings',
    providerBookmakerKey: 'draftkings',
    providerRegion: 'us',
  });
  const duplicate = Object.freeze({ ...first });
  assert.throws(
    () => selectHhrModelSidesForEvidence([first, duplicate]),
    /must contain one Higher and one Lower row/u,
  );
});

test('legacy source-null singleton remains invalid', () => {
  const singleton = row({ boardSource: null, providerBookmakerKey: null, providerRegion: null });
  assert.throws(
    () => selectHhrModelSidesForEvidence([singleton]),
    /must contain exactly one Higher and one Lower row/u,
  );
});

test('legacy complementary Higher/Lower pair retains strict selected-side behavior', () => {
  const higher = row({
    selectedSide: 'higher',
    pWinGivenGrades: 0.7,
    pWin: 0.7,
    pLoss: 0.3,
    outcome: 'win',
  });
  const lower = row({
    selectedSide: 'lower',
    pWinGivenGrades: 0.3,
    pWin: 0.3,
    pLoss: 0.7,
    outcome: 'loss',
  });
  const result = selectHhrModelSidesForEvidence([higher, lower]);
  assert.deepEqual(result.selectedRows, [higher]);
});

test('same prop from DraftKings and Pick6 remains source-separated', () => {
  const draftkings = row({
    boardSource: 'draftkings',
    providerBookmakerKey: 'draftkings',
    providerRegion: 'us',
    pWinGivenGrades: 0.7,
    pWin: 0.7,
    pLoss: 0.3,
  });
  const pick6 = row({
    boardSource: 'pick6',
    providerBookmakerKey: 'pick6',
    providerRegion: 'us_dfs',
    pWinGivenGrades: 0.65,
    pWin: 0.65,
    pLoss: 0.35,
  });
  const result = selectHhrModelSidesForEvidence([draftkings, pick6]);
  assert.equal(result.selectedRows.length, 2);
  assert.ok(result.selectedRows.includes(draftkings));
  assert.ok(result.selectedRows.includes(pick6));
});
