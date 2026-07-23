import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const fixtureDir = path.resolve(
  'fixtures/sanitized/provider-capabilities/2026-07-23/terminal-pa',
);

function fixturePath(name) {
  return path.join(fixtureDir, name);
}

function readJson(name) {
  return JSON.parse(fs.readFileSync(fixturePath(name), 'utf8'));
}

function readPlateAppearances(gameId) {
  return (
    readJson(`balldontlie-plate-appearances-${gameId}.json`).data ?? []
  );
}

function readPlays(gameId) {
  const prefix = `balldontlie-plays-${gameId}-page-`;

  return fs.readdirSync(fixtureDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .sort((left, right) => {
      const page = (name) =>
        Number(name.match(/-page-(\d+)\.json$/)?.[1] ?? 0);

      return page(left) - page(right);
    })
    .flatMap((name) => readJson(name).data ?? []);
}

function finalPitchDescription(pa) {
  return pa?.pitches?.at(-1)?.description ?? null;
}

test('terminal-PA fixture bundle matches its checksums and contains valid sanitized JSON', () => {
  const checksumLines = fs.readFileSync(
    fixturePath('SHA256SUMS'),
    'utf8',
  )
    .trim()
    .split('\n');

  assert.equal(checksumLines.length, 49);

  const checksumEntries = checksumLines.map((line) => {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);

    assert.ok(match, `Malformed checksum line: ${line}`);

    return {
      expectedHash: match[1],
      name: match[2],
    };
  });

  const jsonFiles = fs.readdirSync(fixtureDir)
    .filter((name) => name.endsWith('.json'))
    .sort();

  assert.equal(jsonFiles.length, 49);
  assert.deepEqual(
    checksumEntries.map(({ name }) => name).sort(),
    jsonFiles,
  );

  const secretPatterns = [
    /BALLDONTLIE_API_KEY/i,
    /authorization\s*["':=]/i,
    /bearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
    /api[_-]?key\s*["':=]/i,
  ];

  for (const { expectedHash, name } of checksumEntries) {
    const bytes = fs.readFileSync(fixturePath(name));
    const text = bytes.toString('utf8');

    assert.doesNotThrow(
      () => JSON.parse(text),
      `Invalid JSON: ${name}`,
    );

    assert.equal(
      crypto.createHash('sha256').update(bytes).digest('hex'),
      expectedHash,
      `Checksum mismatch: ${name}`,
    );

    assert.equal(
      secretPatterns.some((pattern) => pattern.test(text)),
      false,
      `Secret-like content detected: ${name}`,
    );
  }
});

test('terminal-PA fixtures preserve context needed to distinguish batter outcomes from runner events', () => {
  const catcherInterference = readPlateAppearances(5059159)
    .find((pa) => pa.result === 'Catcher Interference');

  assert.ok(catcherInterference);
  assert.equal(catcherInterference.batter_id, 545);
  assert.equal(catcherInterference.is_ball_in_play_out, false);

  const pa5059310 = readPlateAppearances(5059310);
  const plays5059310 = readPlays(5059310);

  const fieldersChoice = pa5059310.find(
    (pa) =>
      pa.result === 'Fielders Choice' &&
      pa.batter_id === 2288,
  );

  assert.ok(fieldersChoice);
  assert.equal(fieldersChoice.is_ball_in_play_out, true);

  const nextFieldersChoicePa = pa5059310
    .filter((pa) =>
      pa.inning === fieldersChoice.inning &&
      pa.half_inning === fieldersChoice.half_inning &&
      pa.pa_number > fieldersChoice.pa_number
    )
    .sort((left, right) => left.pa_number - right.pa_number)[0];

  assert.ok(nextFieldersChoicePa);
  assert.equal(nextFieldersChoicePa.runner_on_first, true);
  assert.equal(nextFieldersChoicePa.runner_on_second, true);
  assert.equal(nextFieldersChoicePa.runner_on_third, true);

  assert.ok(
    plays5059310.some((play) =>
      play.batter_id === 2288 &&
      play.type === 'Batters Fielders Choice - All Runners Safe'
    ),
  );

  const pa5059296 = readPlateAppearances(5059296);
  const plays5059296 = readPlays(5059296);

  const fieldersChoiceOut = pa5059296.find(
    (pa) =>
      pa.result === 'Fielders Choice Out' &&
      pa.batter_id === 180,
  );

  assert.ok(fieldersChoiceOut);
  assert.ok(
    plays5059296.some((play) =>
      play.batter_id === 180 &&
      play.type === 'Play Result' &&
      play.text?.includes('García Jr. out at home')
    ),
  );

  const doublePlay = pa5059296.find(
    (pa) =>
      pa.result === 'Double Play' &&
      pa.batter_id === 164,
  );

  assert.ok(doublePlay);
  assert.ok(
    plays5059296.some((play) =>
      play.batter_id === 164 &&
      play.type === 'Play Result' &&
      play.text?.includes('Nuñez out at second') &&
      play.text?.includes('Lile out at home')
    ),
  );

  const pa5059295 = readPlateAppearances(5059295);
  const plays5059295 = readPlays(5059295);

  const caughtStealing = pa5059295.find(
    (pa) => pa.result === 'Caught Stealing 2B',
  );

  assert.ok(caughtStealing);
  assert.equal(finalPitchDescription(caughtStealing), 'Ball');
  assert.ok(
    plays5059295.some((play) =>
      play.type === 'Caught Stealing' &&
      play.batter_id === null &&
      play.text?.includes('caught stealing second')
    ),
  );

  const forceout = pa5059295.find(
    (pa) =>
      pa.result === 'Forceout' &&
      pa.batter_id === 565,
  );

  assert.ok(forceout);
  assert.ok(
    plays5059295.some((play) =>
      play.batter_id === 565 &&
      play.type === 'Play Result' &&
      play.text?.includes('Vázquez out at second')
    ),
  );

  const triplePlay = pa5059295.find(
    (pa) =>
      pa.result === 'Triple Play' &&
      pa.batter_id === 528,
  );

  assert.ok(triplePlay);
  assert.ok(
    plays5059295.some((play) =>
      play.batter_id === 528 &&
      play.type === 'Play Result' &&
      play.text?.includes('grounded into triple play')
    ),
  );

  const pa5059309 = readPlateAppearances(5059309);
  const plays5059309 = readPlays(5059309);

  const strikeoutDoublePlay = pa5059309.find(
    (pa) => pa.result === 'Strikeout Double Play',
  );

  assert.ok(strikeoutDoublePlay);
  assert.equal(
    finalPitchDescription(strikeoutDoublePlay),
    'Swinging Strike',
  );
  assert.equal(strikeoutDoublePlay.is_ball_in_play_out, false);

  assert.ok(
    plays5059309.some((play) =>
      play.batter_id === strikeoutDoublePlay.batter_id &&
      play.type === 'Play Result' &&
      play.text?.includes('struck out swinging') &&
      play.text?.includes('caught stealing second')
    ),
  );
});
