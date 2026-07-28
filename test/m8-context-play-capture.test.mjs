import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildM8ContextPlayCapturePlan,
  collectCompleteM8PlayPages,
  promoteM8ContextPlayGameCapture,
  verifyM8ContextPlayGameCapture,
} from '../scripts/m8-context-play-capture-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

function row({
  rowId,
  date,
  gameId,
  paNumber,
  batterId,
  pitcherId,
  rawResult,
  mappingStatus = 'unresolved',
  unresolvedReason = 'context-required',
}) {
  return {
    rowId,
    observedDate: date,
    providerGameId: gameId,
    providerPaNumber: paNumber,
    providerBatterId: batterId,
    providerPitcherId: pitcherId,
    inning: 1,
    halfInning: 'top',
    rawResult,
    mappingStatus,
    unresolvedReason,
  };
}

function datasetIdentity(dataset) {
  return {
    activeSeason: dataset.activeSeason,
    sourcePartitionSha256: dataset.sourcePartitionSha256,
    sourceEvidenceSetSha256: dataset.sourceEvidenceSetSha256,
    periods: dataset.periods,
    untouchedTestReservation: dataset.untouchedTestReservation,
  };
}

async function writeDataset(root, { exposeTestRows = false } = {}) {
  const fitRows = [
    row({
      rowId: '2026-03-26:10:1',
      date: '2026-03-26',
      gameId: 10,
      paNumber: 1,
      batterId: 101,
      pitcherId: 201,
      rawResult: 'Forceout',
    }),
    row({
      rowId: '2026-03-26:10:2',
      date: '2026-03-26',
      gameId: 10,
      paNumber: 2,
      batterId: 102,
      pitcherId: 201,
      rawResult: 'Double Play',
    }),
    row({
      rowId: '2026-03-26:10:3',
      date: '2026-03-26',
      gameId: 10,
      paNumber: 3,
      batterId: 103,
      pitcherId: 201,
      rawResult: 'Single',
      mappingStatus: 'classified-terminal',
      unresolvedReason: null,
    }),
  ];
  const validationRows = [
    row({
      rowId: '2026-06-22:20:1',
      date: '2026-06-22',
      gameId: 20,
      paNumber: 1,
      batterId: 104,
      pitcherId: 202,
      rawResult: 'Fielders Choice Out',
    }),
  ];
  const dataset = {
    datasetVersion: 2,
    purpose: 'synthetic context play test dataset',
    activeSeason: 2026,
    sourcePartitionSha256: 'a'.repeat(64),
    sourceEvidenceSetSha256: 'b'.repeat(64),
    periods: {
      fit: {
        startDate: '2026-03-26',
        endDate: '2026-06-21',
        rowCount: fitRows.length,
        rows: fitRows,
      },
      validation: {
        startDate: '2026-06-22',
        endDate: '2026-07-05',
        rowCount: validationRows.length,
        rows: validationRows,
      },
    },
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      plateAppearanceCount: 9,
      rowsIncluded: false,
      ...(exposeTestRows ? { rows: [{ forbidden: true }] } : {}),
    },
  };
  dataset.datasetSha256 = sha256(JSON.stringify(datasetIdentity(dataset)));
  const datasetPath = path.join(root, 'dataset.json');
  await writeFile(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  return datasetPath;
}

function play(gameId, order, overrides = {}) {
  return {
    game_id: gameId,
    order,
    inning: 1,
    inning_type: 'Top',
    outs: 0,
    batter_id: 101,
    pitcher_id: 201,
    type: 'Play Result',
    text: 'Synthetic play result.',
    ...overrides,
  };
}

function page(gameId, orders, nextCursor = undefined) {
  return {
    data: orders.map((order) => play(gameId, order)),
    meta: {
      per_page: 100,
      ...(nextCursor === undefined ? {} : { next_cursor: nextCursor }),
    },
  };
}

function snapshot(pageNumber) {
  return {
    rawBodySha256: String(pageNumber).repeat(64).slice(0, 64),
    responseStatus: 200,
    request: {
      origin: 'https://api.balldontlie.io',
      pathname: '/mlb/v1/plays',
      queryKeys:
        pageNumber === 1
          ? ['game_id', 'per_page', 'sort_order']
          : ['cursor', 'game_id', 'per_page', 'sort_order'],
      headerNames: ['Authorization'],
    },
  };
}

