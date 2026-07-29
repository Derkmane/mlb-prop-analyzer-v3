import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildM8ParkVenueLineage,
  verifyM8ParkVenueLineage,
} from '../scripts/m8-park-venue-lineage-utils.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);

function capture({
  gameId,
  observedDate,
  periodId,
  venue,
  exposeUntouched = false,
  plannedDate = observedDate,
}) {
  return {
    captureVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    sourcePlanSha256: SHA_A,
    plannedGame: {
      gameId,
      observedDate: plannedDate,
      periodId,
      sourceRowCount: 1,
    },
    gameSnapshot: {
      rawBodySha256: SHA_B,
      responseStatus: 200,
      body: {
        data: {
          id: gameId,
          status: 'STATUS_FINAL',
          season: 2026,
          season_type: 'regular',
          venue,
        },
      },
    },
    statsPages: [],
    lineupPages: [],
    summary: {
      status: 'STATUS_FINAL',
      season: 2026,
      seasonType: 'regular',
      snapshots: { gameRawBodySha256: SHA_B },
    },
    untouchedTestReservation: exposeUntouched
      ? { rowsIncluded: false, rows: [] }
      : { rowsIncluded: false },
    captureSha256: gameId % 2 === 0 ? SHA_C : SHA_D,
  };
}

function manifest(captures, exposeUntouched = false) {
  return {
    manifestVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    sourcePlanSha256: SHA_A,
    sourceResolvedDatasetSha256: SHA_B,
    sourceRowCount: captures.length,
    gameCount: captures.length,
    includedPeriods: ['fit', 'validation'],
    untouchedTestReservation: exposeUntouched
      ? { rowsIncluded: false, rows: [] }
      : { rowsIncluded: false },
    totals: {},
    games: captures.map((item) => ({
      gameId: item.plannedGame.gameId,
      observedDate: item.plannedGame.observedDate,
      periodId: item.plannedGame.periodId,
      summarySha256: SHA_C,
    })),
    manifestSha256: SHA_D,
  };
}

function evidence() {
  return [
    capture({
      gameId: 1,
      observedDate: '2026-06-01',
      periodId: 'fit',
      venue: 'Park A',
    }),
    capture({
      gameId: 2,
      observedDate: '2026-06-22',
      periodId: 'validation',
      venue: 'Park B',
    }),
    capture({
      gameId: 3,
      observedDate: '2026-06-23',
      periodId: 'validation',
      venue: 'Park A',
    }),
  ];
}

test('preserves exact game-to-venue lineage and source hashes', () => {
  const captures = evidence();
  const lineage = buildM8ParkVenueLineage({
    captureManifest: manifest(captures),
    captures,
  });

  assert.equal(lineage.lineageVersion, 1);
  assert.equal(lineage.activeSeason, 2026);
  assert.equal(lineage.sourceResolvedDatasetSha256, SHA_B);
  assert.equal(lineage.totals.gameCount, 3);
  assert.equal(lineage.totals.fitGameCount, 1);
  assert.equal(lineage.totals.validationGameCount, 2);
  assert.equal(lineage.totals.uniqueVenueCount, 2);
  assert.deepEqual(lineage.venueCounts, { 'Park A': 2, 'Park B': 1 });
  assert.deepEqual(
    lineage.periods.validation.rows.map((row) => [
      row.providerGameId,
      row.venue,
      row.sourceCaptureSha256,
    ]),
    [
      [2, 'Park B', SHA_C],
      [3, 'Park A', SHA_D],
    ],
  );
  assert.equal(lineage.untouchedTestReservation.rowsIncluded, false);
  verifyM8ParkVenueLineage(lineage);
});

test('is deterministic regardless of capture input order', () => {
  const captures = evidence();
  const captureManifest = manifest(captures);
  const first = buildM8ParkVenueLineage({ captureManifest, captures });
  const second = buildM8ParkVenueLineage({
    captureManifest,
    captures: [...captures].reverse(),
  });
  assert.equal(first.lineageSha256, second.lineageSha256);
  assert.deepEqual(first, second);
});

test('fails closed when a game venue is missing', () => {
  const captures = evidence();
  captures[1].gameSnapshot.body.data.venue = null;
  assert.throws(
    () =>
      buildM8ParkVenueLineage({
        captureManifest: manifest(captures),
        captures,
      }),
    /game 2 venue must be a non-empty string/,
  );
});

test('fails closed on manifest-to-capture chronology mismatch', () => {
  const captures = evidence();
  const badCapture = capture({
    gameId: 2,
    observedDate: '2026-06-22',
    plannedDate: '2026-06-21',
    periodId: 'validation',
    venue: 'Park B',
  });
  const badCaptures = [captures[0], badCapture, captures[2]];
  const captureManifest = manifest(captures);
  assert.throws(
    () => buildM8ParkVenueLineage({ captureManifest, captures: badCaptures }),
    /capture chronology mismatch for game 2/,
  );
});

test('rejects untouched-test payloads and tampered lineage identity', () => {
  const captures = evidence();
  captures[0].untouchedTestReservation = { rowsIncluded: false, rows: [] };
  assert.throws(
    () =>
      buildM8ParkVenueLineage({
        captureManifest: manifest(captures),
        captures,
      }),
    /untouched-test rows excluded/,
  );

  const cleanCaptures = evidence();
  const lineage = buildM8ParkVenueLineage({
    captureManifest: manifest(cleanCaptures),
    captures: cleanCaptures,
  });
  const tampered = structuredClone(lineage);
  tampered.periods.validation.rows[0].venue = 'Invented Park';
  assert.throws(
    () => verifyM8ParkVenueLineage(tampered),
    /venue counts do not match lineage rows|SHA-256 is invalid/,
  );
});
