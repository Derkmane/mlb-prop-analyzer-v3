import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ResearchDisplayArchive,
  ResearchDisplayArchiveRepository,
  ResearchDisplayMarket,
  ResearchDisplayRow,
} from '../src/adapters/display-archives/research-display-archive-repository.js';
import {
  PRODUCT_RESEARCH_LABEL,
  readResearchProductBoardV2,
} from '../src/application/index.js';

const CAPTURED_AT = '2026-08-18T20:00:00.000Z';

function row(input: Readonly<{
  market: ResearchDisplayMarket;
  playerId: number;
  playerName: string;
  offerType: 'baseline' | 'alternate';
  side: 'higher' | 'lower';
  line: number;
  p: number;
  price?: number | null;
  multiplier?: number | null;
  lastFive?: readonly number[];
}>): ResearchDisplayRow {
  const isHits = input.market === 'batter-hits';
  return Object.freeze({
    market: input.market,
    captureKey: `${input.market}-capture`,
    capturedAt: CAPTURED_AT,
    modelVersion: isHits
      ? 'm8-5-batter-hits-successor-freeze-v1'
      : 'm11-batter-hhr-direct-composite-v2',
    distributionBuilderVersion: isHits
      ? 'm9-batter-hits-runtime-distribution-v1'
      : 'm11-batter-hhr-negative-binomial-v1',
    providerEventId: `event-${input.playerId}`,
    providerGameId: 9000 + input.playerId,
    providerPlayerId: input.playerId,
    playerName: input.playerName,
    teamName: 'Home Club',
    homeTeamName: 'Home Club',
    awayTeamName: 'Away Club',
    eventCommenceTime: '2026-08-18T22:35:00.000Z',
    providerMarketKey: isHits ? 'batter_hits' : 'batter_hits_runs_rbis',
    offerType: input.offerType,
    selectedSide: input.side,
    postedLine: input.line,
    americanPrice: input.price === undefined ? -110 : input.price,
    multiplier: input.multiplier === undefined ? 1 : input.multiplier,
    pWin: input.p,
    pLoss: 1 - input.p,
    pVoid: 0,
    pWinGivenGrades: input.p,
    lineupStatus: 'confirmed',
    analysisContext: Object.freeze({
      expectedPlateAppearances: 4.35,
      lineupSlot: 2,
      batterSide: 'L',
      opposingStarterHand: 'R',
      venue: isHits ? null : 'Research Park',
      teamImpliedRunTotal: isHits ? null : 4.7,
    }),
    enrichment: Object.freeze({
      lastFiveGames: Object.freeze({
        games: Object.freeze((input.lastFive ?? []).map((actual, index) => Object.freeze({
          gameDate: `2026-08-${String(10 + index).padStart(2, '0')}`,
          opponentAbbreviation: 'AWY',
          hits: isHits ? actual : 1,
          hrr: isHits ? 2 : actual,
        }))),
      }),
      opposingStarter: Object.freeze({
        name: 'Starter Name',
        throwingHand: 'R',
        era: 3.42,
        last10: Object.freeze({ starts: 10, inningsPitched: '58.2', strikeouts: 61, whip: 1.08 }),
      }),
    }),
  });
}

function archive(
  market: ResearchDisplayMarket,
  rows: readonly ResearchDisplayRow[],
): ResearchDisplayArchive {
  const isHits = market === 'batter-hits';
  return Object.freeze({
    market,
    captureKey: `${market}-capture`,
    capturedAt: CAPTURED_AT,
    modelVersion: isHits
      ? 'm8-5-batter-hits-successor-freeze-v1'
      : 'm11-batter-hhr-direct-composite-v2',
    distributionBuilderVersion: isHits
      ? 'm9-batter-hits-runtime-distribution-v1'
      : 'm11-batter-hhr-negative-binomial-v1',
    rows: Object.freeze([...rows]),
  });
}

