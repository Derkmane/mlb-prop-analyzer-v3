import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildM8RecencyEvaluationDataset } from '../scripts/m8-recency-evaluation-dataset-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

function rawPa(paNumber, result) {
  return {
    batter_id: 1000 + paNumber,
    batter_side: 'R',
    half_inning: 'top',
    inning: 1,
    is_ball_in_play_out: false,
    outs: 0,
    pa_number: paNumber,
    pitcher_hand: 'L',
    pitcher_id: 2000,
    pitches: [
      {
        description: result === 'Caught Stealing 2B' ? 'Ball' : 'Ball In Play',
        pitch_call_code: 'X',
        pitch_type: 'Four-Seam Fastball',
        balls: 0,
        strikes: 0,
      },
    ],
    result,
    runner_on_first: false,
    runner_on_second: false,
    runner_on_third: false,
  };
}

function normalizeStub({ plateAppearance, providerGameId, sourceSnapshotSha256 }) {
  if (plateAppearance.result === 'Single') {
    return {
      status: 'normalized',
      terminalPa: {
        providerGameId,
        terminalCategory: '1B',
        sourceSnapshotSha256,
      },
      baserunningEvents: [],
    };
  }
  if (plateAppearance.result === 'Fielders Choice') {
    return {
      status: 'rejected',
      rawResult: plateAppearance.result,
      reason: 'context-required',
    };
  }
  if (plateAppearance.result === 'Caught Stealing 2B') {
    return {
      status: 'baserunning-only',
      providerGameId,
      providerPaNumber: plateAppearance.pa_number,
      rawResult: plateAppearance.result,
      sourceSnapshotSha256,
      baserunningEvents: ['CS'],
    };
  }
  return {
    status: 'rejected',
    rawResult: plateAppearance.result,
    reason: 'unknown-result',
  };
}

