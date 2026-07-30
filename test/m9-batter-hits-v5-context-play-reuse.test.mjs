import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  promoteM8ContextPlayGameCapture,
  verifyM8ContextPlayGameCapture,
} from '../scripts/m8-context-play-capture-utils.mjs';
import {
  prepareM9BatterHitsV5ContextPlayReuse,
  verifyM9BatterHitsV5ContextPlayReuse,
} from '../scripts/m9-batter-hits-v5-context-play-reuse-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

function captureIdentity(manifest) {
  return {
    activeSeason: manifest.activeSeason,
    sourceDatasetSha256: manifest.sourceDatasetSha256,
    sourceDatasetFileSha256: manifest.sourceDatasetFileSha256,
    sourcePlanSha256: manifest.sourcePlanSha256,
    sourcePlanFileSha256: manifest.sourcePlanFileSha256,
    contextRowCount: manifest.contextRowCount,
    gameCount: manifest.gameCount,
    resultCounts: manifest.resultCounts,
    games: manifest.games,
    totalPageCount: manifest.totalPageCount,
    totalPlayRecordCount: manifest.totalPlayRecordCount,
    untouchedTestReservation: manifest.untouchedTestReservation,
  };
}

function collectedGame(gameId) {
  const body = {
    data: [
      {
        game_id: gameId,
        order: 1,
        type: 'Play Result',
      },
    ],
    meta: {
      per_page: 100,
      next_cursor: null,
    },
  };
  return {
    gameId,
    perPage: 100,
    pageCount: 1,
    recordCount: 1,
    firstOrder: 1,
    lastOrder: 1,
    pages: [
      {
        pageNumber: 1,
        requestCursor: null,
        nextCursor: null,
        recordCount: 1,
        firstOrder: 1,
        lastOrder: 1,
        body,
        snapshot: {
          rawBodySha256: sha256(JSON.stringify(body)),
          responseStatus: 200,
          request: {
            method: 'GET',
            url: `https://example.invalid/plays?game_id=${gameId}`,
          },
        },
      },
    ],
  };
}

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm9-v5-context-reuse-'));
  const sourceRoot = path.join(root, 'source');
  const targetRoot = path.join(root, 'target');
  await mkdir(path.join(sourceRoot, 'games'), { recursive: true });

  const sourceGames = [];
  for (const [gameId, observedDate] of [
    [101, '2026-06-01'],
    [102, '2026-06-02'],
  ]) {
    await promoteM8ContextPlayGameCapture({
      outputRoot: sourceRoot,
      gameId,
      collected: collectedGame(gameId),
    });
    const verified = await verifyM8ContextPlayGameCapture({
      gameDirectory: path.join(sourceRoot, 'games', String(gameId)),
      expectedGameId: gameId,
    });
    sourceGames.push({
      gameId,
      observedDate,
      contextRowCount: 1,
      resultCounts: { Forceout: 1 },
      pageCount: verified.pageCount,
      recordCount: verified.recordCount,
      gameManifestSha256: verified.gameManifestSha256,
    });
  }

  const sourceIdentity = {
    activeSeason: 2026,
    sourceDatasetSha256: '1'.repeat(64),
    sourceDatasetFileSha256: '2'.repeat(64),
    sourcePlanSha256: '3'.repeat(64),
    sourcePlanFileSha256: '4'.repeat(64),
    contextRowCount: 2,
    gameCount: sourceGames.length,
    resultCounts: { Forceout: 2 },
    games: sourceGames,
    totalPageCount: 2,
    totalPlayRecordCount: 2,
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      plateAppearanceCount: 1,
      rowsIncluded: false,
    },
  };
  const sourceManifest = {
    captureVersion: 1,
    purpose: 'synthetic verified source context capture',
    provider: 'BALLDONTLIE MLB API',
    status: 'complete',
    error: null,
    ...sourceIdentity,
    captureSha256: sha256(JSON.stringify(sourceIdentity)),
  };

  const plan = {
    planVersion: 1,
    activeSeason: 2026,
    sourceDatasetSha256: 'a'.repeat(64),
    planSha256: 'b'.repeat(64),
    contextRowCount: 3,
    gameCount: 3,
    games: [
      { gameId: 101, observedDate: '2026-06-01' },
      { gameId: 102, observedDate: '2026-06-02' },
      { gameId: 103, observedDate: '2026-07-20' },
    ],
    untouchedTestReservation: {
      startDate: '2026-07-30',
      endDate: '2026-08-04',
      plateAppearanceCount: 0,
      rowsIncluded: false,
    },
  };

  return { root, sourceRoot, targetRoot, sourceManifest, plan };
}

