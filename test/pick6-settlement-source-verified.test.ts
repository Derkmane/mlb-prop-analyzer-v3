import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  readResearchProductBoardV2,
  type ResearchDisplayArchive,
  type ResearchDisplayArchiveRepository,
  type ResearchDisplayMarket,
  type ResearchDisplayRow,
} from '../src/application/index.js';
import { normalizeOddsApiBatterHitsBoard } from '../src/adapters/providers/the-odds-api/index.js';
import { SETTLEMENT_REGISTRY } from '../src/composition/registries.js';
import {
  BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY,
  BATTER_HHR_ALTERNATE_PROVIDER_MARKET_KEY,
  BATTER_HHR_MARKET_KEY,
} from '../src/features/batter-hhr/manifest.js';
import {
  BATTER_HHR_PICK6_SETTLEMENT_RULE_VERSION,
} from '../src/features/batter-hhr/contracts.js';
import { normalizeOddsApiBatterHhrCapture } from '../src/features/batter-hhr/normalized-board-offer.js';
import {
  BATTER_HITS_PICK6_SETTLEMENT_RULE_VERSION,
} from '../src/features/batter-hits/settlement.js';

const fixture = JSON.parse(
  readFileSync('fixtures/sanitized/the-odds-api/pick6-draftkings-ladder-v1.json', 'utf8'),
) as any;
const SOURCE_VERIFIED_AT = '2026-08-25T21:03:38Z';
const FUTURE_CAPTURED_AT = '2099-08-25T20:00:00.000Z';
const FUTURE_GAME_TIME = '2099-08-25T22:35:00.000Z';

function playerIdentitiesForEvent(event: any) {
  const names = new Set<string>();
  for (const bookmaker of event.bookmakers ?? []) {
    for (const market of bookmaker.markets ?? []) {
      if (market.key !== 'batter_hits' && market.key !== 'batter_hits_alternate') continue;
      for (const outcome of market.outcomes ?? []) names.add(outcome.description);
    }
  }
  return Object.freeze([...names].sort().map((name, index) => Object.freeze({
    providerEventId: event.id,
    offerPlayerName: name,
    providerGameId: 99_001,
    providerPlayerId: index + 1,
    providerTeamId: 800 + (index % 2),
    playerName: name,
    teamName: index % 2 === 0 ? event.home_team : event.away_team,
  })));
}

function pick6ResearchRow(input: Readonly<{
  playerId: number;
  playerName: string;
  offerType: 'baseline' | 'alternate';
  side: 'higher' | 'lower';
  line: number;
  p: number;
}>): ResearchDisplayRow {
  return Object.freeze({
    market: 'batter-hits',
    captureKey: 'pick6-research-capture',
    capturedAt: FUTURE_CAPTURED_AT,
    modelVersion: 'm8-5-batter-hits-successor-freeze-v1',
    distributionBuilderVersion: 'm9-batter-hits-runtime-distribution-v1',
    boardSource: 'pick6',
    providerBookmakerKey: 'pick6',
    providerRegion: 'us_dfs',
    settlementRuleVersion: BATTER_HITS_PICK6_SETTLEMENT_RULE_VERSION,
    providerEventId: `pick6-event-${input.playerId}`,
    providerGameId: 10_000 + input.playerId,
    providerPlayerId: input.playerId,
    playerName: input.playerName,
    teamName: 'Home Club',
    homeTeamName: 'Home Club',
    awayTeamName: 'Away Club',
    eventCommenceTime: FUTURE_GAME_TIME,
    providerMarketKey: input.offerType === 'baseline' ? 'batter_hits' : 'batter_hits_alternate',
    offerType: input.offerType,
    selectedSide: input.side,
    postedLine: input.line,
    americanPrice: null,
    multiplier: 1,
    pWin: input.p,
    pLoss: 1 - input.p,
    pVoid: 0,
    pWinGivenGrades: input.p,
    lineupStatus: 'confirmed',
    analysisContext: Object.freeze({
      expectedPlateAppearances: 4.2,
      lineupSlot: 2,
      batterSide: 'L',
      opposingStarterHand: 'R',
      venue: null,
      teamImpliedRunTotal: null,
    }),
    enrichment: Object.freeze({
      lastFiveGames: Object.freeze({ games: Object.freeze([]) }),
      opposingStarter: Object.freeze({
        name: 'Starter Name',
        throwingHand: 'R',
        era: 3.5,
        last10: Object.freeze({ starts: 10, inningsPitched: '60.0', strikeouts: 60, whip: 1.1 }),
      }),
    }),
  });
}

function hitsArchive(rows: readonly ResearchDisplayRow[]): ResearchDisplayArchive {
  return Object.freeze({
    market: 'batter-hits',
    captureKey: 'pick6-research-capture',
    capturedAt: FUTURE_CAPTURED_AT,
    modelVersion: 'm8-5-batter-hits-successor-freeze-v1',
    distributionBuilderVersion: 'm9-batter-hits-runtime-distribution-v1',
    rows: Object.freeze([...rows]),
  });
}

