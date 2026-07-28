import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateResolvedCategoricalModel,
} from '../scripts/m8-resolved-categorical-model-evaluation-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

const CATEGORIES = Object.freeze(['K', '1B', 'OTHER_PA']);
const HIT_CATEGORIES = Object.freeze(['1B']);
const POOLING_CANDIDATES = Object.freeze([
  Object.freeze({ candidateId: 'league-pa-1', leagueEquivalentPa: 1 }),
  Object.freeze({ candidateId: 'league-pa-1000', leagueEquivalentPa: 1000 }),
]);
const MATCHUP_CANDIDATES = Object.freeze([
  Object.freeze({
    candidateId: 'batter-0.00-pitcher-0.00',
    batterCoefficient: 0,
    pitcherAllowedCoefficient: 0,
  }),
  Object.freeze({
    candidateId: 'batter-1.00-pitcher-0.00',
    batterCoefficient: 1,
    pitcherAllowedCoefficient: 0,
  }),
  Object.freeze({
    candidateId: 'batter-0.00-pitcher-1.00',
    batterCoefficient: 0,
    pitcherAllowedCoefficient: 1,
  }),
  Object.freeze({
    candidateId: 'batter-1.00-pitcher-1.00',
    batterCoefficient: 1,
    pitcherAllowedCoefficient: 1,
  }),
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

function classifiedRow({
  date,
  gameId,
  paNumber,
  batterId,
  pitcherId,
  terminalCategory,
}) {
  return {
    rowId: `${date}:${gameId}:${paNumber}`,
    observedDate: date,
    providerGameId: gameId,
    providerPaNumber: paNumber,
    providerBatterId: batterId,
    providerPitcherId: pitcherId,
    inning: 1,
    halfInning: 'top',
    rawBatterSide: batterId === 101 ? 'R' : 'L',
    rawPitcherHand: pitcherId === 201 ? 'R' : 'L',
    rawResult: terminalCategory === 'K' ? 'Strikeout' : 'Single',
    sourceSnapshotPath: `snapshots/${gameId}.json`,
    sourceSnapshotSha256: String(gameId % 10).repeat(64),
    mappingStatus: 'classified-terminal',
    unresolvedReason: null,
    terminalCategory,
    normalizedBatterSide: batterId === 101 ? 'R' : 'L',
    normalizedPitcherHand: pitcherId === 201 ? 'R' : 'L',
    overallOutcomeEligible: true,
    platoonEligible: true,
    includedInOverallOutcomeModel: true,
    includedInPlatoonModel: true,
    contextResolutionApplied: false,
    contextResolutionStatus: null,
    contextResolutionReason: null,
    contextEvidenceMarkers: [],
  };
}

function makePeriod({ periodId, startDate, endDate, rows }) {
  const terminalCategoryCounts = {};
  for (const row of rows) {
    terminalCategoryCounts[row.terminalCategory] =
      (terminalCategoryCounts[row.terminalCategory] ?? 0) + 1;
  }
  return {
    startDate,
    endDate,
    rowCount: rows.length,
    classifiedTerminalCount: rows.length,
    overallOutcomeEligibleCount: rows.length,
    platoonEligibleCount: rows.length,
    platoonIneligibleTerminalCount: 0,
    baserunningOnlyCount: 0,
    unresolvedCount: 0,
    missingResultCount: 0,
    contextRequiredCount: 0,
    unknownResultCount: 0,
    contextContradictionCount: 0,
    contextResolutionAppliedCount: 0,
    resolvedContextTerminalCount: 0,
    resolvedContextBaserunningCount: 0,
    remainingContextUnresolvedCount: 0,
    terminalCategoryCounts,
    rows,
    periodId,
  };
}

function makeDataset() {
  const fitRows = [];
  for (let index = 1; index <= 10; index += 1) {
    fitRows.push(
      classifiedRow({
        date: '2026-05-01',
        gameId: 9001,
        paNumber: index,
        batterId: 101,
        pitcherId: 201,
        terminalCategory: 'K',
      }),
    );
  }
  for (let index = 11; index <= 20; index += 1) {
    fitRows.push(
      classifiedRow({
        date: '2026-05-02',
        gameId: 9002,
        paNumber: index,
        batterId: 102,
        pitcherId: 202,
        terminalCategory: '1B',
      }),
    );
  }

  const validationRows = [];
  for (let index = 1; index <= 3; index += 1) {
    validationRows.push(
      classifiedRow({
        date: '2026-06-22',
        gameId: 9101,
        paNumber: index,
        batterId: 101,
        pitcherId: 201,
        terminalCategory: 'K',
      }),
    );
  }
  for (let index = 4; index <= 6; index += 1) {
    validationRows.push(
      classifiedRow({
        date: '2026-06-23',
        gameId: 9102,
        paNumber: index,
        batterId: 102,
        pitcherId: 202,
        terminalCategory: '1B',
      }),
    );
  }

  const periods = {
    fit: makePeriod({
      periodId: 'fit',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
      rows: fitRows,
    }),
    validation: makePeriod({
      periodId: 'validation',
      startDate: '2026-06-22',
      endDate: '2026-06-23',
      rows: validationRows,
    }),
  };
  const dataset = {
    datasetVersion: 3,
    purpose: 'synthetic resolved categorical dataset',
    activeSeason: 2026,
    sourceDatasetSha256: 'a'.repeat(64),
    sourceDatasetFileSha256: 'b'.repeat(64),
    sourceResolutionSha256: 'c'.repeat(64),
    sourceResolutionFileSha256: 'd'.repeat(64),
    sourcePartitionSha256: 'e'.repeat(64),
    sourceEvidenceSetSha256: 'f'.repeat(64),
    periods,
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      shardCount: 20,
      gameCount: 225,
      plateAppearanceCount: 16830,
      rowsIncluded: false,
      allowedUse: 'final-evaluation-only-after-candidate-selection',
    },
    totals: {
      includedRowCount: 26,
      classifiedTerminalCount: 26,
      overallOutcomeEligibleCount: 26,
      platoonEligibleCount: 26,
      platoonIneligibleTerminalCount: 0,
      baserunningOnlyCount: 0,
      unresolvedCount: 0,
      missingResultCount: 0,
      contextRequiredCount: 0,
      unknownResultCount: 0,
      contextContradictionCount: 0,
      contextResolutionAppliedCount: 0,
      resolvedContextTerminalCount: 0,
      resolvedContextBaserunningCount: 0,
      remainingContextUnresolvedCount: 0,
      terminalCategoryCounts: { K: 13, '1B': 13 },
    },
  };
  dataset.datasetSha256 = sha256(JSON.stringify(datasetIdentity(dataset)));
  return dataset;
}

function evaluate(dataset) {
  const datasetText = JSON.stringify(dataset);
  return evaluateResolvedCategoricalModel({
    dataset,
    datasetText,
    canonicalCategories: CATEGORIES,
    hitCategories: HIT_CATEGORIES,
    poolingCandidates: POOLING_CANDIDATES,
    matchupCandidates: MATCHUP_CANDIDATES,
  });
}

test('reuses existing pooling and coherent matchup paths while retaining structural-zero categories', () => {
  const result = evaluate(makeDataset());
  assert.deepEqual(result.canonicalVectorPolicy.canonicalCategories, CATEGORIES);
  assert.deepEqual(result.canonicalVectorPolicy.modeledCategories, ['K', '1B']);
  assert.deepEqual(result.canonicalVectorPolicy.structuralZeroCategories, ['OTHER_PA']);
  assert.equal(result.canonicalVectorPolicy.canonicalLeagueTarget.OTHER_PA, 0);
  assert.ok(
    Math.abs(
      Object.values(result.canonicalVectorPolicy.canonicalLeagueTarget).reduce(
        (sum, value) => sum + value,
        0,
      ) - 1,
    ) <= 1e-12,
  );
  assert.equal(
    result.poolingBoundary.batter.selection.status,
    'finite-pooling-candidate-selected',
  );
  assert.equal(
    result.poolingBoundary.pitcherAllowed.selection.status,
    'finite-pooling-candidate-selected',
  );
  assert.equal(result.coherentStatus, 'coherent-matchup-evaluated');
  assert.equal(result.coherentMatchup.poolingPassCountPerParameter, 1);
  assert.equal(result.coherentMatchup.secondShrinkageAllowed, false);
});

test('uses one identical validation cohort for pooling and coherent candidates', () => {
  const result = evaluate(makeDataset());
  const batter = result.poolingBoundary.batter;
  const pitcher = result.poolingBoundary.pitcherAllowed;
  const matchup = result.coherentMatchup;
  assert.equal(batter.validationObservationCount, 6);
  assert.equal(pitcher.validationObservationCount, 6);
  assert.equal(matchup.validationObservationCount, 6);
  assert.equal(batter.validationObservationIdsSha256, pitcher.validationObservationIdsSha256);
  assert.equal(batter.validationObservationIdsSha256, matchup.validationObservationIdsSha256);
});

test('is deterministic for identical versioned inputs', () => {
  const dataset = makeDataset();
  const first = evaluate(dataset);
  const second = evaluate(dataset);
  assert.equal(first.evaluationSha256, second.evaluationSha256);
  assert.deepEqual(first, second);
});

test('rejects legacy dataset v2 instead of silently relabeling it', () => {
  const dataset = makeDataset();
  dataset.datasetVersion = 2;
  assert.throws(() => evaluate(dataset), /datasetVersion must equal 3/);
});

test('fails closed when validation contains a category with zero fit support', () => {
  const dataset = makeDataset();
  dataset.periods.validation.rows[0].terminalCategory = 'OTHER_PA';
  dataset.periods.validation.terminalCategoryCounts = {
    K: 2,
    '1B': 3,
    OTHER_PA: 1,
  };
  dataset.totals.terminalCategoryCounts = { K: 12, '1B': 13, OTHER_PA: 1 };
  dataset.datasetSha256 = sha256(JSON.stringify(datasetIdentity(dataset)));
  assert.throws(
    () => evaluate(dataset),
    /has no current-season fit support and cannot be assigned invented probability mass/,
  );
});

test('rejects tampered identity and any exposed untouched-test rows', () => {
  const tampered = makeDataset();
  tampered.periods.fit.rows[0].providerBatterId = 999;
  assert.throws(() => evaluate(tampered), /internal SHA-256/);

  const exposed = makeDataset();
  exposed.untouchedTestReservation.rowsIncluded = true;
  exposed.datasetSha256 = sha256(JSON.stringify(datasetIdentity(exposed)));
  assert.throws(() => evaluate(exposed), /untouched test rows must remain absent/);
});
