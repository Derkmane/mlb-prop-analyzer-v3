import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label} was not found exactly once.`);
  }
  return source.replace(before, after);
}

const capturePath = 'scripts/capture-m8-current-season-pa.mjs';
const utilityPath = 'scripts/m8-capture-verification-utils.mjs';
const cliPath = 'scripts/verify-m8-current-season-pa.mjs';
const testPath = 'test/m8-capture-verification.test.mjs';
const packagePath = 'package.json';
const selfPath = fileURLToPath(import.meta.url);

let capture = readFileSync(capturePath, 'utf8');
capture = replaceExactlyOnce(
  capture,
  "  requireSecret,\n  sanitizeText,",
  "  requireSecret,\n  sanitizeText,\n  sha256,",
  'capture sha256 import',
);
capture = replaceExactlyOnce(
  capture,
  '        rawBodySha256: gamesSnapshot.response.rawBodySha256,\n        request:',
  '        rawBodySha256: gamesSnapshot.response.rawBodySha256,\n        savedBodySha256: sha256(gamesSnapshot.sanitizedBodyText),\n        request:',
  'games saved-body hash',
);
capture = replaceExactlyOnce(
  capture,
  '          rawBodySha256: plateAppearancesSnapshot.response.rawBodySha256,\n          request:',
  '          rawBodySha256: plateAppearancesSnapshot.response.rawBodySha256,\n          savedBodySha256: sha256(\n            plateAppearancesSnapshot.sanitizedBodyText,\n          ),\n          request:',
  'plate appearances saved-body hash',
);
writeFileSync(capturePath, capture);

writeFileSync(
  utilityPath,
  `import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sha256 } from './provider-probe-utils.mjs';
