import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildArchiveRow,
  buildConfirmedRuntimeObservation,
  buildEventScopedPlayerIdentities,
  buildProspectiveArchive,
  chicagoDate,
  matchExactEventGame,
  persistImmutableArchive,
  selectProspectiveEvents,
} from '../scripts/archive-m9-batter-hits-board.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const SHA = 'a'.repeat(64);

function event() {
  return {
    id: 'event-1',
    sport_key: 'baseball_mlb',
    commence_time: '2026-07-31T18:00:00Z',
    home_team: 'Home Club',
    away_team: 'Away Club',
  };
}

function game() {
  return {
    id: 99,
    season: 2026,
    season_type: 'regular',
    postseason: false,
    status: 'STATUS_SCHEDULED',
    date: '2026-07-31T17:59:00.000Z',
    home_team: { id: 2 },
    away_team: { id: 1 },
    home_team_name: 'Home Club',
    away_team_name: 'Away Club',
  };
}

function lineups() {
  return {
    data: [
      {
        game_id: 99,
        team: { id: 1, display_name: 'Away Club' },
        player: { id: 11, full_name: 'Away Hitter', bats_throws: 'L/R' },
        batting_order: 2,
        is_probable_pitcher: false,
      },
      {
        game_id: 99,
        team: { id: 2, display_name: 'Home Club' },
        player: { id: 22, full_name: 'Home Starter', bats_throws: 'R/R' },
        batting_order: null,
        is_probable_pitcher: true,
      },
    ],
  };
}

function offer() {
  return {
    providerEventId: 'event-1',
    providerGameId: 99,
    providerPlayerId: 11,
    providerTeamId: 1,
    playerName: 'Away Hitter',
    teamName: 'Away Club',
    homeTeamName: 'Home Club',
    awayTeamName: 'Away Club',
    eventCommenceTime: '2026-07-31T18:00:00Z',
    baseMarketKey: 'batter_hits',
    providerMarketKey: 'batter_hits',
    offerType: 'baseline',
    selectedSide: 'higher',
    rawSide: 'Over',
    line: 0.5,
    americanPrice: -120,
    multiplier: 1,
    marketLastUpdate: '2026-07-31T15:00:00Z',
    sourceCapturedAt: '2026-07-31T15:01:00Z',
    sourceSnapshotSha256: SHA,
  };
}

function probabilityResult() {
  return {
    productionEnabled: false,
    candidate: {
      eventId: 'event-1',
      gameId: '99',
      playerId: '11',
      playerName: 'Away Hitter',
      baseMarketKey: 'batter_hits',
      marketLabel: 'Batter Hits',
      line: 0.5,
      selectedSide: 'higher',
      settlementStatistic: 'hits',
      eligibilityProbability: 1,
      statisticDistribution: [0.2, 0.5, 0.3],
      pWin: 0.8,
      pLoss: 0.2,
      pVoid: 0,
      pWinGivenGrades: 0.8,
      modelVersion: 'm8-batter-hits-complete-candidate-v1',
      distributionBuilderVersion: 'm9-batter-hits-runtime-distribution-v1',
      settlementRuleVersion: 'batter-hits-settlement-not-production-validated',
      sharedScenarioReference: { providerGameId: 99 },
      featureData: { featureId: 'batter-hits', version: 1, values: {} },
    },
    distribution: {
      distributionBuilderVersion: 'm9-batter-hits-runtime-distribution-v1',
      statisticDistribution: [0.2, 0.5, 0.3],
      opportunityDistribution: [0, 0.1, 0.9],
      scenarios: [{ scenarioIndex: 0, weight: 1 }],
    },
  };
}

test('selects only still-pregame events on the Chicago archive date', () => {
  assert.equal(chicagoDate('2026-07-31T05:00:00Z'), '2026-07-31');
  const selected = selectProspectiveEvents({
    rawEvents: [
      event(),
      { ...event(), id: 'past', commence_time: '2026-07-31T15:00:00Z' },
      { ...event(), id: 'tomorrow', commence_time: '2026-08-01T18:00:00Z' },
    ],
    archiveDate: '2026-07-31',
    asOf: '2026-07-31T16:00:00Z',
  });
  assert.deepEqual(selected.map((row) => row.id), ['event-1']);
});

