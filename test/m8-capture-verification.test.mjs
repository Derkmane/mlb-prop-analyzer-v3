import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyM8CaptureDirectory } from '../scripts/m8-capture-verification-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
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
  await writeFile(path.join(root, paRelative), '{"data":[]}\n', 'utf8');
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
  const contaminated = paText.replace('"data": [', `"secret": "${secret}",\n  "data": [`);
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