import {
  countPlateAppearances,
  enumerateCurrentSeasonDates,
  selectFinalGamesForDate,
} from './m8-recency-weighting-utils.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(\`${'${label}'} must be an object.\`);
  }
  return value;
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(\`${'${label}'} must be a positive integer.\`);
  }
  return value;
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(\`${'${label}'} must be a non-negative integer.\`);
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(\`${'${label}'} must be a lowercase SHA-256 hex digest.\`);
  }
  return value;
}

function assertExactArray(value, expected, label) {
  if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new RangeError(
      \`${'${label}'} must equal ${'${JSON.stringify(expected)}'}.\`,
    );
  }
}

function assertRequest(request, expected, label) {
  const value = assertPlainObject(request, label);
  if (value.origin !== 'https://api.balldontlie.io') {
    throw new RangeError(\`${'${label}'}.origin is not the approved provider.\`);
  }
  if (value.pathname !== expected.pathname) {
    throw new RangeError(\`${'${label}'}.pathname is not approved.\`);
  }
  assertExactArray(value.queryKeys, expected.queryKeys, \`${'${label}'}.queryKeys\`);
  assertExactArray(value.headerNames, ['Authorization'], \`${'${label}'}.headerNames\`);
}

function resolveSnapshotPath(captureRoot, relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new TypeError(\`${'${label}'} must be a non-empty relative path.\`);
  }
  if (path.isAbsolute(relativePath)) {
    throw new RangeError(\`${'${label}'} must be relative.\`);
  }
  const root = path.resolve(captureRoot);
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(\`${'${root}'}${'${path.sep}'}\`)) {
    throw new RangeError(\`${'${label}'} escapes the capture directory.\`);
  }
  return resolved;
}

async function readVerifiedSnapshot({
  captureRoot,
  snapshot,
  label,
  expectedRequest,
  secret,
}) {
  const value = assertPlainObject(snapshot, label);
  if (value.responseStatus !== 200) {
    throw new RangeError(\`${'${label}'}.responseStatus must equal 200.\`);
  }
  assertSha256(value.rawBodySha256, \`${'${label}'}.rawBodySha256\`);
  const savedBodySha256 = assertSha256(
    value.savedBodySha256,
    \`${'${label}'}.savedBodySha256\`,
  );
  assertRequest(value.request, expectedRequest, \`${'${label}'}.request\`);

  const filePath = resolveSnapshotPath(
    captureRoot,
    value.filePath,
    \`${'${label}'}.filePath\`,
  );
  const text = await readFile(filePath, 'utf8');
  if (secret && text.includes(secret)) {
    throw new Error(\`${'${label}'} contains the provider secret.\`);
  }
  const actualSha256 = sha256(text);
  if (actualSha256 !== savedBodySha256) {
    throw new Error(
      \`${'${label}'} saved-body hash mismatch: expected ${'${savedBodySha256}'}, got ${'${actualSha256}'}.\`,
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(\`${'${label}'} is not valid JSON.\`);
  }
}

export async function verifyM8CaptureDirectory({
  captureRoot,
  expectedActiveSeason,
  secret = null,
}) {
  if (typeof captureRoot !== 'string' || captureRoot.trim().length === 0) {
    throw new TypeError('captureRoot must be a non-empty string.');
  }
  assertPositiveInteger(expectedActiveSeason, 'expectedActiveSeason');

  const manifestText = await readFile(
    path.join(captureRoot, 'capture-manifest.json'),
    'utf8',
  );
  if (secret && manifestText.includes(secret)) {
    throw new Error('capture manifest contains the provider secret.');
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error('capture manifest is not valid JSON.');
  }
  assertPlainObject(manifest, 'capture manifest');

  if (manifest.captureVersion !== 1) {
    throw new RangeError('captureVersion must equal 1.');
  }
  if (manifest.provider !== 'BALLDONTLIE MLB API') {
    throw new RangeError('capture provider is not approved.');
  }
  if (manifest.activeSeason !== expectedActiveSeason) {
    throw new RangeError(
      \`capture activeSeason ${'${manifest.activeSeason}'} does not match expected ${'${expectedActiveSeason}'}.\`,
    );
  }
  if (manifest.status !== 'complete' || manifest.error !== null) {
    throw new RangeError('capture must be complete with error null.');
  }
  if (manifest.truncated !== false) {
    throw new RangeError('truncated capture evidence cannot be promoted.');
  }
  if (manifest.requiredFinalStatus !== 'STATUS_FINAL') {
    throw new RangeError('requiredFinalStatus must equal STATUS_FINAL.');
  }

  const expectedDates = enumerateCurrentSeasonDates({
    startDate: manifest.requestedStartDate,
    endDate: manifest.requestedEndDate,
    activeSeason: expectedActiveSeason,
  });
  if (!Array.isArray(manifest.dateCaptures)) {
    throw new TypeError('dateCaptures must be an array.');
  }
  assertExactArray(
    manifest.dateCaptures.map((entry) => entry?.date),
    [...expectedDates],
    'captured dates',
  );

  let totalGames = 0;
  let totalPlateAppearances = 0;
  const seenGameIds = new Set();

  for (const [dateIndex, rawDateCapture] of manifest.dateCaptures.entries()) {
    const dateCapture = assertPlainObject(
      rawDateCapture,
      \`dateCaptures[${'${dateIndex}'}]\`,
    );
    const gamesBody = await readVerifiedSnapshot({
      captureRoot,
      snapshot: dateCapture.gamesSnapshot,
      label: \`dateCaptures[${'${dateIndex}'}].gamesSnapshot\`,
      expectedRequest: {
        pathname: '/mlb/v1/games',
        queryKeys: ['dates[]', 'per_page', 'season_type'],
      },
      secret,
    });
    const finalGames = selectFinalGamesForDate(
      gamesBody,
      dateCapture.date,
      expectedActiveSeason,
    );
    const finalGameCount = assertNonNegativeInteger(
      dateCapture.finalGameCount,
      \`dateCaptures[${'${dateIndex}'}].finalGameCount\`,
    );
    if (finalGameCount !== finalGames.length) {
      throw new Error(
        \`date ${'${dateCapture.date}'} finalGameCount does not match the games snapshot.\`,
      );
    }
    if (!Array.isArray(dateCapture.games)) {
      throw new TypeError(\`dateCaptures[${'${dateIndex}'}].games must be an array.\`);
    }
    if (dateCapture.games.length !== finalGames.length) {
      throw new Error(
        \`date ${'${dateCapture.date}'} does not contain every final game.\`,
      );
    }

    const finalById = new Map(finalGames.map((game) => [game.id, game]));
    for (const [gameIndex, rawGame] of dateCapture.games.entries()) {
      const label = \`dateCaptures[${'${dateIndex}'}].games[${'${gameIndex}'}]\`;
      const game = assertPlainObject(rawGame, label);
      const gameId = assertPositiveInteger(game.gameId, \`${'${label}'}.gameId\`);
      if (seenGameIds.has(gameId)) {
        throw new Error(\`duplicate captured gameId: ${'${gameId}'}\`);
      }
      seenGameIds.add(gameId);

      const expectedGame = finalById.get(gameId);
      if (!expectedGame) {
        throw new Error(\`captured game ${'${gameId}'} is not final in the games snapshot.\`);
      }
      if (
        game.gameDate !== expectedGame.date ||
        game.status !== expectedGame.status ||
        game.status !== 'STATUS_FINAL'
      ) {
        throw new Error(\`captured game ${'${gameId}'} metadata does not match the games snapshot.\`);
      }

      const plateAppearancesBody = await readVerifiedSnapshot({
        captureRoot,
        snapshot: game.plateAppearancesSnapshot,
        label: \`${'${label}'}.plateAppearancesSnapshot\`,
        expectedRequest: {
          pathname: '/mlb/v1/plate_appearances',
          queryKeys: ['game_id'],
        },
        secret,
      });
      const actualRecordCount = countPlateAppearances(plateAppearancesBody);
      const recordedCount = assertNonNegativeInteger(
        game.plateAppearancesSnapshot.recordCount,
        \`${'${label}'}.plateAppearancesSnapshot.recordCount\`,
      );
      if (actualRecordCount !== recordedCount) {
        throw new Error(
          \`game ${'${gameId}'} plate-appearance count does not match its snapshot.\`,
        );
      }

      totalGames += 1;
      totalPlateAppearances += actualRecordCount;
    }
  }

  if (manifest.capturedGameCount !== totalGames) {
    throw new Error('capturedGameCount does not match verified games.');
  }
  if (manifest.capturedPlateAppearanceCount !== totalPlateAppearances) {
    throw new Error(
      'capturedPlateAppearanceCount does not match verified plate appearances.',
    );
  }

  return Object.freeze({
    status: 'verified',
    activeSeason: expectedActiveSeason,
    startDate: manifest.requestedStartDate,
    endDate: manifest.requestedEndDate,
    gameCount: totalGames,
    plateAppearanceCount: totalPlateAppearances,
  });
}
`,
);

