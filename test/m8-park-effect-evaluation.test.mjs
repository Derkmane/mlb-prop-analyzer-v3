import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildM8TerminalPaOutcomeArtifact,
  terminalPaOutcomeProbabilities,
} from '../scripts/m8-terminal-pa-outcome-artifact-utils.mjs';
import {
  applyParkResidual,
  evaluateM8ParkEffect,
  fitParkResiduals,
  selectStableParkCandidate,
  terminalPaOutcomeProbabilitiesFromVerifiedArtifact,
  verifyM8ParkEffectEvaluation,
} from '../scripts/m8-park-effect-evaluation-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const HASH_E = 'e'.repeat(64);
const UNTOUCHED = Object.freeze({
  startDate: '2026-07-01',
  endDate: '2026-07-31',
  plateAppearanceCount: 10,
  rowsIncluded: false,
});
const CATEGORIES = Object.freeze(['1B', 'BIP_OUT']);
const NO_PLATOON = Object.freeze({
  candidateId: 'no-platoon',
  leaguePlatoonPriorId: null,
  leaguePlatoonEquivalentPa: null,
  leaguePlatoonExactTarget: true,
  playerSplitPriorId: null,
  playerSplitEquivalentPa: null,
  playerSplitExactTarget: true,
  platoonCoefficient: 0,
});
const PARK_CANDIDATES = Object.freeze([
  Object.freeze({ candidateId: 'venue-hand-pa-4', parkEquivalentPa: 4, exactNeutral: false }),
  Object.freeze({ candidateId: 'venue-hand-pa-16', parkEquivalentPa: 16, exactNeutral: false }),
  Object.freeze({ candidateId: 'no-park-infinite-pooling', parkEquivalentPa: null, exactNeutral: true }),
]);

function datasetIdentity(dataset) {
  return {
    activeSeason: dataset.activeSeason,
    sourceDatasetSha256: dataset.sourceDatasetSha256,
    sourceDatasetFileSha256: dataset.sourceDatasetFileSha256,
    sourceResolutionSha256: dataset.sourceResolutionSha256,
    sourceResolutionFileSha256: dataset.sourceResolutionFileSha256,
    sourcePartitionSha256: dataset.sourcePartitionSha256,
    sourceEvidenceSetSha256: dataset.sourceEvidenceSetSha256,
    periods: dataset.periods,
    untouchedTestReservation: dataset.untouchedTestReservation,
  };
}