async function withTempRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm8-context-plays-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('plans only fit-validation context-required games deterministically while test remains sealed', async () => {
  await withTempRoot(async (root) => {
    const datasetPath = await writeDataset(root);
    const first = await buildM8ContextPlayCapturePlan({ datasetPath });
    const second = await buildM8ContextPlayCapturePlan({ datasetPath });

    assert.deepEqual(first, second);
    assert.equal(first.contextRowCount, 3);
    assert.equal(first.gameCount, 2);
    assert.deepEqual(first.resultCounts, {
      'Double Play': 1,
      'Fielders Choice Out': 1,
      Forceout: 1,
    });
    assert.deepEqual(
      first.games.map((game) => ({
        gameId: game.gameId,
        observedDate: game.observedDate,
        periods: game.periods,
        contextRowCount: game.contextRowCount,
      })),
      [
        {
          gameId: 10,
          observedDate: '2026-03-26',
          periods: ['fit'],
          contextRowCount: 2,
        },
        {
          gameId: 20,
          observedDate: '2026-06-22',
          periods: ['validation'],
          contextRowCount: 1,
        },
      ],
    );
    assert.equal(first.untouchedTestReservation.rowsIncluded, false);
    assert.match(first.planSha256, /^[a-f0-9]{64}$/);
  });
});

test('collects every cursor page in strict global play order', async () => {
  const calls = [];
  const collected = await collectCompleteM8PlayPages({
    gameId: 10,
    fetchPage: async (request) => {
      calls.push(request);
      if (request.pageNumber === 1) {
        return { body: page(10, [10, 11], 50), snapshot: snapshot(1) };
      }
      return { body: page(10, [12, 13]), snapshot: snapshot(2) };
    },
  });

  assert.deepEqual(
    calls.map(({ cursor, pageNumber }) => ({ cursor, pageNumber })),
    [
      { cursor: null, pageNumber: 1 },
      { cursor: 50, pageNumber: 2 },
    ],
  );
  assert.equal(collected.pageCount, 2);
  assert.equal(collected.recordCount, 4);
  assert.equal(collected.firstOrder, 10);
  assert.equal(collected.lastOrder, 13);
  assert.equal(collected.pages[0].nextCursor, 50);
  assert.equal(collected.pages[1].nextCursor, null);
});

test('fails closed on cursor loops, duplicate orders, and cross-game rows', async () => {
  await assert.rejects(
    collectCompleteM8PlayPages({
      gameId: 10,
      fetchPage: async ({ pageNumber }) => ({
        body:
          pageNumber === 1
            ? page(10, [1], 7)
            : page(10, [2], 7),
        snapshot: snapshot(pageNumber),
      }),
    }),
    /pagination did not advance/,
  );

  await assert.rejects(
    collectCompleteM8PlayPages({
      gameId: 10,
      fetchPage: async ({ pageNumber }) => ({
        body:
          pageNumber === 1
            ? page(10, [1], 7)
            : page(10, [1]),
        snapshot: snapshot(pageNumber),
      }),
    }),
    /duplicate play order/,
  );

  await assert.rejects(
    collectCompleteM8PlayPages({
      gameId: 10,
      fetchPage: async () => ({
        body: page(11, [1]),
        snapshot: snapshot(1),
      }),
    }),
    /contains another game/,
  );
});

test('promotes and re-verifies one complete game capture and detects tampering', async () => {
  await withTempRoot(async (root) => {
    await mkdir(path.join(root, 'games'), { recursive: true });
    const collected = await collectCompleteM8PlayPages({
      gameId: 10,
      fetchPage: async ({ pageNumber }) => ({
        body:
          pageNumber === 1
            ? page(10, [1, 2], 9)
            : page(10, [3]),
        snapshot: snapshot(pageNumber),
      }),
    });
    const promoted = await promoteM8ContextPlayGameCapture({
      outputRoot: root,
      gameId: 10,
      collected,
    });
    const verified = await verifyM8ContextPlayGameCapture({
      gameDirectory: promoted.finalDirectory,
      expectedGameId: 10,
      secret: 'not-present-secret',
    });

    assert.equal(verified.status, 'verified');
    assert.equal(verified.pageCount, 2);
    assert.equal(verified.recordCount, 3);

    const firstPagePath = path.join(
      promoted.finalDirectory,
      'pages',
      'page-0001.json',
    );
    const firstPageText = await readFile(firstPagePath, 'utf8');
    await writeFile(firstPagePath, `${firstPageText} `, 'utf8');
    await assert.rejects(
      verifyM8ContextPlayGameCapture({
        gameDirectory: promoted.finalDirectory,
        expectedGameId: 10,
      }),
      /hash mismatch/,
    );
  });
});

test('rejects any source dataset that exposes untouched-test rows', async () => {
  await withTempRoot(async (root) => {
    const datasetPath = await writeDataset(root, { exposeTestRows: true });
    await assert.rejects(
      buildM8ContextPlayCapturePlan({ datasetPath }),
      /test rows must remain absent/,
    );
  });
});