writeFileSync(
  cliPath,
  `import { activeUtcSeason } from './provider-capability-utils.mjs';
import { verifyM8CaptureDirectory } from './m8-capture-verification-utils.mjs';

const captureRoot = process.env.M8_VERIFY_CAPTURE_DIR?.trim();
if (!captureRoot) {
  throw new Error('Missing required environment variable: M8_VERIFY_CAPTURE_DIR');
}

const result = await verifyM8CaptureDirectory({
  captureRoot,
  expectedActiveSeason: activeUtcSeason(new Date()),
  secret: process.env.BALLDONTLIE_API_KEY?.trim() || null,
});

console.log('=== M8 CAPTURE VERIFICATION ===');
console.log('Status: VERIFIED');
console.log(\`Date range: ${'${result.startDate}'} through ${'${result.endDate}'}\`);
console.log(\`Games verified: ${'${result.gameCount}'}\`);
console.log(\`Plate appearances verified: ${'${result.plateAppearanceCount}'}\`);
`,
);

writeFileSync(
  testPath,
  `import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyM8CaptureDirectory } from '../scripts/m8-capture-verification-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const text = \`${'${JSON.stringify(value, null, 2)}'}\\n\`;
  await writeFile(filePath, text, 'utf8');
  return text;
}

async function createCaptureFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-capture-'));
  const gamesRelative = 'games/balldontlie-games-2026-07-08.json';
  const paRelative = 'plate-appearances/balldontlie-plate-appearances-5059147.json';
  const gamesBody = {
    data: [
      {
        id: 5059147,
        date: '2026-07-08T00:05:00.000Z',
        status: 'STATUS_FINAL',
      },
    ],
  };
  const paBody = { data: [{ id: 1 }, { id: 2 }] };
  const gamesText = await writeJson(path.join(root, gamesRelative), gamesBody);
  const paText = await writeJson(path.join(root, paRelative), paBody);

  const manifest = {
    captureVersion: 1,
    purpose: 'test fixture',
    provider: 'BALLDONTLIE MLB API',
    capturedAt: '2026-07-27T14:33:34.823Z',
    activeSeason: 2026,
    requestedStartDate: '2026-07-08',
    requestedEndDate: '2026-07-08',
    requiredFinalStatus: 'STATUS_FINAL',
    maxGames: null,
    delayMs: 0,
    status: 'complete',
    truncated: false,
    capturedGameCount: 1,
    capturedPlateAppearanceCount: 2,
    dateCaptures: [
      {
        date: '2026-07-08',
        gamesSnapshot: {
          filePath: gamesRelative,
          rawBodySha256: sha256(JSON.stringify(gamesBody)),
          savedBodySha256: sha256(gamesText),
          request: {
            origin: 'https://api.balldontlie.io',
            pathname: '/mlb/v1/games',
            queryKeys: ['dates[]', 'per_page', 'season_type'],
            headerNames: ['Authorization'],
          },
          responseStatus: 200,
        },
        finalGameCount: 1,
        games: [
          {
            gameId: 5059147,
            gameDate: '2026-07-08T00:05:00.000Z',
            status: 'STATUS_FINAL',
            plateAppearancesSnapshot: {
              filePath: paRelative,
              rawBodySha256: sha256(JSON.stringify(paBody)),
              savedBodySha256: sha256(paText),
              request: {
                origin: 'https://api.balldontlie.io',
                pathname: '/mlb/v1/plate_appearances',
                queryKeys: ['game_id'],
                headerNames: ['Authorization'],
              },
              responseStatus: 200,
              recordCount: 2,
            },
          },
        ],
      },
    ],
    error: null,
  };
  await writeJson(path.join(root, 'capture-manifest.json'), manifest);
  return { root, manifest, paRelative };
}

test('verifies a complete non-truncated current-season capture', async () => {
  const { root } = await createCaptureFixture();
  assert.deepEqual(
    await verifyM8CaptureDirectory({
      captureRoot: root,
      expectedActiveSeason: 2026,
      secret: 'not-present',
    }),
    {
      status: 'verified',
      activeSeason: 2026,
      startDate: '2026-07-08',
      endDate: '2026-07-08',
      gameCount: 1,
      plateAppearanceCount: 2,
    },
  );
});

test('rejects a tampered saved snapshot', async () => {
  const { root, paRelative } = await createCaptureFixture();
  await writeFile(path.join(root, paRelative), '{"data":[]}\\n', 'utf8');
  await assert.rejects(
    verifyM8CaptureDirectory({ captureRoot: root, expectedActiveSeason: 2026 }),
    /saved-body hash mismatch/,
  );
});

test('rejects truncated evidence', async () => {
  const { root, manifest } = await createCaptureFixture();
  manifest.truncated = true;
  await writeJson(path.join(root, 'capture-manifest.json'), manifest);
  await assert.rejects(
    verifyM8CaptureDirectory({ captureRoot: root, expectedActiveSeason: 2026 }),
    /cannot be promoted/,
  );
});

test('rejects manifest count drift', async () => {
  const { root, manifest } = await createCaptureFixture();
  manifest.capturedPlateAppearanceCount = 3;
  await writeJson(path.join(root, 'capture-manifest.json'), manifest);
  await assert.rejects(
    verifyM8CaptureDirectory({ captureRoot: root, expectedActiveSeason: 2026 }),
    /does not match verified plate appearances/,
  );
});

test('rejects a provider secret even when hashes match', async () => {
  const { root, manifest, paRelative } = await createCaptureFixture();
  const secret = 'fixture-secret';
  const paText = await readFile(path.join(root, paRelative), 'utf8');
  const contaminated = paText.replace('"data": [', \`"secret": "${'${secret}'}",\\n  "data": [\`);
  await writeFile(path.join(root, paRelative), contaminated, 'utf8');
  manifest.dateCaptures[0].games[0].plateAppearancesSnapshot.savedBodySha256 =
    sha256(contaminated);
  await writeJson(path.join(root, 'capture-manifest.json'), manifest);
  await assert.rejects(
    verifyM8CaptureDirectory({
      captureRoot: root,
      expectedActiveSeason: 2026,
      secret,
    }),
    /contains the provider secret/,
  );
});
`,
);

