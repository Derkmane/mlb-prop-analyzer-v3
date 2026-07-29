import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildM8HitBenchmarkDataset } from '../scripts/m8-hit-benchmark-dataset-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

const snapshotSha256 = 'a'.repeat(64);

function commonRow({
  rowId,
  observedDate,
  paNumber,
  result,
  pitcherHand = 'L',
}) {
  return {
    rowId,
    observedDate,
    providerGameId: observedDate === '2026-03-26' ? 10 : 11,
    providerPaNumber: paNumber,
    providerBatterId: 1000 + paNumber,
    providerPitcherId: 2000,
    inning: 1,
    halfInning: 'top',
    rawBatterSide: 'R',
    rawPitcherHand: pitcherHand,
    rawResult: result,
    sourceSnapshotPath: `${observedDate}/plate-appearances/game.json`,
    sourceSnapshotSha256: snapshotSha256,
  };
}

function classifiedRow({
  rowId,
  observedDate,
  paNumber,
  result,
  terminalCategory,
  pitcherHand = 'L',
}) {
  const common = commonRow({
    rowId,
    observedDate,
    paNumber,
    result,
    pitcherHand,
  });
  const platoonEligible = pitcherHand === 'L' || pitcherHand === 'R';
  return {
    ...common,
    mappingStatus: 'classified-terminal',
    unresolvedReason: null,
    terminalCategory,
    normalizedBatterSide: 'R',
    normalizedPitcherHand: platoonEligible ? pitcherHand : null,
    overallOutcomeEligible: true,
    platoonEligible,
    includedInOverallOutcomeModel: true,
    includedInPlatoonModel: platoonEligible,
  };
}

function unresolvedRow({
  rowId,
  observedDate,
  paNumber,
  result,
  reason,
}) {
  return {
    ...commonRow({ rowId, observedDate, paNumber, result }),
    mappingStatus: 'unresolved',
    unresolvedReason: reason,
    terminalCategory: null,
    normalizedBatterSide: null,
    normalizedPitcherHand: null,
    overallOutcomeEligible: false,
    platoonEligible: false,
    includedInOverallOutcomeModel: false,
    includedInPlatoonModel: false,
  };
}

function baserunningRow({ rowId, observedDate, paNumber }) {
  return {
    ...commonRow({
      rowId,
      observedDate,
      paNumber,
      result: 'Caught Stealing 2B',
    }),
    mappingStatus: 'baserunning-only',
    unresolvedReason: null,
    terminalCategory: null,
    normalizedBatterSide: null,
    normalizedPitcherHand: null,
    overallOutcomeEligible: false,
    platoonEligible: false,
    includedInOverallOutcomeModel: false,
    includedInPlatoonModel: false,
  };
}

function period(startDate, endDate, rows) {
  return {
    startDate,
    endDate,
    rowCount: rows.length,
    classifiedTerminalCount: rows.filter(
      (row) => row.mappingStatus === 'classified-terminal',
    ).length,
    overallOutcomeEligibleCount: rows.filter(
      (row) => row.includedInOverallOutcomeModel,
    ).length,
    platoonEligibleCount: rows.filter((row) => row.includedInPlatoonModel)
      .length,
    platoonIneligibleTerminalCount: rows.filter(
      (row) =>
        row.mappingStatus === 'classified-terminal' &&
        !row.includedInPlatoonModel,
    ).length,
    baserunningOnlyCount: rows.filter(
      (row) => row.mappingStatus === 'baserunning-only',
    ).length,
    unresolvedCount: rows.filter((row) => row.mappingStatus === 'unresolved')
      .length,
    missingResultCount: rows.filter(
      (row) => row.unresolvedReason === 'missing-result',
    ).length,
    contextRequiredCount: rows.filter(
      (row) => row.unresolvedReason === 'context-required',
    ).length,
    unknownResultCount: rows.filter(
      (row) => row.unresolvedReason === 'unknown-result',
    ).length,
    contextContradictionCount: rows.filter(
      (row) => row.unresolvedReason === 'context-contradiction',
    ).length,
    rows,
  };
}