async function writeShard(root, date, gameId, rows) {
  const shardRoot = path.join(root, date);
  const paDir = path.join(shardRoot, 'plate-appearances');
  await mkdir(paDir, { recursive: true });
  const paRelativePath = path.join(
    'plate-appearances',
    `balldontlie-plate-appearances-${gameId}.json`,
  );
  const paPath = path.join(shardRoot, paRelativePath);
  const paText = `${JSON.stringify({ data: rows }, null, 2)}\n`;
  await writeFile(paPath, paText, 'utf8');

  const manifest = {
    captureVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    activeSeason: 2026,
    requestedStartDate: date,
    requestedEndDate: date,
    status: 'complete',
    truncated: false,
    capturedGameCount: 1,
    capturedPlateAppearanceCount: rows.length,
    dateCaptures: [
      {
        date,
        games: [
          {
            gameId,
            plateAppearancesSnapshot: {
              filePath: paRelativePath,
              savedBodySha256: sha256(paText),
              recordCount: rows.length,
            },
          },
        ],
      },
    ],
    error: null,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestPath = path.join(shardRoot, 'capture-manifest.json');
  await writeFile(manifestPath, manifestText, 'utf8');

  return {
    date,
    captureManifestPath: path.join(date, 'capture-manifest.json'),
    captureManifestSha256: sha256(manifestText),
    gameCount: 1,
    plateAppearanceCount: rows.length,
  };
}

async function writePartition({
  root,
  fitRows,
  validationRows,
  testPlateAppearanceCount = 5,
  mutate = (value) => value,
}) {
  const fitShard = await writeShard(root, '2026-03-26', 10, fitRows);
  const validationShard = await writeShard(
    root,
    '2026-03-27',
    11,
    validationRows,
  );
  const testShard = {
    date: '2026-03-28',
    captureManifestPath: '2026-03-28/capture-manifest.json',
    captureManifestSha256: 'f'.repeat(64),
    gameCount: 1,
    plateAppearanceCount: testPlateAppearanceCount,
  };
  const partition = mutate({
    partitionVersion: 1,
    activeSeason: 2026,
    shardCollectionRoot: root,
    evidenceSetSha256: 'e'.repeat(64),
    selectionBoundary: {
      fittingUses: ['fit'],
      candidateSelectionUses: ['validation'],
      untouchedTestUses: ['final-evaluation-only'],
      testMetricsForbiddenDuringCandidateSelection: true,
    },
    periods: {
      fit: {
        startDate: '2026-03-26',
        endDate: '2026-03-26',
        shardCount: 1,
        gameCount: 1,
        plateAppearanceCount: fitRows.length,
        shards: [fitShard],
      },
      validation: {
        startDate: '2026-03-27',
        endDate: '2026-03-27',
        shardCount: 1,
        gameCount: 1,
        plateAppearanceCount: validationRows.length,
        shards: [validationShard],
      },
      test: {
        startDate: '2026-03-28',
        endDate: '2026-03-28',
        shardCount: 1,
        gameCount: 1,
        plateAppearanceCount: testPlateAppearanceCount,
        shards: [testShard],
      },
    },
  });
  const partitionPath = path.join(root, 'partition.json');
  await writeFile(partitionPath, `${JSON.stringify(partition, null, 2)}\n`, 'utf8');
  return partitionPath;
}

function verificationStub(calls) {
  return async ({ captureRoot, expectedActiveSeason }) => {
    const date = path.basename(captureRoot);
    calls.push(date);
    const manifest = JSON.parse(
      await readFile(path.join(captureRoot, 'capture-manifest.json'), 'utf8'),
    );
    return {
      status: 'verified',
      activeSeason: expectedActiveSeason,
      startDate: date,
      endDate: date,
      gameCount: manifest.capturedGameCount,
      plateAppearanceCount: manifest.capturedPlateAppearanceCount,
    };
  };
}

async function withTempRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-recency-dataset-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('builds deterministic fit and validation rows while leaving test outcomes sealed', async () => {
  await withTempRoot(async (root) => {
    const partitionPath = await writePartition({
      root,
      fitRows: [
        rawPa(3, 'Caught Stealing 2B'),
        rawPa(1, 'Single'),
        rawPa(2, 'Fielders Choice'),
      ],
      validationRows: [rawPa(1, 'Single')],
      testPlateAppearanceCount: 9,
    });
    const calls = [];
    const options = {
      partitionManifestPath: partitionPath,
      verifyCaptureDirectory: verificationStub(calls),
      normalizeTerminalPa: normalizeStub,
    };

    const first = await buildM8RecencyEvaluationDataset(options);
    const second = await buildM8RecencyEvaluationDataset({
      ...options,
      verifyCaptureDirectory: verificationStub([]),
    });

    assert.deepEqual(first, second);
    assert.deepEqual(calls, ['2026-03-26', '2026-03-27']);
    assert.equal(first.totals.includedRowCount, 4);
    assert.equal(first.totals.normalizedCount, 2);
    assert.equal(first.totals.contextRequiredCount, 1);
    assert.equal(first.totals.baserunningOnlyCount, 1);
    assert.equal(first.untouchedTestReservation.rowsIncluded, false);
    assert.equal(first.untouchedTestReservation.plateAppearanceCount, 9);
    assert.deepEqual(
      first.periods.fit.rows.map((row) => row.providerPaNumber),
      [1, 2, 3],
    );
    assert.match(first.datasetSha256, /^[a-f0-9]{64}$/);
  });
});

test('rejects capture-manifest hash drift from the frozen partition', async () => {
  await withTempRoot(async (root) => {
    const partitionPath = await writePartition({
      root,
      fitRows: [rawPa(1, 'Single')],
      validationRows: [rawPa(1, 'Single')],
      mutate: (partition) => {
        partition.periods.fit.shards[0].captureManifestSha256 = '0'.repeat(64);
        return partition;
      },
    });

    await assert.rejects(
      buildM8RecencyEvaluationDataset({
        partitionManifestPath: partitionPath,
        verifyCaptureDirectory: verificationStub([]),
        normalizeTerminalPa: normalizeStub,
      }),
      /capture-manifest hash drifted/,
    );
  });
});

test('rejects duplicate provider game and PA identities', async () => {
  await withTempRoot(async (root) => {
    const partitionPath = await writePartition({
      root,
      fitRows: [rawPa(1, 'Single'), rawPa(1, 'Single')],
      validationRows: [rawPa(1, 'Single')],
    });

    await assert.rejects(
      buildM8RecencyEvaluationDataset({
        partitionManifestPath: partitionPath,
        verifyCaptureDirectory: verificationStub([]),
        normalizeTerminalPa: normalizeStub,
      }),
      /duplicate plate-appearance row identity/,
    );
  });
});

test('fails closed on unknown or contradictory terminal mappings', async () => {
  await withTempRoot(async (root) => {
    const partitionPath = await writePartition({
      root,
      fitRows: [rawPa(1, 'Future Provider Result')],
      validationRows: [rawPa(1, 'Single')],
    });

    await assert.rejects(
      buildM8RecencyEvaluationDataset({
        partitionManifestPath: partitionPath,
        verifyCaptureDirectory: verificationStub([]),
        normalizeTerminalPa: normalizeStub,
      }),
      /failed closed during normalization: unknown-result/,
    );
  });
});

test('rejects provider-secret exposure in included evidence without reading test evidence', async () => {
  await withTempRoot(async (root) => {
    const secret = 'super-secret-provider-key';
    const partitionPath = await writePartition({
      root,
      fitRows: [rawPa(1, 'Single')],
      validationRows: [rawPa(1, 'Single')],
    });
    const fitSnapshotPath = path.join(
      root,
      '2026-03-26',
      'plate-appearances',
      'balldontlie-plate-appearances-10.json',
    );
    await writeFile(fitSnapshotPath, `${secret}\n`, 'utf8');

    await assert.rejects(
      buildM8RecencyEvaluationDataset({
        partitionManifestPath: partitionPath,
        secret,
        verifyCaptureDirectory: verificationStub([]),
        normalizeTerminalPa: normalizeStub,
      }),
      /contains the provider secret/,
    );
  });
});