function repository(): ResearchDisplayArchiveRepository {
  const hits = archive('batter-hits', [
    row({ market: 'batter-hits', playerId: 1, playerName: 'Shared Star', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.73, lastFive: [1, 0] }),
    row({ market: 'batter-hits', playerId: 2, playerName: 'Hits Two', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.68 }),
    row({ market: 'batter-hits', playerId: 3, playerName: 'Hits Three', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.66 }),
    row({ market: 'batter-hits', playerId: 4, playerName: 'Hits Four', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.64 }),
    row({ market: 'batter-hits', playerId: 5, playerName: 'Hits Five', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.62 }),
    row({ market: 'batter-hits', playerId: 6, playerName: 'Hits Six', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.60 }),
    row({ market: 'batter-hits', playerId: 11, playerName: 'Hits Alt One', offerType: 'alternate', side: 'lower', line: 1.5, p: 0.79 }),
    row({ market: 'batter-hits', playerId: 12, playerName: 'Hits Alt Two', offerType: 'alternate', side: 'lower', line: 1.5, p: 0.74 }),
    row({ market: 'batter-hits', playerId: 13, playerName: 'Hits Alt Three', offerType: 'alternate', side: 'lower', line: 1.5, p: 0.69 }),
  ]);
  const hhr = archive('batter-hhr', [
    row({ market: 'batter-hhr', playerId: 1, playerName: 'Shared Star', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.81, lastFive: [1, 0] }),
    row({ market: 'batter-hhr', playerId: 20, playerName: 'HHR Baseline', offerType: 'baseline', side: 'higher', line: 1.5, p: 0.70 }),
    row({ market: 'batter-hhr', playerId: 21, playerName: 'HHR Alt One', offerType: 'alternate', side: 'lower', line: 1.5, p: 0.83 }),
    row({ market: 'batter-hhr', playerId: 22, playerName: 'HHR Alt Two', offerType: 'alternate', side: 'lower', line: 1.5, p: 0.78 }),
    row({ market: 'batter-hhr', playerId: 23, playerName: 'HHR Deep', offerType: 'alternate', side: 'lower', line: 2.5, p: 0.72 }),
  ]);
  return Object.freeze({
    readLatest: async (market: ResearchDisplayMarket) =>
      market === 'batter-hits' ? hits : hhr,
  });
}

test('research board populates exactly three canonical Top Five categories from both markets', async () => {
  const board = await readResearchProductBoardV2(repository());

  assert.equal(board.productionCalibrated, false);
  assert.equal(board.disclosure, PRODUCT_RESEARCH_LABEL);
  assert.deepEqual(board.sourceMarkets, ['batter-hits', 'batter-hhr']);
  assert.deepEqual(
    board.categories.map((category) => category.title),
    [
      'Opportunity Miner Favorites',
      'High Probability Baseline Props',
      'High Probability Altline Props',
    ],
  );
  for (const category of board.categories) {
    assert.ok(category.picks.length > 0);
    assert.ok(category.picks.length <= 5);
    assert.equal(new Set(category.picks.map((pick) => pick.playerId)).size, category.picks.length);
    assert.ok(category.picks.every((pick) => pick.probabilityLabel === PRODUCT_RESEARCH_LABEL));
    for (let index = 1; index < category.picks.length; index += 1) {
      assert.ok(category.picks[index - 1]!.pWinGivenGrades >= category.picks[index]!.pWinGivenGrades);
    }
  }

  const baseline = board.categories[1]!;
  assert.equal(baseline.picks[0]!.player, 'Shared Star');
  assert.equal(baseline.picks[0]!.market, 'Hits + Runs + RBIs');
  assert.equal(baseline.picks[0]!.pWinGivenGrades, 0.81);
  assert.equal(baseline.picks.some((pick) => pick.market === 'Hits'), true);

  const altline = board.categories[2]!;
  assert.equal(altline.picks[0]!.player, 'HHR Alt One');
  assert.equal(altline.picks.some((pick) => pick.market === 'Hits'), true);
});

test('research cards preserve context, side-aware last five, and explicit calibration failures', async () => {
  const board = await readResearchProductBoardV2(repository());
  const shared = board.categories[1]!.picks[0]!;

  assert.equal(shared.expectedPlateAppearances, 4.35);
  assert.equal(shared.lineupSlot, 2);
  assert.equal(shared.opposingStarter.name, 'Starter Name');
  assert.equal(shared.opposingStarter.hand, 'R');
  assert.equal(shared.opposingStarter.era, 3.42);
  assert.equal(shared.opposingStarter.kRate, null);
  assert.match(shared.opposingStarter.recentWorkload ?? '', /10 starts/u);
  assert.equal(shared.platoon, 'L batter vs R starter');
  assert.equal(shared.teamImpliedRunTotal, 4.7);
  assert.equal(shared.park, 'Research Park');
  assert.deepEqual(shared.lastFive.map((game) => game.outcome), ['cash', 'miss']);
  assert.equal(shared.calibration.status, 'failed');
  assert.equal(shared.calibration.predicted, 0.6554);
  assert.equal(shared.calibration.observed, 0.5412);
  assert.match(shared.calibration.message, /model 65\.5%, actual 54\.1%/u);

  const hits = board.categories[1]!.picks.find((pick) => pick.market === 'Hits');
  assert.ok(hits);
  assert.equal(hits.calibration.status, 'pending');
  assert.equal(hits.park, null);
  assert.equal(hits.teamImpliedRunTotal, null);
});
