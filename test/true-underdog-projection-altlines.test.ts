import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readResearchProductBoardV2,
  type ResearchDisplayArchive,
  type ResearchDisplayArchiveRepository,
  type ResearchDisplayMarket,
  type ResearchDisplayRow,
} from '../src/application/index.js';
import { BATTER_HHR_MARKET_KEY } from '../src/features/batter-hhr/index.js';

const CAPTURED_AT = '2099-08-24T20:00:00.000Z';
const GAME_TIME = '2099-08-24T23:00:00.000Z';

function row(input: Readonly<{
  playerId: number;
  playerName: string;
  providerMarketKey: 'batter_hits_runs_rbis' | 'batter_hits_runs_rbis_alternate';
  rawOfferType: 'baseline' | 'alternate';
  line: number;
  p: number;
}>): ResearchDisplayRow {
  return Object.freeze({
    market: BATTER_HHR_MARKET_KEY,
    captureKey: 'true-altline-test-capture',
    capturedAt: CAPTURED_AT,
    modelVersion: 'm11-batter-hhr-direct-composite-v2',
    distributionBuilderVersion: 'm11-batter-hhr-negative-binomial-v1',
    providerEventId: 'event-true-altline',
    providerGameId: 8800,
    providerPlayerId: input.playerId,
    playerName: input.playerName,
    teamName: 'Home Club',
    homeTeamName: 'Home Club',
    awayTeamName: 'Away Club',
    eventCommenceTime: GAME_TIME,
    providerMarketKey: input.providerMarketKey,
    offerType: input.rawOfferType,
    selectedSide: 'lower',
    postedLine: input.line,
    americanPrice: -110,
    multiplier: input.providerMarketKey.endsWith('_alternate') ? 0.9 : 1,
    pWin: input.p,
    pLoss: 1 - input.p,
    pVoid: 0,
    pWinGivenGrades: input.p,
    lineupStatus: 'confirmed',
    analysisContext: Object.freeze({
      expectedPlateAppearances: 4.2,
      lineupSlot: 5,
      batterSide: 'R',
      opposingStarterHand: 'R',
      venue: 'Test Park',
      teamImpliedRunTotal: 4.5,
    }),
    enrichment: null,
  });
}

function repository(rows: readonly ResearchDisplayRow[]): ResearchDisplayArchiveRepository {
  const archive: ResearchDisplayArchive = Object.freeze({
    market: BATTER_HHR_MARKET_KEY,
    captureKey: 'true-altline-test-capture',
    capturedAt: CAPTURED_AT,
    modelVersion: 'm11-batter-hhr-direct-composite-v2',
    distributionBuilderVersion: 'm11-batter-hhr-negative-binomial-v1',
    rows: Object.freeze([...rows]),
  });
  return Object.freeze({
    readLatest: async (market: ResearchDisplayMarket) =>
      market === BATTER_HHR_MARKET_KEY ? archive : null,
  });
}

test('product Altline requires a numerically different posted projection, not an _alternate multiplier bucket', async () => {
  const board = await readResearchProductBoardV2(repository([
    row({
      playerId: 1,
      playerName: 'Multiplier Only',
      providerMarketKey: 'batter_hits_runs_rbis_alternate',
      rawOfferType: 'alternate',
      line: 1.5,
      p: 0.71,
    }),
    row({
      playerId: 2,
      playerName: 'True Alt',
      providerMarketKey: 'batter_hits_runs_rbis',
      rawOfferType: 'baseline',
      line: 1.5,
      p: 0.61,
    }),
    row({
      playerId: 2,
      playerName: 'True Alt',
      providerMarketKey: 'batter_hits_runs_rbis_alternate',
      rawOfferType: 'alternate',
      line: 2.5,
      p: 0.74,
    }),
    row({
      playerId: 3,
      playerName: 'Unresolved Ladder',
      providerMarketKey: 'batter_hits_runs_rbis_alternate',
      rawOfferType: 'alternate',
      line: 0.5,
      p: 0.80,
    }),
    row({
      playerId: 3,
      playerName: 'Unresolved Ladder',
      providerMarketKey: 'batter_hits_runs_rbis_alternate',
      rawOfferType: 'alternate',
      line: 1.5,
      p: 0.79,
    }),
  ]));

  const baseline = board.categories.find((category) => category.title === 'High Probability Baseline Props');
  const altline = board.categories.find((category) => category.title === 'High Probability Altline Props');
  assert.ok(baseline);
  assert.ok(altline);

  assert.equal(baseline.picks.some((pick) => pick.player === 'Multiplier Only'), false);
  assert.equal(altline.picks.some((pick) => pick.player === 'Multiplier Only'), false);

  const trueBaseline = baseline.picks.find((pick) => pick.player === 'True Alt');
  const trueAltline = altline.picks.find((pick) => pick.player === 'True Alt');
  assert.equal(trueBaseline?.postedLine, 1.5);
  assert.equal(trueBaseline?.offerType, 'baseline');
  assert.equal(trueAltline?.postedLine, 2.5);
  assert.equal(trueAltline?.offerType, 'alternate');

  assert.equal(baseline.picks.some((pick) => pick.player === 'Unresolved Ladder'), false);
  assert.equal(altline.picks.some((pick) => pick.player === 'Unresolved Ladder'), false);
});