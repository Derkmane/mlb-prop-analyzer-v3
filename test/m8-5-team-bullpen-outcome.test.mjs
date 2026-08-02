import assert from 'node:assert/strict';
import test from 'node:test';

import { TERMINAL_PA_CATEGORIES } from '../dist/domain/terminal-pa.js';
import {
  DEFAULT_M8_5_TEAM_BULLPEN_CANDIDATES,
  buildM8_5TeamBullpenDataset,
  evaluateM8_5TeamBullpenCandidates,
  factorEffectsForM8_5TeamBullpenModel,
} from '../scripts/m8-5-team-bullpen-outcome-utils.mjs';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function paRow({ date, gameId, pa, half, pitcherId, hand, category }) {
  return Object.freeze({
    rowId: `${date}:${gameId}:${pa}`,
    observedDate: date,
    providerGameId: gameId,
    providerPaNumber: pa,
    providerPitcherId: pitcherId,
    halfInning: half,
    mappingStatus: 'classified-terminal',
    normalizedPitcherHand: hand,
    normalizedBatterSide: 'R',
    terminalCategory: category,
  });
}

function gameRows(date, gameId, awayBullpenCategory, homeBullpenCategory) {
  return [
    paRow({ date, gameId, pa: 1, half: 'top', pitcherId: 2000 + gameId, hand: 'R', category: 'BIP_OUT' }),
    paRow({ date, gameId, pa: 2, half: 'top', pitcherId: 2100 + gameId, hand: 'L', category: awayBullpenCategory }),
    paRow({ date, gameId, pa: 3, half: 'top', pitcherId: 2200 + gameId, hand: 'R', category: awayBullpenCategory }),
    paRow({ date, gameId, pa: 4, half: 'bottom', pitcherId: 3000 + gameId, hand: 'L', category: 'BIP_OUT' }),
    paRow({ date, gameId, pa: 5, half: 'bottom', pitcherId: 3100 + gameId, hand: 'L', category: homeBullpenCategory }),
    paRow({ date, gameId, pa: 6, half: 'bottom', pitcherId: 3200 + gameId, hand: 'R', category: homeBullpenCategory }),
  ];
}

function resolvedDataset({ uniform = false } = {}) {
  const fitRows = [
    ...gameRows('2026-04-01', 1, uniform ? 'BIP_OUT' : '1B', 'BIP_OUT'),
    ...gameRows('2026-04-02', 2, uniform ? 'BIP_OUT' : '1B', 'BIP_OUT'),
  ];
  const validationRows = [
    ...gameRows('2026-06-22', 3, uniform ? 'BIP_OUT' : '1B', 'BIP_OUT'),
    ...gameRows('2026-06-23', 4, uniform ? 'BIP_OUT' : '1B', 'BIP_OUT'),
  ];
  return Object.freeze({
    datasetVersion: 3,
    activeSeason: 2026,
    datasetSha256: HASH_A,
    periods: Object.freeze({
      fit: Object.freeze({ rows: Object.freeze(fitRows) }),
      validation: Object.freeze({ rows: Object.freeze(validationRows) }),
    }),
    untouchedTestReservation: Object.freeze({ rowsIncluded: false }),
  });
}

function environmentRows(periodId, games) {
  return Object.freeze(
    games.flatMap(({ date, gameId }) => [
      Object.freeze({
        rowId: `${periodId}:${date}:${gameId}:away:100`,
        periodId,
        observedDate: date,
        gameId,
        side: 'away',
        teamId: 100,
        opponentTeamId: 200,
      }),
      Object.freeze({
        rowId: `${periodId}:${date}:${gameId}:home:200`,
        periodId,
        observedDate: date,
        gameId,
        side: 'home',
        teamId: 200,
        opponentTeamId: 100,
      }),
    ]),
  );
}

function teamEnvironmentDataset() {
  return Object.freeze({
    datasetVersion: 2,
    activeSeason: 2026,
    datasetSha256: HASH_B,
    sourceResolvedDatasetSha256: HASH_A,
    periods: Object.freeze({
      fit: Object.freeze({
        rows: environmentRows('fit', [
          { date: '2026-04-01', gameId: 1 },
          { date: '2026-04-02', gameId: 2 },
        ]),
      }),
      validation: Object.freeze({
        rows: environmentRows('validation', [
          { date: '2026-06-22', gameId: 3 },
          { date: '2026-06-23', gameId: 4 },
        ]),
      }),
    }),
    untouchedTestReservation: Object.freeze({ rowsIncluded: false }),
  });
}

function categoryVector(primaryCategory = null) {
  if (primaryCategory !== null) {
    return Object.freeze(
      Object.fromEntries(
        TERMINAL_PA_CATEGORIES.map((category) => [category, category === primaryCategory ? 1 : 0]),
      ),
    );
  }
  return Object.freeze(
    Object.fromEntries(
      TERMINAL_PA_CATEGORIES.map((category) => [category, 1 / TERMINAL_PA_CATEGORIES.length]),
    ),
  );
}

function genericBullpen(primaryCategory = null) {
  const vector = categoryVector(primaryCategory);
  return Object.freeze({
    modelVersion: 'm8-generic-bullpen-outcome-v1',
    handWeights: Object.freeze({ L: 0.4, R: 0.6 }),
    byHand: Object.freeze({ L: vector, R: vector }),
  });
}