function platoonIdentity(value) {
  return {
    activeSeason: value.activeSeason,
    sourceDatasetSha256: value.sourceDatasetSha256,
    sourceDatasetFileSha256: value.sourceDatasetFileSha256,
    sourceFixedEvaluationSha256: value.sourceFixedEvaluationSha256,
    sourceFixedEvaluationFileSha256: value.sourceFixedEvaluationFileSha256,
    sourceWalkForwardSha256: value.sourceWalkForwardSha256,
    sourceWalkForwardFileSha256: value.sourceWalkForwardFileSha256,
    canonicalCategories: value.canonicalCategories,
    modeledCategories: value.modeledCategories,
    structuralZeroCategories: value.structuralZeroCategories,
    hitCategories: value.hitCategories,
    baseParameters: value.baseParameters,
    platoonModel: value.platoonModel,
    cohorts: value.cohorts,
    candidates: value.candidates,
    results: value.results,
    baseline: value.baseline,
    selection: value.selection,
    improvementVersusNoPlatoon: value.improvementVersusNoPlatoon,
    selectedBoundaryFlags: value.selectedBoundaryFlags,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

function lineageIdentity(value) {
  return {
    lineageVersion: value.lineageVersion,
    provider: value.provider,
    activeSeason: value.activeSeason,
    sourceCaptureManifestSha256: value.sourceCaptureManifestSha256,
    sourceCapturePlanSha256: value.sourceCapturePlanSha256,
    sourceResolvedDatasetSha256: value.sourceResolvedDatasetSha256,
    includedPeriods: value.includedPeriods,
    untouchedTestReservation: value.untouchedTestReservation,
    totals: value.totals,
    venueCounts: value.venueCounts,
    periods: value.periods,
  };
}

function row({ rowId, observedDate, providerGameId, providerBatterId, hand, category }) {
  return Object.freeze({
    rowId,
    observedDate,
    providerGameId,
    providerBatterId,
    providerPitcherId: 9000 + providerGameId,
    mappingStatus: 'classified-terminal',
    includedInOverallOutcomeModel: true,
    includedInPlatoonModel: true,
    normalizedBatterSide: hand,
    normalizedPitcherHand: 'R',
    terminalCategory: category,
  });
}

function makePeriod(periodId, dates, startingGameId) {
  const rows = [];
  const games = [];
  let gameId = startingGameId;
  let batterId = startingGameId * 10;
  for (const observedDate of dates) {
    for (const venue of ['Park A', 'Park B']) {
      const currentGameId = gameId;
      gameId += 1;
      games.push({ observedDate, providerGameId: currentGameId, venue });
      for (const hand of ['L', 'R']) {
        rows.push(
          row({
            rowId: `${periodId}:${observedDate}:${currentGameId}:${hand}`,
            observedDate,
            providerGameId: currentGameId,
            providerBatterId: batterId,
            hand,
            category: venue === 'Park A' ? '1B' : 'BIP_OUT',
          }),
        );
        batterId += 1;
      }
    }
  }
  return { rows: Object.freeze(rows), games: Object.freeze(games) };
}

function fixtures() {
  const fit = makePeriod('fit', ['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04'], 100);
  const validation = makePeriod('validation', ['2026-05-01', '2026-05-02'], 200);
  const periods = Object.freeze({
    fit: Object.freeze({
      startDate: '2026-04-01',
      endDate: '2026-04-04',
      rowCount: fit.rows.length,
      classifiedTerminalCount: fit.rows.length,
      platoonEligibleCount: fit.rows.length,
      rows: fit.rows,
    }),
    validation: Object.freeze({
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      rowCount: validation.rows.length,
      classifiedTerminalCount: validation.rows.length,
      platoonEligibleCount: validation.rows.length,
      rows: validation.rows,
    }),
  });
  const dataset = {
    datasetVersion: 3,
    activeSeason: 2026,
    sourceDatasetSha256: HASH_A,
    sourceDatasetFileSha256: HASH_B,
    sourceResolutionSha256: HASH_C,
    sourceResolutionFileSha256: HASH_D,
    sourcePartitionSha256: HASH_E,
    sourceEvidenceSetSha256: HASH_A,
    periods,
    totals: Object.freeze({
      includedRowCount: fit.rows.length + validation.rows.length,
      classifiedTerminalCount: fit.rows.length + validation.rows.length,
    }),
    untouchedTestReservation: UNTOUCHED,
  };
  dataset.datasetSha256 = sha256(JSON.stringify(datasetIdentity(dataset)));

  const evaluation = {
    platoonEvaluationVersion: 1,
    activeSeason: 2026,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: HASH_B,
    sourceFixedEvaluationSha256: HASH_C,
    sourceFixedEvaluationFileSha256: HASH_D,
    sourceWalkForwardSha256: HASH_E,
    sourceWalkForwardFileSha256: HASH_A,
    canonicalCategories: CATEGORIES,
    modeledCategories: CATEGORIES,
    structuralZeroCategories: Object.freeze([]),
    hitCategories: Object.freeze(['1B']),
    baseParameters: Object.freeze({
      batterPooling: 64,
      pitcherPooling: 64,
      batterCoefficient: 0,
      pitcherAllowedCoefficient: 0,
      selectedCandidateId: 'league-only-baseline',
    }),
    platoonModel: Object.freeze({}),
    cohorts: Object.freeze({}),
    candidates: Object.freeze([NO_PLATOON]),
    results: Object.freeze([]),
    baseline: Object.freeze({}),
    selection: Object.freeze({ selectedCandidate: NO_PLATOON }),
    improvementVersusNoPlatoon: Object.freeze({}),
    selectedBoundaryFlags: Object.freeze({}),
    untouchedTestReservation: UNTOUCHED,
  };
  evaluation.platoonEvaluationSha256 = sha256(JSON.stringify(platoonIdentity(evaluation)));

  const periodLineage = (periodId, games) =>
    Object.freeze({
      startDate: games[0].observedDate,
      endDate: games.at(-1).observedDate,
      rowCount: games.length,
      rows: Object.freeze(
        games.map((game) =>
          Object.freeze({
            rowId: `${periodId}:${game.observedDate}:${game.providerGameId}`,
            observedDate: game.observedDate,
            periodId,
            providerGameId: game.providerGameId,
            venue: game.venue,
            sourceCaptureSha256: HASH_B,
          }),
        ),
      ),
    });
  const lineage = {
    lineageVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    activeSeason: 2026,
    sourceCaptureManifestSha256: HASH_C,
    sourceCapturePlanSha256: HASH_D,
    sourceResolvedDatasetSha256: dataset.datasetSha256,
    includedPeriods: Object.freeze(['fit', 'validation']),
    untouchedTestReservation: UNTOUCHED,
    totals: Object.freeze({
      gameCount: fit.games.length + validation.games.length,
      fitGameCount: fit.games.length,
      validationGameCount: validation.games.length,
      uniqueVenueCount: 2,
    }),
    venueCounts: Object.freeze({
      'Park A': 6,
      'Park B': 6,
    }),
    periods: Object.freeze({
      fit: periodLineage('fit', fit.games),
      validation: periodLineage('validation', validation.games),
    }),
  };
  lineage.lineageSha256 = sha256(JSON.stringify(lineageIdentity(lineage)));
  return { dataset, evaluation, lineage };
}

test('park residuals are outcome-specific, coherent, and handedness-cell specific', () => {
  const statistics = new Map([
    [
      'Park A|L',
      {
        observationCount: 10,
        observedCounts: { '1B': 8, BIP_OUT: 2 },
        expectedMass: { '1B': 5, BIP_OUT: 5 },
      },
    ],
  ]);
  const residuals = fitParkResiduals({
    cellStatistics: statistics,
    categories: CATEGORIES,
    candidate: PARK_CANDIDATES[0],
  });
  const adjusted = applyParkResidual({
    baseProbabilities: { '1B': 0.5, BIP_OUT: 0.5 },
    residualFactors: residuals.get('Park A|L'),
    categories: CATEGORIES,
  });
  assert.ok(adjusted['1B'] > 0.5);
  assert.ok(adjusted.BIP_OUT < 0.5);
  assert.ok(Math.abs(adjusted['1B'] + adjusted.BIP_OUT - 1) < 1e-12);
  const neutral = applyParkResidual({
    baseProbabilities: { '1B': 0.5, BIP_OUT: 0.5 },
    residualFactors: undefined,
    categories: CATEGORIES,
  });
  assert.deepEqual(neutral, { '1B': 0.5, BIP_OUT: 0.5 });
});

test('stable park selection uses proper-score nondominance and strongest pooling', () => {
  const result = (candidate, logLoss, brier) => ({
    candidate,
    categoricalLogLoss: logLoss,
    categoricalBrierScore: brier,
  });
  const fixed = [
    result(PARK_CANDIDATES[0], 0.60, 0.40),
    result(PARK_CANDIDATES[1], 0.59, 0.41),
    result(PARK_CANDIDATES[2], 0.61, 0.42),
  ];
  const walk = [
    result(PARK_CANDIDATES[0], 0.58, 0.40),
    result(PARK_CANDIDATES[1], 0.59, 0.39),
    result(PARK_CANDIDATES[2], 0.62, 0.43),
  ];
  const selection = selectStableParkCandidate({
    fixedResults: fixed,
    walkForwardResults: walk,
    candidates: PARK_CANDIDATES,
  });
  assert.deepEqual(selection.stableCandidateIds, [
    'venue-hand-pa-16',
    'venue-hand-pa-4',
  ]);
  assert.equal(selection.selectedCandidate.candidateId, 'venue-hand-pa-16');
});

test('verified-artifact fast scoring matches the canonical terminal PA scorer', () => {
  const { dataset, evaluation } = fixtures();
  const artifact = buildM8TerminalPaOutcomeArtifact({
    rawDataset: dataset,
    datasetFileSha256: HASH_A,
    rawPlatoonEvaluation: evaluation,
    platoonEvaluationFileSha256: HASH_B,
  });
  const input = {
    artifact,
    batterId: 999999,
    pitcherId: 888888,
    batterSide: 'L',
    pitcherHand: 'R',
  };
  assert.deepEqual(
    terminalPaOutcomeProbabilitiesFromVerifiedArtifact(input),
    terminalPaOutcomeProbabilities(input),
  );
});

test('fits and selects a deterministic current-season venue-hand park candidate', () => {
  const { dataset, evaluation, lineage } = fixtures();
  const input = {
    rawDataset: dataset,
    datasetFileSha256: HASH_A,
    rawVenueLineage: lineage,
    venueLineageFileSha256: HASH_B,
    rawPlatoonEvaluation: evaluation,
    platoonEvaluationFileSha256: HASH_C,
    candidates: PARK_CANDIDATES,
  };
  const first = evaluateM8ParkEffect(input);
  const second = evaluateM8ParkEffect(input);
  verifyM8ParkEffectEvaluation(first);
  assert.equal(first.evaluationSha256, second.evaluationSha256);
  assert.equal(first.cohorts.fitVenueHandCellCount, 4);
  assert.equal(first.cohorts.validationVenueHandCellCount, 4);
  assert.equal(first.walkForward.foldCount, 2);
  assert.equal(first.selection.selectedCandidate.candidateId, 'venue-hand-pa-4');
  assert.equal(first.untouchedTestReservation.rowsIncluded, false);
});

test('fails closed on venue lineage mismatch and exposed untouched rows', () => {
  const { dataset, evaluation, lineage } = fixtures();
  assert.throws(
    () =>
      evaluateM8ParkEffect({
        rawDataset: dataset,
        datasetFileSha256: HASH_A,
        rawVenueLineage: { ...lineage, sourceResolvedDatasetSha256: HASH_E },
        venueLineageFileSha256: HASH_B,
        rawPlatoonEvaluation: evaluation,
        platoonEvaluationFileSha256: HASH_C,
        candidates: PARK_CANDIDATES,
      }),
    /lineage SHA-256 is invalid|does not reference/,
  );
  const exposed = {
    ...dataset,
    untouchedTestReservation: { ...UNTOUCHED, rowsIncluded: true },
  };
  exposed.datasetSha256 = sha256(JSON.stringify(datasetIdentity(exposed)));
  assert.throws(
    () =>
      evaluateM8ParkEffect({
        rawDataset: exposed,
        datasetFileSha256: HASH_A,
        rawVenueLineage: lineage,
        venueLineageFileSha256: HASH_B,
        rawPlatoonEvaluation: evaluation,
        platoonEvaluationFileSha256: HASH_C,
        candidates: PARK_CANDIDATES,
      }),
    /untouched-test rows excluded/,
  );
});
