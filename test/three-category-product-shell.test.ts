import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRODUCT_DISPLAY_BOARD_VERSION,
  PRODUCT_EMPTY_CATEGORY_REASON,
  readLatestHhrDisplayUiBoard,
  type HhrDisplayArchive,
  type HhrDisplayArchiveRepository,
} from '../src/application/index.js';
import {
  HHR_DISPLAY_APP_JS,
  renderHhrDisplayAppPage,
  renderHhrDisplayLoginPage,
} from '../src/adapters/ui/hhr-display-page.js';

const CAPTURED_AT = '2026-08-18T20:00:00.000Z';

function row(input: Readonly<{
  rank: number;
  playerId: number;
  playerName: string;
  postedLine: 0.5 | 2.5;
  selectedSide: 'higher' | 'lower';
}>): HhrDisplayArchive['rows'][number] {
  return Object.freeze({
    rank: input.rank,
    providerEventId: `event-${input.playerId}`,
    providerGameId: 100,
    providerPlayerId: input.playerId,
    providerTeamId: 10,
    playerName: input.playerName,
    teamName: 'Home Club',
    homeTeamName: 'Home Club',
    awayTeamName: 'Away Club',
    eventCommenceTime: '2026-08-18T22:35:00.000Z',
    baseMarketKey: 'batter-hits-runs-rbis',
    providerMarketKey: 'batter_hits_runs_rbis_alternate',
    marketLabel: 'Hits + Runs + RBIs',
    offerType: 'alternate',
    settlementStatistic: 'hits+runs+rbis',
    selectedSide: input.selectedSide,
    postedLine: input.postedLine,
    americanPrice: -110,
    multiplier: 1.0,
    pWin: 0.6,
    pLoss: 0.4,
    pVoid: 0,
    pWinGivenGrades: 0.6,
    lineupStatus: 'confirmed',
  });
}

function repository(): HhrDisplayArchiveRepository {
  const archive: HhrDisplayArchive = Object.freeze({
    captureKey: 'capture-v1',
    capturedAt: CAPTURED_AT,
    modelVersion: 'archived-hhr-model',
    distributionBuilderVersion: 'archived-hhr-builder',
    rows: Object.freeze([
      row({ rank: 1, playerId: 1, playerName: 'Lower Player', postedLine: 2.5, selectedSide: 'lower' }),
      row({ rank: 2, playerId: 2, playerName: 'Higher Player', postedLine: 0.5, selectedSide: 'higher' }),
    ]),
    enrichmentByGamePlayerKey: Object.freeze({}),
  });
  return Object.freeze({ readLatest: async () => archive });
}

test('product board exposes exactly the three canonical categories and fails closed with no production-authorized market', async () => {
  const board = await readLatestHhrDisplayUiBoard(repository());

  assert.equal(board.productBoardVersion, PRODUCT_DISPLAY_BOARD_VERSION);
  assert.deepEqual(
    board.categories.map((category) => category.title),
    [
      'Opportunity Miner Favorites',
      'High Probability Baseline Props',
      'High Probability Altline Props',
    ],
  );
  assert.deepEqual(
    board.categories.map((category) => category.categoryId),
    [
      'opportunity-miner-favorites',
      'high-probability-baseline-props',
      'high-probability-altline-props',
    ],
  );
  for (const category of board.categories) {
    assert.deepEqual(category.picks, []);
    assert.equal(category.emptyState, PRODUCT_EMPTY_CATEGORY_REASON);
  }
});

test('HHR rows remain archived research evidence and never enter production category picks', async () => {
  const board = await readLatestHhrDisplayUiBoard(repository());

  assert.equal(board.archivedEvidence.market, 'Hits + Runs + RBIs');
  assert.equal(board.archivedEvidence.productionValidated, false);
  assert.equal(board.archivedEvidence.rankingEnabled, false);
  assert.equal(board.archivedEvidence.capturedAt, CAPTURED_AT);
  assert.match(board.archivedEvidence.notice, /not production-validated/u);
  assert.match(board.archivedEvidence.notice, /not current production picks/u);
  assert.deepEqual(
    board.archivedEvidence.groups.map((group) => ({
      title: group.title,
      market: group.market,
      offerType: group.offerType,
      players: group.picks.map((pick) => pick.player),
    })),
    [
      {
        title: '2.5 Lower alternate evidence',
        market: 'Hits + Runs + RBIs',
        offerType: 'alternate',
        players: ['Lower Player'],
      },
      {
        title: '0.5 Higher alternate evidence',
        market: 'Hits + Runs + RBIs',
        offerType: 'alternate',
        players: ['Higher Player'],
      },
    ],
  );
  assert.equal(board.categories.flatMap((category) => category.picks).length, 0);
});

test('product UI is category-first, human-readable, labels slate freshness, and contains no browser ranking or settlement implementation', () => {
  const page = renderHhrDisplayAppPage();
  const login = renderHhrDisplayLoginPage();

  assert.match(page, /MLB Prop Analyzer/u);
  assert.match(page, /Prop categories/u);
  assert.match(page, /Archived research evidence/u);
  assert.match(page, /id="capture-freshness"/u);
  assert.match(login, /MLB Prop Analyzer/u);

  for (const forbidden of ['M8', 'M9', 'M11', 'Family B']) {
    assert.doesNotMatch(page, new RegExp(forbidden, 'u'));
    assert.doesNotMatch(login, new RegExp(forbidden, 'u'));
  }

  assert.match(HHR_DISPLAY_APP_JS, /timeZone: 'America\/Chicago'/u);
  assert.match(HHR_DISPLAY_APP_JS, /capturedSlateDate === currentSlateDate \? 'TODAY' : 'STALE'/u);
  assert.match(HHR_DISPLAY_APP_JS, /Today’s saved board loaded/u);
  assert.match(HHR_DISPLAY_APP_JS, /STALE saved board/u);
  assert.doesNotMatch(HHR_DISPLAY_APP_JS, /\.sort\s*\(/u);
  assert.doesNotMatch(HHR_DISPLAY_APP_JS, /compareSettlementResultsForRanking/u);
  assert.doesNotMatch(HHR_DISPLAY_APP_JS, /settleObserved|settleHigher|settleLower/u);
  assert.doesNotMatch(HHR_DISPLAY_APP_JS, /pWinGivenGrades\s*[+\-*/]/u);

  for (const label of [
    'P(Win)',
    'P(Loss)',
    'P(Void)',
    'P(Win | grades)',
    'Offer type',
    'Captured',
    'Alternate',
    'Higher',
    'Lower',
  ]) {
    assert.ok(HHR_DISPLAY_APP_JS.includes(label));
  }
});
