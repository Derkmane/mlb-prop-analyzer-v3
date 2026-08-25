import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRODUCT_RESEARCH_LABEL,
  readResearchProductBoardV2,
  type ResearchDisplayArchive,
  type ResearchDisplayArchiveRepository,
  type ResearchDisplayMarket,
  type ResearchDisplayRow,
} from '../src/application/index.js';
import { BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_VERSION } from '../src/features/batter-hhr/contracts.js';
import { BATTER_HHR_MARKET_KEY } from '../src/features/batter-hhr/manifest.js';
import { BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION } from '../src/features/batter-hits/settlement.js';

const CAPTURED_AT = '2099-08-18T20:00:00.000Z';

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
  eventCommenceTime?: string;
  providerMarketKey?: string;
  captureKey?: string;
}>): ResearchDisplayRow {
  const isHits = input.market === 'batter-hits';
  return Object.freeze({
    market: input.market,
    captureKey: input.captureKey ?? `${input.market}-capture`,
    capturedAt: CAPTURED_AT,
    modelVersion: isHits
      ? 'm8-5-batter-hits-successor-freeze-v1'
      : 'm11-batter-hhr-direct-composite-v2',
    distributionBuilderVersion: isHits
      ? 'm9-batter-hits-runtime-distribution-v1'
      : 'm11-batter-hhr-negative-binomial-v1',
    boardSource: 'draftkings',
    providerBookmakerKey: 'draftkings',
    providerRegion: 'us',
    settlementRuleVersion: isHits
      ? BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION
      : BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
    providerEventId: `event-${input.playerId}`,
    providerGameId: 9000 + input.playerId,
    providerPlayerId: input.playerId,
    playerName: input.playerName,
    teamName: 'Home Club',
    homeTeamName: 'Home Club',
    awayTeamName: 'Away Club',
    eventCommenceTime: input.eventCommenceTime ?? '2099-08-18T22:35:00.000Z',
    providerMarketKey:
      input.providerMarketKey ??
      (isHits
        ? input.offerType === 'baseline'
          ? 'batter_hits'
          : 'batter_hits_alternate'
        : input.offerType === 'baseline'
          ? 'batter_hits_runs_rbis'
          : 'batter_hits_runs_rbis_alternate'),
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
  capturedAt = CAPTURED_AT,
): ResearchDisplayArchive {
  const isHits = market === 'batter-hits';
  return Object.freeze({
    market,
    captureKey: `${market}-capture`,
    capturedAt,
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
    row({ market: 'batter-hits', playerId: 11, playerName: 'Hits Alt One', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.41 }),
    row({ market: 'batter-hits', playerId: 12, playerName: 'Hits Alt Two', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.40 }),
    row({ market: 'batter-hits', playerId: 13, playerName: 'Hits Alt Three', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.39 }),
    row({ market: 'batter-hits', playerId: 11, playerName: 'Hits Alt One', offerType: 'alternate', side: 'lower', line: 1.5, p: 0.79 }),
    row({ market: 'batter-hits', playerId: 12, playerName: 'Hits Alt Two', offerType: 'alternate', side: 'lower', line: 1.5, p: 0.74 }),
    row({ market: 'batter-hits', playerId: 13, playerName: 'Hits Alt Three', offerType: 'alternate', side: 'lower', line: 1.5, p: 0.69 }),
  ]);
  const hhr = archive(BATTER_HHR_MARKET_KEY, [
    row({ market: BATTER_HHR_MARKET_KEY, playerId: 1, playerName: 'Shared Star', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.81, lastFive: [1, 0] }),
    row({ market: BATTER_HHR_MARKET_KEY, playerId: 20, playerName: 'HHR Baseline', offerType: 'baseline', side: 'higher', line: 1.5, p: 0.70 }),
    row({ market: BATTER_HHR_MARKET_KEY, playerId: 21, playerName: 'HHR Alt One', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.42 }),
    row({ market: BATTER_HHR_MARKET_KEY, playerId: 22, playerName: 'HHR Alt Two', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.41 }),
    row({ market: BATTER_HHR_MARKET_KEY, playerId: 23, playerName: 'HHR Deep', offerType: 'baseline', side: 'higher', line: 1.5, p: 0.40 }),
    row({ market: BATTER_HHR_MARKET_KEY, playerId: 21, playerName: 'HHR Alt One', offerType: 'alternate', side: 'lower', line: 1.5, p: 0.83 }),
    row({ market: BATTER_HHR_MARKET_KEY, playerId: 22, playerName: 'HHR Alt Two', offerType: 'alternate', side: 'lower', line: 1.5, p: 0.78 }),
    row({ market: BATTER_HHR_MARKET_KEY, playerId: 23, playerName: 'HHR Deep', offerType: 'alternate', side: 'lower', line: 2.5, p: 0.72 }),
  ]);
  return Object.freeze({
    readLatest: async (market: ResearchDisplayMarket) =>
      market === 'batter-hits' ? hits : hhr,
  });
}

test('research board returns full eligible categories and a separate Top Five research subset', async () => {
  const board = await readResearchProductBoardV2(repository());

  assert.equal(board.productionCalibrated, false);
  assert.equal(board.disclosure, PRODUCT_RESEARCH_LABEL);
  assert.deepEqual(board.sourceMarkets, ['batter-hits', BATTER_HHR_MARKET_KEY]);
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
    assert.ok(category.picks.length <= 20);
    assert.ok(category.picks.every((pick) => pick.pWinGivenGrades > 0.5));
    assert.equal(new Set(category.picks.map((pick) => pick.playerId)).size, category.picks.length);
    assert.ok(category.picks.every((pick) => pick.probabilityLabel === PRODUCT_RESEARCH_LABEL));
    assert.ok(category.picks.every((pick) => pick.boardSource === 'draftkings'));
    assert.ok(category.picks.every((pick) => pick.providerBookmakerKey === 'draftkings'));
    assert.ok(category.picks.every((pick) => pick.providerRegion === 'us'));
    assert.deepEqual(category.researchTopFive, category.picks.slice(0, 5));
    assert.ok(category.researchTopFive.length <= 5);
    for (let index = 1; index < category.picks.length; index += 1) {
      assert.ok(category.picks[index - 1]!.pWinGivenGrades >= category.picks[index]!.pWinGivenGrades);
    }
  }

  const baseline = board.categories[1]!;
  assert.equal(baseline.picks.length, 7);
  assert.equal(baseline.researchTopFive.length, 5);
  assert.equal(baseline.picks[0]!.player, 'Shared Star');
  assert.equal(baseline.picks[0]!.market, 'Hits + Runs + RBIs');
  assert.equal(baseline.picks[0]!.pWinGivenGrades, 0.81);
  assert.equal(baseline.picks.some((pick) => pick.market === 'Hits'), true);

  const altline = board.categories[2]!;
  assert.equal(altline.picks.length, 6);
  assert.equal(altline.researchTopFive.length, 5);
  assert.equal(altline.picks[0]!.player, 'HHR Alt One');
  assert.equal(altline.picks.some((pick) => pick.market === 'Hits'), true);
});

test('research board caps a category at 20 and excludes 50 percent or lower without padding', async () => {
  const qualifying = Array.from({ length: 24 }, (_, index) =>
    row({
      market: 'batter-hits',
      playerId: 200 + index,
      playerName: `Qualifying ${index + 1}`,
      offerType: 'baseline',
      side: 'higher',
      line: 0.5,
      p: 0.80 - index * 0.01,
    }),
  );
  const hits = archive('batter-hits', [
    ...qualifying,
    row({ market: 'batter-hits', playerId: 300, playerName: 'Exactly Half', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.5 }),
    row({ market: 'batter-hits', playerId: 301, playerName: 'Below Half', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.49 }),
  ]);
  const board = await readResearchProductBoardV2(Object.freeze({
    readLatest: async (market: ResearchDisplayMarket) => market === 'batter-hits' ? hits : null,
  }));
  const baseline = board.categories[1]!;

  assert.equal(baseline.picks.length, 20);
  assert.ok(baseline.picks.every((pick) => pick.pWinGivenGrades > 0.5));
  assert.equal(baseline.picks.some((pick) => pick.player === 'Exactly Half'), false);
  assert.equal(baseline.picks.some((pick) => pick.player === 'Below Half'), false);
  assert.deepEqual(baseline.researchTopFive, baseline.picks.slice(0, 5));
});

test('research cards preserve context, side-aware last five, and explicit calibration states', async () => {
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
  assert.equal(shared.calibration.sampleSufficiency, 'sufficient');
  assert.equal(shared.calibration.calibrationAgreement, 'fail');
  assert.equal(shared.calibration.calculationMethod, 'primary-per-pick-heterogeneous');
  assert.equal(shared.calibration.predicted, 0.6554);
  assert.equal(shared.calibration.observed, 0.5412);
  assert.match(shared.calibration.message, /Sample SUFFICIENT · Agreement FAIL/u);
  assert.match(shared.calibration.message, /model 65\.5%, actual 54\.1%/u);

  const hits = board.categories[1]!.picks.find((pick) => pick.market === 'Hits');
  assert.ok(hits);
  assert.equal(hits.calibration.status, 'pending');
  assert.equal(hits.calibration.sampleSufficiency, 'unavailable');
  assert.equal(hits.calibration.calibrationAgreement, 'unavailable');
  assert.equal(hits.park, null);
  assert.equal(hits.teamImpliedRunTotal, null);
});

test('different per-market newest capture timestamps still contribute both markets', async () => {
  const hits = archive('batter-hits', [
    row({ market: 'batter-hits', playerId: 80, playerName: 'Hits Newest', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.72 }),
  ], '2099-08-18T20:00:00.000Z');
  const hhr = archive(BATTER_HHR_MARKET_KEY, [
    row({ market: BATTER_HHR_MARKET_KEY, playerId: 81, playerName: 'HHR Newest', offerType: 'baseline', side: 'higher', line: 1.5, p: 0.71 }),
  ], '2099-08-18T19:00:00.000Z');
  const board = await readResearchProductBoardV2(Object.freeze({
    readLatest: async (market: ResearchDisplayMarket) => market === 'batter-hits' ? hits : hhr,
  }));
  const baselinePlayers = board.categories[1]!.picks.map((pick) => pick.player);

  assert.deepEqual(board.sourceMarkets, ['batter-hits', BATTER_HHR_MARKET_KEY]);
  assert.equal(board.capturedAt, '2099-08-18T20:00:00.000Z');
  assert.ok(baselinePlayers.includes('Hits Newest'));
  assert.ok(baselinePlayers.includes('HHR Newest'));
});

test('research board excludes commenced rows and preserves each archived line and side after product classification', async () => {
  const futureBaseline = row({ market: 'batter-hits', playerId: 90, playerName: 'Future', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.20 });
  const future = row({ market: 'batter-hits', playerId: 90, playerName: 'Future', offerType: 'alternate', side: 'lower', line: 2.5, p: 0.91 });
  const passed = row({ market: 'batter-hits', playerId: 91, playerName: 'Passed', offerType: 'alternate', side: 'higher', line: 0.5, p: 0.99, eventCommenceTime: '2000-01-01T00:00:00.000Z' });
  const newest = archive('batter-hits', [futureBaseline, future, passed]);
  const board = await readResearchProductBoardV2(Object.freeze({
    readLatest: async (market: ResearchDisplayMarket) => market === 'batter-hits' ? newest : null,
  }));
  const displayed = board.categories.flatMap((category) => category.picks);
  const baseline = board.categories[1]!;
  const altline = board.categories[2]!;

  assert.equal(displayed.some((pick) => pick.player === 'Passed'), false);
  assert.ok(displayed.some((pick) => pick.player === 'Future'));
  assert.equal(baseline.picks.some((pick) => pick.player === 'Future'), false);
  assert.equal(altline.picks.some((pick) => pick.player === 'Future'), true);
  for (const pick of displayed.filter((value) => value.player === 'Future')) {
    assert.equal(pick.postedLine, future.postedLine);
    assert.equal(pick.selectedSide, future.selectedSide);
  }
});

test('High Probability Altline requires a different line with a unique same-capture baseline', async () => {
  const hits = archive('batter-hits', [
    row({ market: 'batter-hits', playerId: 100, playerName: 'Verified Alt', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.20 }),
    row({ market: 'batter-hits', playerId: 100, playerName: 'Verified Alt', offerType: 'alternate', side: 'lower', line: 1.5, p: 0.80 }),
    row({ market: 'batter-hits', playerId: 101, playerName: 'Missing Baseline', offerType: 'alternate', side: 'lower', line: 1.5, p: 0.99 }),
    row({ market: 'batter-hits', playerId: 102, playerName: 'Ambiguous Baseline', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.20 }),
    row({ market: 'batter-hits', playerId: 102, playerName: 'Ambiguous Baseline', offerType: 'baseline', side: 'higher', line: 1.5, p: 0.21 }),
    row({ market: 'batter-hits', playerId: 102, playerName: 'Ambiguous Baseline', offerType: 'alternate', side: 'lower', line: 2.5, p: 0.98 }),
    row({ market: 'batter-hits', playerId: 103, playerName: 'Other Capture Baseline', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.20, captureKey: 'old-capture' }),
    row({ market: 'batter-hits', playerId: 103, playerName: 'Other Capture Baseline', offerType: 'alternate', side: 'lower', line: 1.5, p: 0.97, captureKey: 'new-capture' }),
  ]);
  const hhr = archive(BATTER_HHR_MARKET_KEY, [
    row({ market: BATTER_HHR_MARKET_KEY, playerId: 104, playerName: 'Same Line', offerType: 'baseline', side: 'higher', line: 1.5, p: 0.20 }),
    row({ market: BATTER_HHR_MARKET_KEY, playerId: 104, playerName: 'Same Line', offerType: 'alternate', side: 'lower', line: 1.5, p: 0.96 }),
  ]);
  const board = await readResearchProductBoardV2(Object.freeze({
    readLatest: async (market: ResearchDisplayMarket) => market === 'batter-hits' ? hits : hhr,
  }));
  const baseline = board.categories[1]!;
  const altline = board.categories[2]!;

  assert.deepEqual(altline.picks.map((pick) => pick.player), ['Verified Alt']);
  assert.equal(altline.picks[0]!.postedLine, 1.5);
  assert.equal(altline.picks[0]!.selectedSide, 'lower');
  assert.equal(altline.picks[0]!.pWinGivenGrades, 0.80);

  const sameLine = baseline.picks.find((pick) => pick.player === 'Same Line');
  assert.ok(sameLine);
  assert.equal(sameLine.postedLine, 1.5);
  assert.equal(sameLine.selectedSide, 'lower');
  assert.equal(sameLine.pWinGivenGrades, 0.96);

  assert.equal(altline.picks.some((pick) => pick.player === 'Missing Baseline'), false);
  assert.equal(altline.picks.some((pick) => pick.player === 'Ambiguous Baseline'), false);
  assert.equal(altline.picks.some((pick) => pick.player === 'Other Capture Baseline'), false);
  assert.equal(altline.picks.some((pick) => pick.player === 'Same Line'), false);
});
