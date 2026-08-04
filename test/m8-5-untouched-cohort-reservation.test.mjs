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

function dateCapture(
  date,
  gameId,
  count,
  plateAppearanceHash,
  {
    gameDate = `${date}T00:05:00.000Z`,
    gamesSnapshotHash = plateAppearanceHash,
  } = {},
) {
  return {
    date,
    gamesSnapshot: {
      filePath: `missing-games-${date}.json`,
      rawBodySha256: gamesSnapshotHash,
      savedBodySha256: gamesSnapshotHash,
      request: {},
      responseStatus: 200,
    },
    finalGameCount: 1,
    games: [
      {
        gameId,
        gameDate,
        status: 'STATUS_FINAL',
        plateAppearancesSnapshot: {
          filePath: `missing-pa-${gameId}.json`,
          rawBodySha256: plateAppearanceHash,
          savedBodySha256: plateAppearanceHash,
          request: {},
          responseStatus: 200,
          recordCount: count,
        },
      },
    ],
  };
}

function completeManifest(startDate, endDate, captures, capturedAt = '2026-08-04T20:00:00.000Z') {
  return {
    captureVersion: 1,
    purpose: 'synthetic metadata-only reservation fixture',
    provider: 'BALLDONTLIE MLB API',
    capturedAt,
    activeSeason: 2026,
    requestedStartDate: startDate,
    requestedEndDate: endDate,
    requiredFinalStatus: 'STATUS_FINAL',
    maxGames: null,
    delayMs: 0,
    status: 'complete',
    truncated: false,
    capturedGameCount: captures.reduce(
      (total, capture) => total + capture.finalGameCount,
      0,
    ),
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

test('reserves the deterministic July 26+ cohort, preserves raw gameDate, and never opens missing PA payloads', async () => {
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
  assert.equal(
    first.reservedDateMetadata[0].games[0].gameDate,
    '2026-07-26T00:05:00.000Z',
  );
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

test('fails closed on a malformed provider gameDate timestamp', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-5-reservation-malformed-date-'));
  const captureRoot = path.join(root, 'captures');
  const artifacts = await arrangeArtifacts(root);
  await writeJson(
    path.join(captureRoot, 'bad', 'capture-manifest.json'),
    completeManifest('2026-07-26', '2026-07-26', [
      dateCapture('2026-07-26', 2001, 10, HASH_A, { gameDate: '2026-07-26' }),
    ]),
  );

  await assert.rejects(
    reserveM8_5UntouchedCohort({
      captureRoot,
      latestDate: '2026-07-26',
      ...artifacts,
    }),
    /must be a 24-character UTC ISO date-time/,
  );
});

test('fails closed when gameDate resolves to a different UTC calendar date', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-5-reservation-wrong-utc-date-'));
  const captureRoot = path.join(root, 'captures');
  const artifacts = await arrangeArtifacts(root);
  await writeJson(
    path.join(captureRoot, 'bad', 'capture-manifest.json'),
    completeManifest('2026-07-26', '2026-07-26', [
      dateCapture('2026-07-26', 3001, 10, HASH_A, {
        gameDate: '2026-07-27T00:05:00.000Z',
      }),
    ]),
  );

  await assert.rejects(
    reserveM8_5UntouchedCohort({
      captureRoot,
      latestDate: '2026-07-26',
      ...artifacts,
    }),
    /UTC calendar date does not match its capture date/,
  );
});

test('accepts legitimate recaptures with identical game metadata and deduplicates by gameId', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-5-reservation-duplicate-'));
  const captureRoot = path.join(root, 'captures');
  const artifacts = await arrangeArtifacts(root);
  await writeJson(
    path.join(captureRoot, 'full-2026-07-26', 'capture-manifest.json'),
    completeManifest('2026-07-26', '2026-07-26', [
      dateCapture('2026-07-26', 4001, 10, HASH_A, {
        gamesSnapshotHash: HASH_A,
      }),
    ]),
  );
  await writeJson(
    path.join(captureRoot, 'full-2026-07-26-verifiable', 'capture-manifest.json'),
    completeManifest(
      '2026-07-26',
      '2026-07-26',
      [
        dateCapture('2026-07-26', 4001, 10, HASH_A, {
          gamesSnapshotHash: HASH_B,
        }),
      ],
      '2026-08-04T20:01:00.000Z',
    ),
  );

  const artifact = await reserveM8_5UntouchedCohort({
    captureRoot,
    latestDate: '2026-07-26',
    ...artifacts,
  });

  assert.equal(artifact.sourceManifests.length, 2);
  assert.equal(artifact.gameCount, 1);
  assert.equal(artifact.plateAppearanceCount, 10);
  assert.equal(artifact.reservedDateMetadata[0].finalGameCount, 1);
  assert.equal(artifact.reservedDateMetadata[0].games.length, 1);
  assert.equal(artifact.reservedDateMetadata[0].games[0].gameId, 4001);
});

test('fails closed on contradictory metadata for the same gameId', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-5-reservation-conflict-'));
  const captureRoot = path.join(root, 'captures');
  const artifacts = await arrangeArtifacts(root);
  await writeJson(
    path.join(captureRoot, 'first', 'capture-manifest.json'),
    completeManifest('2026-07-26', '2026-07-26', [
      dateCapture('2026-07-26', 5001, 10, HASH_A),
    ]),
  );
  await writeJson(
    path.join(captureRoot, 'second', 'capture-manifest.json'),
    completeManifest('2026-07-26', '2026-07-26', [
      dateCapture('2026-07-26', 5001, 11, HASH_B),
    ]),
  );

  await assert.rejects(
    reserveM8_5UntouchedCohort({
      captureRoot,
      latestDate: '2026-07-26',
      ...artifacts,
    }),
    /Contradictory complete capture metadata exists for gameId 5001/,
  );
});