test('joins each bullpen PA to the opposing pitching team without changing workload evidence', () => {
  const resolved = resolvedDataset();
  const environment = teamEnvironmentDataset();
  const original = structuredClone(resolved);
  const dataset = buildM8_5TeamBullpenDataset({
    resolvedDataset: resolved,
    teamEnvironmentDataset: environment,
    starterBullpenTransitionSha256: 'c'.repeat(64),
  });

  assert.equal(dataset.periods.fit.rowCount, 8);
  assert.equal(dataset.periods.validation.rowCount, 8);
  assert.deepEqual(
    [...new Set(dataset.periods.fit.rows.filter((row) => row.battingSide === 'away').map((row) => row.pitchingTeamId))],
    [200],
  );
  assert.deepEqual(
    [...new Set(dataset.periods.fit.rows.filter((row) => row.battingSide === 'home').map((row) => row.pitchingTeamId))],
    [100],
  );
  assert.equal(dataset.sourceStarterBullpenTransitionSha256, 'c'.repeat(64));
  assert.deepEqual(resolved, original);
});

test('chronological validation selects a pooled team signal while preserving frozen hand weights', () => {
  const dataset = buildM8_5TeamBullpenDataset({
    resolvedDataset: resolvedDataset(),
    teamEnvironmentDataset: teamEnvironmentDataset(),
    starterBullpenTransitionSha256: 'c'.repeat(64),
  });
  const evaluation = evaluateM8_5TeamBullpenCandidates({
    dataset,
    genericBullpenModel: genericBullpen(),
    candidates: DEFAULT_M8_5_TEAM_BULLPEN_CANDIDATES,
  });

  assert.equal(evaluation.decision, 'VALIDATED_TEAM_SIGNAL');
  assert.notEqual(evaluation.selectedCandidateId, null);
  assert.ok(evaluation.selectedFixedMetrics.logLoss < evaluation.genericFixedMetrics.logLoss);
  assert.ok(evaluation.selectedWalkForwardMetrics.logLoss < evaluation.genericWalkForwardMetrics.logLoss);
  assert.deepEqual(evaluation.selectedModel.handWeights, { L: 0.4, R: 0.6 });
  assert.equal(evaluation.selectedModel.handWeightsPolicy, 'preserve-m8-generic-bullpen-hand-weights');
});

test('factor effects are team-and-hand terminal vectors and contain no side or probability shortcut', () => {
  const dataset = buildM8_5TeamBullpenDataset({
    resolvedDataset: resolvedDataset(),
    teamEnvironmentDataset: teamEnvironmentDataset(),
    starterBullpenTransitionSha256: 'c'.repeat(64),
  });
  const evaluation = evaluateM8_5TeamBullpenCandidates({
    dataset,
    genericBullpenModel: genericBullpen(),
    candidates: DEFAULT_M8_5_TEAM_BULLPEN_CANDIDATES,
  });
  const effects = factorEffectsForM8_5TeamBullpenModel(evaluation.selectedModel);

  assert.equal(effects.length, 4);
  for (const effect of effects) {
    assert.equal(effect.kind, 'terminal-outcome-vector');
    assert.equal(effect.scope, 'bullpen');
    assert.match(effect.matchupKey, /^pitching-team:\d+\|pitcher-hand:[LR]$/u);
    assert.equal(effect.categoryProbabilities.length, TERMINAL_PA_CATEGORIES.length);
    assert.equal(
      effect.categoryProbabilities.reduce((sum, entry) => sum + entry.probability, 0),
      1,
    );
    assert.equal(Object.hasOwn(effect, 'selectedSide'), false);
    assert.equal(Object.hasOwn(effect, 'probabilityDelta'), false);
    assert.equal(Object.hasOwn(effect, 'coefficient'), false);
  }
});

test('no validation improvement keeps the factor explicit identity instead of forcing team movement', () => {
  const dataset = buildM8_5TeamBullpenDataset({
    resolvedDataset: resolvedDataset({ uniform: true }),
    teamEnvironmentDataset: teamEnvironmentDataset(),
    starterBullpenTransitionSha256: 'c'.repeat(64),
  });
  const evaluation = evaluateM8_5TeamBullpenCandidates({
    dataset,
    genericBullpenModel: genericBullpen('BIP_OUT'),
    candidates: DEFAULT_M8_5_TEAM_BULLPEN_CANDIDATES,
  });

  assert.equal(evaluation.decision, 'IDENTITY_RETAINED_NO_VALIDATED_TEAM_SIGNAL');
  assert.equal(evaluation.selectedCandidateId, null);
  assert.equal(evaluation.selectedModel, null);
});

test('missing team-game identity and exposed untouched rows fail closed', () => {
  const environment = teamEnvironmentDataset();
  const broken = {
    ...environment,
    periods: {
      ...environment.periods,
      fit: { rows: environment.periods.fit.rows.slice(1) },
    },
  };
  assert.throws(
    () =>
      buildM8_5TeamBullpenDataset({
        resolvedDataset: resolvedDataset(),
        teamEnvironmentDataset: broken,
        starterBullpenTransitionSha256: 'c'.repeat(64),
      }),
    /missing team-environment row/u,
  );
  assert.throws(
    () =>
      buildM8_5TeamBullpenDataset({
        resolvedDataset: {
          ...resolvedDataset(),
          untouchedTestReservation: { rowsIncluded: true },
        },
        teamEnvironmentDataset: environment,
        starterBullpenTransitionSha256: 'c'.repeat(64),
      }),
    /untouched/u,
  );
});
