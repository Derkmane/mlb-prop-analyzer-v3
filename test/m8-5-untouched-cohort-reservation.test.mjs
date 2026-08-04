import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { reserveM8_5UntouchedCohort } from '../scripts/reserve-m8-5-untouched-cohort.mjs';

const FREEZE_SHA =
  'a296c384397315832b39d322a7d061ca73e542d94a886087f743f0774199cd17';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function dateCapture(date, gameId, count, hash) {
  return {
    date,
    gamesSnapshot: {
      filePath: `missing-games-${date}.json`,
      rawBodySha256: hash,
      savedBodySha256: hash,
      request: {},
      responseStatus: 200,
    },
    finalGameCount: 1,
    games: [
      {
        gameId,
        gameDate: date,
        status: 'STATUS_FINAL',
        plateAppearancesSnapshot: {
          filePath: `missing-pa-${gameId}.json`,
          rawBodySha256: hash,
          savedBodySha256: hash,
          request: {},
          responseStatus: 200,
          recordCount: count,
        },
      },
    ],
  };
}

function completeManifest(startDate, endDate, captures) {
  return {
    captureVersion: 1,
    purpose: 'synthetic metadata-only reservation fixture',
    provider: 'BALLDONTLIE MLB API',
    capturedAt: '2026-08-04T20:00:00.000Z',
    activeSeason: 2026,
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    requiredFinalStatus: 'STATUS_FINAL',
    maxGames: null,
    delayMs: 0,
    status: 'complete',
    truncated: false,
    capturedGameCount: captures.length,
    capturedPlateAppearanceCount: captures.reduce(
      (total, capture) =>
        total +
        capture.games.reduce(
          (dateTotal, game) =>
            dateTotal + game.plateAppearancesSnapshot.recordCount,
          0,
        ),
      0,
    ),
    dateCaptures: captures,
    error: null,
  };
}

async function arrangeArtifacts(root) {
  const freezePath = path.join(root, 'freeze.json');
  const originalM8CandidatePath = path.join(root, 'original-m8.json');
  const environmentPath = path.join(root, 'environment.json');
  const bullpenPath = path.join(root, 'bullpen.json');
  const parkPath = path.join(root, 'park.json');
  await writeJson(freezePath, {
    modelVersion: 'm8-5-batter-hits-successor-freeze-v1',
    artifactSha256: FREEZE_SHA,
    untouchedTestAccessed: false,
    newUntouchedTestReservation: {
      reserved: false,
      rowsIncluded: false,
      cohortVersion: null,
    },
  });
  await writeJson(originalM8CandidatePath, {
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      rowsIncluded: false,
    },
  });
  const validationEvidence = {
    fitPeriod: { start: '2026-03-26', end: '2026-06-21' },
    validationPeriod: { start: '2026-06-22', end: '2026-07-05' },
    untouchedRowsIncluded: false,
  };
  await writeJson(environmentPath, { validationEvidence });
  await writeJson(bullpenPath, { validationEvidence });
  await writeJson(parkPath, {
    typedFactorArtifact: { validationEvidence },
  });
  return {
    freezePath,
    originalM8CandidatePath,
    factorArtifactPaths: [environmentPath, bullpenPath, parkPath],
  };
}

test('reserves the deterministic July 26+ cohort from manifest metadata without opening PA payloads', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-5-reservation-'));
  const captureRoot = path.join(root, 'captures');
  const artifacts = await arrangeArtifacts(root);
  await writeJson(
    path.join(captureRoot, 'complete', 'capture-manifest.json'),
    completeManifest('2026-07-26', '2026-07-28', [
      dateCapture('2026-07-26', 1001, 10, HASH_A),
      dateCapture('2026-07-27', 1002, 11, HASH_B),
      dateCapture('2026-07-28', 1003, 12, HASH_C),
    ]),
  );

  const first = await reserveM8_5UntouchedCohort({
    captureRoot,
    latestDate: '2026-07-28',
    ...artifacts,
  });
  const second = await reserveM8_5UntouchedCohort({
    captureRoot,
    latestDate: '2026-07-28',
    ...artifacts,
  });

  assert.deepEqual(second, first);
  assert.deepEqual(first.dateRange, {
    startDate: '2026-07-26',
    endDate: '2026-07-28',
    dateCount: 3,
  });
  assert.equal(first.gameCount, 3);
  assert.equal(first.plateAppearanceCount, 33);
  assert.equal(first.rowsIncluded, false);
  assert.equal(first.outcomesRead, false);
  assert.equal(first.evaluationRunCount, 0);
  assert.equal(first.chronologyProof.fitOrValidationOverlap, false);
  assert.equal(first.chronologyProof.originalM8UntouchedOverlap, false);
  assert.match(first.cohortIdentitySha256, /^[a-f0-9]{64}$/);
  assert.match(first.artifactSha256, /^[a-f0-9]{64}$/);
});

test('fails closed when the required first new date has no complete capture metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-5-reservation-gap-'));
  const captureRoot = path.join(root, 'captures');
  const artifacts = await arrangeArtifacts(root);
  await writeJson(
    path.join(captureRoot, 'late', 'capture-manifest.json'),
    completeManifest('2026-07-27', '2026-07-27', [
      dateCapture('2026-07-27', 2001, 10, HASH_A),
    ]),
  );

  await assert.rejects(
    reserveM8_5UntouchedCohort({
      captureRoot,
      latestDate: '2026-07-28',
      ...artifacts,
    }),
    /2026-07-26 has no complete capture metadata/,
  );
});

test('fails closed on conflicting complete metadata for one reserved date', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-5-reservation-conflict-'));
  const captureRoot = path.join(root, 'captures');
  const artifacts = await arrangeArtifacts(root);
  await writeJson(
    path.join(captureRoot, 'first', 'capture-manifest.json'),
    completeManifest('2026-07-26', '2026-07-26', [
      dateCapture('2026-07-26', 3001, 10, HASH_A),
    ]),
  );
  await writeJson(
    path.join(captureRoot, 'second', 'capture-manifest.json'),
    completeManifest('2026-07-26', '2026-07-26', [
      dateCapture('2026-07-26', 3001, 11, HASH_B),
    ]),
  );

  await assert.rejects(
    reserveM8_5UntouchedCohort({
      captureRoot,
      latestDate: '2026-07-26',
      ...artifacts,
    }),
    /Conflicting complete capture metadata exists for 2026-07-26/,
  );
});