async function writeSourceDataset(root, {
  fitRows,
  validationRows,
  untouchedRows = undefined,
  mutate = (value) => value,
}) {
  const fit = period('2026-03-26', '2026-03-26', fitRows);
  const validation = period(
    '2026-03-27',
    '2026-03-27',
    validationRows,
  );
  const untouchedTestReservation = {
    startDate: '2026-03-28',
    endDate: '2026-03-28',
    shardCount: 1,
    gameCount: 1,
    plateAppearanceCount: 9,
    rowsIncluded: false,
    allowedUse: 'final-evaluation-only-after-candidate-selection',
    ...(untouchedRows === undefined ? {} : { rows: untouchedRows }),
  };
  const datasetIdentity = {
    activeSeason: 2026,
    sourcePartitionSha256: 'b'.repeat(64),
    sourceEvidenceSetSha256: 'c'.repeat(64),
    periods: { fit, validation },
    untouchedTestReservation,
  };
  const dataset = mutate({
    datasetVersion: 2,
    purpose: 'test source',
    ...datasetIdentity,
    totals: {
      includedRowCount: fitRows.length + validationRows.length,
      classifiedTerminalCount:
        fit.classifiedTerminalCount + validation.classifiedTerminalCount,
      overallOutcomeEligibleCount:
        fit.overallOutcomeEligibleCount + validation.overallOutcomeEligibleCount,
      platoonEligibleCount:
        fit.platoonEligibleCount + validation.platoonEligibleCount,
      platoonIneligibleTerminalCount:
        fit.platoonIneligibleTerminalCount +
        validation.platoonIneligibleTerminalCount,
      baserunningOnlyCount:
        fit.baserunningOnlyCount + validation.baserunningOnlyCount,
      unresolvedCount: fit.unresolvedCount + validation.unresolvedCount,
      missingResultCount:
        fit.missingResultCount + validation.missingResultCount,
      contextRequiredCount:
        fit.contextRequiredCount + validation.contextRequiredCount,
      unknownResultCount:
        fit.unknownResultCount + validation.unknownResultCount,
      contextContradictionCount:
        fit.contextContradictionCount + validation.contextContradictionCount,
    },
    datasetSha256: sha256(JSON.stringify(datasetIdentity)),
  });
  const sourcePath = path.join(root, 'source-dataset.json');
  await writeFile(sourcePath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  return sourcePath;
}

async function withTempRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-hit-benchmark-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('builds a deterministic Hit/No-Hit benchmark while conserving all source rows and sealing test', async () => {
  await withTempRoot(async (root) => {
    const sourceDatasetPath = await writeSourceDataset(root, {
      fitRows: [
        classifiedRow({
          rowId: '2026-03-26:10:1',
          observedDate: '2026-03-26',
          paNumber: 1,
          result: 'Single',
          terminalCategory: '1B',
        }),
        classifiedRow({
          rowId: '2026-03-26:10:2',
          observedDate: '2026-03-26',
          paNumber: 2,
          result: 'Strikeout',
          terminalCategory: 'K',
        }),
        unresolvedRow({
          rowId: '2026-03-26:10:3',
          observedDate: '2026-03-26',
          paNumber: 3,
          result: 'Fielders Choice',
          reason: 'context-required',
        }),
        unresolvedRow({
          rowId: '2026-03-26:10:4',
          observedDate: '2026-03-26',
          paNumber: 4,
          result: 'Future Provider Result',
          reason: 'unknown-result',
        }),
        unresolvedRow({
          rowId: '2026-03-26:10:5',
          observedDate: '2026-03-26',
          paNumber: 5,
          result: null,
          reason: 'missing-result',
        }),
        baserunningRow({
          rowId: '2026-03-26:10:6',
          observedDate: '2026-03-26',
          paNumber: 6,
        }),
        classifiedRow({
          rowId: '2026-03-26:10:7',
          observedDate: '2026-03-26',
          paNumber: 7,
          result: 'Home Run',
          terminalCategory: 'HR',
          pitcherHand: 'S',
        }),
      ],
      validationRows: [
        classifiedRow({
          rowId: '2026-03-27:11:1',
          observedDate: '2026-03-27',
          paNumber: 1,
          result: 'Double',
          terminalCategory: '2B',
        }),
      ],
    });

    const first = await buildM8HitBenchmarkDataset({ sourceDatasetPath });
    const second = await buildM8HitBenchmarkDataset({ sourceDatasetPath });

    assert.deepEqual(first, second);
    assert.equal(first.totals.sourceRowCount, 8);
    assert.equal(first.totals.observationCount, 5);
    assert.equal(first.totals.hitCount, 3);
    assert.equal(first.totals.noHitCount, 2);
    assert.equal(first.totals.contextualNonHitCount, 1);
    assert.equal(first.totals.platoonEligibleCount, 3);
    assert.equal(first.totals.excludedCount, 3);
    assert.equal(first.untouchedTestReservation.rowsIncluded, false);
    assert.equal(first.untouchedTestReservation.plateAppearanceCount, 9);
    const contextual = first.periods.fit.observations.find(
      (observation) => observation.providerPaNumber === 3,
    );
    assert.equal(contextual?.hit, 0);
    assert.equal(contextual?.terminalCategory, null);
    assert.equal(
      contextual?.labelSource,
      'verified-contextual-non-hit-result',
    );
    const switchPitcher = first.periods.fit.observations.find(
      (observation) => observation.providerPaNumber === 7,
    );
    assert.equal(switchPitcher?.hit, 1);
    assert.equal(switchPitcher?.platoonEligible, false);
    assert.match(first.benchmarkSha256, /^[a-f0-9]{64}$/);
  });
});

test('maps every evidence-backed contextual terminal result to binary No Hit without assigning a terminal category', async () => {
  await withTempRoot(async (root) => {
    const contextualLabels = [
      'Fielders Choice',
      'Fielders Choice Out',
      'Forceout',
      'Double Play',
      'Triple Play',
      'Strikeout Double Play',
    ];
    const sourceDatasetPath = await writeSourceDataset(root, {
      fitRows: contextualLabels.map((result, index) =>
        unresolvedRow({
          rowId: `2026-03-26:10:${index + 1}`,
          observedDate: '2026-03-26',
          paNumber: index + 1,
          result,
          reason: 'context-required',
        }),
      ),
      validationRows: [
        classifiedRow({
          rowId: '2026-03-27:11:1',
          observedDate: '2026-03-27',
          paNumber: 1,
          result: 'Strikeout',
          terminalCategory: 'K',
        }),
      ],
    });

    const benchmark = await buildM8HitBenchmarkDataset({ sourceDatasetPath });
    assert.equal(benchmark.periods.fit.contextualNonHitCount, 6);
    assert.ok(
      benchmark.periods.fit.observations.every(
        (observation) =>
          observation.hit === 0 && observation.terminalCategory === null,
      ),
    );
  });
});

test('excludes context-required caught stealing as baserunning-only evidence', async () => {
  await withTempRoot(async (root) => {
    const sourceDatasetPath = await writeSourceDataset(root, {
      fitRows: [
        unresolvedRow({
          rowId: '2026-03-26:10:1',
          observedDate: '2026-03-26',
          paNumber: 1,
          result: 'Caught Stealing 2B',
          reason: 'context-required',
        }),
      ],
      validationRows: [
        classifiedRow({
          rowId: '2026-03-27:11:1',
          observedDate: '2026-03-27',
          paNumber: 1,
          result: 'Single',
          terminalCategory: '1B',
        }),
      ],
    });

    const benchmark = await buildM8HitBenchmarkDataset({ sourceDatasetPath });
    assert.equal(benchmark.periods.fit.observationCount, 0);
    assert.equal(benchmark.periods.fit.excludedCount, 1);
    assert.equal(
      benchmark.periods.fit.exclusions[0]?.exclusionReason,
      'context-required-baserunning-only',
    );
  });
});

test('fails closed when a context-required label is not evidence-backed as binary No Hit', async () => {
  await withTempRoot(async (root) => {
    const sourceDatasetPath = await writeSourceDataset(root, {
      fitRows: [
        unresolvedRow({
          rowId: '2026-03-26:10:1',
          observedDate: '2026-03-26',
          paNumber: 1,
          result: 'Future Context Label',
          reason: 'context-required',
        }),
      ],
      validationRows: [
        classifiedRow({
          rowId: '2026-03-27:11:1',
          observedDate: '2026-03-27',
          paNumber: 1,
          result: 'Single',
          terminalCategory: '1B',
        }),
      ],
    });

    await assert.rejects(
      buildM8HitBenchmarkDataset({ sourceDatasetPath }),
      /not verified as binary No Hit/,
    );
  });
});

test('rejects duplicate observation identities across fit and validation', async () => {
  await withTempRoot(async (root) => {
    const duplicate = classifiedRow({
      rowId: 'duplicate-row',
      observedDate: '2026-03-26',
      paNumber: 1,
      result: 'Single',
      terminalCategory: '1B',
    });
    const sourceDatasetPath = await writeSourceDataset(root, {
      fitRows: [duplicate],
      validationRows: [
        {
          ...duplicate,
          observedDate: '2026-03-27',
          providerGameId: 11,
        },
      ],
    });

    await assert.rejects(
      buildM8HitBenchmarkDataset({ sourceDatasetPath }),
      /duplicate observationId/,
    );
  });
});

test('rejects any source dataset that includes untouched-test rows', async () => {
  await withTempRoot(async (root) => {
    const sourceDatasetPath = await writeSourceDataset(root, {
      fitRows: [
        classifiedRow({
          rowId: '2026-03-26:10:1',
          observedDate: '2026-03-26',
          paNumber: 1,
          result: 'Single',
          terminalCategory: '1B',
        }),
      ],
      validationRows: [
        classifiedRow({
          rowId: '2026-03-27:11:1',
          observedDate: '2026-03-27',
          paNumber: 1,
          result: 'Strikeout',
          terminalCategory: 'K',
        }),
      ],
      untouchedRows: [{ forbidden: true }],
    });

    await assert.rejects(
      buildM8HitBenchmarkDataset({ sourceDatasetPath }),
      /must not contain rows/,
    );
  });
});
