import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildM9BatterHitsV5RefitPartition,
  verifyM9BatterHitsV5RefitPartition,
} from '../scripts/m9-batter-hits-v5-refit-partition-utils.mjs';

function dates(startDate, endDate) {
  const result = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function shard(date) {
  return {
    date,
    captureManifestPath: `${date}/capture-manifest.json`,
    captureManifestSha256: 'b'.repeat(64),
    gameCount: date === '2026-07-13' || date === '2026-07-14' ? 0 : 1,
    plateAppearanceCount: date === '2026-07-13' || date === '2026-07-14' ? 0 : 10,
  };
}

function sourcePartition() {
  return {
    partitionVersion: 1,
    activeSeason: 2026,
    evidenceSetSha256: 'a'.repeat(64),
    periods: {
      fit: {
        startDate: '2026-03-26',
        endDate: '2026-06-21',
        shards: dates('2026-03-26', '2026-06-21').map(shard),
      },
      validation: {
        startDate: '2026-06-22',
        endDate: '2026-07-05',
        shards: dates('2026-06-22', '2026-07-05').map(shard),
      },
      test: {
        startDate: '2026-07-06',
        endDate: '2026-07-25',
        shards: dates('2026-07-06', '2026-07-25').map(shard),
      },
    },
  };
}

test('V5 reassigns only evidence through July 25 and preserves the new untouched seal', () => {
  const partition = buildM9BatterHitsV5RefitPartition({
    rawSourcePartition: sourcePartition(),
  });

  assert.equal(partition.productionEnabled, false);
  assert.equal(partition.periods.fit.startDate, '2026-03-26');
  assert.equal(partition.periods.fit.endDate, '2026-07-15');
  assert.equal(partition.periods.validation.startDate, '2026-07-16');
  assert.equal(partition.periods.validation.endDate, '2026-07-25');
  assert.equal(partition.periods.fit.shards.at(-1).date, '2026-07-15');
  assert.equal(partition.periods.validation.shards[0].date, '2026-07-16');
  assert.equal(partition.periods.validation.shards.at(-1).date, '2026-07-25');
  assert.deepEqual(partition.excludedCapturedDates, [
    '2026-07-26',
    '2026-07-27',
    '2026-07-28',
    '2026-07-29',
  ]);
  assert.deepEqual(partition.untouchedTestReservation, {
    startDate: '2026-07-30',
    endDate: '2026-08-04',
    rowsIncluded: false,
    allowedUse: 'one-time-final-evaluation-after-v5-candidate-freeze',
    minimumIncludedStarterObservations: 900,
    minimumActualHitsAbove25: 35,
  });
  assert.equal(
    [...partition.periods.fit.shards, ...partition.periods.validation.shards].some(
      (value) => value.date >= '2026-07-26',
    ),
    false,
  );
  assert.equal(verifyM9BatterHitsV5RefitPartition(partition), partition);
});

test('V5 rejects a missing zero-game date rather than silently compressing chronology', () => {
  const source = sourcePartition();
  source.periods.test.shards = source.periods.test.shards.filter(
    (value) => value.date !== '2026-07-13',
  );

  assert.throws(
    () =>
      buildM9BatterHitsV5RefitPartition({
        rawSourcePartition: source,
      }),
    /each date exactly once/,
  );
});

test('V5 verification rejects any attempt to open or move the untouched reservation', () => {
  const partition = buildM9BatterHitsV5RefitPartition({
    rawSourcePartition: sourcePartition(),
  });
  const tampered = {
    ...partition,
    untouchedTestReservation: {
      ...partition.untouchedTestReservation,
      rowsIncluded: true,
    },
  };

  assert.throws(
    () => verifyM9BatterHitsV5RefitPartition(tampered),
    /reservation drifted or was opened/,
  );
});