test('skips capture manifests that do not carry the dateCaptures contract', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-5-reservation-skip-shape-'));
  const captureRoot = path.join(root, 'captures');
  const artifacts = await arrangeArtifacts(root);
  await writeJson(
    path.join(captureRoot, 'm8-context-plays-v1', 'capture-manifest.json'),
    {
      captureVersion: 'different-contract-v1',
      provider: 'BALLDONTLIE MLB API',
      games: [{ gameId: 9999 }],
    },
  );
  await writeJson(
    path.join(captureRoot, 'complete', 'capture-manifest.json'),
    completeManifest('2026-07-26', '2026-07-26', [
      dateCapture('2026-07-26', 6001, 10, HASH_A),
    ]),
  );

  const artifact = await reserveM8_5UntouchedCohort({
    captureRoot,
    latestDate: '2026-07-26',
    ...artifacts,
  });

  assert.equal(artifact.gameCount, 1);
  assert.equal(artifact.sourceManifests.length, 1);
  assert.doesNotMatch(
    artifact.sourceManifests[0].path,
    /m8-context-plays-v1/,
  );
});

test('skips wholly pre-window legacy manifests before strict snapshot hash validation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-5-reservation-legacy-window-'));
  const captureRoot = path.join(root, 'captures');
  const artifacts = await arrangeArtifacts(root);
  const legacyCapture = dateCapture('2026-07-08', 8001, 10, HASH_A);
  delete legacyCapture.gamesSnapshot.savedBodySha256;
  delete legacyCapture.games[0].plateAppearancesSnapshot.savedBodySha256;
  await writeJson(
    path.join(captureRoot, 'legacy-2026-07-08', 'capture-manifest.json'),
    completeManifest('2026-07-08', '2026-07-08', [legacyCapture]),
  );
  await writeJson(
    path.join(captureRoot, 'eligible-2026-07-26', 'capture-manifest.json'),
    completeManifest('2026-07-26', '2026-07-26', [
      dateCapture('2026-07-26', 8002, 12, HASH_B),
    ]),
  );

  const artifact = await reserveM8_5UntouchedCohort({
    captureRoot,
    latestDate: '2026-07-26',
    ...artifacts,
  });

  assert.equal(artifact.gameCount, 1);
  assert.equal(artifact.sourceManifests.length, 1);
  assert.doesNotMatch(
    artifact.sourceManifests[0].path,
    /legacy-2026-07-08/,
  );
});

