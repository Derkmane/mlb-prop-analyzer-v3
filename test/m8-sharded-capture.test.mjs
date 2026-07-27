import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildM8ShardPlan,
  inspectM8Shard,
  verifyM8ShardCollection,
} from '../scripts/m8-sharded-capture-utils.mjs';

const activeSeason = 2026;

async function temporaryRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'm8-shards-'));
}

async function writeManifestPlaceholder(directory) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'capture-manifest.json'), '{}\n');
}

test('plans deterministic current-season date shards only', () => {
  const plan = buildM8ShardPlan({
    startDate: '2026-07-01',
    endDate: '2026-07-03',
    activeSeason,
    outputRoot: 'artifacts/m8-shards',
  });

  assert.deepEqual(
    plan.map(({ date, finalDirectory }) => ({ date, finalDirectory })),
    [
      {
        date: '2026-07-01',
        finalDirectory: path.join('artifacts/m8-shards', '2026-07-01'),
      },
      {
        date: '2026-07-02',
        finalDirectory: path.join('artifacts/m8-shards', '2026-07-02'),
      },
      {
        date: '2026-07-03',
        finalDirectory: path.join('artifacts/m8-shards', '2026-07-03'),
      },
    ],
  );
  assert.ok(Object.isFrozen(plan));
  assert.throws(
    () =>
      buildM8ShardPlan({
        startDate: '2025-09-28',
        endDate: '2026-04-01',
        activeSeason,
        outputRoot: 'artifacts/m8-shards',
      }),
    /active season 2026/,
  );
});

test('reports a genuinely absent shard as missing', async () => {
  const root = await temporaryRoot();
  try {
    const result = await inspectM8Shard({
      shardRoot: path.join(root, '2026-07-01'),
      date: '2026-07-01',
      activeSeason,
    });
    assert.equal(result.status, 'missing');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reuses a verified shard and refuses incomplete or corrupt existing shards', async () => {
  const root = await temporaryRoot();
  try {
    const verifiedDirectory = path.join(root, '2026-07-01');
    await writeManifestPlaceholder(verifiedDirectory);
    const verified = await inspectM8Shard({
      shardRoot: verifiedDirectory,
      date: '2026-07-01',
      activeSeason,
      verify: async () => ({
        startDate: '2026-07-01',
        endDate: '2026-07-01',
        gameCount: 15,
        plateAppearanceCount: 1100,
      }),
    });
    assert.deepEqual(verified, {
      status: 'verified',
      date: '2026-07-01',
      shardRoot: verifiedDirectory,
      gameCount: 15,
      plateAppearanceCount: 1100,
    });

    const incompleteDirectory = path.join(root, '2026-07-02');
    await mkdir(incompleteDirectory);
    await assert.rejects(
      inspectM8Shard({
        shardRoot: incompleteDirectory,
        date: '2026-07-02',
        activeSeason,
      }),
      /has no capture manifest; refusing to overwrite/,
    );

    const corruptDirectory = path.join(root, '2026-07-03');
    await writeManifestPlaceholder(corruptDirectory);
    await assert.rejects(
      inspectM8Shard({
        shardRoot: corruptDirectory,
        date: '2026-07-03',
        activeSeason,
        verify: async () => {
          throw new Error('saved-body hash mismatch');
        },
      }),
      /failed verification; refusing to overwrite.*hash mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('verifies and totals every required date shard without gaps', async () => {
  const root = await temporaryRoot();
  try {
    for (const date of ['2026-07-01', '2026-07-02']) {
      await writeManifestPlaceholder(path.join(root, date));
    }

    const result = await verifyM8ShardCollection({
      startDate: '2026-07-01',
      endDate: '2026-07-02',
      activeSeason,
      outputRoot: root,
      verify: async ({ captureRoot }) => {
        const date = path.basename(captureRoot);
        return {
          startDate: date,
          endDate: date,
          gameCount: date.endsWith('01') ? 15 : 16,
          plateAppearanceCount: date.endsWith('01') ? 1100 : 1177,
        };
      },
    });

    assert.deepEqual(result, {
      status: 'verified',
      activeSeason,
      startDate: '2026-07-01',
      endDate: '2026-07-02',
      shardCount: 2,
      gameCount: 31,
      plateAppearanceCount: 2277,
    });

    await rm(path.join(root, '2026-07-02'), { recursive: true, force: true });
    await assert.rejects(
      verifyM8ShardCollection({
        startDate: '2026-07-01',
        endDate: '2026-07-02',
        activeSeason,
        outputRoot: root,
        verify: async ({ captureRoot }) => {
          const date = path.basename(captureRoot);
          return {
            startDate: date,
            endDate: date,
            gameCount: 1,
            plateAppearanceCount: 1,
          };
        },
      }),
      /Required shard 2026-07-02 is missing/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
