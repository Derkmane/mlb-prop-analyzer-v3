import assert from 'node:assert/strict';
import test from 'node:test';

import { decideBoardRun } from '../scripts/m9-capture-controller.mjs';

const RUN_STARTED_AT = '2026-08-19T16:00:00.000Z';

const events = Object.freeze([
  Object.freeze({
    eventId: 'started',
    commenceTimeUtc: '2026-08-19T15:59:00.000Z',
    homeTeamName: 'Started Home',
    awayTeamName: 'Started Away',
  }),
  Object.freeze({
    eventId: 'recovery',
    commenceTimeUtc: '2026-08-19T16:30:00.000Z',
    homeTeamName: 'Recovery Home',
    awayTeamName: 'Recovery Away',
  }),
  Object.freeze({
    eventId: 'normal',
    commenceTimeUtc: '2026-08-19T17:20:00.000Z',
    homeTeamName: 'Normal Home',
    awayTeamName: 'Normal Away',
  }),
  Object.freeze({
    eventId: 'later',
    commenceTimeUtc: '2026-08-20T00:40:00.000Z',
    homeTeamName: 'Later Home',
    awayTeamName: 'Later Away',
  }),
  Object.freeze({
    eventId: 'covered',
    commenceTimeUtc: '2026-08-20T01:10:00.000Z',
    homeTeamName: 'Covered Home',
    awayTeamName: 'Covered Away',
  }),
]);

const coveredIdentity = 'covered@2026-08-20T01:10:00.000Z';

test('default capture mode preserves the existing scheduled-window decisions', () => {
  const result = decideBoardRun({
    events,
    coveredGameIdentities: [coveredIdentity],
    runStartedAt: RUN_STARTED_AT,
  });
  assert.equal(result.decision, 'CAPTURE');
  assert.deepEqual(
    result.evaluations.map((row) => [row.eventId, row.classification]),
    [
      ['started', 'STARTED'],
      ['recovery', 'RECOVERY'],
      ['normal', 'NORMAL'],
      ['later', 'OUTSIDE_WINDOW'],
      ['covered', 'COVERED'],
    ],
  );
  assert.deepEqual(
    result.claimedGames.map((row) => row.eventId),
    ['recovery', 'normal'],
  );
});

test('explicit user-projection mode claims every uncovered pregame game but never started or covered games', () => {
  const result = decideBoardRun({
    events,
    coveredGameIdentities: [coveredIdentity],
    runStartedAt: RUN_STARTED_AT,
    captureAllPregame: true,
  });
  assert.equal(result.decision, 'CAPTURE');
  assert.deepEqual(
    result.evaluations.map((row) => [row.eventId, row.classification]),
    [
      ['started', 'STARTED'],
      ['recovery', 'USER_PROJECTION'],
      ['normal', 'USER_PROJECTION'],
      ['later', 'USER_PROJECTION'],
      ['covered', 'COVERED'],
    ],
  );
  assert.deepEqual(
    result.claimedGames.map((row) => row.eventId),
    ['recovery', 'normal', 'later'],
  );
});