test('skips a pre-window truncated pilot but rejects an eligible truncated manifest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-5-reservation-truncated-window-'));
  const captureRoot = path.join(root, 'captures');
  const artifacts = await arrangeArtifacts(root);
  const preWindowPilot = completeManifest('2026-07-08', '2026-07-08', [
    dateCapture('2026-07-08', 8501, 74, HASH_A),
  ]);
  preWindowPilot.truncated = true;
  await writeJson(
    path.join(captureRoot, 'pilot-2026-07-08', 'capture-manifest.json'),
    preWindowPilot,
  );
  await writeJson(
    path.join(captureRoot, 'eligible-2026-07-26', 'capture-manifest.json'),
    completeManifest('2026-07-26', '2026-07-26', [
      dateCapture('2026-07-26', 8502, 12, HASH_B),
    ]),
  );

  const artifact = await reserveM8_5UntouchedCohort({
    captureRoot,
    latestDate: '2026-07-26',
    ...artifacts,
  });

  assert.equal(artifact.gameCount, 1);
  assert.equal(artifact.sourceManifests.length, 1);
  assert.doesNotMatch(
    artifact.sourceManifests[0].path,
    /pilot-2026-07-08/,
  );

  const eligibleTruncated = completeManifest('2026-07-26', '2026-07-26', [
    dateCapture('2026-07-26', 8503, 12, HASH_C),
  ]);
  eligibleTruncated.truncated = true;
  await writeJson(
    path.join(captureRoot, 'eligible-truncated', 'capture-manifest.json'),
    eligibleTruncated,
  );

  await assert.rejects(
    reserveM8_5UntouchedCohort({
      captureRoot,
      latestDate: '2026-07-26',
      ...artifacts,
    }),
    /Capture manifest is not complete approved 2026 evidence/,
  );
});

test('fails closed when an eligible manifest omits its saved games snapshot hash', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-5-reservation-eligible-hash-'));
  const captureRoot = path.join(root, 'captures');
  const artifacts = await arrangeArtifacts(root);
  const eligibleCapture = dateCapture('2026-07-26', 9001, 10, HASH_A);
  delete eligibleCapture.gamesSnapshot.savedBodySha256;
  await writeJson(
    path.join(captureRoot, 'eligible', 'capture-manifest.json'),
    completeManifest('2026-07-26', '2026-07-26', [eligibleCapture]),
  );

  await assert.rejects(
    reserveM8_5UntouchedCohort({
      captureRoot,
      latestDate: '2026-07-26',
      ...artifacts,
    }),
    /gamesSnapshot\.savedBodySha256 must be a non-empty string/,
  );
});

test('reserves the available contiguous run when it ends before latestDate', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-5-reservation-short-run-'));
  const captureRoot = path.join(root, 'captures');
  const artifacts = await arrangeArtifacts(root);
  await writeJson(
    path.join(captureRoot, 'eligible-run', 'capture-manifest.json'),
    completeManifest('2026-07-26', '2026-07-29', [
      dateCapture('2026-07-26', 10001, 10, HASH_A),
      dateCapture('2026-07-27', 10002, 11, HASH_B),
      dateCapture('2026-07-28', 10003, 12, HASH_C),
      dateCapture('2026-07-29', 10004, 13, HASH_A),
    ]),
  );

  const artifact = await reserveM8_5UntouchedCohort({
    captureRoot,
    latestDate: '2026-08-03',
    ...artifacts,
  });

  assert.deepEqual(artifact.dateRange, {
    startDate: '2026-07-26',
    endDate: '2026-07-29',
    dateCount: 4,
  });
  assert.equal(artifact.latestDate, '2026-08-03');
  assert.equal(artifact.gameCount, 4);
  assert.equal(artifact.plateAppearanceCount, 46);
});

test('fails closed when the required July 26 first date has no complete capture metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-5-reservation-gap-'));
  const captureRoot = path.join(root, 'captures');
  const artifacts = await arrangeArtifacts(root);
  await writeJson(
    path.join(captureRoot, 'late', 'capture-manifest.json'),
    completeManifest('2026-07-27', '2026-07-27', [
      dateCapture('2026-07-27', 7001, 10, HASH_A),
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
