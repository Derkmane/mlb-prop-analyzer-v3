import assert from 'node:assert/strict';
import test from 'node:test';

import { captureM9BatterHitsEventOdds } from '../scripts/archive-m9-batter-hits-board.mjs';
import { createM9ArchiveFunnel } from '../scripts/m9-board-archive-funnel-utils.mjs';

const CAPTURED_AT = '2026-08-25T21:35:15.751Z';
const EVENT_ID = 'event-empty-pick6-regression';

function sourceSnapshot(source) {
  const isPick6 = source === 'pick6';
  return Object.freeze({
    capturedAt: CAPTURED_AT,
    rawBody: Object.freeze({
      sha256: (isPick6 ? 'a' : 'b').repeat(64),
    }),
    parsedBody: Object.freeze({
      id: EVENT_ID,
      commence_time: '2026-08-25T23:00:00.000Z',
      home_team: 'Home Team',
      away_team: 'Away Team',
      bookmakers: isPick6
        ? Object.freeze([])
        : Object.freeze([
            Object.freeze({
              key: 'draftkings',
              markets: Object.freeze([
                Object.freeze({
                  key: 'batter_hits',
                  outcomes: Object.freeze([
                    Object.freeze({
                      description: 'Regression Player',
                      name: 'Over',
                      point: 0.5,
                    }),
                    Object.freeze({
                      description: 'Regression Player',
                      name: 'Under',
                      point: 0.5,
                    }),
                  ]),
                }),
              ]),
            }),
          ]),
    }),
  });
}

test('Hits replay accepts a valid empty Pick6 source and still consumes DraftKings', async () => {
  const providerSnapshots = [];
  const funnel = createM9ArchiveFunnel({
    captureTimestamp: CAPTURED_AT,
    dryRun: false,
  });
  const calls = [];

  const result = await captureM9BatterHitsEventOdds({
    eventId: EVENT_ID,
    oddsApiKey: 'test-secret',
    providerSnapshots,
    funnel,
    fetchOdds: async (request) => {
      calls.push(request.url.searchParams.get('bookmakers'));
      assert.equal(
        request.requireNonemptyRecords,
        false,
        'valid empty active-source event odds must remain no-offer evidence',
      );
      const bookmaker = request.url.searchParams.get('bookmakers');
      if (bookmaker === 'pick6') return sourceSnapshot('pick6');
      if (bookmaker === 'draftkings') return sourceSnapshot('draftkings');
      throw new Error(`unexpected bookmaker ${String(bookmaker)}`);
    },
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.exclusion, null);
  assert.equal(result.rawOffers.count, 2);
  assert.deepEqual(calls, ['pick6', 'draftkings']);
  assert.equal(providerSnapshots.length, 2);
  assert.deepEqual(
    result.sources.map((source) => [source.boardSource, source.rawOffers.count]),
    [
      ['pick6', 0],
      ['draftkings', 2],
    ],
  );
});


test('Hits replay rejects a malformed empty Pick6 event envelope before treating it as no offers', async () => {
  const providerSnapshots = [];
  const funnel = createM9ArchiveFunnel({
    captureTimestamp: CAPTURED_AT,
    dryRun: false,
  });
  const calls = [];

  const result = await captureM9BatterHitsEventOdds({
    eventId: EVENT_ID,
    oddsApiKey: 'test-secret',
    providerSnapshots,
    funnel,
    fetchOdds: async (request) => {
      const bookmaker = request.url.searchParams.get('bookmakers');
      calls.push(bookmaker);
      if (bookmaker !== 'pick6') {
        throw new Error('DraftKings must not be consumed after malformed Pick6 evidence.');
      }
      return Object.freeze({
        capturedAt: CAPTURED_AT,
        rawBody: Object.freeze({ sha256: 'c'.repeat(64) }),
        parsedBody: Object.freeze({ bookmakers: Object.freeze([]) }),
      });
    },
  });

  assert.equal(result.status, 'failed-closed');
  assert.equal(result.exclusion.reason, 'EVENT_ODDS_FAILED_CLOSED');
  assert.equal(result.exclusion.boardSource, 'pick6');
  assert.match(result.exclusion.detail, /event\.id must be a nonempty string/u);
  assert.deepEqual(calls, ['pick6']);
});
