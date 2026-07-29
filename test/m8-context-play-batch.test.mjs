import assert from 'node:assert/strict';
import test from 'node:test';

import { selectM8ContextPlayCaptureBatch } from '../scripts/m8-context-play-batch-utils.mjs';

function games(...ids) {
  return Object.freeze(
    ids.map((gameId) => Object.freeze({ gameId, contextRowCount: 1 })),
  );
}

test('selects only the requested number of first missing games in plan order', () => {
  const plannedGames = games(10, 20, 30, 40, 50);
  const result = selectM8ContextPlayCaptureBatch({
    plannedGames,
    verifiedGameIds: [10, 30],
    maxNewGames: 2,
  });

  assert.deepEqual(
    result.selectedGames.map((game) => game.gameId),
    [20, 40],
  );
  assert.equal(result.planGameCount, 5);
  assert.equal(result.verifiedBeforeCount, 2);
  assert.equal(result.missingBeforeCount, 3);
  assert.equal(result.selectedNewGameCount, 2);
  assert.equal(result.remainingAfterBatchCount, 1);
  assert.equal(result.completesPlan, false);
  assert.deepEqual(
    plannedGames.map((game) => game.gameId),
    [10, 20, 30, 40, 50],
  );
});

test('zero batch limit selects every missing game', () => {
  const result = selectM8ContextPlayCaptureBatch({
    plannedGames: games(1, 2, 3, 4),
    verifiedGameIds: [2],
    maxNewGames: 0,
  });

  assert.deepEqual(
    result.selectedGames.map((game) => game.gameId),
    [1, 3, 4],
  );
  assert.equal(result.selectedNewGameCount, 3);
  assert.equal(result.remainingAfterBatchCount, 0);
  assert.equal(result.completesPlan, true);
});

test('marks completion only when the selected batch covers every remaining game', () => {
  const partial = selectM8ContextPlayCaptureBatch({
    plannedGames: games(1, 2, 3),
    verifiedGameIds: [1],
    maxNewGames: 1,
  });
  assert.equal(partial.completesPlan, false);
  assert.equal(partial.remainingAfterBatchCount, 1);

  const complete = selectM8ContextPlayCaptureBatch({
    plannedGames: games(1, 2, 3),
    verifiedGameIds: [1, 2],
    maxNewGames: 1,
  });
  assert.deepEqual(
    complete.selectedGames.map((game) => game.gameId),
    [3],
  );
  assert.equal(complete.completesPlan, true);
  assert.equal(complete.remainingAfterBatchCount, 0);

  const alreadyComplete = selectM8ContextPlayCaptureBatch({
    plannedGames: games(1, 2, 3),
    verifiedGameIds: [1, 2, 3],
    maxNewGames: 1,
  });
  assert.equal(alreadyComplete.selectedNewGameCount, 0);
  assert.equal(alreadyComplete.completesPlan, true);
});

test('rejects duplicate, unplanned, and invalid game identities or limits', () => {
  assert.throws(
    () =>
      selectM8ContextPlayCaptureBatch({
        plannedGames: games(1, 1),
        verifiedGameIds: [],
        maxNewGames: 1,
      }),
    /duplicate planned gameId: 1/,
  );

  assert.throws(
    () =>
      selectM8ContextPlayCaptureBatch({
        plannedGames: games(1, 2),
        verifiedGameIds: [3],
        maxNewGames: 1,
      }),
    /verified gameId 3 is not in the capture plan/,
  );

  assert.throws(
    () =>
      selectM8ContextPlayCaptureBatch({
        plannedGames: games(1, 2),
        verifiedGameIds: [1, 1],
        maxNewGames: 1,
      }),
    /duplicate verified gameId: 1/,
  );

  assert.throws(
    () =>
      selectM8ContextPlayCaptureBatch({
        plannedGames: games(1, 2),
        verifiedGameIds: [],
        maxNewGames: -1,
      }),
    /maxNewGames must be a non-negative integer/,
  );
});
