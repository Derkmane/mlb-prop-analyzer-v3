import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildM8ChronologicalPartitionManifest,
  validateM8PartitionWindows,
} from '../scripts/m8-partition-manifest-utils.mjs';
import { selectRecencyCandidateFromValidation } from '../scripts/m8-recency-weighting-utils.mjs';

const ACTIVE_SEASON = 2026;

async function withTemporaryDirectory(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-partition-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeShard(root, date, { games, plateAppearances, secret = null }) {
  const shardRoot = path.join(root, date);
  await mkdir(shardRoot, { recursive: true });
  const manifest = {
    captureVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    activeSeason: ACTIVE_SEASON,
    requestedStartDate: date,
    requestedEndDate: date,
    status: 'complete',
    truncated: false,
    capturedGameCount: games,
    capturedPlateAppearanceCount: plateAppearances,
    dateCaptures: [],
    error: null,
    note: secret,
  };
  await writeFile(
    path.join(shardRoot, 'capture-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

function verifyingFromManifest({ overrideDate = null, gameDelta = 0 } = {}) {
  return async ({ captureRoot, expectedActiveSeason }) => {
    const manifest = JSON.parse(
      await readFile(path.join(captureRoot, 'capture-manifest.json'), 'utf8'),
    );
    const date = path.basename(captureRoot);
    return {
      status: 'verified',
      activeSeason: expectedActiveSeason,
      startDate: overrideDate ?? date,
      endDate: overrideDate ?? date,
      gameCount: manifest.capturedGameCount + gameDelta,
      plateAppearanceCount: manifest.capturedPlateAppearanceCount,
    };
  };
}

const WINDOWS = Object.freeze({
  fitStartDate: '2026-03-26',
  fitEndDate: '2026-03-28',
  validationStartDate: '2026-03-29',
  validationEndDate: '2026-03-30',
  testStartDate: '2026-03-31',
  testEndDate: '2026-03-31',
});

test('builds a deterministic verified fit-validation-test evidence manifest', async () => {
  await withTemporaryDirectory(async (root) => {
    const dates = [
      '2026-03-26',
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
    ];
    for (const [index, date] of dates.entries()) {
      await writeShard(root, date, {
        games: index + 1,
        plateAppearances: (index + 1) * 10,
      });
    }

    const first = await buildM8ChronologicalPartitionManifest({
      shardCollectionRoot: root,
      activeSeason: ACTIVE_SEASON,
      windows: WINDOWS,
      verify: verifyingFromManifest(),
    });
    const second = await buildM8ChronologicalPartitionManifest({
      shardCollectionRoot: root,
      activeSeason: ACTIVE_SEASON,
      windows: WINDOWS,
      verify: verifyingFromManifest(),
    });

    assert.deepEqual(first, second);
    assert.equal(first.totals.shardCount, 6);
    assert.equal(first.totals.gameCount, 21);
    assert.equal(first.totals.plateAppearanceCount, 210);
    assert.equal(first.periods.fit.shardCount, 3);
    assert.equal(first.periods.validation.shardCount, 2);
    assert.equal(first.periods.test.shardCount, 1);
    assert.equal(
      first.selectionBoundary.testMetricsForbiddenDuringCandidateSelection,
      true,
    );
    assert.match(first.evidenceSetSha256, /^[a-f0-9]{64}$/);
    assert.equal(first.periods.fit.shards[0].captureManifestPath,
      '2026-03-26/capture-manifest.json');
  });
});

test('records an explicit validation-to-test exclusion gap without reading excluded shards', async () => {
  await withTemporaryDirectory(async (root) => {
    const windows = Object.freeze({
      fitStartDate: '2026-07-14',
      fitEndDate: '2026-07-15',
      validationStartDate: '2026-07-16',
      validationEndDate: '2026-07-25',
      testStartDate: '2026-07-30',
      testEndDate: '2026-07-30',
    });

    const includedDates = [
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
      '2026-07-18',
      '2026-07-19',
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
      '2026-07-23',
      '2026-07-24',
      '2026-07-25',
      '2026-07-30',
    ];

    for (const date of includedDates) {
      await writeShard(root, date, {
        games: 1,
        plateAppearances: 10,
      });
    }

    const manifest = await buildM8ChronologicalPartitionManifest({
      shardCollectionRoot: root,
      activeSeason: ACTIVE_SEASON,
      windows,
      verify: verifyingFromManifest(),
    });

    assert.deepEqual(manifest.excludedGap, {
      startDate: '2026-07-26',
      endDate: '2026-07-29',
      allowedUse: 'excluded-from-fitting-validation-and-untouched-testing',
      dateCount: 4,
      dates: [
        '2026-07-26',
        '2026-07-27',
        '2026-07-28',
        '2026-07-29',
      ],
    });
    assert.equal(manifest.totals.shardCount, 13);
    assert.equal(
      manifest.selectionBoundary.excludedGapUsedByModelOrEvaluation,
      false,
    );
  });
});

test('rejects overlaps, fit-validation gaps, and dates outside the active season', () => {
  assert.throws(
    () =>
      validateM8PartitionWindows({
        activeSeason: ACTIVE_SEASON,
        ...WINDOWS,
        validationStartDate: '2026-03-28',
      }),
    /fit period must end before validation begins/,
  );
  assert.throws(
    () =>
      validateM8PartitionWindows({
        activeSeason: ACTIVE_SEASON,
        ...WINDOWS,
        validationStartDate: '2026-03-30',
      }),
    /adjacent with no omitted dates/,
  );
  assert.throws(
    () =>
      validateM8PartitionWindows({
        activeSeason: ACTIVE_SEASON,
        ...WINDOWS,
        testEndDate: '2025-03-31',
      }),
    /active season 2026/,
  );
});

test('rejects shard count drift after verification', async () => {
  await withTemporaryDirectory(async (root) => {
    for (const date of [
      '2026-03-26',
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
    ]) {
      await writeShard(root, date, { games: 1, plateAppearances: 10 });
    }

    await assert.rejects(
      buildM8ChronologicalPartitionManifest({
        shardCollectionRoot: root,
        activeSeason: ACTIVE_SEASON,
        windows: WINDOWS,
        verify: verifyingFromManifest({ gameDelta: 1 }),
      }),
      /manifest counts drifted from verification/,
    );
  });
});

test('rejects provider-secret exposure in a shard manifest', async () => {
  await withTemporaryDirectory(async (root) => {
    const secret = 'test-provider-secret';
    for (const date of [
      '2026-03-26',
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
    ]) {
      await writeShard(root, date, {
        games: 1,
        plateAppearances: 10,
        secret: date === '2026-03-29' ? secret : null,
      });
    }

    await assert.rejects(
      buildM8ChronologicalPartitionManifest({
        shardCollectionRoot: root,
        activeSeason: ACTIVE_SEASON,
        windows: WINDOWS,
        secret,
        verify: verifyingFromManifest(),
      }),
      /contains the provider secret/,
    );
  });
});

test('reserves test-period metrics from recency candidate selection', () => {
  assert.throws(
    () =>
      selectRecencyCandidateFromValidation([
        {
          candidate: { candidateId: 'uniform', kind: 'uniform' },
          validationObservationCount: 100,
          validationLogLoss: 0.6,
        },
        {
          candidate: {
            candidateId: 'half-life-30',
            kind: 'exponential-half-life',
            halfLifeDays: 30,
          },
          validationObservationCount: 100,
          validationLogLoss: 0.59,
          testLogLoss: 0.58,
        },
      ]),
    /test-period metrics cannot participate/,
  );
});
