import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  evaluateM8CategoricalPoolingBoundary,
  M8_CATEGORICAL_POOLING_BOUNDARY_CANDIDATES,
} from '../scripts/m8-categorical-pooling-boundary-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

const categories = Object.freeze(['HIT', 'OUT']);

function row({ id, date, batterId, pitcherId, category }) {
  return Object.freeze({
    rowId: id,
    observedDate: date,
    providerGameId: 1,
    providerPaNumber: Number(id.replace(/\D/g, '').slice(-6)) || 1,
    providerBatterId: batterId,
    providerPitcherId: pitcherId,
    mappingStatus: 'classified-terminal',
    unresolvedReason: null,
    terminalCategory: category,
    includedInOverallOutcomeModel: true,
    includedInPlatoonModel: true,
  });
}

function period(startDate, endDate, rows) {
  return Object.freeze({
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
    rows,
  });
}

async function writeDataset(root, { fitRows, validationRows, exposeTestRows = false }) {
  const periods = Object.freeze({
    fit: period('2026-03-26', '2026-06-21', fitRows),
    validation: period('2026-06-22', '2026-07-05', validationRows),
  });
  const untouchedTestReservation = {
    startDate: '2026-07-06',
    endDate: '2026-07-25',
    shardCount: 20,
    gameCount: 20,
    plateAppearanceCount: 20,
    rowsIncluded: false,
    allowedUse: 'final-evaluation-only-after-candidate-selection',
    ...(exposeTestRows ? { rows: [{ forbidden: true }] } : {}),
  };
  const identity = {
    activeSeason: 2026,
    sourcePartitionSha256: 'a'.repeat(64),
    sourceEvidenceSetSha256: 'b'.repeat(64),
    periods,
    untouchedTestReservation,
  };
  const dataset = {
    datasetVersion: 2,
    purpose: 'synthetic categorical pooling boundary dataset',
    ...identity,
    totals: {
      includedRowCount: fitRows.length + validationRows.length,
      classifiedTerminalCount: fitRows.length + validationRows.length,
    },
    datasetSha256: sha256(JSON.stringify(identity)),
  };
  const datasetPath = path.join(root, 'dataset.json');
  await writeFile(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  return datasetPath;
}

function repeatedRows({ prefix, date, batterId, pitcherId, hitCount, outCount }) {
  const rows = [];
  for (let index = 0; index < hitCount; index += 1) {
    rows.push(
      row({
        id: `${prefix}-hit-${index}`,
        date,
        batterId,
        pitcherId,
        category: 'HIT',
      }),
    );
  }
  for (let index = 0; index < outCount; index += 1) {
    rows.push(
      row({
        id: `${prefix}-out-${index}`,
        date,
        batterId,
        pitcherId,
        category: 'OUT',
      }),
    );
  }
  return rows;
}

async function withTempRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-pooling-boundary-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('selects the exact league-only limit when identity deviations contain no later validation signal', async () => {
  await withTempRoot(async (root) => {
    const fitRows = [
      ...repeatedRows({
        prefix: 'fit-a',
        date: '2026-06-20',
        batterId: 1,
        pitcherId: 11,
        hitCount: 9,
        outCount: 1,
      }),
      ...repeatedRows({
        prefix: 'fit-b',
        date: '2026-06-21',
        batterId: 2,
        pitcherId: 22,
        hitCount: 1,
        outCount: 9,
      }),
    ];
    const validationRows = [
      ...repeatedRows({
        prefix: 'validation-a',
        date: '2026-06-22',
        batterId: 1,
        pitcherId: 11,
        hitCount: 5,
        outCount: 5,
      }),
      ...repeatedRows({
        prefix: 'validation-b',
        date: '2026-06-22',
        batterId: 2,
        pitcherId: 22,
        hitCount: 5,
        outCount: 5,
      }),
    ];
    const datasetPath = await writeDataset(root, { fitRows, validationRows });

    const evaluation = await evaluateM8CategoricalPoolingBoundary({
      datasetPath,
      categories,
    });

    assert.equal(
      evaluation.batter.selection.status,
      'league-only-limit-selected',
    );
    assert.equal(
      evaluation.pitcherAllowed.selection.status,
      'league-only-limit-selected',
    );
    assert.equal(
      evaluation.batter.selection.selectedCandidate.candidateId,
      'league-only-limit',
    );
    assert.equal(evaluation.batter.results.length, 14);
    assert.equal(
      evaluation.finiteCandidates.at(-1).leagueEquivalentPa,
      4096,
    );
  });
});

test('selects a finite pooling strength when identity deviations persist into validation', async () => {
  await withTempRoot(async (root) => {
    const fitRows = [
      ...repeatedRows({
        prefix: 'fit-a',
        date: '2026-06-20',
        batterId: 1,
        pitcherId: 11,
        hitCount: 9,
        outCount: 1,
      }),
      ...repeatedRows({
        prefix: 'fit-b',
        date: '2026-06-21',
        batterId: 2,
        pitcherId: 22,
        hitCount: 1,
        outCount: 9,
      }),
    ];
    const validationRows = [
      ...repeatedRows({
        prefix: 'validation-a',
        date: '2026-06-22',
        batterId: 1,
        pitcherId: 11,
        hitCount: 10,
        outCount: 0,
      }),
      ...repeatedRows({
        prefix: 'validation-b',
        date: '2026-06-22',
        batterId: 2,
        pitcherId: 22,
        hitCount: 0,
        outCount: 10,
      }),
    ];
    const datasetPath = await writeDataset(root, { fitRows, validationRows });

    const evaluation = await evaluateM8CategoricalPoolingBoundary({
      datasetPath,
      categories,
    });

    assert.equal(
      evaluation.batter.selection.status,
      'finite-pooling-candidate-selected',
    );
    assert.notEqual(
      evaluation.batter.selection.selectedCandidate.candidateId,
      'league-only-limit',
    );
    assert.equal(
      evaluation.pitcherAllowed.selection.status,
      'finite-pooling-candidate-selected',
    );
  });
});

test('is deterministic and uses the identical validation observation identities for finite and league-only candidates', async () => {
  await withTempRoot(async (root) => {
    const fitRows = [
      ...repeatedRows({
        prefix: 'fit-a',
        date: '2026-06-20',
        batterId: 1,
        pitcherId: 11,
        hitCount: 2,
        outCount: 2,
      }),
      ...repeatedRows({
        prefix: 'fit-b',
        date: '2026-06-21',
        batterId: 2,
        pitcherId: 22,
        hitCount: 2,
        outCount: 2,
      }),
    ];
    const validationRows = [
      ...repeatedRows({
        prefix: 'validation-a',
        date: '2026-06-22',
        batterId: 1,
        pitcherId: 11,
        hitCount: 1,
        outCount: 1,
      }),
      ...repeatedRows({
        prefix: 'validation-b',
        date: '2026-06-22',
        batterId: 2,
        pitcherId: 22,
        hitCount: 1,
        outCount: 1,
      }),
    ];
    const datasetPath = await writeDataset(root, { fitRows, validationRows });

    const first = await evaluateM8CategoricalPoolingBoundary({
      datasetPath,
      categories,
    });
    const second = await evaluateM8CategoricalPoolingBoundary({
      datasetPath,
      categories,
    });

    assert.deepEqual(first, second);
    for (const parameter of [first.batter, first.pitcherAllowed]) {
      assert.ok(
        parameter.results.every(
          (result) =>
            result.validationObservationCount ===
              parameter.validationObservationCount &&
            result.validationObservationIdsSha256 ===
              parameter.validationObservationIdsSha256,
        ),
      );
    }
    assert.match(first.boundaryEvaluationSha256, /^[a-f0-9]{64}$/);
    assert.equal(
      M8_CATEGORICAL_POOLING_BOUNDARY_CANDIDATES.at(-1).leagueEquivalentPa,
      4096,
    );
  });
});

test('rejects a source dataset that exposes untouched-test rows', async () => {
  await withTempRoot(async (root) => {
    const fitRows = repeatedRows({
      prefix: 'fit',
      date: '2026-06-20',
      batterId: 1,
      pitcherId: 11,
      hitCount: 1,
      outCount: 1,
    });
    const validationRows = repeatedRows({
      prefix: 'validation',
      date: '2026-06-22',
      batterId: 1,
      pitcherId: 11,
      hitCount: 1,
      outCount: 1,
    });
    const datasetPath = await writeDataset(root, {
      fitRows,
      validationRows,
      exposeTestRows: true,
    });

    await assert.rejects(
      evaluateM8CategoricalPoolingBoundary({
        datasetPath,
        categories,
      }),
      /test rows must remain absent/,
    );
  });
});
