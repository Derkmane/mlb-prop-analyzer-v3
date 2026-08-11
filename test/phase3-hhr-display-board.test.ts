import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createHhrDisplayArchiveRepository,
  HHR_DISPLAY_ARCHIVE_ROOT,
  type HhrDisplayArchiveFileReader,
} from '../src/adapters/display-archives/hhr-display-archive-repository.js';
import {
  readLatestHhrDisplayBoard,
  type HhrDisplayArchive,
  type HhrDisplayArchiveRepository,
} from '../src/application/hhr-display-board.js';

const SHA = 'a'.repeat(64);
const CAPTURE_KEY = `20260811T162447459Z--${SHA}`;

function archive(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    displayArchiveVersion: 1,
    displayArchiveContract: 'phase1-trimmed-board-display-v1',
    market: 'batter-hhr',
    captureKey: CAPTURE_KEY,
    capturedAt: '2026-08-11T16:24:47.459Z',
    captureDateUtc: '2026-08-11',
    fullArchiveSha256: SHA,
    fullArchiveFileSha256: SHA,
    productionEnabled: false,
    productionRankingEnabled: false,
    modelVersion: 'hhr-model-v2',
    distributionBuilderVersion: 'hhr-distribution-v1',
    displayEnrichment: enrichment(),
    rows: [row()],
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rank: 1,
    providerEventId: 'event-1',
    providerGameId: 100,
    providerPlayerId: 7,
    providerTeamId: 10,
    playerName: 'Player Seven',
    teamName: 'Away Team',
    homeTeamName: 'Home Team',
    awayTeamName: 'Away Team',
    eventCommenceTime: '2026-08-11T23:00:00.000Z',
    baseMarketKey: 'batter_hits_runs_rbis',
    providerMarketKey: 'batter_hits_runs_rbis_alternate',
    marketLabel: 'Batter Hits + Runs + RBIs',
    offerType: 'alternate',
    settlementStatistic: 'hits+runs+rbi',
    selectedSide: 'lower',
    postedLine: 2.5,
    americanPrice: -120,
    multiplier: 0.92,
    pWin: 0.7000000000000001,
    pLoss: 0.2999999999999999,
    pVoid: 0,
    pWinGivenGrades: 0.7000000000000001,
    lineupStatus: 'projected',
    ...overrides,
  };
}

function enrichmentRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerGameId: 100,
    providerPlayerId: 7,
    lastFiveGames: {
      count: 1,
      games: [{
        gameDate: '2026-08-10', opponentTeamName: 'Prior Opponent', opponentAbbreviation: 'PRV',
        homeOrAway: 'away', hits: 1, runs: 2, rbi: 3, hrr: 6, atBats: 4,
        plateAppearances: 5, totalBases: 2,
      }],
      failureReason: null,
    },
    opposingStarter: {
      name: 'Starter', throwingHand: 'R', era: 2.75,
      last10: { starts: 10, inningsPitched: '60.1', earnedRuns: 20, strikeouts: 70, whip: 1.1 },
      season: { inningsPitched: 120.2, earnedRuns: 40, strikeouts: 140, whip: 1.2 },
    },
    ...overrides,
  };
}

function enrichment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    contract: 'phase2-last-five-and-opposing-starter-v1',
    keyFormat: 'providerGameId:providerPlayerId',
    byGamePlayerKey: { '100:7': enrichmentRecord() },
    diagnostics: { playerCount: 1, failureReasons: {} },
    ...overrides,
  };
}

function fakeReader(files: Readonly<Record<string, string>>, order = Object.keys(files)): HhrDisplayArchiveFileReader {
  return {
    readdir: async (directory) => {
      assert.equal(directory, HHR_DISPLAY_ARCHIVE_ROOT);
      return order;
    },
    readFile: async (filePath) => {
      const filename = filePath.split('/').at(-1)!;
      const bytes = files[filename];
      if (bytes === undefined) throw new Error(`Missing fake file ${filename}`);
      return bytes;
    },
  };
}

const filename = `${CAPTURE_KEY}.json`;
const serialized = (value: unknown): string => JSON.stringify(value);

test('repository reads the newest committed valid capture', async () => {
  const result = await createHhrDisplayArchiveRepository().readLatest();
  assert.equal(result.captureKey, '20260811T162447459Z--ddda7db0a4e092c737504e895ccea3a5c9d4b6f71ef3ed73edc7123623faab21');
});