test('V5 reuse links exact verified overlap and leaves only absent games missing', async () => {
  const fixture = await makeFixture();
  try {
    const reuse = await prepareM9BatterHitsV5ContextPlayReuse({
      rawPlan: fixture.plan,
      rawSourceCaptureManifest: fixture.sourceManifest,
      sourceCaptureRoot: fixture.sourceRoot,
      targetCaptureRoot: fixture.targetRoot,
    });
    verifyM9BatterHitsV5ContextPlayReuse(reuse);
    assert.equal(reuse.reusedGameCount, 2);
    assert.equal(reuse.linkedGameCount, 2);
    assert.equal(reuse.existingVerifiedGameCount, 0);
    assert.equal(reuse.missingGameCount, 1);
    assert.deepEqual(reuse.missingGames, [
      { gameId: 103, observedDate: '2026-07-20' },
    ]);
    for (const gameId of [101, 102]) {
      const targetDirectory = path.join(fixture.targetRoot, 'games', String(gameId));
      assert.equal((await lstat(targetDirectory)).isSymbolicLink(), true);
      const sourcePage = await readFile(
        path.join(fixture.sourceRoot, 'games', String(gameId), 'pages', 'page-0001.json'),
        'utf8',
      );
      const targetPage = await readFile(
        path.join(targetDirectory, 'pages', 'page-0001.json'),
        'utf8',
      );
      assert.equal(targetPage, sourcePage);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('V5 reuse is idempotent and preserves the same manifest identity on rerun', async () => {
  const fixture = await makeFixture();
  try {
    const first = await prepareM9BatterHitsV5ContextPlayReuse({
      rawPlan: fixture.plan,
      rawSourceCaptureManifest: fixture.sourceManifest,
      sourceCaptureRoot: fixture.sourceRoot,
      targetCaptureRoot: fixture.targetRoot,
    });
    const second = await prepareM9BatterHitsV5ContextPlayReuse({
      rawPlan: fixture.plan,
      rawSourceCaptureManifest: fixture.sourceManifest,
      sourceCaptureRoot: fixture.sourceRoot,
      targetCaptureRoot: fixture.targetRoot,
    });
    assert.deepEqual(second, first);
    assert.equal(second.linkedGameCount, 2);
    assert.equal(second.existingVerifiedGameCount, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('V5 reuse rejects a source page whose saved hash no longer matches', async () => {
  const fixture = await makeFixture();
  try {
    await writeFile(
      path.join(fixture.sourceRoot, 'games', '101', 'pages', 'page-0001.json'),
      '{"tampered":true}\n',
      'utf8',
    );
    await assert.rejects(
      prepareM9BatterHitsV5ContextPlayReuse({
        rawPlan: fixture.plan,
        rawSourceCaptureManifest: fixture.sourceManifest,
        sourceCaptureRoot: fixture.sourceRoot,
        targetCaptureRoot: fixture.targetRoot,
      }),
      /hash mismatch/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('V5 reuse rejects any plan that opens the untouched acceptance reservation', async () => {
  const fixture = await makeFixture();
  try {
    const openedPlan = structuredClone(fixture.plan);
    openedPlan.untouchedTestReservation.rowsIncluded = true;
    await assert.rejects(
      prepareM9BatterHitsV5ContextPlayReuse({
        rawPlan: openedPlan,
        rawSourceCaptureManifest: fixture.sourceManifest,
        sourceCaptureRoot: fixture.sourceRoot,
        targetCaptureRoot: fixture.targetRoot,
      }),
      /exposes untouched-test rows/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
