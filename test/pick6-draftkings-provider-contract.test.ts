import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { classifyProjectionLineOffersV1 } from '../src/application/projection-line-classification.js';
import {
  normalizeOddsApiBatterHitsBoard,
  rawOddsApiEventOddsSchema,
} from '../src/adapters/providers/the-odds-api/index.js';

const fixture = JSON.parse(
  readFileSync(
    'fixtures/sanitized/the-odds-api/pick6-draftkings-ladder-v1.json',
    'utf8',
  ),
) as any;

function playerIdentitiesForEvent(event: any) {
  const names = new Set<string>();
  for (const bookmaker of event.bookmakers ?? []) {
    for (const market of bookmaker.markets ?? []) {
      if (market.key !== 'batter_hits' && market.key !== 'batter_hits_alternate') continue;
      for (const outcome of market.outcomes ?? []) names.add(outcome.description);
    }
  }
  return Object.freeze(
    [...names].sort().map((name, index) =>
      Object.freeze({
        providerEventId: event.id,
        offerPlayerName: name,
        providerGameId: 90_001,
        providerPlayerId: index + 1,
        providerTeamId: 700 + (index % 2),
        playerName: name,
        teamName: index % 2 === 0 ? event.home_team : event.away_team,
      }),
    ),
  );
}

test('verified Pick6 and DraftKings fixture satisfies the evidence-backed raw contract', () => {
  const pick6 = rawOddsApiEventOddsSchema.parse(fixture.pick6.response);
  const draftkings = rawOddsApiEventOddsSchema.parse(fixture.draftkings.response);

  assert.equal(pick6.bookmakers.length, 0);
  assert.equal(draftkings.bookmakers.length, 1);
  const outcomes = draftkings.bookmakers[0]?.markets.flatMap((market) => market.outcomes) ?? [];
  assert.equal(outcomes.some((outcome) => outcome.multiplier === null), true);
  assert.equal(outcomes.some((outcome) => outcome.sid === undefined), true);
});

test('DraftKings Batter Hits normalization preserves source identity and every captured side/rung without standard-book inference', () => {
  const event = fixture.draftkings.response;
  const board = normalizeOddsApiBatterHitsBoard({
    boardSource: 'draftkings',
    rawEventSnapshot: event,
    sourceSnapshotSha256: fixture.draftkings.responseSha256,
    sourceCapturedAt: fixture.capturedAt,
    playerIdentities: playerIdentitiesForEvent(event),
  });

  const expectedOfferCount = (event.bookmakers?.[0]?.markets ?? [])
    .filter((market: any) =>
      market.key === 'batter_hits' || market.key === 'batter_hits_alternate')
    .reduce(
      (sum: number, market: any) => sum + (market.outcomes?.length ?? 0),
      0,
    );

  assert.equal(board.boardSource, 'draftkings');
  assert.equal(board.providerBookmakerKey, 'draftkings');
  assert.equal(board.providerRegion, 'us');
  assert.equal(board.offers.length, expectedOfferCount);
  assert.equal(board.rejectedOffers.length, 0);
  assert.equal(board.offers.every((offer) => offer.boardSource === 'draftkings'), true);
  assert.equal(board.offers.every((offer) => offer.providerRegion === 'us'), true);
  assert.equal(board.offers.some((offer) => offer.multiplier === null), true);
  assert.equal(
    board.offers.some(
      (offer) => offer.providerMarketKey === 'batter_hits_alternate' && offer.selectedSide === 'lower',
    ),
    false,
  );
});

test('temporarily unavailable Pick6 is represented as an empty source board rather than substituted', () => {
  const event = fixture.pick6.response;
  const board = normalizeOddsApiBatterHitsBoard({
    boardSource: 'pick6',
    rawEventSnapshot: event,
    sourceSnapshotSha256: fixture.pick6.responseSha256,
    sourceCapturedAt: fixture.capturedAt,
    playerIdentities: [],
  });

  assert.equal(board.boardSource, 'pick6');
  assert.equal(board.providerBookmakerKey, 'pick6');
  assert.equal(board.providerRegion, 'us_dfs');
  assert.deepEqual(board.offers, []);
  assert.deepEqual(board.rejectedOffers, []);
});

test('legacy Underdog fixtures normalize only as explicitly non-active historical evidence', () => {
  const legacy = rawOddsApiEventOddsSchema.parse({
    id: 'legacy-event',
    sport_key: 'baseball_mlb',
    sport_title: 'MLB',
    commence_time: '2026-07-23T20:00:00Z',
    home_team: 'Home',
    away_team: 'Away',
    bookmakers: [{
      key: 'underdog',
      title: 'Underdog',
      markets: [{
        key: 'batter_hits',
        last_update: '2026-07-23T19:00:00Z',
        outcomes: [{ name: 'Over', description: 'Legacy Hitter', price: 100, point: 0.5, multiplier: 1 }],
      }],
    }],
  });
  const board = normalizeOddsApiBatterHitsBoard({
    rawEventSnapshot: legacy,
    sourceSnapshotSha256: 'a'.repeat(64),
    sourceCapturedAt: '2026-07-23T19:00:00Z',
    playerIdentities: [{
      providerEventId: 'legacy-event',
      offerPlayerName: 'Legacy Hitter',
      providerGameId: 1,
      providerPlayerId: 1,
      providerTeamId: 1,
      playerName: 'Legacy Hitter',
      teamName: 'Home',
    }],
  });

  assert.equal(board.boardSource, null);
  assert.equal(board.providerBookmakerKey, 'underdog');
  assert.equal(board.offers[0]?.boardSource, null);
});

test('product ladder classification requires a unique same-source base line', () => {
  const rows = [
    { source: 'draftkings', player: 'Alt Only', providerMarketKey: 'batter_hits_alternate', postedLine: 1.5 },
    { source: 'draftkings', player: 'Ladder', providerMarketKey: 'batter_hits', postedLine: 0.5 },
    { source: 'draftkings', player: 'Ladder', providerMarketKey: 'batter_hits_alternate', postedLine: 0.5 },
    { source: 'draftkings', player: 'Ladder', providerMarketKey: 'batter_hits_alternate', postedLine: 1.5 },
    { source: 'pick6', player: 'Ladder', providerMarketKey: 'batter_hits_alternate', postedLine: 2.5 },
  ] as const;

  const classified = classifyProjectionLineOffersV1(
    rows,
    (row) => `${row.source}:${row.player}`,
  );

  assert.equal(classified.has(rows[0]), false);
  assert.equal(classified.get(rows[1]), 'baseline');
  assert.equal(classified.get(rows[2]), 'baseline');
  assert.equal(classified.get(rows[3]), 'alternate');
  assert.equal(classified.has(rows[4]), false);
});
