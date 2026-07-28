import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyBallDontLieTerminalPa,
  normalizeBallDontLieTerminalPa,
  rawBallDontLiePlateAppearanceSchema,
  type RawBallDontLiePlateAppearance,
} from '../src/adapters/providers/balldontlie/index.js';

const sourceSnapshotSha256 = 'a'.repeat(64);

function plateAppearance(
  result: string | null,
  overrides: Partial<RawBallDontLiePlateAppearance> = {},
): RawBallDontLiePlateAppearance {
  return rawBallDontLiePlateAppearanceSchema.parse({
    batter_id: 551,
    pitcher_id: 971,
    inning: 1,
    half_inning: 'top',
    pa_number: 1,
    outs: 1,
    batter_side: 'L',
    pitcher_hand: 'R',
    result,
    is_ball_in_play_out: false,
    runner_on_first: false,
    runner_on_second: false,
    runner_on_third: false,
    pitches: [
      {
        balls: 0,
        strikes: 0,
        description: null,
        pitch_call_code: null,
        pitch_type: null,
      },
    ],
    ...overrides,
  });
}

function mappingInput(
  result: string | null,
  overrides: Partial<RawBallDontLiePlateAppearance> = {},
): unknown {
  return {
    plateAppearance: plateAppearance(result, overrides),
    providerGameId: 5057771,
    sourceSnapshotSha256,
  };
}

test('raw evidence accepts observed nullable pitch metadata and a present null result', () => {
  const nullablePitch = plateAppearance('Strikeout');
  assert.equal(nullablePitch.pitches[0]?.pitch_type, null);
  assert.equal(nullablePitch.pitches[0]?.description, null);
  assert.equal(nullablePitch.pitches[0]?.pitch_call_code, null);

  const missingTerminalResult = plateAppearance(null);
  assert.equal(missingTerminalResult.result, null);

  const absentResult = { ...missingTerminalResult } as Record<string, unknown>;
  delete absentResult.result;
  assert.equal(rawBallDontLiePlateAppearanceSchema.safeParse(absentResult).success, false);
});

test('direct terminal classification does not depend on optional pitch metadata', () => {
  const classified = classifyBallDontLieTerminalPa(mappingInput('Strikeout'));
  assert.equal(classified.status, 'classified-terminal');
  if (classified.status !== 'classified-terminal') {
    return;
  }

  assert.equal(classified.terminalPa.terminalCategory, 'K');
  assert.equal(classified.overallOutcomeEligible, true);
  assert.equal(classified.platoonEligible, true);

  const normalized = normalizeBallDontLieTerminalPa(mappingInput('Strikeout'));
  assert.equal(normalized.status, 'normalized');
  if (normalized.status === 'normalized') {
    assert.equal(normalized.terminalPa.terminalCategory, 'K');
  }
});

test('unrecognized pitcher handedness preserves the outcome but fails platoon readiness', () => {
  const input = mappingInput('Home Run', { pitcher_hand: 'S' });
  const classified = classifyBallDontLieTerminalPa(input);

  assert.equal(classified.status, 'classified-terminal');
  if (classified.status !== 'classified-terminal') {
    return;
  }

  assert.equal(classified.terminalPa.terminalCategory, 'HR');
  assert.equal(classified.terminalPa.rawPitcherHand, 'S');
  assert.equal(classified.terminalPa.pitcherHand, null);
  assert.equal(classified.overallOutcomeEligible, true);
  assert.equal(classified.platoonEligible, false);

  assert.deepEqual(normalizeBallDontLieTerminalPa(input), {
    status: 'rejected',
    rawResult: 'Home Run',
    reason: 'malformed-input',
  });
});

test('missing, unknown, and context-dependent results remain explicit and unresolved', () => {
  assert.deepEqual(classifyBallDontLieTerminalPa(mappingInput(null)), {
    status: 'unresolved',
    rawResult: null,
    reason: 'missing-result',
  });

  assert.deepEqual(
    classifyBallDontLieTerminalPa(mappingInput('Future Provider Result')),
    {
      status: 'unresolved',
      rawResult: 'Future Provider Result',
      reason: 'unknown-result',
    },
  );

  assert.deepEqual(
    classifyBallDontLieTerminalPa(mappingInput('Fielders Choice')),
    {
      status: 'unresolved',
      rawResult: 'Fielders Choice',
      reason: 'context-required',
    },
  );
});
