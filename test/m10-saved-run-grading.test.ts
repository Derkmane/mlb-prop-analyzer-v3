import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  normalizeBallDontLieOfficialFinalHitsV1,
  rawBallDontLiePlayerGameStatsResponseSchema,
} from '../src/adapters/providers/balldontlie/index.js';
import { settleObservedDiscreteStatisticV1 } from '../src/core/index.js';
import { gradeSavedRunBatterHitsV1 } from '../src/historical/index.js';
import { createM10SavedRunFixture } from './helpers/m10-saved-run-fixture.js';

const GAME_SNAPSHOT_SHA = 'c'.repeat(64);
const STATS_SNAPSHOT_SHA = 'd'.repeat(64);

function game(id: number, status = 'STATUS_FINAL') {
  return {
    id,
    home_team_name: 'Home Team',
    away_team_name: 'Away Team',
    home_team: { id: 1, display_name: 'Home Team' },
    away_team: { id: 2, display_name: 'Away Team' },
    season: 2026,
    postseason: false,
    season_type: 'regular',
    date: '2026-08-05T18:00:00.000Z',
    status,
  };
}

function rawEvidenceInput() {
  return {
    gameSnapshot: {
      snapshotId: 'bdl-games-final-20260805',
      sha256: GAME_SNAPSHOT_SHA,
      capturedAt: '2026-08-06T04:00:00.000Z',
      response: {
        data: [game(5059401), game(5059402)],
        meta: { per_page: 100 },
      },
    },
    statsSnapshot: {
      snapshotId: 'bdl-stats-final-20260805',
      sha256: STATS_SNAPSHOT_SHA,
      capturedAt: '2026-08-06T04:00:02.000Z',
      response: {
        data: [
          {
            player: {
              id: 2001,
              full_name: 'Provider Name Does Not Control Identity',
            },
            game_id: 5059401,
            hits: 1,
          },
          {
            player: { id: 2002, full_name: 'Historical Lower' },
            game_id: 5059402,
            hits: 1,
          },
        ],
        meta: { per_page: 100 },
      },
    },
    expectedIdentities: [
      { providerGameId: 5059401, providerPlayerId: 2001 },
      { providerGameId: 5059402, providerPlayerId: 2002 },
    ],
  };
}

test('observed Hits settle Higher and Lower symmetrically with exact ties void', () => {
  assert.equal(
    settleObservedDiscreteStatisticV1({
      observedStatistic: 2,
      line: 1,
      selectedSide: 'higher',
    }).outcome,
    'win',
  );
  assert.equal(
    settleObservedDiscreteStatisticV1({
      observedStatistic: 0,
      line: 1,
      selectedSide: 'higher',
    }).outcome,
    'loss',
  );
  assert.equal(
    settleObservedDiscreteStatisticV1({
      observedStatistic: 1,
      line: 1,
      selectedSide: 'higher',
    }).outcome,
    'void',
  );
  assert.equal(
    settleObservedDiscreteStatisticV1({
      observedStatistic: 0,
      line: 1,
      selectedSide: 'lower',
    }).outcome,
    'win',
  );
  assert.equal(
    settleObservedDiscreteStatisticV1({
      observedStatistic: 2,
      line: 1,
      selectedSide: 'lower',
    }).outcome,
    'loss',
  );
  assert.equal(
    settleObservedDiscreteStatisticV1({
      observedStatistic: 1,
      line: 1,
      selectedSide: 'lower',
    }).outcome,
    'void',
  );
});

test('BALLDONTLIE final Hits normalization joins only exact game and player identities', () => {
  const evidence = normalizeBallDontLieOfficialFinalHitsV1(
    rawEvidenceInput(),
  );
  assert.deepEqual(
    evidence.map((item) => ({
      game: item.providerGameId,
      player: item.providerPlayerId,
      hits: item.officialHits,
      status: item.gameStatus,
    })),
    [
      { game: 5059401, player: 2001, hits: 1, status: 'STATUS_FINAL' },
      { game: 5059402, player: 2002, hits: 1, status: 'STATUS_FINAL' },
    ],
  );
  assert.equal(evidence[0]!.statsEndpointPath, '/mlb/v1/stats');
  assert.equal(evidence[0]!.gamesEndpointPath, '/mlb/v1/games');
  assert.equal(evidence[0]!.statsSnapshotSha256, STATS_SNAPSHOT_SHA);
});

