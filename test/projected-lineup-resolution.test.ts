import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROJECTED_LINEUP_EXCLUSION_REASON,
  resolveProjectedLineupSlot,
  type CurrentLineupSlotEvidence,
  type ProjectedLineupSlotEvidence,
} from '../src/game/index.js';

function current(
  lineupSlot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
): CurrentLineupSlotEvidence {
  return Object.freeze({
    gameId: 'bdl-today',
    playerId: '42',
    teamId: '7',
    lineupSlot,
    sourceCapturedAt: '2026-08-15T18:00:00.000Z',
    sourceSnapshotSha256: 'a'.repeat(64),
  });
}

function projected(
  lineupSlot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
): ProjectedLineupSlotEvidence {
  return Object.freeze({
    sourceGameId: '822941',
    sourceGameDateUtc: '2026-08-15T22:10:00.000Z',
    playerId: '42',
    teamId: '7',
    lineupSlot,
    sourceCapturedAt: '2026-08-15T18:00:01.000Z',
    sourceSnapshotSha256: 'b'.repeat(64),
  });
}

test('current BALLDONTLIE slot wins and is confirmed when projected evidence also exists', () => {
  const result = resolveProjectedLineupSlot({
    targetGameId: 'bdl-today',
    playerId: '42',
    teamId: '7',
    currentGameEvidence: [current(3)],
    projectedGameEvidence: [projected(2)],
  });

  assert.equal(result.resolved, true);
  if (!result.resolved) return;
  assert.equal(result.lineupStatus, 'confirmed');
  assert.equal(result.lineupSlot, 3);
  assert.equal(result.sourceGameId, 'bdl-today');
  assert.equal(result.sourceGameDateUtc, null);
});

test('projected source supplies the slot only when current BALLDONTLIE evidence is absent', () => {
  const result = resolveProjectedLineupSlot({
    targetGameId: 'bdl-today',
    playerId: '42',
    teamId: '7',
    currentGameEvidence: [],
    projectedGameEvidence: [projected(2)],
  });

  assert.equal(result.resolved, true);
  if (!result.resolved) return;
  assert.equal(result.lineupStatus, 'projected');
  assert.equal(result.lineupSlot, 2);
  assert.equal(result.sourceGameId, '822941');
  assert.equal(result.sourceGameDateUtc, '2026-08-15T22:10:00.000Z');
});

test('no current or projected slot fails closed instead of inheriting a prior-game slot', () => {
  const result = resolveProjectedLineupSlot({
    targetGameId: 'bdl-today',
    playerId: '42',
    teamId: '7',
    currentGameEvidence: [],
    projectedGameEvidence: [],
  });

  assert.deepEqual(result, {
    resolved: false,
    reason: PROJECTED_LINEUP_EXCLUSION_REASON,
  });
});

test('ambiguous current-game evidence fails closed', () => {
  assert.throws(
    () =>
      resolveProjectedLineupSlot({
        targetGameId: 'bdl-today',
        playerId: '42',
        teamId: '7',
        currentGameEvidence: [current(3), current(4)],
        projectedGameEvidence: [projected(2)],
      }),
    /Current lineup evidence is ambiguous/u,
  );
});

test('ambiguous projected evidence fails closed', () => {
  assert.throws(
    () =>
      resolveProjectedLineupSlot({
        targetGameId: 'bdl-today',
        playerId: '42',
        teamId: '7',
        currentGameEvidence: [],
        projectedGameEvidence: [projected(2), projected(5)],
      }),
    /Projected lineup evidence is ambiguous/u,
  );
});
