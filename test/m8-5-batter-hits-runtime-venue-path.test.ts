import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeBallDontLieGamesSnapshot } from '../src/adapters/index.js';
import { connectFrozenBatterHitsProbabilityOutput } from '../src/composition/index.js';
import type { BatterHitsRuntimeObservation } from '../src/features/batter-hits/index.js';
import {
  M9_GAME_SOURCE_SNAPSHOT_SHA256,
  M9_GAMES_FIXTURE_PATH,
  M9_MATCHED_GAME_ID,
  M9_SOURCE_CAPTURED_AT,
  m9ObservationFor,
  m9Offer,
  m9PregameBoard,
  m9ReadJson,
} from './helpers/m9-batter-hits-final-runtime-fixture.js';
import { m9FinalGameEnvironmentResolutionInput } from './helpers/m9-final-probability-resolution.js';

interface MutableGamesFixture {
  data: Array<Record<string, unknown>>;
  meta: Record<string, unknown>;
}

function readRawGames(): MutableGamesFixture {
  return m9ReadJson(M9_GAMES_FIXTURE_PATH) as MutableGamesFixture;
}

function matchedGame(games: MutableGamesFixture): Record<string, unknown> {
  const game = games.data.find((row) => row['id'] === M9_MATCHED_GAME_ID);
  assert.ok(game);
  return game;
}

function observationWithoutVenue(
  offer: Parameters<typeof m9ObservationFor>[0],
): BatterHitsRuntimeObservation {
  const { venue: _venue, ...observation } = m9ObservationFor(offer);
  return Object.freeze(observation);
}

test('exact provider venue survives BALLDONTLIE normalization byte-for-byte', () => {
  const games = readRawGames();
  const exactVenue = '  Exact Provider Venue  ';
  matchedGame(games)['venue'] = exactVenue;

  const normalized = normalizeBallDontLieGamesSnapshot({
    rawGamesSnapshot: games,
    sourceCapturedAt: M9_SOURCE_CAPTURED_AT,
    sourceSnapshotSha256: M9_GAME_SOURCE_SNAPSHOT_SHA256,
  });
  const game = normalized.games.find(
    (candidate) => candidate.providerGameId === M9_MATCHED_GAME_ID,
  );
  assert.ok(game);
  assert.equal(game.venue, exactVenue);
});

test('surrounding whitespace and null bytes fail closed through final runtime composition', async () => {
  for (const invalidVenue of [' Truist Park ', 'Truist\0Park']) {
    const games = readRawGames();
    matchedGame(games)['venue'] = invalidVenue;
    const board = m9PregameBoard(games);
    const offer = m9Offer(board, 'Gavin Sheets', 'baseline', 0.5, 'higher');

    await assert.rejects(
      connectFrozenBatterHitsProbabilityOutput({
        pregameBoard: board,
        offer,
        observation: observationWithoutVenue(offer),
        gameEnvironmentResolutionInput:
          await m9FinalGameEnvironmentResolutionInput(offer),
      }),
      /runtime observation venue/u,
    );
  }
});

test('an absent provider venue leaves D_final unchanged because park remains not applied', async () => {
  const withVenueBoard = m9PregameBoard();
  const withoutVenueGames = readRawGames();
  delete matchedGame(withoutVenueGames)['venue'];
  const withoutVenueBoard = m9PregameBoard(withoutVenueGames);

  const withVenueOffer = m9Offer(
    withVenueBoard,
    'Gavin Sheets',
    'baseline',
    0.5,
    'higher',
  );
  const withoutVenueOffer = m9Offer(
    withoutVenueBoard,
    'Gavin Sheets',
    'baseline',
    0.5,
    'higher',
  );
  assert.equal(
    withVenueBoard.providerVenueByGameId[String(M9_MATCHED_GAME_ID)],
    'Truist Park',
  );
  assert.equal(
    withoutVenueBoard.providerVenueByGameId[String(M9_MATCHED_GAME_ID)],
    undefined,
  );

  const [withVenue, withoutVenue] = await Promise.all([
    connectFrozenBatterHitsProbabilityOutput({
      pregameBoard: withVenueBoard,
      offer: withVenueOffer,
      observation: observationWithoutVenue(withVenueOffer),
      gameEnvironmentResolutionInput:
        await m9FinalGameEnvironmentResolutionInput(withVenueOffer),
    }),
    connectFrozenBatterHitsProbabilityOutput({
      pregameBoard: withoutVenueBoard,
      offer: withoutVenueOffer,
      observation: observationWithoutVenue(withoutVenueOffer),
      gameEnvironmentResolutionInput:
        await m9FinalGameEnvironmentResolutionInput(withoutVenueOffer),
    }),
  ]);

  assert.deepEqual(withVenue.distribution, withoutVenue.distribution);
  assert.deepEqual(
    withVenue.candidate.statisticDistribution,
    withoutVenue.candidate.statisticDistribution,
  );
  assert.equal(
    withVenue.finalEvaluation.finalDistributionSha256,
    withoutVenue.finalEvaluation.finalDistributionSha256,
  );
});
