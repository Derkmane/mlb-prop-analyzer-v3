import assert from 'node:assert/strict';
import test from 'node:test';

import {
  M8_UNTOUCHED_MINIMUM_ACTUAL_HITS_ABOVE_25,
  M8_UNTOUCHED_MINIMUM_INCLUDED_STARTER_OBSERVATIONS,
  evaluateM8UntouchedEvidenceThresholds,
} from '../scripts/m8-batter-hits-untouched-evaluation-utils.mjs';
import {
  M8_UNTOUCHED_ACCESS_OPENS_AT,
  assertM8UntouchedAccessOpen,
} from '../scripts/m8-untouched-access-gate-utils.mjs';

function observations({ count, actualHitsAbove25Count }) {
  return Array.from({ length: count }, (_, index) => ({
    actualHits: index < actualHitsAbove25Count ? 3 : 0,
  }));
}

test('fails closed before the August 5 Chicago access instant', () => {
  assert.throws(
    () =>
      assertM8UntouchedAccessOpen({
        now: '2026-08-04T23:59:59-05:00',
      }),
    /remains sealed.*No untouched files were read/u,
  );
});

test('opens exactly after the August 4 sealed period ends', () => {
  const result = assertM8UntouchedAccessOpen({
    now: M8_UNTOUCHED_ACCESS_OPENS_AT,
  });
  assert.equal(result.openedAt, '2026-08-05T00:00:00-05:00');
  assert.equal(result.evaluatedAt, '2026-08-05T05:00:00.000Z');
});

test('rejects an invalid access timestamp', () => {
  assert.throws(
    () => assertM8UntouchedAccessOpen({ now: 'not-a-date' }),
    /valid timestamp/u,
  );
});

test('passes only when both frozen evidence thresholds are met', () => {
  const result = evaluateM8UntouchedEvidenceThresholds(
    observations({
      count: M8_UNTOUCHED_MINIMUM_INCLUDED_STARTER_OBSERVATIONS,
      actualHitsAbove25Count: M8_UNTOUCHED_MINIMUM_ACTUAL_HITS_ABOVE_25,
    }),
  );
  assert.deepEqual(result, {
    minimumIncludedStarterObservations: 900,
    includedStarterObservationCount: 900,
    includedStarterObservationsPass: true,
    minimumActualHitsAbove25: 35,
    actualHitsAbove25Count: 35,
    actualHitsAbove25Pass: true,
    allRequiredEvidencePass: true,
  });
});

test('fails closed when either evidence threshold is short', () => {
  const tooFewObservations = evaluateM8UntouchedEvidenceThresholds(
    observations({ count: 899, actualHitsAbove25Count: 35 }),
  );
  assert.equal(tooFewObservations.includedStarterObservationsPass, false);
  assert.equal(tooFewObservations.allRequiredEvidencePass, false);

  const tooFewThreeHitOutcomes = evaluateM8UntouchedEvidenceThresholds(
    observations({ count: 900, actualHitsAbove25Count: 34 }),
  );
  assert.equal(tooFewThreeHitOutcomes.actualHitsAbove25Pass, false);
  assert.equal(tooFewThreeHitOutcomes.allRequiredEvidencePass, false);
});
