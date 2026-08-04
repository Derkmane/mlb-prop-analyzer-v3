import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildM8_5ParkFrozenBasePredictions,
  M8_5_PARK_FROZEN_BASE_EXPECTED,
} from '../scripts/m8-5-park-frozen-base-prediction-utils.mjs';
import {
  buildM8_5ParkEvaluationDataset,
} from '../scripts/m8-5-park-model-utils.mjs';
import {
  buildM8_5ParkVenueEvidenceAudit,
} from '../scripts/m8-5-park-venue-evidence-utils.mjs';

const CATEGORIES = Object.freeze(['1B', '2B', '3B', 'HR', 'BIP_OUT']);
const MATCHUPS = Object.freeze([
  ['L', 'L', 1, 11],
  ['L', 'R', 1, 12],
  ['R', 'L', 2, 11],
  ['R', 'R', 2, 12],
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isoDate(dayOffset) {
  const date = new Date(Date.UTC(2026, 2, 20 + dayOffset));
  return date.toISOString().slice(0, 10);
}

function periodRows(periodId, startOffset, dateCount, gameStart) {
  const rows = [];
  for (let dateIndex = 0; dateIndex < dateCount; dateIndex += 1) {
    const observedDate = isoDate(startOffset + dateIndex);
    const providerGameId = gameStart + dateIndex;
    for (const [batterHand, pitcherHand, batterId, pitcherId] of MATCHUPS) {
      for (const [categoryIndex, terminalCategory] of CATEGORIES.entries()) {
        rows.push(
          Object.freeze({
            rowId: `${periodId}:${providerGameId}:${batterHand}:${pitcherHand}:${terminalCategory}`,
            observedDate,
            providerGameId,
            providerBatterId: batterId,
            providerPitcherId: pitcherId,
            mappingStatus: 'classified-terminal',
            includedInOverallOutcomeModel: true,
            includedInPlatoonModel: true,
            rawBatterSide: batterHand,
            normalizedBatterSide: batterHand,
            normalizedPitcherHand: pitcherHand,
            terminalCategory,
            categoryIndex,
          }),
        );
      }
    }
  }
  return Object.freeze(rows);
}

function resolvedDataset() {
  const fitRows = periodRows('fit', 0, 50, 1000);
  const validationRows = periodRows('validation', 60, 3, 2000);
  return Object.freeze({
    datasetVersion: 3,
    activeSeason: 2026,
    datasetSha256: 'd'.repeat(64),
    periods: Object.freeze({
      fit: Object.freeze({ rows: fitRows }),
      validation: Object.freeze({ rows: validationRows }),
    }),
    untouchedTestReservation: Object.freeze({ rowsIncluded: false }),
  });
}

function baseParameters() {
  return Object.freeze({
    batterPooling: M8_5_PARK_FROZEN_BASE_EXPECTED.batterPooling,
    pitcherPooling: M8_5_PARK_FROZEN_BASE_EXPECTED.pitcherPooling,
    batterCoefficient: M8_5_PARK_FROZEN_BASE_EXPECTED.batterCoefficient,
    pitcherAllowedCoefficient:
      M8_5_PARK_FROZEN_BASE_EXPECTED.pitcherAllowedCoefficient,
  });
}

function platoonCandidate() {
  return Object.freeze({
    candidateId: M8_5_PARK_FROZEN_BASE_EXPECTED.platoonCandidateId,
    leaguePlatoonPriorId:
      M8_5_PARK_FROZEN_BASE_EXPECTED.leaguePlatoonPriorId,
    leaguePlatoonEquivalentPa:
      M8_5_PARK_FROZEN_BASE_EXPECTED.leaguePlatoonEquivalentPa,
    leaguePlatoonExactTarget: false,
    playerSplitPriorId:
      M8_5_PARK_FROZEN_BASE_EXPECTED.playerSplitPriorId,
    playerSplitEquivalentPa:
      M8_5_PARK_FROZEN_BASE_EXPECTED.playerSplitEquivalentPa,
    playerSplitExactTarget: false,
    platoonCoefficient:
      M8_5_PARK_FROZEN_BASE_EXPECTED.platoonCoefficient,
  });
}

function parity(dataset) {
  const built = buildM8_5ParkFrozenBasePredictions({
    fitObservations: dataset.periods.fit.rows.map((row) => ({
      observationId: row.rowId,
      observedDate: row.observedDate,
      providerGameId: row.providerGameId,
      providerBatterId: row.providerBatterId,
      providerPitcherId: row.providerPitcherId,
      terminalCategory: row.terminalCategory,
      batterHand: row.rawBatterSide,
      normalizedBatterSide: row.normalizedBatterSide,
      normalizedPitcherHand: row.normalizedPitcherHand,
      platoonEligible: true,
    })),
    validationObservations: dataset.periods.validation.rows.map((row) => ({
      observationId: row.rowId,
      observedDate: row.observedDate,
      providerGameId: row.providerGameId,
      providerBatterId: row.providerBatterId,
      providerPitcherId: row.providerPitcherId,
      terminalCategory: row.terminalCategory,
      batterHand: row.rawBatterSide,
      normalizedBatterSide: row.normalizedBatterSide,
      normalizedPitcherHand: row.normalizedPitcherHand,
      platoonEligible: true,
    })),
    modeledCategories: CATEGORIES,
    canonicalCategories: CATEGORIES,
    hitCategories: ['1B', '2B', '3B', 'HR'],
    baseParameters: baseParameters(),
    platoonCandidate: platoonCandidate(),
  });
  const identity = {
    parityVersion: 1,
    activeSeason: 2026,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceFixedEvaluationSha256: '1'.repeat(64),
    sourcePlatoonEvaluationSha256: '2'.repeat(64),
    sourcePlatoonWalkForwardSha256: '3'.repeat(64),
    sourceCloseoutFreezeSha256: '4'.repeat(64),
    coherentCandidateId: M8_5_PARK_FROZEN_BASE_EXPECTED.coherentCandidateId,
    platoonCandidateId: M8_5_PARK_FROZEN_BASE_EXPECTED.platoonCandidateId,
    coherentMetrics: built.coherentMetrics,
    platoonMetrics: built.platoonMetrics,
    finalBaseMetrics: built.finalBaseMetrics,
    predictionSha256: built.predictionSha256,
    productionEnabled: false,
    rankingEnabled: false,
    selectedSideInputUsed: false,
    directProbabilityAdjustmentUsed: false,
    untouchedTestRowsAccessed: false,
  };
  return Object.freeze({
    ...identity,
    paritySha256: sha256(JSON.stringify(identity)),
    predictions: built.predictions,
  });
}

function venueAudit(dataset) {
  const allRows = [
    ...dataset.periods.fit.rows,
    ...dataset.periods.validation.rows,
  ];
  const games = [...new Map(allRows.map((row) => [row.providerGameId, row])).values()]
    .sort((left, right) => left.providerGameId - right.providerGameId);
  const manifest = {
    manifestVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    sourcePlanSha256: '5'.repeat(64),
    manifestSha256: '6'.repeat(64),
    gameCount: games.length,
    games: games.map((row) => ({
      gameId: row.providerGameId,
      observedDate: row.observedDate,
      periodId: row.rowId.startsWith('fit:') ? 'fit' : 'validation',
    })),
    untouchedTestReservation: { rowsIncluded: false },
  };
  const captures = games.map((row, index) => ({
    sourcePlanSha256: manifest.sourcePlanSha256,
    plannedGame: {
      gameId: row.providerGameId,
      observedDate: row.observedDate,
      periodId: row.rowId.startsWith('fit:') ? 'fit' : 'validation',
    },
    gameSnapshot: {
      rawBodySha256: String(index + 10).padStart(64, '0'),
      body: {
        data: {
          id: row.providerGameId,
          season: 2026,
          season_type: 'regular',
          postseason: false,
          status: 'STATUS_FINAL',
          venue: row.providerGameId % 2 === 0 ? 'Park A' : 'Park B',
          home_team: { id: 1 },
          away_team: { id: 2 },
        },
      },
    },
    captureSha256: String(index + 100).padStart(64, '0'),
    untouchedTestReservation: { rowsIncluded: false },
  }));
  return buildM8_5ParkVenueEvidenceAudit({
    captureManifest: manifest,
    captures,
  });
}

test('builds a deterministic chronological park dataset from exact venue and frozen-base lineage', () => {
  const resolved = resolvedDataset();
  const frozenParity = parity(resolved);
  const audit = venueAudit(resolved);
  const first = buildM8_5ParkEvaluationDataset({
    resolvedDataset: resolved,
    venueAudit: audit,
    frozenBaseParity: frozenParity,
  });
  const second = buildM8_5ParkEvaluationDataset({
    resolvedDataset: resolved,
    venueAudit: audit,
    frozenBaseParity: frozenParity,
  });

  assert.equal(first.datasetSha256, second.datasetSha256);
  assert.equal(first.periods.validation.rowCount, 60);
  assert.ok(first.periods.fit.rowCount >= 14 * MATCHUPS.length * CATEGORIES.length);
  assert.ok(first.periods.fit.endDate < first.periods.validation.startDate);
  assert.deepEqual(first.venues, ['Park A', 'Park B']);
  assert.equal(first.exclusions.length, 0);
  assert.equal(first.sourceFrozenValidationPredictionSha256, frozenParity.predictionSha256);
  assert.equal(first.safety.selectedSideInputUsed, false);
  assert.equal(first.safety.untouchedTestRowsAccessed, false);
});

test('fails closed on parity identity drift, missing venue evidence, and exposed untouched rows', () => {
  const resolved = resolvedDataset();
  const frozenParity = parity(resolved);
  const audit = venueAudit(resolved);

  assert.throws(
    () =>
      buildM8_5ParkEvaluationDataset({
        resolvedDataset: resolved,
        venueAudit: audit,
        frozenBaseParity: {
          ...frozenParity,
          sourceDatasetSha256: 'f'.repeat(64),
        },
      }),
    /does not reference the resolved dataset/,
  );

  assert.throws(
    () =>
      buildM8_5ParkEvaluationDataset({
        resolvedDataset: resolved,
        venueAudit: {
          ...audit,
          games: audit.games.slice(1),
        },
        frozenBaseParity: frozenParity,
      }),
    /venue audit SHA-256 is invalid|lacks exact venue evidence/,
  );

  assert.throws(
    () =>
      buildM8_5ParkEvaluationDataset({
        resolvedDataset: {
          ...resolved,
          untouchedTestReservation: {
            rowsIncluded: true,
            rows: [],
          },
        },
        venueAudit: audit,
        frozenBaseParity: frozenParity,
      }),
    /must keep untouched-test rows excluded/,
  );
});
