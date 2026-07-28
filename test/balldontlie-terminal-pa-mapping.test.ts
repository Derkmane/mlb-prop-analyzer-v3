import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  normalizeBallDontLieTerminalPa,
  type BallDontLieBatterDisposition,
  type RawBallDontLiePlateAppearance,
} from '../src/adapters/providers/balldontlie/index.js';
import type { TerminalPaCategory } from '../src/domain/terminal-pa.js';

const fixtureDir = path.resolve(
  'fixtures/sanitized/provider-capabilities/2026-07-23/terminal-pa',
);
const snapshotSha256 = 'a'.repeat(64);

function plateAppearance(
  result: string,
  finalPitchDescription = 'Ball In Play',
): RawBallDontLiePlateAppearance {
  return {
    batter_id: 545,
    batter_side: 'R',
    half_inning: 'top',
    inning: 1,
    is_ball_in_play_out: false,
    outs: 0,
    pa_number: 1,
    pitcher_hand: 'L',
    pitcher_id: 123,
    pitches: [
      {
        description: finalPitchDescription,
        pitch_call_code: 'X',
        pitch_type: 'Four-Seam Fastball',
        balls: 0,
        strikes: 0,
      },
    ],
    result,
    runner_on_first: false,
    runner_on_second: false,
    runner_on_third: false,
  };
}

function mappingInput(
  result: string,
  options: {
    readonly batterDisposition?: BallDontLieBatterDisposition;
    readonly finalPitchDescription?: string;
    readonly plateAppearanceOverrides?: Partial<RawBallDontLiePlateAppearance>;
  } = {},
): unknown {
  const input = {
    plateAppearance: {
      ...plateAppearance(
        result,
        options.finalPitchDescription ?? 'Ball In Play',
      ),
      ...options.plateAppearanceOverrides,
    },
    providerGameId: 5059159,
    sourceSnapshotSha256: snapshotSha256,
  };

  return options.batterDisposition === undefined
    ? input
    : { ...input, batterDisposition: options.batterDisposition };
}

test('verified direct BALLDONTLIE results map to exactly one canonical terminal category', () => {
  const cases: ReadonlyArray<readonly [string, TerminalPaCategory]> = [
    ['Strikeout', 'K'],
    ['Walk', 'UBB'],
    ['Intent Walk', 'IBB'],
    ['Hit By Pitch', 'HBP'],
    ['Single', '1B'],
    ['Double', '2B'],
    ['Triple', '3B'],
    ['Home Run', 'HR'],
    ['Field Error', 'ROE'],
    ['Sac Fly', 'SF'],
    ['Sac Bunt', 'SH'],
    ['Flyout', 'BIP_OUT'],
    ['Groundout', 'BIP_OUT'],
    ['Lineout', 'BIP_OUT'],
    ['Pop Out', 'BIP_OUT'],
    ['Bunt Groundout', 'BIP_OUT'],
    ['Bunt Pop Out', 'BIP_OUT'],
    ['GIDP', 'BIP_OUT'],
    ['Catcher Interference', 'CATCHER_INTERFERENCE'],
  ];

  for (const [rawResult, terminalCategory] of cases) {
    const result = normalizeBallDontLieTerminalPa(mappingInput(rawResult));
    assert.equal(result.status, 'normalized', rawResult);
    if (result.status !== 'normalized') {
      continue;
    }
    assert.equal(result.terminalPa.rawResult, rawResult);
    assert.equal(result.terminalPa.terminalCategory, terminalCategory);
    assert.deepEqual(result.baserunningEvents, []);
    assert.notEqual(result.terminalPa.terminalCategory, 'OTHER_PA');
  }
});

test('ambiguous fielder-choice and multi-out labels require explicit batter disposition', () => {
  for (const rawResult of [
    'Fielders Choice',
    'Fielders Choice Out',
    'Forceout',
  ]) {
    assert.deepEqual(normalizeBallDontLieTerminalPa(mappingInput(rawResult)), {
      status: 'rejected',
      rawResult,
      reason: 'context-required',
    });

    const reached = normalizeBallDontLieTerminalPa(
      mappingInput(rawResult, {
        batterDisposition: 'reached',
        plateAppearanceOverrides: { is_ball_in_play_out: true },
      }),
    );
    assert.equal(reached.status, 'normalized');
    if (reached.status === 'normalized') {
      assert.equal(reached.terminalPa.terminalCategory, 'FC');
    }

    assert.deepEqual(
      normalizeBallDontLieTerminalPa(
        mappingInput(rawResult, { batterDisposition: 'retired' }),
      ),
      {
        status: 'rejected',
        rawResult,
        reason: 'context-contradiction',
      },
    );
  }

  for (const rawResult of ['Double Play', 'Triple Play']) {
    assert.deepEqual(normalizeBallDontLieTerminalPa(mappingInput(rawResult)), {
      status: 'rejected',
      rawResult,
      reason: 'context-required',
    });

    const retired = normalizeBallDontLieTerminalPa(
      mappingInput(rawResult, { batterDisposition: 'retired' }),
    );
    assert.equal(retired.status, 'normalized');
    if (retired.status === 'normalized') {
      assert.equal(retired.terminalPa.terminalCategory, 'BIP_OUT');
    }

    assert.deepEqual(
      normalizeBallDontLieTerminalPa(
        mappingInput(rawResult, { batterDisposition: 'reached' }),
      ),
      {
        status: 'rejected',
        rawResult,
        reason: 'context-contradiction',
      },
    );
  }
});

