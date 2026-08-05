import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { persistImmutableJson } from '../scripts/m10-grade-saved-archive-utils.mjs';
import {
  buildScheduledArchiveGradeReportV1,
  classifyArchiveGameStatuses,
  M10_CALIBRATION_BUCKETS,
  M10_SCHEDULED_ARCHIVE_GRADING_VERSION,
  playersByGame,
  verifyAndProjectM9ArchiveBytes,
} from '../scripts/m10-scheduled-archive-grading-utils.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const CAPTURED_AT = '2026-08-05T21:15:00.000Z';
const CAPTURE_KEY = `${CAPTURED_AT.replace(/[-:.]/gu, '')}--${SHA_A}`;

function stableJson(value) {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(',')}}`;
}

function row(rank, probability, hits) {
  const providerPlayerId = 1000 + rank;
  const providerEventId = rank.toString(16).padStart(32, '0');
  return {
    rank,
    normalizedOffer: {
      providerEventId,
      providerGameId: 5001,
      providerPlayerId,
      playerName: `Player ${rank}`,
      offerType: rank % 2 === 0 ? 'alternate' : 'baseline',
      selectedSide: 'higher',
      postedLine: 0.5,
    },
    probabilities: {
      pWin: probability,
      pLoss: 1 - probability,
      pVoid: 0,
      pWinGivenGrades: probability,
    },
    candidate: {
      baseMarketKey: 'batter-hits',
      eventId: providerEventId,
      gameId: '5001',
      playerId: String(providerPlayerId),
      selectedSide: 'higher',
      line: 0.5,
      pWin: probability,
      pLoss: 1 - probability,
      pVoid: 0,
      pWinGivenGrades: probability,
    },
    testOfficialHits: hits,
  };
}

function archiveBytes() {
  const probabilities = [0.4, 0.52, 0.57, 0.62, 0.67, 0.72, 0.77, 0.82];
  const rows = probabilities.map((probability, index) =>
    row(index + 1, probability, index % 2),
  );
  const identity = {
    archiveVersion: 2,
    archiveContract: 'm9-batter-hits-prospective-capture-snapshot-v2',
    captureIdentity: {
      capturedAt: CAPTURED_AT,
      rawProviderSnapshotSha256: SHA_A,
      captureKey: CAPTURE_KEY,
    },
    capturedAt: CAPTURED_AT,
    captureDateUtc: '2026-08-05',
    projectRulesVersion: '2.9',
    mathSpecVersion: '1.7',
    productionEnabled: false,
    productionRankingEnabled: false,
    gradingPerformed: false,
    fixtureBackedEvidence: false,
    liveBoard: true,
    authorizationMode: 'TEST ONLY — EPHEMERAL SNAPSHOT',
    notice: 'test archive',
    providerSnapshots: [{ snapshot: true }],
    pregameEvents: [{ eventId: 'event' }],
    normalizedOffers: rows.map((entry) => entry.normalizedOffer),
    rankedRows: rows.map(({ testOfficialHits: ignored, ...entry }) => {
      void ignored;
      return entry;
    }),
    exclusions: [],
    evidence: { liveBoard: true },
    counts: {
      providerSnapshotCount: 1,
      normalizedOfferCount: rows.length,
      composedCandidateCount: rows.length,
      rankedCandidateCount: rows.length,
      exclusionCount: 0,
    },
  };
  return {
    rows,
    bytes: Buffer.from(
      `${JSON.stringify(
        {
          ...identity,
          archiveSha256: createHash('sha256')
            .update(stableJson(identity))
            .digest('hex'),
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
  };
}

function game(status = 'STATUS_FINAL') {
  return {
    id: 5001,
    home_team_name: 'Home',
    away_team_name: 'Away',
    home_team: { id: 1, display_name: 'Home' },
    away_team: { id: 2, display_name: 'Away' },
    season: 2026,
    postseason: false,
    season_type: 'regular',
    date: '2026-08-05T22:40:00.000Z',
    status,
  };
}

function snapshots(projection, testRows, status = 'STATUS_FINAL') {
  return {
    gameSnapshot: {
      snapshotId: 'scheduled-games',
      sha256: SHA_B,
      capturedAt: '2026-08-06T09:00:00.000Z',
      response: { data: [game(status)], meta: { per_page: 1 } },
    },
    statsSnapshot: {
      snapshotId: 'scheduled-stats',
      sha256: SHA_C,
      capturedAt: '2026-08-06T09:01:00.000Z',
      response: {
        data: projection.rows.map((entry) => ({
          player: { id: entry.providerPlayerId },
          game_id: entry.providerGameId,
          hits: testRows[entry.rank - 1].testOfficialHits,
        })),
        meta: { per_page: 100 },
      },
    },
  };
}

test('scheduled archive verification authenticates immutable bytes and rejects drift', () => {
  const { bytes } = archiveBytes();
  const projection = verifyAndProjectM9ArchiveBytes({
    bytes,
    archivePath: `captures/${CAPTURE_KEY}.json`,
    expectedCaptureKey: CAPTURE_KEY,
  });
  assert.equal(projection.sourceCaptureKey, CAPTURE_KEY);
  assert.equal(projection.rows.length, 8);
  assert.deepEqual([...playersByGame(projection).keys()], [5001]);

  const tampered = JSON.parse(bytes.toString('utf8'));
  tampered.rankedRows[0].probabilities.pWin = 0.41;
  assert.throws(
    () =>
      verifyAndProjectM9ArchiveBytes({
        bytes: Buffer.from(`${JSON.stringify(tampered)}\n`, 'utf8'),
        archivePath: `captures/${CAPTURE_KEY}.json`,
        expectedCaptureKey: CAPTURE_KEY,
      }),
    /SHA-256 verification failed/u,
  );

  const enabled = JSON.parse(bytes.toString('utf8'));
  enabled.productionEnabled = true;
  assert.throws(
    () =>
      verifyAndProjectM9ArchiveBytes({
        bytes: Buffer.from(`${JSON.stringify(enabled)}\n`, 'utf8'),
        archivePath: `captures/${CAPTURE_KEY}.json`,
        expectedCaptureKey: CAPTURE_KEY,
      }),
    /production-disabled/u,
  );
});

test('scheduled status gate grades only exact STATUS_FINAL games and skips every other state', () => {
  const { bytes } = archiveBytes();
  const projection = verifyAndProjectM9ArchiveBytes({
    bytes,
    archivePath: `captures/${CAPTURE_KEY}.json`,
    expectedCaptureKey: CAPTURE_KEY,
  });
  assert.equal(
    classifyArchiveGameStatuses(projection, [game('STATUS_FINAL')])
      .readyToGrade,
    true,
  );
  for (const status of [
    'STATUS_SCHEDULED',
    'STATUS_IN_PROGRESS',
    'STATUS_POSTPONED',
    'STATUS_SUSPENDED',
    'UNKNOWN',
  ]) {
    const result = classifyArchiveGameStatuses(projection, [game(status)]);
    assert.equal(result.readyToGrade, false, status);
    assert.equal(result.nonFinalGames[0].status, status);
  }
});

test('scheduled report settles through core and calibration buckets conserve every pick', () => {
  const { bytes, rows } = archiveBytes();
  const projection = verifyAndProjectM9ArchiveBytes({
    bytes,
    archivePath: `captures/${CAPTURE_KEY}.json`,
    expectedCaptureKey: CAPTURE_KEY,
  });
  const { gameSnapshot, statsSnapshot } = snapshots(projection, rows);
  const report = buildScheduledArchiveGradeReportV1({
    projection,
    gradedAt: '2026-08-06T09:02:00.000Z',
    gameSnapshot,
    statsSnapshot,
  });
  assert.equal(report.reportVersion, M10_SCHEDULED_ARCHIVE_GRADING_VERSION);
  assert.equal(report.summary.picksGraded, 8);
  assert.equal(
    report.summary.wins + report.summary.losses + report.summary.voids,
    8,
  );
  assert.equal(report.calibration.length, M10_CALIBRATION_BUCKETS.length);
  assert.deepEqual(
    report.calibration.map((bucket) => [bucket.label, bucket.totalPicks]),
    [
      ['Below 50%', 1],
      ['50-55%', 1],
      ['55-60%', 1],
      ['60-65%', 1],
      ['65-70%', 1],
      ['70-75%', 1],
      ['75-80%', 1],
      ['80%+', 1],
    ],
  );
  assert.equal(
    report.calibration.reduce(
      (total, bucket) => total + bucket.totalPicks,
      0,
    ),
    8,
  );
  assert.equal(report.source.archiveModified, false);
  assert.equal(report.safety.productionEnabled, false);
  assert.equal(report.safety.rankingEnabled, false);
});

test('scheduled report refuses a live game before settlement or grading', () => {
  const { bytes, rows } = archiveBytes();
  const projection = verifyAndProjectM9ArchiveBytes({
    bytes,
    archivePath: `captures/${CAPTURE_KEY}.json`,
    expectedCaptureKey: CAPTURE_KEY,
  });
  const { gameSnapshot, statsSnapshot } = snapshots(
    projection,
    rows,
    'STATUS_IN_PROGRESS',
  );
  assert.throws(
    () =>
      buildScheduledArchiveGradeReportV1({
        projection,
        gradedAt: '2026-08-06T09:02:00.000Z',
        gameSnapshot,
        statsSnapshot,
      }),
    /not all STATUS_FINAL/u,
  );
});

test('grade persistence is separate and leaves verified archive bytes unchanged', async () => {
  const { bytes, rows } = archiveBytes();
  const before = Buffer.from(bytes);
  const projection = verifyAndProjectM9ArchiveBytes({
    bytes,
    archivePath: `captures/${CAPTURE_KEY}.json`,
    expectedCaptureKey: CAPTURE_KEY,
  });
  const { gameSnapshot, statsSnapshot } = snapshots(projection, rows);
  const report = buildScheduledArchiveGradeReportV1({
    projection,
    gradedAt: '2026-08-06T09:02:00.000Z',
    gameSnapshot,
    statsSnapshot,
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm10-scheduled-grade-'));
  try {
    const reportPath = path.join(directory, CAPTURE_KEY, 'grades', 'report.json');
    await persistImmutableJson(reportPath, report);
    assert.deepEqual(bytes, before);
    await assert.rejects(
      () => persistImmutableJson(reportPath, report),
      /Immutable report already exists/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('daily capture and final-only grading workflows are scheduled, bounded, cached, and always upload evidence', async () => {
  const captureWorkflow = await readFile(
    '.github/workflows/m9-board-archive.yml',
    'utf8',
  );
  assert.match(captureWorkflow, /cron:\s*'15 21 \* \* \*'/u);
  assert.match(captureWorkflow, /timeout-minutes:\s*330/u);
  assert.match(captureWorkflow, /m9-board-archive-ledger-/u);
  assert.ok((captureWorkflow.match(/if:\s*always\(\)/gu) ?? []).length >= 3);
  assert.match(captureWorkflow, /retention-days:\s*90/u);

  const gradingWorkflow = await readFile(
    '.github/workflows/m10-grade-pending-archives.yml',
    'utf8',
  );
  assert.match(gradingWorkflow, /cron:\s*'0 9 \* \* \*'/u);
  assert.match(gradingWorkflow, /timeout-minutes:\s*180/u);
  assert.match(gradingWorkflow, /grade-m10-pending-archives\.mjs/u);
  assert.match(gradingWorkflow, /m9-board-archive-ledger-/u);
  assert.ok((gradingWorkflow.match(/if:\s*always\(\)/gu) ?? []).length >= 3);
  assert.match(gradingWorkflow, /retention-days:\s*90/u);
  assert.doesNotMatch(gradingWorkflow, /productionEnabled:\s*true/u);
  assert.doesNotMatch(gradingWorkflow, /rankingEnabled:\s*true/u);
});

test('new scheduled grading scripts pass Node syntax checking', () => {
  for (const scriptPath of [
    'scripts/m10-scheduled-archive-grading-utils.mjs',
    'scripts/grade-m10-pending-archives.mjs',
  ]) {
    const result = spawnSync(process.execPath, ['--check', scriptPath], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${scriptPath}\n${result.stderr}`);
  }
});