test('newest valid selection is deterministic and independent of filesystem order', async () => {
  const olderKey = `20260811T152447459Z--${'b'.repeat(64)}`;
  const files = {
    [filename]: serialized(archive()),
    [`${olderKey}.json`]: serialized(archive({ captureKey: olderKey, capturedAt: '2026-08-11T15:24:47.459Z' })),
  };
  for (const order of [Object.keys(files), Object.keys(files).reverse()]) {
    assert.equal((await createHhrDisplayArchiveRepository(fakeReader(files, order)).readLatest()).captureKey, CAPTURE_KEY);
  }
});

test('malformed JSON fails closed', async () => {
  await assert.rejects(createHhrDisplayArchiveRepository(fakeReader({ [filename]: '{' })).readLatest(), /Malformed/u);
});

for (const [name, mutation, pattern] of [
  ['wrong archive version', { displayArchiveVersion: 2 }, /contract/u],
  ['wrong market', { market: 'batter-hits' }, /contract/u],
] as const) {
  test(`${name} fails closed`, async () => {
    await assert.rejects(
      createHhrDisplayArchiveRepository(fakeReader({ [filename]: serialized(archive(mutation)) })).readLatest(),
      pattern,
    );
  });
}

test('filename and captureKey disagreement fails closed', async () => {
  const wrong = archive({ captureKey: `20260811T162447459Z--${'c'.repeat(64)}` });
  await assert.rejects(createHhrDisplayArchiveRepository(fakeReader({ [filename]: serialized(wrong) })).readLatest(), /disagreement/u);
});

test('malformed Phase 2 enrichment contract fails closed before fields are exposed', async () => {
  const malformed = archive({ displayEnrichment: enrichment({ contract: 'wrong' }) });
  await assert.rejects(createHhrDisplayArchiveRepository(fakeReader({ [filename]: serialized(malformed) })).readLatest(), /contract/u);
});

test('unexpected archive filenames and ambiguous capture timestamps fail closed', async () => {
  await assert.rejects(createHhrDisplayArchiveRepository(fakeReader({ 'latest.json': '{}' })).readLatest(), /Unexpected/u);
  const otherKey = `20260811T162447459Z--${'b'.repeat(64)}`;
  const files = {
    [filename]: serialized(archive()),
    [`${otherKey}.json`]: serialized(archive({ captureKey: otherKey })),
  };
  await assert.rejects(createHhrDisplayArchiveRepository(fakeReader(files)).readLatest(), /Ambiguous/u);
});

function applicationArchive(rows: readonly Record<string, unknown>[], enrichmentByKey = enrichmentRecord()): HhrDisplayArchive {
  return {
    captureKey: CAPTURE_KEY,
    capturedAt: '2026-08-11T16:24:47.459Z',
    modelVersion: 'hhr-model-v2',
    distributionBuilderVersion: 'hhr-distribution-v1',
    rows: rows as unknown as HhrDisplayArchive['rows'],
    enrichmentByGamePlayerKey: { '100:7': enrichmentByKey as unknown as HhrDisplayArchive['enrichmentByGamePlayerKey'][string] },
  };
}

const repository = (value: HhrDisplayArchive): HhrDisplayArchiveRepository => ({ readLatest: async () => value });

test('view model preserves side, line, probabilities, lineup, display price, enrichment, and opponent verbatim', async () => {
  const input = applicationArchive([row()]);
  const pick = (await readLatestHhrDisplayBoard(repository(input))).hhr25LowerAlternates[0]!;
  assert.equal(pick.selectedSide, 'lower');
  assert.equal(pick.postedLine, 2.5);
  assert.equal(pick.pWinGivenGrades, 0.7000000000000001);
  assert.equal(pick.pVoid, 0);
  assert.equal(pick.lineupStatus, 'projected');
  assert.equal(pick.multiplier, 0.92);
  assert.equal(pick.americanPrice, -120);
  assert.equal(pick.opponent, 'Home Team');
  assert.equal(pick.gameTime, '2026-08-11T23:00:00.000Z');
  assert.equal(pick.opposingStarter?.name, 'Starter');
  assert.equal(pick.lastFiveGames[0]?.hrr, 6);
});

test('exact providerGameId:providerPlayerId join never attaches another player enrichment', async () => {
  const mismatched = applicationArchive([row({ providerPlayerId: 8 })]);
  const pick = (await readLatestHhrDisplayBoard(repository(mismatched))).hhr25LowerAlternates[0]!;
  assert.equal(pick.opposingStarter, null);
  assert.equal(pick.lastFiveGames.length, 0);
  assert.equal(pick.lastFiveGamesFailureReason, 'missing-player-enrichment');
});