test('BALLDONTLIE grading evidence fails closed for non-final, missing, duplicate, or malformed rows', () => {
  const nonFinal = rawEvidenceInput();
  nonFinal.gameSnapshot.response.data[0] = game(
    5059401,
    'STATUS_SCHEDULED',
  );
  assert.throws(
    () => normalizeBallDontLieOfficialFinalHitsV1(nonFinal),
    /not STATUS_FINAL/u,
  );

  const missing = rawEvidenceInput();
  missing.statsSnapshot.response.data.pop();
  assert.throws(
    () => normalizeBallDontLieOfficialFinalHitsV1(missing),
    /received 0/u,
  );

  const duplicate = rawEvidenceInput();
  duplicate.statsSnapshot.response.data.push({
    player: { id: 2001, full_name: 'Duplicate Exact Identity' },
    game_id: 5059401,
    hits: 1,
  });
  assert.throws(
    () => normalizeBallDontLieOfficialFinalHitsV1(duplicate),
    /received 2/u,
  );

  assert.throws(
    () =>
      rawBallDontLiePlayerGameStatsResponseSchema.parse({
        data: [
          {
            player: { id: 2001 },
            game_id: 5059401,
            hits: 1.5,
          },
        ],
        meta: { per_page: 100 },
      }),
    /expected int/u,
  );
});

test('versioned grading preserves archived probabilities and grades category overlap independently', () => {
  const run = createM10SavedRunFixture();
  const before = JSON.stringify(run);
  const evidence = normalizeBallDontLieOfficialFinalHitsV1(
    rawEvidenceInput(),
  );
  const report = gradeSavedRunBatterHitsV1({
    run,
    evidence,
    gradedAt: '2026-08-06T04:00:03.000Z',
  });

  assert.equal(report.gradingVersion, 'm10-saved-run-batter-hits-grading-v1');
  assert.equal(report.summary.graded, 3);
  assert.equal(report.summary.wins, 3);
  assert.equal(report.summary.losses, 0);
  assert.equal(report.summary.voids, 0);
  assert.equal(report.summary.winRateGivenGrades, 1);
  assert.equal(report.productionEnabled, false);
  assert.equal(report.rankingEnabled, false);
  assert.equal(JSON.stringify(run), before);
  assert.equal(
    report.categories[0]!.picks[0]!.providerPlayerId,
    report.categories[1]!.picks[0]!.providerPlayerId,
  );
  report.categories.forEach((category, categoryIndex) => {
    const savedCategory = run.categories[categoryIndex]!;
    category.picks.forEach((grade, pickIndex) => {
      const savedPick = savedCategory.picks[pickIndex]!;
      assert.equal(grade.snapshotId, savedPick.snapshotId);
      assert.equal(grade.selectedSide, savedPick.selectedSide);
      assert.equal(grade.line, savedPick.line);
      assert.equal(grade.archivedPWin, savedPick.pWin);
      assert.equal(grade.archivedPLoss, savedPick.pLoss);
      assert.equal(grade.archivedPVoid, savedPick.pVoid);
      assert.equal(
        grade.archivedPWinGivenGrades,
        savedPick.pWinGivenGrades,
      );
      assert.equal(grade.outcome, 'win');
    });
  });
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.categories));
});

test('saved-run grading uses no active feature implementation and prints literal track-record evidence', () => {
  const source = readFileSync(
    path.resolve('src/historical/grade-saved-run.ts'),
    'utf8',
  );
  assert.doesNotMatch(source, /\.\.\/features|features\//u);
  const run = createM10SavedRunFixture();
  const evidence = normalizeBallDontLieOfficialFinalHitsV1(
    rawEvidenceInput(),
  );
  const report = gradeSavedRunBatterHitsV1({
    run,
    evidence,
    gradedAt: '2026-08-06T04:00:03.000Z',
  });

  process.stdout.write('\n--- M10 SAVED RUN GRADING OUTPUT ---\n');
  process.stdout.write(`RUN ID: ${report.runId}\n`);
  process.stdout.write(`GRADING VERSION: ${report.gradingVersion}\n`);
  process.stdout.write(`PROVIDER: ${report.provider}\n`);
  process.stdout.write('JOIN: EXACT providerGameId + providerPlayerId\n');
  process.stdout.write('GAME STATUS: STATUS_FINAL ONLY\n');
  process.stdout.write('STATISTIC: official Hits\n');
  for (const category of report.categories) {
    for (const grade of category.picks) {
      process.stdout.write(
        `${category.categoryId}\t${grade.categoryRank}\t${grade.playerName}\t${grade.providerGameId}\t${grade.providerPlayerId}\t${grade.selectedSide}\t${grade.line}\t${grade.officialHits}\t${grade.outcome}\t${grade.archivedPWinGivenGrades}\n`,
      );
    }
  }
  process.stdout.write(`GRADED: ${report.summary.graded}\n`);
  process.stdout.write(`WINS: ${report.summary.wins}\n`);
  process.stdout.write(`LOSSES: ${report.summary.losses}\n`);
  process.stdout.write(`VOIDS: ${report.summary.voids}\n`);
  process.stdout.write(
    `WIN RATE GIVEN GRADES: ${report.summary.winRateGivenGrades}\n`,
  );
  process.stdout.write('ACTIVE FEATURE IMPORTS: 0\n');
  process.stdout.write('PRODUCTION: DISABLED\n');
  process.stdout.write('RANKING: DISABLED\n');
  process.stdout.write('--- END M10 SAVED RUN GRADING OUTPUT ---\n');
});
