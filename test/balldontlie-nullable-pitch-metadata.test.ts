import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeBallDontLieTerminalPa,
  rawBallDontLiePlateAppearanceSchema,
} from '../src/adapters/providers/balldontlie/index.js';

const sourceSnapshotSha256 = 'a'.repeat(64);

function observedStrikeoutRow() {
  return {
    batter_id: 551,
    pitcher_id: 971,
    inning: 1,
    half_inning: 'top',
    pa_number: 1,
    outs: 1,
    batter_side: 'L',
    pitcher_hand: 'R',
    result: 'Strikeout',
    is_ball_in_play_out: false,
    runner_on_first: false,
    runner_on_second: false,
    runner_on_third: false,
    pitches: [
      {
        pitch_number: 1,
        balls: 0,
        strikes: 0,
        pitch_call: 'S',
        description: null,
        pitch_call_code: null,
        call_name: null,
        pitch_type_code: 'SI',
        pitch_type: 'Sinker',
      },
    ],
  };
}

test('accepts observed nullable pitch metadata and maps the direct Strikeout result to K', () => {
  const row = observedStrikeoutRow();
  const parsed = rawBallDontLiePlateAppearanceSchema.safeParse(row);

  assert.equal(parsed.success, true);

  const result = normalizeBallDontLieTerminalPa({
    plateAppearance: row,
    providerGameId: 5057771,
    sourceSnapshotSha256,
  });

  assert.equal(result.status, 'normalized');
  if (result.status !== 'normalized') {
    return;
  }
  assert.equal(result.terminalPa.rawResult, 'Strikeout');
  assert.equal(result.terminalPa.terminalCategory, 'K');
  assert.equal(result.terminalPa.providerGameId, 5057771);
  assert.equal(result.terminalPa.providerPaNumber, 1);
});

test('nullable pitch metadata does not weaken required terminal-result validation', () => {
  const row = { ...observedStrikeoutRow(), result: '' };

  assert.equal(rawBallDontLiePlateAppearanceSchema.safeParse(row).success, false);
  assert.deepEqual(
    normalizeBallDontLieTerminalPa({
      plateAppearance: row,
      providerGameId: 5057771,
      sourceSnapshotSha256,
    }),
    {
      status: 'rejected',
      rawResult: '',
      reason: 'malformed-input',
    },
  );
});
