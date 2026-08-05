import assert from 'node:assert/strict';
import test from 'node:test';

import {
  selectHighProbabilityAltlinePropsV1,
  selectHighProbabilityBaselinePropsV1,
  selectTopFiveV1,
  TOP_FIVE_LIMIT,
  type CategoryOfferInput,
} from '../src/categories/index.js';
import type { PredictionCandidate } from '../src/domain/prediction-candidate.js';

type TestCandidate = PredictionCandidate<Readonly<{ identity: string }>>;

function candidate(identity: string, pFinal: number, playerId = `player-${identity}`): TestCandidate {
  return Object.freeze({
    eventId: `event-${identity}`,
    gameId: `game-${identity}`,
    playerId,
    playerName: `Player ${identity}`,
    baseMarketKey: 'batter-hits',
    marketLabel: 'Batter Hits',
    line: 0.5,
    selectedSide: 'higher',
    settlementStatistic: 'hits',
    eligibilityProbability: 1,
    statisticDistribution: Object.freeze({
      probabilities: Object.freeze([1 - pFinal, pFinal]),
    }),
    pWin: pFinal,
    pLoss: 1 - pFinal,
    pVoid: 0,
    pWinGivenGrades: pFinal,
    modelVersion: 'model-v1',
    distributionBuilderVersion: 'distribution-v1',
    settlementRuleVersion: 'settlement-v1',
    sharedScenarioReference: Object.freeze({ identity }),
    featureData: Object.freeze({
      featureId: 'batter-hits',
      schemaVersion: 2,
      values: Object.freeze({}),
    }),
  });
}

function input(
  value: TestCandidate,
  offerType: 'baseline' | 'alternate',
): CategoryOfferInput<TestCandidate> {
  return Object.freeze({
    candidate: value,
    offerType,
    americanPrice: -110,
    multiplier: 1,
    postedImpliedProbability: 110 / 210,
    priceEdge: 0,
  });
}

test('Top Five returns exactly the first five when more than five are eligible', () => {
  const eligible = Object.freeze(
    Array.from({ length: 8 }, (_, index) => candidate(String(index + 1), 0.8 - index * 0.01)),
  );
  const result = selectTopFiveV1(eligible);

  assert.equal(TOP_FIVE_LIMIT, 5);
  assert.equal(result.length, 5);
  assert.deepEqual(
    result.map((entry) => entry.playerId),
    eligible.slice(0, 5).map((entry) => entry.playerId),
  );
});

test('Top Five returns all eligible picks when fewer than five exist', () => {
  const eligible = Object.freeze([
    candidate('one', 0.7),
    candidate('two', 0.6),
    candidate('three', 0.5),
  ]);
  const result = selectTopFiveV1(eligible);

  assert.equal(result.length, 3);
  assert.deepEqual(result, eligible);
});

test('the same player may appear in Top Five for different categories', () => {
  const sharedPlayerId = 'shared-player';
  const baseline = input(candidate('baseline-shared', 0.63, sharedPlayerId), 'baseline');
  const alternate = input(candidate('alternate-shared', 0.72, sharedPlayerId), 'alternate');

  const baselineTop = selectTopFiveV1(
    selectHighProbabilityBaselinePropsV1([baseline, alternate]).eligibleCandidates,
  );
  const altlineTop = selectTopFiveV1(
    selectHighProbabilityAltlinePropsV1([baseline, alternate]).eligibleCandidates,
  );

  assert.equal(baselineTop[0]!.candidate.playerId, sharedPlayerId);
  assert.equal(altlineTop[0]!.candidate.playerId, sharedPlayerId);
  assert.notEqual(baselineTop[0], altlineTop[0]);
});

test('Top Five selection preserves object identity and every probability', () => {
  const eligible = Object.freeze(
    Array.from({ length: 6 }, (_, index) => candidate(String(index + 1), 0.7 - index * 0.01)),
  );
  const before = eligible.map((entry) => Object.freeze({
    pWin: entry.pWin,
    pLoss: entry.pLoss,
    pVoid: entry.pVoid,
    pWinGivenGrades: entry.pWinGivenGrades,
    distribution: entry.statisticDistribution,
  }));
  const result = selectTopFiveV1(eligible);

  result.forEach((entry, index) => {
    assert.equal(entry, eligible[index]);
    assert.equal(entry.pWin, before[index]!.pWin);
    assert.equal(entry.pLoss, before[index]!.pLoss);
    assert.equal(entry.pVoid, before[index]!.pVoid);
    assert.equal(entry.pWinGivenGrades, before[index]!.pWinGivenGrades);
    assert.equal(entry.statisticDistribution, before[index]!.distribution);
  });
});