const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
packageJson.scripts['check:scripts'] +=
  ' && node --check scripts/m8-capture-verification-utils.mjs && node --check scripts/verify-m8-current-season-pa.mjs';
packageJson.scripts['test:m8-capture-verification'] =
  'node --test test/m8-capture-verification.test.mjs';
packageJson.scripts['verify:m8-current-season-pa'] =
  'node scripts/verify-m8-current-season-pa.mjs';
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

execFileSync('npm', ['run', 'test:m8-capture-verification'], {
  stdio: 'inherit',
});
execFileSync('npm', ['run', 'test:m8-recency'], { stdio: 'inherit' });

unlinkSync(selfPath);
execFileSync('git', ['config', 'user.name', 'github-actions[bot]']);
execFileSync('git', [
  'config',
  'user.email',
  '41898282+github-actions[bot]@users.noreply.github.com',
]);
execFileSync('git', ['add', '-A'], { stdio: 'inherit' });
execFileSync(
  'git',
  ['commit', '-m', 'Verify preserved M8 capture evidence'],
  { stdio: 'inherit' },
);
execFileSync(
  'git',
  ['push', 'origin', 'HEAD:agent/m8-recency-weighting'],
  { stdio: 'inherit' },
);

const captureRoot =
  'artifacts/m8-current-season-pa/full-2026-07-08-verifiable';
execFileSync('npm', ['run', 'capture:m8-current-season-pa'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    M8_CAPTURE_START_DATE: '2026-07-08',
    M8_CAPTURE_END_DATE: '2026-07-08',
    M8_CAPTURE_MAX_GAMES: '16',
    M8_CAPTURE_OUTPUT_DIR: captureRoot,
  },
});
execFileSync('npm', ['run', 'verify:m8-current-season-pa'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    M8_VERIFY_CAPTURE_DIR: captureRoot,
  },
});
