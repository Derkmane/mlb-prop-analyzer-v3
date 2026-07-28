import assert from 'node:assert/strict';
import test from 'node:test';

import { segmentVerifiedM8ContextPlaySequence } from '../scripts/m8-context-play-signature-audit-run-utils.mjs';

function play({
  order,
  type,
  batterId = null,
  pitcherId = null,
  inning = 1,
  inningType = 'Top',
  gameId = 5057781,
  text = null,
}) {
  return {
    game_id: gameId,
    order,
    type,
    text,
    inning,
    inning_type: inningType,
    outs: 0,
    batter_id: batterId,
    pitcher_id: pitcherId,
  };
}

test('closes a missing-end batter block at the next verified batter start', () => {
  const segments = segmentVerifiedM8ContextPlaySequence({
    gameId: 5057781,
    plays: [
      play({ order: 1, type: 'Start Inning' }),
      play({ order: 2, type: 'Start Batter/Pitcher', batterId: 101, pitcherId: 201 }),
      play({ order: 3, type: 'Force Out', batterId: 101, pitcherId: 201 }),
      play({ order: 4, type: 'Play Result', batterId: 101, pitcherId: 201 }),
      play({ order: 5, type: 'Start Batter/Pitcher', batterId: 102, pitcherId: 201 }),
      play({ order: 6, type: 'Single', batterId: 102, pitcherId: 201 }),
      play({ order: 7, type: 'End Batter/Pitcher', batterId: 102, pitcherId: 201 }),
      play({ order: 8, type: 'End Inning', inningType: 'Mid' }),
    ],
  });

  assert.equal(segments.length, 2);
  assert.deepEqual(
    segments.map((segment) => ({
      batterId: segment.batterId,
      startOrder: segment.startOrder,
      endOrder: segment.endOrder,
      endBoundary: segment.endBoundary,
    })),
    [
      { batterId: 101, startOrder: 2, endOrder: 4, endBoundary: 'next-start' },
      { batterId: 102, startOrder: 5, endOrder: 7, endBoundary: 'inning-boundary' },
    ],
  );
  assert.equal(
    segments[0].plays.some((value) => value.type === 'Start Batter/Pitcher' && value.order === 5),
    false,
  );
});

test('closes the final missing-end batter block at capture end without inventing a result', () => {
  const segments = segmentVerifiedM8ContextPlaySequence({
    gameId: 5057781,
    plays: [
      play({ order: 10, type: 'Start Batter/Pitcher', batterId: 103, pitcherId: 202 }),
      play({ order: 11, type: 'Ball', batterId: 103, pitcherId: 202 }),
    ],
  });

  assert.equal(segments.length, 1);
  assert.equal(segments[0].startOrder, 10);
  assert.equal(segments[0].endOrder, 11);
  assert.equal(segments[0].endBoundary, 'capture-end');
  assert.deepEqual(
    segments[0].plays.map((value) => value.type),
    ['Start Batter/Pitcher', 'Ball'],
  );
});

test('closes a batter block before non-batter inning markers enter its evidence', () => {
  const segments = segmentVerifiedM8ContextPlaySequence({
    gameId: 5057781,
    plays: [
      play({ order: 20, type: 'Start Batter/Pitcher', batterId: 104, pitcherId: 203 }),
      play({ order: 21, type: 'Play Result', batterId: 104, pitcherId: 203 }),
      play({ order: 22, type: 'End Inning', inningType: 'Mid' }),
      play({ order: 23, type: 'Start Inning', inning: 2, inningType: 'Bottom' }),
    ],
  });

  assert.equal(segments.length, 1);
  assert.equal(segments[0].endBoundary, 'inning-boundary');
  assert.equal(segments[0].endOrder, 21);
  assert.equal(
    segments[0].plays.some((value) => value.type === 'End Inning'),
    false,
  );
});