test('compound strikeout and caught-stealing rows keep terminal and baserunning events separate', () => {
  const strikeoutDoublePlay = normalizeBallDontLieTerminalPa(
    mappingInput('Strikeout Double Play', {
      finalPitchDescription: 'Swinging Strike',
    }),
  );
  assert.equal(strikeoutDoublePlay.status, 'normalized');
  if (strikeoutDoublePlay.status === 'normalized') {
    assert.equal(strikeoutDoublePlay.terminalPa.terminalCategory, 'K');
    assert.deepEqual(strikeoutDoublePlay.baserunningEvents, ['CS']);
  }

  assert.deepEqual(
    normalizeBallDontLieTerminalPa(
      mappingInput('Strikeout Double Play', {
        finalPitchDescription: 'Swinging Strike',
        batterDisposition: 'reached',
      }),
    ),
    {
      status: 'rejected',
      rawResult: 'Strikeout Double Play',
      reason: 'context-contradiction',
    },
  );

  assert.deepEqual(
    normalizeBallDontLieTerminalPa(
      mappingInput('Strikeout Double Play', {
        finalPitchDescription: 'Ball',
      }),
    ),
    {
      status: 'rejected',
      rawResult: 'Strikeout Double Play',
      reason: 'context-required',
    },
  );

  const caughtStealing = normalizeBallDontLieTerminalPa(
    mappingInput('Caught Stealing 2B', { finalPitchDescription: 'Ball' }),
  );
  assert.equal(caughtStealing.status, 'baserunning-only');
  if (caughtStealing.status === 'baserunning-only') {
    assert.deepEqual(caughtStealing.baserunningEvents, ['CS']);
    assert.equal(caughtStealing.rawResult, 'Caught Stealing 2B');
  }

  assert.deepEqual(
    normalizeBallDontLieTerminalPa(
      mappingInput('Caught Stealing 2B', {
        finalPitchDescription: 'Swinging Strike',
      }),
    ),
    {
      status: 'rejected',
      rawResult: 'Caught Stealing 2B',
      reason: 'context-required',
    },
  );
});

test('unknown, canonical-looking raw labels, malformed context, and contradictory context fail closed', () => {
  assert.deepEqual(
    normalizeBallDontLieTerminalPa(mappingInput('Future Provider Result')),
    {
      status: 'rejected',
      rawResult: 'Future Provider Result',
      reason: 'unknown-result',
    },
  );
  assert.deepEqual(normalizeBallDontLieTerminalPa(mappingInput('OTHER_PA')), {
    status: 'rejected',
    rawResult: 'OTHER_PA',
    reason: 'unknown-result',
  });

  const malformed = mappingInput('Single') as {
    sourceSnapshotSha256: string;
  };
  malformed.sourceSnapshotSha256 = 'not-a-sha';
  assert.deepEqual(normalizeBallDontLieTerminalPa(malformed), {
    status: 'rejected',
    rawResult: 'Single',
    reason: 'malformed-input',
  });

  assert.deepEqual(
    normalizeBallDontLieTerminalPa(
      mappingInput('Single', { batterDisposition: 'retired' }),
    ),
    {
      status: 'rejected',
      rawResult: 'Single',
      reason: 'context-contradiction',
    },
  );

  assert.deepEqual(
    normalizeBallDontLieTerminalPa(
      mappingInput('Single', {
        plateAppearanceOverrides: { batter_side: 'S' },
      }),
    ),
    {
      status: 'rejected',
      rawResult: 'Single',
      reason: 'malformed-input',
    },
  );
});

test('all promoted PA rows produce one explicit deterministic state without OTHER_PA fallback', () => {
  const fixtureNames = fs
    .readdirSync(fixtureDir)
    .filter(
      (name) =>
        name.startsWith('balldontlie-plate-appearances-') &&
        name.endsWith('.json'),
    )
    .sort();
  assert.equal(fixtureNames.length, 8);

  let rowCount = 0;
  let normalizedCount = 0;
  let baserunningOnlyCount = 0;
  let contextRequiredCount = 0;
  const contextRequiredLabels = new Set([
    'Fielders Choice',
    'Fielders Choice Out',
    'Forceout',
    'Double Play',
    'Triple Play',
  ]);

  for (const name of fixtureNames) {
    const gameId = Number(
      name.match(/balldontlie-plate-appearances-(\d+)\.json$/)?.[1],
    );
    assert.ok(Number.isInteger(gameId));

    const payload = JSON.parse(
      fs.readFileSync(path.join(fixtureDir, name), 'utf8'),
    ) as { data: RawBallDontLiePlateAppearance[] };

    for (const rawPlateAppearance of payload.data) {
      rowCount += 1;
      const result = normalizeBallDontLieTerminalPa({
        plateAppearance: rawPlateAppearance,
        providerGameId: gameId,
        sourceSnapshotSha256: snapshotSha256,
      });

      if (result.status === 'normalized') {
        normalizedCount += 1;
        assert.notEqual(result.terminalPa.terminalCategory, 'OTHER_PA');
        continue;
      }
      if (result.status === 'baserunning-only') {
        baserunningOnlyCount += 1;
        assert.equal(rawPlateAppearance.result, 'Caught Stealing 2B');
        continue;
      }

      assert.equal(result.reason, 'context-required');
      assert.notEqual(rawPlateAppearance.result, null);
      if (rawPlateAppearance.result !== null) {
        assert.equal(contextRequiredLabels.has(rawPlateAppearance.result), true);
      }
      contextRequiredCount += 1;
    }
  }

  assert.equal(rowCount, 607);
  assert.equal(
    normalizedCount + baserunningOnlyCount + contextRequiredCount,
    607,
  );
  assert.equal(baserunningOnlyCount, 1);
  assert.ok(contextRequiredCount > 0);
});
