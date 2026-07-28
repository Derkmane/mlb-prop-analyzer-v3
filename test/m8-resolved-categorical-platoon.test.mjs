import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateResolvedCategoricalModel } from '../scripts/m8-resolved-categorical-model-evaluation-utils.mjs';
import {
  applyPlatoonDeviation,
  evaluateResolvedCategoricalPlatoon,
} from '../scripts/m8-resolved-categorical-platoon-utils.mjs';
import { evaluateResolvedCategoricalWalkForward } from '../scripts/m8-resolved-categorical-walk-forward-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

const CATEGORIES = Object.freeze(['K', '1B', '2B', 'OTHER_PA']);
const HIT_CATEGORIES = Object.freeze(['1B', '2B']);
const PLATOON_CANDIDATES = Object.freeze([
  Object.freeze({
    candidateId: 'no-platoon',
    leaguePlatoonPriorId: null,
    leaguePlatoonEquivalentPa: null,
    leaguePlatoonExactTarget: true,
    playerSplitPriorId: null,
    playerSplitEquivalentPa: null,
    playerSplitExactTarget: true,
    platoonCoefficient: 0,
  }),
  Object.freeze({
    candidateId: 'league-pa-16-split-pa-16-coefficient-1.00',
    leaguePlatoonPriorId: 'league-pa-16',
    leaguePlatoonEquivalentPa: 16,
    leaguePlatoonExactTarget: false,
    playerSplitPriorId: 'split-pa-16',
    playerSplitEquivalentPa: 16,
    playerSplitExactTarget: false,
    platoonCoefficient: 1,
  }),
  Object.freeze({
    candidateId: 'league-only-target-split-target-only-coefficient-0.50',
    leaguePlatoonPriorId: 'league-only-target',
    leaguePlatoonEquivalentPa: null,
    leaguePlatoonExactTarget: true,
    playerSplitPriorId: 'split-target-only',
    playerSplitEquivalentPa: null,
    playerSplitExactTarget: true,
    platoonCoefficient: 0.5,
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

function terminalRow({
  date,
  gameId,
  paNumber,
  batterId,
  pitcherId,
  terminalCategory,
  batterSide,
  pitcherHand,
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
    rawBatterSide: batterSide,
    rawPitcherHand: pitcherHand,
    rawResult:
      terminalCategory === 'K'
        ? 'Strikeout'
        : terminalCategory === '1B'
          ? 'Single'
          : 'Double',
    sourceSnapshotPath: `snapshots/${gameId}.json`,
    sourceSnapshotSha256: String((gameId % 8) + 1).repeat(64),
    mappingStatus: 'classified-terminal',
    unresolvedReason: null,
    terminalCategory,
    normalizedBatterSide: batterSide,
    normalizedPitcherHand: pitcherHand,
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

function summarizePeriod(periodId, startDate, endDate, rows) {
  const terminalCategoryCounts = {};
  for (const row of rows) {
    terminalCategoryCounts[row.terminalCategory] =
      (terminalCategoryCounts[row.terminalCategory] ?? 0) + 1;
  }
  const platoonEligibleCount = rows.filter(
    (row) => row.includedInPlatoonModel,
  ).length;
  return {
    periodId,
    startDate,
    endDate,
    rowCount: rows.length,
    classifiedTerminalCount: rows.length,
    overallOutcomeEligibleCount: rows.length,
    platoonEligibleCount,
    platoonIneligibleTerminalCount: rows.length - platoonEligibleCount,
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
  };
}

function buildRows({ validation = false }) {
  const rows = [];
  const definitions = [
    {
      terminalCategory: 'K',
      batterId: 101,
      pitcherId: 201,
      batterSide: 'R',
      pitcherHand: 'R',
    },
    {
      terminalCategory: '1B',
      batterId: 102,
      pitcherId: 202,
      batterSide: 'L',
      pitcherHand: 'L',
    },
    {
      terminalCategory: '2B',
      batterId: 103,
      pitcherId: 203,
      batterSide: 'R',
      pitcherHand: 'L',
    },
  ];
  if (!validation) {
    let paNumber = 1;
    for (const [definitionIndex, definition] of definitions.entries()) {
      for (let index = 0; index < 30; index += 1) {
        rows.push(
          terminalRow({
            date: `2026-05-0${definitionIndex + 1}`,
            gameId: 9000 + definitionIndex + 1,
            paNumber,
            ...definition,
          }),
        );
        paNumber += 1;
      }
    }
    return rows;
  }

  let paNumber = 1;
  for (const [dateIndex, date] of ['2026-06-22', '2026-06-23'].entries()) {
    for (const definition of definitions) {
      for (let index = 0; index < 3; index += 1) {
        rows.push(
          terminalRow({
            date,
            gameId: 9100 + dateIndex + 1,
            paNumber,
            ...definition,
          }),
        );
        paNumber += 1;
      }
    }
  }
  return rows;
}

function recalculateDataset(dataset) {
  dataset.periods.fit = summarizePeriod(
    'fit',
    '2026-05-01',
    '2026-05-03',
    dataset.periods.fit.rows,
  );
  dataset.periods.validation = summarizePeriod(
    'validation',
    '2026-06-22',
    '2026-06-23',
    dataset.periods.validation.rows,
  );
  const periods = dataset.periods;
  const includedRowCount = periods.fit.rowCount + periods.validation.rowCount;
  const platoonEligibleCount =
    periods.fit.platoonEligibleCount + periods.validation.platoonEligibleCount;
  dataset.totals = {
    includedRowCount,
    classifiedTerminalCount: includedRowCount,
    overallOutcomeEligibleCount: includedRowCount,
    platoonEligibleCount,
    platoonIneligibleTerminalCount: includedRowCount - platoonEligibleCount,
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
    terminalCategoryCounts: {
      K: 36,
      '1B': 36,
      '2B': 36,
    },
  };
  dataset.datasetSha256 = sha256(JSON.stringify(datasetIdentity(dataset)));
  return dataset;
}

function makeDataset() {
  const dataset = {
    datasetVersion: 3,
    purpose: 'synthetic resolved categorical platoon fixture',
    activeSeason: 2026,
    sourceDatasetSha256: 'a'.repeat(64),
    sourceDatasetFileSha256: 'b'.repeat(64),
    sourceResolutionSha256: 'c'.repeat(64),
    sourceResolutionFileSha256: 'd'.repeat(64),
    sourcePartitionSha256: 'e'.repeat(64),
    sourceEvidenceSetSha256: 'f'.repeat(64),
    periods: {
      fit: { rows: buildRows({ validation: false }) },
      validation: { rows: buildRows({ validation: true }) },
    },
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      shardCount: 20,
      gameCount: 225,
      plateAppearanceCount: 16830,
      rowsIncluded: false,
      allowedUse: 'final-evaluation-only-after-candidate-selection',
    },
    totals: {},
  };
  return recalculateDataset(dataset);
}

function buildArtifacts(dataset) {
  const datasetText = JSON.stringify(dataset);
  const fixed = evaluateResolvedCategoricalModel({
    dataset,
    datasetText,
    canonicalCategories: CATEGORIES,
    hitCategories: HIT_CATEGORIES,
  });
  assert.equal(fixed.coherentStatus, 'coherent-matchup-evaluated');
  const fixedText = JSON.stringify(fixed);
  const walkForward = evaluateResolvedCategoricalWalkForward({
    dataset,
    datasetText,
    fixedEvaluation: fixed,
    fixedEvaluationText: fixedText,
    canonicalCategories: CATEGORIES,
    hitCategories: HIT_CATEGORIES,
  });
  const walkForwardText = JSON.stringify(walkForward);
  return {
    datasetText,
    fixed,
    fixedText,
    walkForward,
    walkForwardText,
  };
}

function evaluate(dataset, candidates = PLATOON_CANDIDATES) {
  const artifacts = buildArtifacts(dataset);
  return {
    ...artifacts,
    result: evaluateResolvedCategoricalPlatoon({
      dataset,
      datasetText: artifacts.datasetText,
      fixedEvaluation: artifacts.fixed,
      fixedEvaluationText: artifacts.fixedText,
      walkForwardEvaluation: artifacts.walkForward,
      walkForwardEvaluationText: artifacts.walkForwardText,
      canonicalCategories: CATEGORIES,
      hitCategories: HIT_CATEGORIES,
      candidates,
    }),
  };
}

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test('zero platoon coefficient preserves overall batter talent and positive weight moves toward the split', () => {
  const categories = ['K', '1B', '2B'];
  const overall = Object.freeze({ K: 0.5, '1B': 0.3, '2B': 0.2 });
  const split = Object.freeze({ K: 0.2, '1B': 0.5, '2B': 0.3 });
  const neutral = applyPlatoonDeviation({
    categories,
    batterOverall: overall,
    playerSplit: split,
    platoonCoefficient: 0,
  });
  assert.equal(neutral, overall);
  const adjusted = applyPlatoonDeviation({
    categories,
    batterOverall: overall,
    playerSplit: split,
    platoonCoefficient: 1,
  });
  assertClose(adjusted.K, split.K);
  assertClose(adjusted['1B'], split['1B']);
  assertClose(adjusted['2B'], split['2B']);
});

test('no-platoon baseline reproduces the verified coherent model on the identical eligible cohort', () => {
  const { fixed, walkForward, result } = evaluate(makeDataset());
  const selectedId = walkForward.aggregateSelection.selectedCandidate.candidateId;
  const fixedSelected = fixed.coherentMatchup.results.find(
    (entry) => entry.candidate.candidateId === selectedId,
  );
  assert.ok(fixedSelected);
  assert.equal(result.cohorts.validationPlatoonObservationCount, 18);
  assert.equal(result.baseline.validationObservationCount, 18);
  assert.equal(
    result.baseline.validationObservationIdsSha256,
    fixed.coherentMatchup.validationObservationIdsSha256,
  );
  assertClose(
    result.baseline.validationCategoricalLogLoss,
    fixedSelected.validationCategoricalLogLoss,
  );
  assertClose(
    result.baseline.validationCategoricalBrierScore,
    fixedSelected.validationCategoricalBrierScore,
  );
  assertClose(result.baseline.validationHitLogLoss, fixedSelected.validationHitLogLoss);
  assertClose(result.baseline.validationHitBrierScore, fixedSelected.validationHitBrierScore);
});

test('uses one identical validation cohort and preserves the no-double-shrinkage boundary', () => {
  const { result } = evaluate(makeDataset());
  assert.equal(result.candidates.length, PLATOON_CANDIDATES.length);
  assert.ok(
    result.results.every(
      (entry) =>
        entry.validationObservationCount === 18 &&
        entry.validationObservationIdsSha256 ===
          result.cohorts.validationObservationIdsSha256,
    ),
  );
  assert.equal(result.platoonModel.doubleShrinkageAllowed, false);
  assert.equal(result.platoonModel.priorSeasonRowsAllowed, false);
  assert.equal(result.platoonModel.hardSampleCutoffAllowed, false);
  assert.equal(result.structuralZeroCategories.includes('OTHER_PA'), true);
  assert.equal(result.untouchedTestReservation.rowsIncluded, false);
});

test('retains a switch-hitter row in overall fitting while excluding only its platoon interaction', () => {
  const dataset = makeDataset();
  const row = dataset.periods.fit.rows[0];
  row.rawBatterSide = 'S';
  row.normalizedBatterSide = null;
  row.platoonEligible = false;
  row.includedInPlatoonModel = false;
  recalculateDataset(dataset);
  const { result } = evaluate(dataset);
  assert.equal(result.cohorts.fitOverallObservationCount, 90);
  assert.equal(result.cohorts.fitPlatoonObservationCount, 89);
  assert.equal(result.cohorts.fitPlatoonExcludedCount, 1);
  assert.equal(row.normalizedPitcherHand, 'R');
});

test('is deterministic for identical versioned inputs', () => {
  const dataset = makeDataset();
  const first = evaluate(dataset).result;
  const second = evaluate(dataset).result;
  assert.equal(first.platoonEvaluationSha256, second.platoonEvaluationSha256);
  assert.deepEqual(first, second);
});

test('rejects tampered source artifacts, invalid platoon flags, and exposed test rows', () => {
  const dataset = makeDataset();
  const artifacts = buildArtifacts(dataset);
  const tamperedFixed = structuredClone(artifacts.fixed);
  tamperedFixed.coherentMatchup.selection.selectedCandidate.batterCoefficient += 0.25;
  assert.throws(
    () =>
      evaluateResolvedCategoricalPlatoon({
        dataset,
        datasetText: artifacts.datasetText,
        fixedEvaluation: tamperedFixed,
        fixedEvaluationText: JSON.stringify(tamperedFixed),
        walkForwardEvaluation: artifacts.walkForward,
        walkForwardEvaluationText: artifacts.walkForwardText,
        canonicalCategories: CATEGORIES,
        hitCategories: HIT_CATEGORIES,
        candidates: PLATOON_CANDIDATES,
      }),
    /fixed evaluation drifted/,
  );

  const invalidFlag = makeDataset();
  invalidFlag.periods.fit.rows[0].includedInPlatoonModel = false;
  invalidFlag.periods.fit.rows[0].platoonEligible = false;
  recalculateDataset(invalidFlag);
  assert.throws(
    () => evaluate(invalidFlag),
    /platoon eligibility must equal availability/,
  );

  const exposed = makeDataset();
  exposed.untouchedTestReservation.rowsIncluded = true;
  exposed.datasetSha256 = sha256(JSON.stringify(datasetIdentity(exposed)));
  assert.throws(() => evaluate(exposed), /untouched test rows must remain absent/);
});
