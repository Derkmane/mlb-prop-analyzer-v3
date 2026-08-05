import assert from 'node:assert/strict';
import test from 'node:test';

import {
  batterHitsPlatoonPathForDeclaredHand,
  resolveBatterSideAgainstVerifiedStarter,
} from '../src/features/batter-hits/index.js';
import {
  m9ObservationFor,
  m9PregameBoard,
  m9ResolveBatterHandedness,
} from './helpers/m9-batter-hits-final-runtime-fixture.js';

test('a B/R hitter resolves against a verified starter while preserving the raw declaration', () => {
  const versusRight = m9ResolveBatterHandedness('B/R', 'R');
  assert.deepEqual(versusRight, {
    rawBatterBatsThrows: 'B/R',
    declaredBatterHand: 'B',
    batterSide: 'L',
  });
  assert.equal(
    batterHitsPlatoonPathForDeclaredHand(versusRight.declaredBatterHand),
    'coherent-overall',
  );

  const versusLeft = m9ResolveBatterHandedness('B/R', 'L');
  assert.deepEqual(versusLeft, {
    rawBatterBatsThrows: 'B/R',
    declaredBatterHand: 'B',
    batterSide: 'R',
  });
  assert.equal(resolveBatterSideAgainstVerifiedStarter('B', 'R'), 'L');
  assert.equal(resolveBatterSideAgainstVerifiedStarter('B', 'L'), 'R');
});

test('a switch hitter fails closed without a verified opposing starter hand', () => {
  assert.throws(
    () => m9ResolveBatterHandedness('B/R', undefined),
    /opposing starter hand must be explicit L or R/u,
  );
  assert.throws(
    () => m9ResolveBatterHandedness('B/R', '?'),
    /opposing starter hand must be explicit L or R/u,
  );
});

test('declared L and R hitters retain the existing resolved side and platoon path', () => {
  assert.deepEqual(m9ResolveBatterHandedness('L/R', 'R'), {
    rawBatterBatsThrows: 'L/R',
    declaredBatterHand: 'L',
    batterSide: 'L',
  });
  assert.deepEqual(m9ResolveBatterHandedness('R/R', 'L'), {
    rawBatterBatsThrows: 'R/R',
    declaredBatterHand: 'R',
    batterSide: 'R',
  });
  assert.equal(batterHitsPlatoonPathForDeclaredHand('L'), 'selected-platoon');
  assert.equal(batterHitsPlatoonPathForDeclaredHand('R'), 'selected-platoon');
});

test('the committed switch hitters normalize deterministically and remain on the frozen coherent path', () => {
  const board = m9PregameBoard();
  for (const playerName of ['Ozzie Albies', 'Luis Rengifo']) {
    const offer = board.offers.find((candidate) => candidate.playerName === playerName);
    assert.ok(offer);
    const first = m9ObservationFor(offer);
    const second = m9ObservationFor(offer);
    assert.deepEqual(first, second);
    assert.equal(first.rawBatterBatsThrows, 'B/R');
    assert.equal(first.declaredBatterHand, 'B');
    assert.equal(
      first.batterSide,
      first.opposingStarterHand === 'R' ? 'L' : 'R',
    );
    assert.equal(
      batterHitsPlatoonPathForDeclaredHand(first.declaredBatterHand),
      'coherent-overall',
    );
  }
});