test('requires one exact current-season event-to-game match', () => {
  assert.equal(
    matchExactEventGame({
      event: {
        id: 'event-1',
        homeTeam: 'Home Club',
        awayTeam: 'Away Club',
      },
      rawGamesSnapshot: { data: [game()] },
    }).id,
    99,
  );
  assert.throws(
    () =>
      matchExactEventGame({
        event: {
          id: 'event-1',
          homeTeam: 'Home Club',
          awayTeam: 'Away Club',
        },
        rawGamesSnapshot: { data: [game(), { ...game(), id: 100 }] },
      }),
    /exactly one exact BALLDONTLIE team-pair match/u,
  );
});

test('builds exact event-scoped identities and a confirmed runtime observation', () => {
  const identities = buildEventScopedPlayerIdentities({
    event: { id: 'event-1' },
    game: game(),
    rawLineupsSnapshot: lineups(),
    playerNames: ['Away Hitter', 'Missing Hitter'],
  });
  assert.equal(identities.identities.length, 1);
  assert.equal(identities.unresolved.length, 1);
  const observation = buildConfirmedRuntimeObservation({
    offer: offer(),
    game: game(),
    rawLineupsSnapshot: lineups(),
    lineupCapturedAt: '2026-07-31T15:02:00Z',
    lineupSnapshotSha256: SHA,
  });
  assert.equal(observation.lineupSlot, 2);
  assert.equal(observation.teamSide, 'away');
  assert.equal(observation.batterSide, 'L');
  assert.equal(observation.opposingStarterPitcherId, 22);
  assert.equal(observation.opposingStarterHand, 'R');
});

test('archives exact side, line, complete distributions, and no production rank', () => {
  const row = buildArchiveRow({
    offer: offer(),
    probabilityResult: probabilityResult(),
    lineupSnapshotSha256: SHA,
  });
  assert.equal(row.market.line, 0.5);
  assert.equal(row.market.selectedSide, 'higher');
  assert.equal(row.probabilities.pWinGivenGrades, 0.8);
  assert.deepEqual(row.distribution.statisticDistribution, [0.2, 0.5, 0.3]);
  assert.deepEqual(row.distribution.opportunityDistribution, [0, 0.1, 0.9]);
  assert.equal(row.productionRank, null);
  assert.equal(row.rankStatus, 'NOT_AUTHORIZED_UNTIL_ACCEPTANCE_GATES_PASS');

  const archive = buildProspectiveArchive(
    {
      archiveDate: '2026-07-31',
      archivedAt: '2026-07-31T16:00:00Z',
      asOf: '2026-07-31T15:59:00Z',
      providerSnapshots: [],
      connectedArtifacts: [],
      counts: {
        prospectiveEventCount: 1,
        archivedRowCount: 1,
        excludedEventCount: 0,
        excludedOfferCount: 0,
      },
      excludedEvents: [],
      excludedOffers: [],
      rows: [row],
    },
    hash,
  );
  assert.equal(archive.configurationVersion, 'm9-batter-hits-prospective-archive-config-v1');
  assert.deepEqual(archive.connectedArtifacts, []);
  assert.equal(archive.productionEnabled, false);
  assert.equal(archive.productionRankingAuthorized, false);
  assert.equal(archive.gradingPerformed, false);
  assert.equal(archive.untouchedTestAccessed, false);
  assert.match(archive.archiveSha256, /^[a-f0-9]{64}$/u);
});

test('persists one immutable archive per date and rejects changed reruns', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm9-board-archive-'));
  const filePath = path.join(root, '2026-07-31.json');
  const archive = { archiveSha256: '1'.repeat(64), rows: [] };
  const writeJson = async (target, value) => {
    await writeFile(target, `${JSON.stringify(value)}\n`, 'utf8');
  };
  try {
    const first = await persistImmutableArchive({ filePath, archive, writeJson });
    assert.equal(first.reused, false);
    const second = await persistImmutableArchive({ filePath, archive, writeJson });
    assert.equal(second.reused, true);
    await assert.rejects(
      persistImmutableArchive({
        filePath,
        archive: { archiveSha256: '2'.repeat(64), rows: [] },
        writeJson,
      }),
      /Immutable board archive already exists/u,
    );
    assert.equal(JSON.parse(await readFile(filePath, 'utf8')).archiveSha256, '1'.repeat(64));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
