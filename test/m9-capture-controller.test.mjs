import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertBoardSnapshotBeforeClaimedGames,
  decideBoardRun,
} from '../scripts/m9-capture-controller.mjs';

const RUN = '2026-08-13T16:00:00.000Z';

function event(id, minutes) {
  return Object.freeze({
    eventId: id,
    commenceTimeUtc: new Date(
      Date.parse(RUN) + minutes * 60_000,
    ).toISOString(),
    homeTeamName: `Home ${id}`,
    awayTeamName: `Away ${id}`,
  });
}

function classification(minutes, covered = []) {
  return decideBoardRun({
    events: [event('game', minutes)],
    coveredGameIdentities: covered,
    runStartedAt: RUN,
  });
}

test('capture controller honors 110/40 normal boundaries and under-40 recovery', () => {
  assert.equal(classification(110).claimedGames[0].classification, 'NORMAL');
  assert.equal(classification(40).claimedGames[0].classification, 'NORMAL');
  assert.equal(
    classification(39.999).claimedGames[0].classification,
    'RECOVERY',
  );
});

test('capture controller no-ops covered, beyond-window, and started games', () => {
  const coveredIdentity = `game@${event('game', 80).commenceTimeUtc}`;
  assert.equal(classification(80, [coveredIdentity]).decision, 'NOOP');
  assert.equal(classification(110.001).decision, 'NOOP');
  assert.equal(classification(0).decision, 'NOOP');
  assert.equal(classification(-1).evaluations[0].classification, 'STARTED');
});

test('capture controller has no daily cap and allows later same-day games to qualify after earlier coverage', () => {
  const early = event('early', 60);
  const later = event('later', 105);
  const first = decideBoardRun({
    events: [early, later],
    runStartedAt: RUN,
  });
  assert.equal(first.claimedGames.length, 2);

  const coveredEarly = `${early.eventId}@${early.commenceTimeUtc}`;
  const second = decideBoardRun({
    events: [early, later],
    coveredGameIdentities: [coveredEarly],
    runStartedAt: RUN,
  });
  assert.deepEqual(
    second.claimedGames.map((row) => row.eventId),
    ['later'],
  );
});

test('30-minute cadence leaves one additional normal-band look after a failed first qualifying run', () => {
  for (const firstMinutes of [80.001, 95, 110]) {
    const nextMinutes = firstMinutes - 30;
    assert.ok(nextMinutes > 50 && nextMinutes <= 80);
    assert.equal(
      classification(nextMinutes).claimedGames[0].classification,
      'NORMAL',
    );
  }
});

test('late first snapshot fails closed at or after claimed first pitch', () => {
  const claimed = classification(40).claimedGames;

  assert.doesNotThrow(() =>
    assertBoardSnapshotBeforeClaimedGames(
      new Date(Date.parse(claimed[0].commenceTimeUtc) - 1).toISOString(),
      claimed,
    ),
  );

  assert.throws(
    () =>
      assertBoardSnapshotBeforeClaimedGames(
        claimed[0].commenceTimeUtc,
        claimed,
      ),
    /at or after first pitch/u,
  );
});
