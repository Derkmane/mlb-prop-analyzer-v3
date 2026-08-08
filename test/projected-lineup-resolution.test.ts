import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROJECTED_LINEUP_EXCLUSION_REASON,
  resolveProjectedLineupSlot,
  type CurrentLineupSlotEvidence,
  type HistoricalCompletedLineupStartEvidence,
} from '../src/game/index.js';

const targetGameDateUtc = '2026-08-08T19:05:00.000Z';

function current(
  lineupSlot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
): CurrentLineupSlotEvidence {
  return Object.freeze({
    gameId: 'today',
    playerId: '42',
    teamId: '7',
    lineupSlot,
    sourceCapturedAt: '2026-08-08T14:00:00.000Z',
    sourceSnapshotSha256: 'a'.repeat(64),
  });
}

function historical(
  gameId: string,
  gameDateUtc: string,
  lineupSlot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
): HistoricalCompletedLineupStartEvidence {
  return Object.freeze({
    gameId,
    gameDateUtc,
    playerId: '42',
    teamId: '7',
    lineupSlot,
    sourceCapturedAt: '2026-08-08T14:01:00.000Z',
    sourceSnapshotSha256: 'b'.repeat(64),
  });
}

test('current-game slot wins and is confirmed even when historical evidence exists', () => {
  const result = resolveProjectedLineupSlot({
    targetGameId: 'today',
    targetGameDateUtc,
    playerId: '42',
    teamId: '7',
    currentGameEvidence: [current(3)],
    historicalCompletedStarts: [
      historical('yesterday', '2026-08-07T19:05:00.000Z', 1),
    ],
  });

  assert.equal(result.resolved, true);
  if (!result.resolved) return;
  assert.equal(result.lineupStatus, 'confirmed');
  assert.equal(result.lineupSlot, 3);
  assert.equal(result.sourceGameId, 'today');
});

test('latest strictly-earlier completed start inside 14 days supplies the projected slot', () => {
  const result = resolveProjectedLineupSlot({
    targetGameId: 'today',
    targetGameDateUtc,
    playerId: '42',
    teamId: '7',
    currentGameEvidence: [],
    historicalCompletedStarts: [
      historical('older', '2026-08-03T19:05:00.000Z', 6),
      historical('latest', '2026-08-07T23:05:00.000Z', 2),
      historical('future', '2026-08-08T20:05:00.000Z', 9),
      historical('too-old', '2026-07-24T19:04:59.000Z', 8),
    ],
  });

  assert.equal(result.resolved, true);
  if (!result.resolved) return;
  assert.equal(result.lineupStatus, 'projected');
  assert.equal(result.lineupSlot, 2);
  assert.equal(result.sourceGameId, 'latest');
});

test('no current or in-lookback prior start fails closed with the authorized exclusion', () => {
  const result = resolveProjectedLineupSlot({
    targetGameId: 'today',
    targetGameDateUtc,
    playerId: '42',
    teamId: '7',
    currentGameEvidence: [],
    historicalCompletedStarts: [
      historical('too-old', '2026-07-24T19:04:59.000Z', 8),
    ],
  });

  assert.deepEqual(result, {
    resolved: false,
    reason: PROJECTED_LINEUP_EXCLUSION_REASON,
  });
});

test('ambiguous current-game evidence fails closed instead of selecting or defaulting a slot', () => {
  assert.throws(
    () =>
      resolveProjectedLineupSlot({
        targetGameId: 'today',
        targetGameDateUtc,
        playerId: '42',
        teamId: '7',
        currentGameEvidence: [current(3), current(4)],
        historicalCompletedStarts: [],
      }),
    /Current lineup evidence is ambiguous/u,
  );
});
