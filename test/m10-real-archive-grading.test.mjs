import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildM10RealArchiveGradeReportV1,
  expectedFinalHitsIdentities,
  M10_REAL_ARCHIVE_CAPTURE_KEY,
  M10_REAL_ARCHIVE_EXPECTED_PICK_COUNT,
  M10_REAL_ARCHIVE_GRADING_VERSION,
  M10_REAL_ARCHIVE_PROJECTION_PATH,
  parseM10RealArchiveProjection,
  persistImmutableJson,
  playersByGame,
} from '../scripts/m10-grade-saved-archive-utils.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

async function loadProjection() {
  const bytes = await readFile(M10_REAL_ARCHIVE_PROJECTION_PATH);
  return { bytes, projection: parseM10RealArchiveProjection(bytes) };
}

function game(providerGameId, status = 'STATUS_FINAL') {
  return {
    id: providerGameId,
    home_team_name: `Home ${providerGameId}`,
    away_team_name: `Away ${providerGameId}`,
    home_team: { id: 1, display_name: 'Home' },
    away_team: { id: 2, display_name: 'Away' },
    season: 2026,
    postseason: false,
    season_type: 'regular',
    date: '2026-08-05T18:00:00.000Z',
    status,
  };
}

function officialHits(identity, projection) {
  const row = projection.rows.find(
    (candidate) =>
      candidate.providerGameId === identity.providerGameId &&
      candidate.providerPlayerId === identity.providerPlayerId,
  );
  if (row?.playerName === 'Buddy Kennedy') return 1;
  if (row?.playerName === 'Grant McCray') return 0;
  if (row?.playerName === 'Yainer Diaz') return 0;
  return identity.providerPlayerId % 3;
}

function snapshots(projection, statuses = new Map()) {
  const identities = expectedFinalHitsIdentities(projection);
  const games = [...playersByGame(projection).keys()].map((gameId) =>
    game(gameId, statuses.get(gameId) ?? 'STATUS_FINAL'),
  );
  const stats = identities.map((identity) => ({
    player: { id: identity.providerPlayerId },
    game_id: identity.providerGameId,
    hits: officialHits(identity, projection),
  }));
  return {
    gameSnapshot: {
      snapshotId: 'test-games',
      sha256: SHA_A,
      capturedAt: '2026-08-06T05:00:00.000Z',
      response: { data: games, meta: { per_page: games.length } },
    },
    statsSnapshot: {
      snapshotId: 'test-stats',
      sha256: SHA_B,
      capturedAt: '2026-08-06T05:01:00.000Z',
      response: { data: stats, meta: { per_page: 100 } },
    },
  };
}

test('exact August 5 projection preserves 78 archived identities and three exact games', async () => {
  const { projection } = await loadProjection();
  assert.equal(projection.sourceCaptureKey, M10_REAL_ARCHIVE_CAPTURE_KEY);
  assert.equal(projection.rows.length, M10_REAL_ARCHIVE_EXPECTED_PICK_COUNT);
  assert.deepEqual([...playersByGame(projection).keys()], [5059484, 5059485, 5059486]);
  assert.equal(expectedFinalHitsIdentities(projection).length, 39);
  assert.equal(projection.synthetic, false);
});

test('real archive report grades all 78 picks through exact final Hits evidence and core settlement', async () => {
  const { projection } = await loadProjection();
  const { gameSnapshot, statsSnapshot } = snapshots(projection);
  const report = buildM10RealArchiveGradeReportV1({
    projection,
    gradedAt: '2026-08-06T05:02:00.000Z',
    gameSnapshot,
    statsSnapshot,
  });
  assert.equal(report.reportVersion, M10_REAL_ARCHIVE_GRADING_VERSION);
  assert.equal(report.summary.picksGraded, 78);
  assert.equal(
    report.summary.wins + report.summary.losses + report.summary.voids,
    78,
  );
  assert.equal(report.source.archiveModified, false);
  assert.equal(report.safety.productionEnabled, false);
  assert.equal(report.safety.rankingEnabled, false);
  assert.equal(report.safety.activeFeatureImports, 0);
  assert.deepEqual(
    report.opportunityMinerPicks.map((pick) => ({
      playerName: pick.playerName,
      selectedSide: pick.selectedSide,
      postedLine: pick.postedLine,
      officialHits: pick.officialHits,
      outcome: pick.outcome,
    })),
    [
      {
        playerName: 'Buddy Kennedy',
        selectedSide: 'higher',
        postedLine: 0.5,
        officialHits: 1,
        outcome: 'win',
      },
      {
        playerName: 'Grant McCray',
        selectedSide: 'higher',
        postedLine: 0.5,
        officialHits: 0,
        outcome: 'loss',
      },
      {
        playerName: 'Yainer Diaz',
        selectedSide: 'lower',
        postedLine: 0.5,
        officialHits: 0,
        outcome: 'win',
      },
    ],
  );
});

