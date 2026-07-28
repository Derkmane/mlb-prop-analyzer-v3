import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateResolvedCategoricalModel } from '../scripts/m8-resolved-categorical-model-evaluation-utils.mjs';
import { evaluateResolvedCategoricalWalkForward } from '../scripts/m8-resolved-categorical-walk-forward-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

const CATEGORIES = Object.freeze(['K', '1B', 'OTHER_PA']);
const HIT_CATEGORIES = Object.freeze(['1B']);

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

function row({ date, gameId, paNumber, batterId, pitcherId, terminalCategory }) {
  return {
    rowId: `${date}:${gameId}:${paNumber}`,
    observedDate: date,
    providerGameId: gameId,
    providerPaNumber: paNumber,
    providerBatterId: batterId,
    providerPitcherId: pitcherId,
    mappingStatus: 'classified-terminal',
    includedInOverallOutcomeModel: true,
    terminalCategory,
  };
}

function period(startDate, endDate, rows) {
  return {
    startDate,
    endDate,
    rowCount: rows.length,
    classifiedTerminalCount: rows.length,
    rows,
  };
}

function makeDataset() {
  const fitRows = [];
  for (let index = 1; index <= 20; index += 1) {
    fitRows.push(
      row({
        date: '2026-05-01',
        gameId: 8001,
        paNumber: index,
        batterId: 101,
        pitcherId: 201,
        terminalCategory: 'K',
      }),
    );
  }
  for (let index = 21; index <= 40; index += 1) {
    fitRows.push(
      row({
        date: '2026-05-02',
        gameId: 8002,
        paNumber: index,
        batterId: 102,
        pitcherId: 202,
        terminalCategory: '1B',
      }),
    );
  }

  const validationRows = [];
  let paNumber = 1;
  for (const date of ['2026-06-22', '2026-06-23']) {
    for (let index = 0; index < 4; index += 1) {
      validationRows.push(
        row({
          date,
          gameId: date === '2026-06-22' ? 8101 : 8102,
          paNumber: paNumber++,
          batterId: 101,
          pitcherId: 201,
          terminalCategory: 'K',
        }),
      );
    }
    for (let index = 0; index < 4; index += 1) {
      validationRows.push(
        row({
          date,
          gameId: date === '2026-06-22' ? 8101 : 8102,
          paNumber: paNumber++,
          batterId: 102,
          pitcherId: 202,
          terminalCategory: '1B',
        }),
      );
    }
  }

  const periods = {
    fit: period('2026-05-01', '2026-05-02', fitRows),
    validation: period('2026-06-22', '2026-06-23', validationRows),
  };
  const dataset = {
    datasetVersion: 3,
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
      plateAppearanceCount: 16830,
      rowsIncluded: false,
    },
    totals: {
      includedRowCount: 56,
      classifiedTerminalCount: 56,
    },
  };
  dataset.datasetSha256 = sha256(JSON.stringify(datasetIdentity(dataset)));
  return dataset;
}

function makeFixture() {
  const dataset = makeDataset();
  const datasetText = JSON.stringify(dataset);
  const fixedEvaluation = evaluateResolvedCategoricalModel({
    dataset,
    datasetText,
    canonicalCategories: CATEGORIES,
    hitCategories: HIT_CATEGORIES,
  });
  return {
    dataset,
    datasetText,
    fixedEvaluation,
    fixedEvaluationText: JSON.stringify(fixedEvaluation),
  };
}

function evaluate(fixture) {
  return evaluateResolvedCategoricalWalkForward({
    ...fixture,
    canonicalCategories: CATEGORIES,
    hitCategories: HIT_CATEGORIES,
  });
}

test('uses expanding strictly earlier training and scores each validation date once', () => {
  const result = evaluate(makeFixture());
  assert.equal(result.folds.length, 2);
  assert.deepEqual(
    result.folds.map((fold) => [
      fold.validationDate,
      fold.trainingObservationCount,
      fold.validationObservationCount,
      fold.trainingEndDate,
    ]),
    [
      ['2026-06-22', 40, 8, '2026-05-02'],
      ['2026-06-23', 48, 8, '2026-06-22'],
    ],
  );
  assert.equal(result.aggregateResults[0].validationObservationCount, 16);
});

test('keeps fixed pooling strengths and one identical coefficient cohort', () => {
  const result = evaluate(makeFixture());
  assert.equal(result.candidates.length, 49);
  assert.ok(result.poolingStrengths.batterLeagueEquivalentPa > 0);
  assert.ok(result.poolingStrengths.pitcherAllowedLeagueEquivalentPa > 0);
  for (const fold of result.folds) {
    assert.equal(fold.results.length, 49);
    assert.ok(
      fold.results.every(
        (entry) =>
          entry.validationObservationCount === fold.validationObservationCount,
      ),
    );
  }
  assert.equal(result.aggregateResults.length, 49);
  assert.equal(
    result.stability.leagueOnlyCandidateAggregateMetrics.candidate.candidateId,
    'batter-0.00-pitcher-0.00',
  );
});

test('tracks the fixed-holdout candidate and fold selection stability', () => {
  const result = evaluate(makeFixture());
  assert.ok(result.stability.fixedHoldoutCandidateAggregateRank >= 1);
  assert.ok(result.stability.fixedHoldoutCandidateAggregateRank <= 49);
  assert.equal(
    Object.values(result.stability.foldSelectionCounts).reduce(
      (sum, count) => sum + count,
      0,
    ),
    result.folds.length,
  );
  assert.ok(result.stability.sameAsFixedHoldoutSelectionRate >= 0);
  assert.ok(result.stability.sameAsFixedHoldoutSelectionRate <= 1);
});

test('preserves structural-zero categories and is deterministic', () => {
  const fixture = makeFixture();
  const first = evaluate(fixture);
  const second = evaluate(fixture);
  assert.deepEqual(first.structuralZeroCategories, ['OTHER_PA']);
  assert.equal(first.walkForwardSha256, second.walkForwardSha256);
  assert.deepEqual(first, second);
});

test('rejects a tampered fixed evaluation artifact', () => {
  const fixture = makeFixture();
  const tampered = structuredClone(fixture.fixedEvaluation);
  tampered.coherentMatchup.selection.selectedCandidate.candidateId =
    'batter-0.00-pitcher-0.00';
  assert.throws(
    () =>
      evaluate({
        ...fixture,
        fixedEvaluation: tampered,
        fixedEvaluationText: JSON.stringify(tampered),
      }),
    /fixed evaluation SHA-256 drifted|content drifted/,
  );
});

test('rejects exposed test rows and non-chronological source periods', () => {
  const exposed = makeDataset();
  exposed.untouchedTestReservation.rowsIncluded = true;
  exposed.datasetSha256 = sha256(JSON.stringify(datasetIdentity(exposed)));
  const originalFixture = makeFixture();
  assert.throws(
    () =>
      evaluate({
        ...originalFixture,
        dataset: exposed,
        datasetText: JSON.stringify(exposed),
      }),
    /untouched test rows must remain absent/,
  );

  const overlapping = makeDataset();
  overlapping.periods.validation.startDate = '2026-05-02';
  overlapping.periods.validation.rows[0].observedDate = '2026-05-02';
  overlapping.periods.validation.rows[0].rowId = '2026-05-02:8101:1';
  overlapping.datasetSha256 = sha256(JSON.stringify(datasetIdentity(overlapping)));
  assert.throws(
    () =>
      evaluate({
        ...originalFixture,
        dataset: overlapping,
        datasetText: JSON.stringify(overlapping),
      }),
    /strictly chronological|outside its validation date window/,
  );
});
