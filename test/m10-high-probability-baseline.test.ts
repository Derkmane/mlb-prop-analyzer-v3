import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HIGH_PROBABILITY_BASELINE_CATEGORY_ID,
  selectHighProbabilityBaselinePropsV1,
  type CategoryOfferInput,
} from '../src/categories/index.js';
import type { PredictionCandidate } from '../src/domain/prediction-candidate.js';

type TestCandidate = PredictionCandidate<Readonly<{ identity: string }>>;

interface CandidateOptions {
  readonly identity: string;
  readonly pFinal: number;
  readonly pVoid?: number;
  readonly playerId?: string;
}

function candidate(options: CandidateOptions): TestCandidate {
  const pVoid = options.pVoid ?? 0;
  const gradeMass = 1 - pVoid;
  return Object.freeze({
    eventId: `event-${options.identity}`,
    gameId: `game-${options.identity}`,
    playerId: options.playerId ?? `player-${options.identity}`,
    playerName: `Player ${options.identity}`,
    baseMarketKey: 'batter-hits',
    marketLabel: 'Batter Hits',
    line: 0.5,
    selectedSide: 'higher',
    settlementStatistic: 'hits',
    eligibilityProbability: gradeMass,
    statisticDistribution: Object.freeze({
      probabilities: Object.freeze([1 - options.pFinal, options.pFinal]),
    }),
    pWin: options.pFinal * gradeMass,
    pLoss: (1 - options.pFinal) * gradeMass,
    pVoid,
    pWinGivenGrades: options.pFinal,
    modelVersion: 'model-v1',
    distributionBuilderVersion: 'distribution-v1',
    settlementRuleVersion: 'settlement-v1',
    sharedScenarioReference: Object.freeze({ identity: options.identity }),
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
  diagnostics: Readonly<{
    americanPrice?: number;
    multiplier?: number;
    postedImpliedProbability?: number;
    priceEdge?: number;
  }> = {},
): CategoryOfferInput<TestCandidate> {
  return Object.freeze({
    candidate: value,
    offerType,
    americanPrice: diagnostics.americanPrice ?? -110,
    multiplier: diagnostics.multiplier ?? 1,
    postedImpliedProbability:
      diagnostics.postedImpliedProbability ?? 110 / 210,
    priceEdge: diagnostics.priceEdge ?? 0,
  });
}

test('High Probability Baseline admits only baseline offers', () => {
  const baseline = input(candidate({ identity: 'baseline', pFinal: 0.61 }), 'baseline');
  const alternate = input(candidate({ identity: 'alternate', pFinal: 0.99 }), 'alternate');
  const result = selectHighProbabilityBaselinePropsV1([alternate, baseline]);

  assert.equal(result.categoryId, HIGH_PROBABILITY_BASELINE_CATEGORY_ID);
  assert.deepEqual(
    result.eligibleCandidates.map((entry) => entry.candidate.playerId),
    ['player-baseline'],
  );
  assert.deepEqual(
    result.ineligibleCandidates.map((entry) => entry.candidate.playerId),
    ['player-alternate'],
  );
});

test('Baseline order is final P(Win | grades), then P(Void) only', () => {
  const lowerFinal = input(candidate({ identity: 'lower-final', pFinal: 0.61, pVoid: 0.01 }), 'baseline');
  const higherFinalMoreVoid = input(candidate({ identity: 'higher-final-more-void', pFinal: 0.64, pVoid: 0.08 }), 'baseline');
  const higherFinalLessVoid = input(candidate({ identity: 'higher-final-less-void', pFinal: 0.64, pVoid: 0.02 }), 'baseline');

  const result = selectHighProbabilityBaselinePropsV1([
    lowerFinal,
    higherFinalMoreVoid,
    higherFinalLessVoid,
  ]);

  assert.deepEqual(
    result.eligibleCandidates.map((entry) => entry.candidate.playerId),
    [
      'player-higher-final-less-void',
      'player-higher-final-more-void',
      'player-lower-final',
    ],
  );
});

test('Baseline keeps one prop per player using the canonical comparator', () => {
  const lower = input(candidate({ identity: 'lower', playerId: 'shared', pFinal: 0.61 }), 'baseline');
  const higherMoreVoid = input(candidate({ identity: 'higher-more-void', playerId: 'shared', pFinal: 0.64, pVoid: 0.08 }), 'baseline');
  const higherLessVoid = input(candidate({ identity: 'higher-less-void', playerId: 'shared', pFinal: 0.64, pVoid: 0.02 }), 'baseline');

  const result = selectHighProbabilityBaselinePropsV1([
    lower,
    higherMoreVoid,
    higherLessVoid,
  ]);

  assert.equal(result.eligibleCandidates.length, 1);
  assert.equal(
    result.eligibleCandidates[0]!.candidate.sharedScenarioReference.identity,
    'higher-less-void',
  );
});

test('price, multiplier, and priceEdge cannot alter Baseline order', () => {
  const higherFinal = input(
    candidate({ identity: 'higher-final', pFinal: 0.62 }),
    'baseline',
    { americanPrice: -500, multiplier: 0.5, postedImpliedProbability: 0.9, priceEdge: -0.8 },
  );
  const lowerFinal = input(
    candidate({ identity: 'lower-final', pFinal: 0.61 }),
    'baseline',
    { americanPrice: 500, multiplier: 9, postedImpliedProbability: 0.1, priceEdge: 0.9 },
  );

  const result = selectHighProbabilityBaselinePropsV1([
    lowerFinal,
    higherFinal,
  ]);

  assert.deepEqual(
    result.eligibleCandidates.map((entry) => entry.candidate.playerId),
    ['player-higher-final', 'player-lower-final'],
  );
});

test('Baseline selection preserves the original candidate and probabilities', () => {
  const original = candidate({ identity: 'unchanged', pFinal: 0.63, pVoid: 0.04 });
  const result = selectHighProbabilityBaselinePropsV1([
    input(original, 'baseline'),
  ]);
  const selected = result.eligibleCandidates[0]!.candidate;

  assert.equal(selected, original);
  assert.equal(selected.pWin, original.pWin);
  assert.equal(selected.pLoss, original.pLoss);
  assert.equal(selected.pVoid, original.pVoid);
  assert.equal(selected.pWinGivenGrades, original.pWinGivenGrades);
  assert.equal(selected.statisticDistribution, original.statisticDistribution);
});
