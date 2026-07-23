import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  normalizedTerminalPaSchema,
  rawBallDontLiePlateAppearancesResponseSchema,
  rawBallDontLiePlaysResponseSchema,
} from '../src/adapters/providers/balldontlie/index.js';
import {
  BASERUNNING_EVENT_CATEGORIES,
  isBaserunningEventCategory,
  isTerminalPaCategory,
  TERMINAL_PA_CATEGORIES,
} from '../src/domain/terminal-pa.js';

const fixtureDir = path.resolve(
  'fixtures/sanitized/provider-capabilities/2026-07-23/terminal-pa',
);

function fixtureNames(prefix: string): string[] {
  return fs
    .readdirSync(fixtureDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .sort();
}

function readFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

test('canonical terminal PA and baserunning categories remain separate', () => {
  assert.deepEqual(TERMINAL_PA_CATEGORIES, [
    'K',
    'UBB',
    'IBB',
    'HBP',
    '1B',
    '2B',
    '3B',
    'HR',
    'ROE',
    'FC',
    'SF',
    'SH',
    'BIP_OUT',
    'CATCHER_INTERFERENCE',
    'OTHER_PA',
  ]);

  assert.deepEqual(BASERUNNING_EVENT_CATEGORIES, [
    'SB',
    'CS',
    'PICKOFF',
    'OTHER_BASERUNNING',
  ]);

  assert.equal(
    TERMINAL_PA_CATEGORIES.some((category) =>
      isBaserunningEventCategory(category),
    ),
    false,
  );

  assert.equal(isTerminalPaCategory('1B'), true);
  assert.equal(isTerminalPaCategory('OTHER_PA'), true);
  assert.equal(isTerminalPaCategory('Single'), false);
  assert.equal(isTerminalPaCategory('Caught Stealing 2B'), false);
  assert.equal(isBaserunningEventCategory('CS'), true);
});

test('all promoted BALLDONTLIE PA and play fixtures satisfy the raw schemas', () => {
  const paFiles = fixtureNames('balldontlie-plate-appearances-');
  const playFiles = fixtureNames('balldontlie-plays-');

  assert.equal(paFiles.length, 8);
  assert.equal(playFiles.length, 38);

  let paRows = 0;
  for (const name of paFiles) {
    const parsed = rawBallDontLiePlateAppearancesResponseSchema.parse(
      readFixture(name),
    );
    paRows += parsed.data.length;
  }

  let playRows = 0;
  for (const name of playFiles) {
    const parsed = rawBallDontLiePlaysResponseSchema.parse(readFixture(name));
    playRows += parsed.data.length;
  }

  assert.equal(paRows, 607);
  assert.equal(playRows, 3497);
});

test('raw schemas preserve unknown provider fields and reject missing required fields', () => {
  const fixture = readFixture(
    'balldontlie-plate-appearances-5059159.json',
  ) as {
    data: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };

  fixture['future_top_level_field'] = 'preserved';

  const firstPa = fixture.data[0];
  assert.ok(firstPa);
  firstPa['future_pa_field'] = 17;

  const pitches = firstPa['pitches'];
  assert.ok(Array.isArray(pitches));
  const firstPitch = pitches[0] as Record<string, unknown> | undefined;
  assert.ok(firstPitch);
  firstPitch['future_pitch_field'] = true;

  const parsed = rawBallDontLiePlateAppearancesResponseSchema.parse(fixture);
  assert.equal(parsed['future_top_level_field'], 'preserved');

  const parsedFirstPa = parsed.data[0];
  assert.ok(parsedFirstPa);
  assert.equal(parsedFirstPa['future_pa_field'], 17);

  const parsedFirstPitch = parsedFirstPa.pitches[0];
  assert.ok(parsedFirstPitch);
  assert.equal(parsedFirstPitch['future_pitch_field'], true);

  const missingResult = structuredClone(fixture);
  const incompletePa = missingResult.data[0];
  assert.ok(incompletePa);
  delete incompletePa['result'];

  assert.equal(
    rawBallDontLiePlateAppearancesResponseSchema.safeParse(missingResult)
      .success,
    false,
  );
});

test('play contracts preserve nullable identities and reject malformed pagination', () => {
  const fixture = readFixture(
    'balldontlie-plays-5059295-page-1.json',
  ) as {
    data: Array<Record<string, unknown>>;
    meta: Record<string, unknown>;
  };

  const parsed = rawBallDontLiePlaysResponseSchema.parse(fixture);

  assert.ok(parsed.data.some((play) => play.batter_id === null));
  assert.ok(parsed.data.some((play) => play.pitcher_id === null));
  assert.ok(parsed.data.some((play) => play.text === null));

  const nullCursor = structuredClone(fixture);
  nullCursor.meta['next_cursor'] = null;

  assert.equal(
    rawBallDontLiePlaysResponseSchema.safeParse(nullCursor).success,
    false,
  );
});

test('normalized terminal PA boundary accepts only canonical categories and explicit snapshot context', () => {
  const valid = {
    provider: 'balldontlie',
    providerGameId: 5059159,
    providerBatterId: 545,
    providerPitcherId: 123,
    inning: 1,
    halfInning: 'top',
    providerPaNumber: 1,
    batterSide: 'R',
    pitcherHand: 'L',
    rawResult: 'Catcher Interference',
    terminalCategory: 'CATCHER_INTERFERENCE',
    sourceSnapshotSha256: 'a'.repeat(64),
  } as const;

  assert.equal(normalizedTerminalPaSchema.safeParse(valid).success, true);

  assert.equal(
    normalizedTerminalPaSchema.safeParse({
      ...valid,
      terminalCategory: 'Single',
    }).success,
    false,
  );

  assert.equal(
    normalizedTerminalPaSchema.safeParse({
      ...valid,
      terminalCategory: 'Caught Stealing 2B',
    }).success,
    false,
  );

  assert.equal(
    normalizedTerminalPaSchema.safeParse({
      ...valid,
      providerGameId: undefined,
    }).success,
    false,
  );

  assert.equal(
    normalizedTerminalPaSchema.safeParse({
      ...valid,
      unapprovedField: true,
    }).success,
    false,
  );
});