test('exact category lines and sides are selected with no substitution', async () => {
  const rows = [
    row(),
    row({ rank: 2, providerPlayerId: 8, selectedSide: 'higher' }),
    row({ rank: 3, providerPlayerId: 9, postedLine: 2 }),
    row({ rank: 4, providerPlayerId: 10, postedLine: 0.5, selectedSide: 'higher' }),
    row({ rank: 5, providerPlayerId: 11, postedLine: 0.5, selectedSide: 'lower' }),
    row({ rank: 6, providerPlayerId: 12, postedLine: 0.5, selectedSide: 'higher', offerType: 'baseline' }),
  ];
  const board = await readLatestHhrDisplayBoard(repository(applicationArchive(rows)));
  assert.deepEqual(board.hhr25LowerAlternates.map((pick) => [pick.postedLine, pick.selectedSide]), [[2.5, 'lower']]);
  assert.deepEqual(board.hhr05HigherAlternates.map((pick) => [pick.postedLine, pick.selectedSide]), [[0.5, 'higher']]);
});

test('persisted rank alone controls order, so multiplier cannot change it', async () => {
  const rows = [
    row({ rank: 2, providerPlayerId: 8, playerName: 'Second', multiplier: 100 }),
    row({ rank: 1, playerName: 'First', multiplier: 0.01 }),
  ];
  const picks = (await readLatestHhrDisplayBoard(repository(applicationArchive(rows)))).hhr25LowerAlternates;
  assert.deepEqual(picks.map((pick) => pick.player), ['First', 'Second']);
});

test('persisted rank keeps only the first exact offer for each player', async () => {
  const rows = [row(), row({ rank: 2, playerName: 'Duplicate' })];
  const picks = (await readLatestHhrDisplayBoard(repository(applicationArchive(rows)))).hhr25LowerAlternates;
  assert.deepEqual(picks.map((pick) => pick.player), ['Player Seven']);
});

test('top 20 never pads and returns fewer when fewer exist', async () => {
  const nineteen = Array.from({ length: 19 }, (_, index) => row({
    rank: index + 1, providerPlayerId: index + 1, playerName: `Player ${index + 1}`,
  }));
  assert.equal((await readLatestHhrDisplayBoard(repository(applicationArchive(nineteen)))).hhr25LowerAlternates.length, 19);
  const twentyOne = [...nineteen, row({ rank: 20, providerPlayerId: 20 }), row({ rank: 21, providerPlayerId: 21 })];
  assert.equal((await readLatestHhrDisplayBoard(repository(applicationArchive(twentyOne)))).hhr25LowerAlternates.length, 20);
});

test('identical input produces structurally identical output', async () => {
  const input = repository(applicationArchive([row()]));
  assert.deepEqual(await readLatestHhrDisplayBoard(input), await readLatestHhrDisplayBoard(input));
});

test('read-path import graph cannot reach providers, fitting, probability, settlement, or ranking', async () => {
  const [applicationSource, adapterSource] = await Promise.all([
    readFile('src/application/hhr-display-board.ts', 'utf8'),
    readFile('src/adapters/display-archives/hhr-display-archive-repository.ts', 'utf8'),
  ]);
  const imports = [...applicationSource.matchAll(/from\s+['"]([^'"]+)['"]/gu),
    ...adapterSource.matchAll(/from\s+['"]([^'"]+)['"]/gu)].map((match) => match[1]);
  assert.equal(imports.some((value) => /providers|features|categories|core|probability|settlement|ranking|scripts/u.test(value ?? '')), false);
  assert.deepEqual(imports.filter((value) => value?.startsWith('..')), ['../../application/hhr-display-board.js']);
});

test('production and ranking remain disabled in both archive validation and registries', async () => {
  const [adapterSource, registries] = await Promise.all([
    readFile('src/adapters/display-archives/hhr-display-archive-repository.ts', 'utf8'),
    readFile('src/composition/registries.ts', 'utf8'),
  ]);
  assert.match(adapterSource, /productionEnabled: z\.literal\(false\)/u);
  assert.match(adapterSource, /productionRankingEnabled: z\.literal\(false\)/u);
  assert.match(registries, /BATTER_HHR_FEATURE_ID, enabled: false/u);
});
