import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  buildM9BatterHitsV5RecencyPartitionAdapter,
  verifyM9BatterHitsV5RecencyPartitionAdapter,
} from '../scripts/m9-batter-hits-v5-recency-partition-adapter-utils.mjs';
import { buildM9BatterHitsV5RefitPartition } from '../scripts/m9-batter-hits-v5-refit-partition-utils.mjs';

const execFileAsync = promisify(execFile);

function dates(startDate, endDate) {
  const rows = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= end) {
    rows.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return rows;
}

function shard(date) {
  const day = Number(date.slice(-2));
  return {
    date,
    captureManifestPath: `${date}/capture-manifest.json`,
    captureManifestSha256: day.toString(16).padStart(64, '0'),
    gameCount: date === '2026-07-13' || date === '2026-07-14' ? 0 : 1,
    plateAppearanceCount:
      date === '2026-07-13' || date === '2026-07-14' ? 0 : 10,
  };
}

function period(startDate, endDate) {
  const shards = dates(startDate, endDate).map(shard);
  return {
    startDate,
    endDate,
    shardCount: shards.length,
    gameCount: shards.reduce((sum, value) => sum + value.gameCount, 0),
    plateAppearanceCount: shards.reduce(
      (sum, value) => sum + value.plateAppearanceCount,
      0,
    ),
    shards,
  };
}

function sourcePartition() {
  return {
    partitionVersion: 1,
    activeSeason: 2026,
    shardCollectionRoot: 'artifacts/synthetic-shards',
    evidenceSetSha256: 'e'.repeat(64),
    periods: {
      fit: period('2026-03-26', '2026-06-21'),
      validation: period('2026-06-22', '2026-07-05'),
      test: period('2026-07-06', '2026-07-25'),
    },
  };
}

function fixture() {
  const source = sourcePartition();
  const v5 = buildM9BatterHitsV5RefitPartition({
    rawSourcePartition: source,
  });
  return {
    source,
    v5,
    adapter: buildM9BatterHitsV5RecencyPartitionAdapter({
      rawV5Partition: v5,
      rawSourcePartition: source,
    }),
  };
}

test('V5 adapter reuses exact source shards and exposes no untouched shards', () => {
  const { adapter } = fixture();
  verifyM9BatterHitsV5RecencyPartitionAdapter(adapter);

  assert.equal(adapter.periods.fit.endDate, '2026-07-15');
  assert.equal(adapter.periods.validation.startDate, '2026-07-16');
  assert.equal(adapter.periods.validation.endDate, '2026-07-25');
  assert.equal(adapter.compatibilityManifest.periods.test.startDate, '2026-07-30');
  assert.equal(adapter.compatibilityManifest.periods.test.endDate, '2026-08-04');
  assert.equal(adapter.compatibilityManifest.periods.test.shardCount, 0);
  assert.deepEqual(adapter.compatibilityManifest.periods.test.shards, []);
  assert.equal(
    adapter.periods.fit.shards.find((value) => value.date === '2026-07-13')
      .gameCount,
    0,
  );
  assert.equal(
    adapter.periods.fit.shards.find((value) => value.date === '2026-07-14')
      .plateAppearanceCount,
    0,
  );
});

test('V5 adapter rejects any development shard that drifts from the source partition', () => {
  const source = sourcePartition();
  const v5 = JSON.parse(
    JSON.stringify(
      buildM9BatterHitsV5RefitPartition({
        rawSourcePartition: source,
      }),
    ),
  );
  const target = v5.periods.fit.shards.find((value) => value.date === '2026-07-10');
  target.captureManifestPath = 'tampered/capture-manifest.json';

  assert.throws(
    () =>
      buildM9BatterHitsV5RecencyPartitionAdapter({
        rawV5Partition: v5,
        rawSourcePartition: source,
      }),
    /partition SHA-256 is invalid|drifted from the verified source shard/,
  );
});

test('V5 adapter verification rejects compatibility-manifest tampering', () => {
  const { adapter } = fixture();
  const tampered = JSON.parse(JSON.stringify(adapter));
  tampered.compatibilityManifest.periods.test.shardCount = 1;
  tampered.compatibilityManifest.periods.test.shards = [shard('2026-07-30')];

  assert.throws(
    () => verifyM9BatterHitsV5RecencyPartitionAdapter(tampered),
    /exposes untouched-test evidence|SHA-256 is invalid/,
  );
});

test('V5 recency adapter and builder scripts pass syntax checks', async () => {
  for (const filePath of [
    'scripts/m9-batter-hits-v5-recency-partition-adapter-utils.mjs',
    'scripts/build-m9-batter-hits-v5-recency-dataset.mjs',
  ]) {
    const result = await execFileAsync(process.execPath, ['--check', filePath], {
      cwd: process.cwd(),
    });
    assert.equal(result.stderr, '');
  }
});
