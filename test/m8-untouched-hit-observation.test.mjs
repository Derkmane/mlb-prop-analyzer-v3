import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildM8UntouchedGameObservations,
  gradeM8UntouchedPlateAppearance,
} from '../scripts/m8-untouched-hit-observation-utils.mjs';

function raw(number, half, batterId, pitcherId, result = 'Groundout') {
  return {
    pa_number: number,
    half_inning: half,
    batter_id: batterId,
    pitcher_id: pitcherId,
    batter_side: batterId % 2 === 0 ? 'L' : 'R',
    pitcher_hand: pitcherId % 2 === 0 ? 'R' : 'L',
    result,
  };
}

function classified(rawRow, terminalCategory) {
  return {
    status: 'classified-terminal',
    terminalPa: { terminalCategory },
  };
}

function gradeTerminal(number, half, batterId, pitcherId, category = 'BIP_OUT') {
  return gradeM8UntouchedPlateAppearance({
    rawPlateAppearance: raw(number, half, batterId, pitcherId),
    classification: classified(null, category),
  });
}

test('grades official hits, ignores baserunning-only rows, and retains verified contextual non-hits', () => {
  const hitRaw = raw(1, 'top', 10, 20, 'Single');
  const hit = gradeM8UntouchedPlateAppearance({
    rawPlateAppearance: hitRaw,
    classification: classified(hitRaw, '1B'),
  });
  assert.equal(hit.kind, 'terminal');
  assert.equal(hit.hit, true);

  const caughtStealing = gradeM8UntouchedPlateAppearance({
    rawPlateAppearance: raw(2, 'top', 11, 20, 'Caught Stealing 2B'),
    classification: { status: 'baserunning-only' },
  });
  assert.equal(caughtStealing.kind, 'ignore-baserunning');

  const forceout = gradeM8UntouchedPlateAppearance({
    rawPlateAppearance: raw(3, 'top', 12, 20, 'Forceout'),
    classification: {
      status: 'unresolved',
      reason: 'context-required',
      rawResult: 'Forceout',
    },
  });
  assert.equal(forceout.kind, 'terminal');
  assert.equal(forceout.hit, false);

  const unknown = gradeM8UntouchedPlateAppearance({
    rawPlateAppearance: raw(4, 'top', 13, 20, 'Unknown'),
    classification: {
      status: 'unresolved',
      reason: 'unknown-result',
      rawResult: 'Unknown',
    },
  });
  assert.equal(unknown.kind, 'reject');
});

test('reconstructs the starting nine without letting an ignored baserunning row shift slots', () => {
  const rows = [];
  for (const [half, pitcherId, offset] of [
    ['top', 100, 0],
    ['bottom', 200, 1000],
  ]) {
    for (let index = 0; index < 18; index += 1) {
      const slot = index % 9;
      const batterId = offset + slot + 1;
      rows.push(
        gradeTerminal(
          index + 1 + (half === 'bottom' ? 100 : 0),
          half,
          batterId,
          pitcherId,
          index === 0 ? '1B' : 'BIP_OUT',
        ),
      );
    }
  }
  rows.splice(
    5,
    0,
    gradeM8UntouchedPlateAppearance({
      rawPlateAppearance: raw(99, 'top', 99, 100, 'Caught Stealing 2B'),
      classification: { status: 'baserunning-only' },
    }),
  );

  const result = buildM8UntouchedGameObservations({
    observedDate: '2026-07-06',
    gameId: 500,
    gradedRows: rows,
  });
  assert.equal(result.exclusions.length, 0);
  assert.equal(result.observations.length, 18);
  assert.equal(result.ignoredBaserunningRowCount, 1);
  const awaySlotOne = result.observations.find(
    (observation) => observation.side === 'away' && observation.lineupSlot === 1,
  );
  assert.equal(awaySlotOne.batterId, 1);
  assert.equal(awaySlotOne.actualHits, 1);
  assert.equal(awaySlotOne.observedStarterPlateAppearances, 2);
});

test('rejects a five-slot simultaneous replacement phase shift', () => {
  const rows = [];
  for (const [half, pitcherId, offset] of [
    ['top', 100, 0],
    ['bottom', 200, 1000],
  ]) {
    for (let index = 0; index < 18; index += 1) {
      const slot = index % 9;
      const secondCycle = index >= 9;
      const batterId =
        half === 'top' && secondCycle && slot < 5
          ? offset + 100 + slot
          : offset + slot + 1;
      rows.push(
        gradeTerminal(
          index + 1 + (half === 'bottom' ? 100 : 0),
          half,
          batterId,
          pitcherId,
        ),
      );
    }
  }
  const result = buildM8UntouchedGameObservations({
    observedDate: '2026-07-07',
    gameId: 501,
    gradedRows: rows,
  });
  assert.ok(
    result.exclusions.some(
      (exclusion) => exclusion.reason === 'simultaneous-multi-slot-phase-shift',
    ),
  );
  assert.equal(
    result.observations.filter((observation) => observation.side === 'away').length,
    0,
  );
});
