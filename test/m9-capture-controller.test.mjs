import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertBoardSnapshotBeforeClaimedGames,
  coverageReceiptDecision,
  CURRENT_SLATE_BOOTSTRAP_MODE,
  decideBoardRun,
  shouldBootstrapCurrentSlate,
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

test('automatic bootstrap claims every still-pregame game on the current Chicago slate without claiming tomorrow', () => {
  const runStartedAt = '2026-08-27T15:00:00.000Z';
  const currentSlate = [
    Object.freeze({
      eventId: 'started-today',
      commenceTimeUtc: '2026-08-27T14:00:00.000Z',
      homeTeamName: 'Started Home',
      awayTeamName: 'Started Away',
    }),
    Object.freeze({
      eventId: 'far-today',
      commenceTimeUtc: '2026-08-28T00:10:00.000Z',
      homeTeamName: 'Far Home',
      awayTeamName: 'Far Away',
    }),
    Object.freeze({
      eventId: 'tomorrow',
      commenceTimeUtc: '2026-08-28T18:10:00.000Z',
      homeTeamName: 'Tomorrow Home',
      awayTeamName: 'Tomorrow Away',
    }),
  ];

  const result = decideBoardRun({
    events: currentSlate,
    coveredGameIdentities: [
      'far-today@2026-08-28T00:10:00.000Z',
    ],
    runStartedAt,
    captureCurrentSlate: true,
  });

  assert.equal(result.decision, 'CAPTURE');
  assert.deepEqual(
    result.evaluations.map((row) => [row.eventId, row.classification]),
    [
      ['started-today', 'STARTED'],
      ['far-today', CURRENT_SLATE_BOOTSTRAP_MODE],
      ['tomorrow', 'OUTSIDE_WINDOW'],
    ],
  );
  assert.deepEqual(
    result.claimedGames.map((row) => row.eventId),
    ['far-today'],
  );
});

test('automatic bootstrap is required until both display markets share a current Chicago-slate capture', () => {
  const runStartedAt = '2026-08-27T20:00:00.000Z';

  assert.equal(
    shouldBootstrapCurrentSlate({
      runStartedAt,
      hitsCapturedAt: '2026-08-27T00:27:31.148Z',
      hhrCapturedAt: '2026-08-27T00:27:31.148Z',
    }),
    true,
  );
  assert.equal(
    shouldBootstrapCurrentSlate({
      runStartedAt,
      hitsCapturedAt: '2026-08-27T15:30:00.000Z',
      hhrCapturedAt: '2026-08-27T15:30:00.000Z',
    }),
    false,
  );
  assert.equal(
    shouldBootstrapCurrentSlate({
      runStartedAt,
      hitsCapturedAt: '2026-08-27T15:30:00.000Z',
      hhrCapturedAt: '2026-08-27T15:31:00.000Z',
    }),
    true,
  );
  assert.equal(
    shouldBootstrapCurrentSlate({
      runStartedAt,
      hitsCapturedAt: null,
      hhrCapturedAt: null,
    }),
    true,
  );
  assert.throws(
    () =>
      shouldBootstrapCurrentSlate({
        runStartedAt,
        hitsCapturedAt: '2026-08-28T15:30:00.000Z',
        hhrCapturedAt: '2026-08-28T15:30:00.000Z',
      }),
    /future-dated/u,
  );
});

test('current-slate bootstrap does not mark games covered, preserving later schedule-window refreshes', () => {
  const claimedGames = Object.freeze([
    Object.freeze({
      eventId: 'game-1',
      gameIdentity: 'game-1@2026-08-27T23:00:00.000Z',
    }),
  ]);
  const rawCoverageDecision = Object.freeze({
    coveredEventIds: Object.freeze(['game-1']),
    deferredGames: Object.freeze([]),
  });

  const bootstrap = coverageReceiptDecision({
    captureMode: CURRENT_SLATE_BOOTSTRAP_MODE,
    claimedGames,
    coverageDecision: rawCoverageDecision,
  });
  assert.deepEqual(bootstrap.coveredEventIds, []);
  assert.deepEqual(bootstrap.deferredGames, [
    {
      eventId: 'game-1',
      gameIdentity: 'game-1@2026-08-27T23:00:00.000Z',
      reasons: ['current-slate-bootstrap-refresh'],
    },
  ]);

  assert.equal(
    coverageReceiptDecision({
      captureMode: 'SCHEDULE_WINDOW',
      claimedGames,
      coverageDecision: rawCoverageDecision,
    }),
    rawCoverageDecision,
  );
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