test('sourceVerifiedAt Pick6 settlement registrations are source-specific and non-retroactive evidence', () => {
  const pick6Rules = SETTLEMENT_REGISTRY.rules.filter((rule) => rule.boardSource === 'pick6');
  assert.equal(pick6Rules.length, 2);
  assert.deepEqual(
    pick6Rules.map((rule) => rule.version).sort(),
    [BATTER_HHR_PICK6_SETTLEMENT_RULE_VERSION, BATTER_HITS_PICK6_SETTLEMENT_RULE_VERSION].sort(),
  );
  for (const rule of pick6Rules) {
    assert.ok('sourceVerifiedAt' in rule);
    assert.equal(rule.sourceVerifiedAt, SOURCE_VERIFIED_AT);
    assert.equal('effectiveDate' in rule, false);
    assert.equal('sourcePublishedAt' in rule, false);
    assert.match(rule.tieHandling, /void/u);
    assert.ok(rule.voidConditions.some((condition) => condition.includes('More full-game hitter pick')));
  }
});

test('Pick6 Hits provider normalization carries the verified Pick6 settlement version through every rung', () => {
  const event = structuredClone(fixture.draftkings.response);
  const bookmaker = event.bookmakers?.[0];
  assert.ok(bookmaker);
  bookmaker.key = 'pick6';
  bookmaker.title = 'Pick6';

  const board = normalizeOddsApiBatterHitsBoard({
    boardSource: 'pick6',
    rawEventSnapshot: event,
    sourceSnapshotSha256: fixture.draftkings.responseSha256,
    sourceCapturedAt: fixture.capturedAt,
    playerIdentities: playerIdentitiesForEvent(event),
  });

  assert.equal(board.settlementRuleVersion, BATTER_HITS_PICK6_SETTLEMENT_RULE_VERSION);
  assert.ok(board.offers.length > 0);
  assert.equal(
    board.offers.every((offer) => offer.settlementRuleVersion === BATTER_HITS_PICK6_SETTLEMENT_RULE_VERSION),
    true,
  );
  assert.equal(board.offers.some((offer) => offer.providerMarketKey === 'batter_hits_alternate'), true);
});

test('Pick6 HHR normalization carries the verified Pick6 settlement version through baseline and alternate rungs', () => {
  const capture = {
    captureVersion: 1,
    request: {
      provider: 'The Odds API',
      region: 'us_dfs',
      bookmaker: 'pick6',
      marketKeys: [BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY, BATTER_HHR_ALTERNATE_PROVIDER_MARKET_KEY],
    },
    sourceSnapshotSha256: 'b'.repeat(64),
    response: {
      id: 'pick6-hhr-event',
      commence_time: FUTURE_GAME_TIME,
      home_team: 'Home Club',
      away_team: 'Away Club',
      bookmakers: [{
        key: 'pick6',
        markets: [
          {
            key: BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY,
            last_update: FUTURE_CAPTURED_AT,
            outcomes: [{ name: 'Over', description: 'Pick6 HHR Hitter', point: 1.5, multiplier: 1.1 }],
          },
          {
            key: BATTER_HHR_ALTERNATE_PROVIDER_MARKET_KEY,
            last_update: FUTURE_CAPTURED_AT,
            outcomes: [{ name: 'Under', description: 'Pick6 HHR Hitter', point: 2.5, multiplier: 1.1 }],
          },
        ],
      }],
    },
  };

  const offers = normalizeOddsApiBatterHhrCapture(capture);
  assert.equal(offers.length, 2);
  assert.equal(offers.every((offer) => offer.boardSource === 'pick6'), true);
  assert.equal(offers.every((offer) => offer.settlementRuleVersion === BATTER_HHR_PICK6_SETTLEMENT_RULE_VERSION), true);
  assert.deepEqual(offers.map((offer) => offer.offerType), ['baseline', 'alternate']);
});

test('Pick6 Lower can enter research ranking while Pick6 Higher stays fail-closed for unmodeled Pardon eligibility', async () => {
  const archive = hitsArchive([
    pick6ResearchRow({ playerId: 1, playerName: 'Pick6 Lower', offerType: 'baseline', side: 'lower', line: 0.5, p: 0.20 }),
    pick6ResearchRow({ playerId: 1, playerName: 'Pick6 Lower', offerType: 'alternate', side: 'lower', line: 1.5, p: 0.82 }),
    pick6ResearchRow({ playerId: 2, playerName: 'Pick6 Higher', offerType: 'baseline', side: 'higher', line: 0.5, p: 0.20 }),
    pick6ResearchRow({ playerId: 2, playerName: 'Pick6 Higher', offerType: 'alternate', side: 'higher', line: 1.5, p: 0.94 }),
  ]);
  const repository: ResearchDisplayArchiveRepository = Object.freeze({
    readLatest: async (market: ResearchDisplayMarket) => market === 'batter-hits' ? archive : null,
  });

  const board = await readResearchProductBoardV2(repository);
  const displayed = board.categories.flatMap((category) => category.picks);
  const altline = board.categories.find((category) => category.title === 'High Probability Altline Props');
  assert.ok(altline);

  assert.equal(displayed.some((pick) => pick.player === 'Pick6 Higher'), false);
  assert.equal(altline.picks.some((pick) => pick.player === 'Pick6 Lower'), true);
  const lower = altline.picks.find((pick) => pick.player === 'Pick6 Lower');
  assert.ok(lower);
  assert.equal(lower.boardSource, 'pick6');
  assert.equal(lower.providerRegion, 'us_dfs');
  assert.equal(lower.settlementRuleVersion, BATTER_HITS_PICK6_SETTLEMENT_RULE_VERSION);
  assert.equal(lower.selectedSide, 'lower');
  assert.equal(lower.postedLine, 1.5);
});