test('scheduled, live, postponed, or unknown game state fails the entire archive closed', async () => {
  const { projection } = await loadProjection();
  for (const status of [
    'STATUS_SCHEDULED',
    'STATUS_IN_PROGRESS',
    'STATUS_POSTPONED',
    'STATUS_SUSPENDED',
    'UNRECOGNIZED',
  ]) {
    const { gameSnapshot, statsSnapshot } = snapshots(
      projection,
      new Map([[5059485, status]]),
    );
    assert.throws(
      () =>
        buildM10RealArchiveGradeReportV1({
          projection,
          gradedAt: '2026-08-06T05:02:00.000Z',
          gameSnapshot,
          statsSnapshot,
        }),
      /is not STATUS_FINAL/u,
      status,
    );
  }
});

test('missing, duplicate, or unexpected player-game stats identities fail closed', async () => {
  const { projection } = await loadProjection();
  const { gameSnapshot, statsSnapshot } = snapshots(projection);
  const rows = statsSnapshot.response.data;
  const missing = {
    ...statsSnapshot,
    response: { ...statsSnapshot.response, data: rows.slice(1) },
  };
  assert.throws(
    () =>
      buildM10RealArchiveGradeReportV1({
        projection,
        gradedAt: '2026-08-06T05:02:00.000Z',
        gameSnapshot,
        statsSnapshot: missing,
      }),
    /received 0/u,
  );
  const duplicate = {
    ...statsSnapshot,
    response: { ...statsSnapshot.response, data: [...rows, rows[0]] },
  };
  assert.throws(
    () =>
      buildM10RealArchiveGradeReportV1({
        projection,
        gradedAt: '2026-08-06T05:02:00.000Z',
        gameSnapshot,
        statsSnapshot: duplicate,
      }),
    /received 2/u,
  );
  const unexpected = {
    ...statsSnapshot,
    response: {
      ...statsSnapshot.response,
      data: [...rows, { player: { id: 999999 }, game_id: 5059484, hits: 1 }],
    },
  };
  assert.throws(
    () =>
      buildM10RealArchiveGradeReportV1({
        projection,
        gradedAt: '2026-08-06T05:02:00.000Z',
        gameSnapshot,
        statsSnapshot: unexpected,
      }),
    /Unexpected BALLDONTLIE stats identity/u,
  );
});

test('grade persistence is immutable and never changes the archive projection', async () => {
  const { bytes, projection } = await loadProjection();
  const before = Buffer.from(bytes);
  const { gameSnapshot, statsSnapshot } = snapshots(projection);
  const report = buildM10RealArchiveGradeReportV1({
    projection,
    gradedAt: '2026-08-06T05:02:00.000Z',
    gameSnapshot,
    statsSnapshot,
  });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm10-real-grade-'));
  try {
    const filePath = path.join(directory, 'grades', 'report.json');
    const persisted = await persistImmutableJson(filePath, report);
    assert.equal(persisted.filePath, filePath);
    await assert.rejects(
      () => persistImmutableJson(filePath, report),
      /Immutable report already exists/u,
    );
    assert.deepEqual(await readFile(M10_REAL_ARCHIVE_PROJECTION_PATH), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('workflow has a timeout and always uploads report evidence and the full log', async () => {
  const workflow = await readFile(
    '.github/workflows/m10-grade-saved-archive.yml',
    'utf8',
  );
  assert.match(workflow, /timeout-minutes:\s*30/u);
  assert.ok((workflow.match(/if:\s*always\(\)/gu) ?? []).length >= 2);
  assert.match(workflow, /artifacts\/board-archives\/batter-hits/u);
  assert.match(workflow, /artifacts\/workflow-logs\/m10-saved-archive-grade\.log/u);
  assert.match(workflow, /BALLDONTLIE_API_KEY/u);
  assert.match(workflow, /M10_CAPTURE_KEY/u);
  assert.doesNotMatch(workflow, /productionEnabled:\s*true/u);
  assert.doesNotMatch(workflow, /rankingEnabled:\s*true/u);
});
