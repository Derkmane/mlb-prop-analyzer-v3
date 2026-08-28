import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import {
  DisplayStoreUnavailableError,
  HHR_DISPLAY_SESSION_COOKIE,
} from '../src/adapters/index.js';
import {
  PRODUCT_DISPLAY_BOARD_VERSION,
  type ResearchDisplayArchive,
  type ResearchDisplayMarket,
  type HhrDisplayArchive,
} from '../src/application/index.js';
import { createHhrDisplayAppServer } from '../src/composition/index.js';

test('deployable app fails closed on non-storage refresh failures before archive reads', async () => {
  let refreshCalls = 0;
  let archiveReads = 0;
  const server = createHhrDisplayAppServer({
    password: 'refresh-fail-closed-password',
    sessionToken: 'refresh-fail-closed-session-token',
    repository: Object.freeze({
      async readLatest() {
        archiveReads += 1;
        throw new Error('archive read must not run after an invalid persistent bundle');
      },
    }),
    cumulativeRepository: Object.freeze({
      async readLatest() {
        archiveReads += 1;
        return null;
      },
    }),
    researchRepository: Object.freeze({
      async readLatest() {
        archiveReads += 1;
        return null;
      },
    }),
    async refreshDisplayArchives() {
      refreshCalls += 1;
      throw new Error('invalid persistent display bundle');
    },
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${origin}/api/hhr-display-board`, {
      headers: { cookie: `${HHR_DISPLAY_SESSION_COOKIE}=refresh-fail-closed-session-token` },
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'hhr-display-board-unavailable' });
    assert.equal(refreshCalls, 1);
    assert.equal(archiveReads, 0);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('deployable app still fails closed when App Storage is unavailable and no readable archive exists', async () => {
  let refreshCalls = 0;
  let archiveReads = 0;
  const server = createHhrDisplayAppServer({
    password: 'storage-unavailable-password',
    sessionToken: 'storage-unavailable-session-token',
    repository: Object.freeze({
      async readLatest() {
        archiveReads += 1;
        throw new Error('forced unreadable shipped archive');
      },
    }),
    cumulativeRepository: Object.freeze({ async readLatest() { archiveReads += 1; return null; } }),
    researchRepository: Object.freeze({ async readLatest() { archiveReads += 1; return null; } }),
    async refreshDisplayArchives() {
      refreshCalls += 1;
      throw new DisplayStoreUnavailableError('forced App Storage outage');
    },
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${origin}/api/hhr-display-board`, {
      headers: { cookie: `${HHR_DISPLAY_SESSION_COOKIE}=storage-unavailable-session-token` },
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'hhr-display-board-unavailable' });
    assert.equal(refreshCalls, 1);
    assert.equal(archiveReads, 1);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('deployable app serves its latest local board during a temporary App Storage outage', async () => {
  let refreshCalls = 0;
  let archiveReads = 0;
  const archive: HhrDisplayArchive = Object.freeze({
    captureKey: `20260828T183000000Z--${'a'.repeat(64)}`,
    capturedAt: '2026-08-28T18:30:00.000Z',
    modelVersion: 'hhr-model-v1',
    distributionBuilderVersion: 'hhr-distribution-v1',
    rows: Object.freeze([]),
    enrichmentByGamePlayerKey: Object.freeze({}),
  });
  const server = createHhrDisplayAppServer({
    password: 'storage-readable-password',
    sessionToken: 'storage-readable-session-token',
    repository: Object.freeze({ async readLatest() { archiveReads += 1; return archive; } }),
    cumulativeRepository: Object.freeze({ async readLatest() { archiveReads += 1; return null; } }),
    researchRepository: Object.freeze({
      async readLatest(market: ResearchDisplayMarket): Promise<ResearchDisplayArchive> {
        archiveReads += 1;
        return Object.freeze({
          market,
          captureKey: archive.captureKey,
          capturedAt: archive.capturedAt,
          modelVersion: archive.modelVersion,
          distributionBuilderVersion: archive.distributionBuilderVersion,
          rows: Object.freeze([]),
        });
      },
    }),
    async refreshDisplayArchives() {
      refreshCalls += 1;
      throw new DisplayStoreUnavailableError('forced App Storage outage');
    },
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${origin}/api/hhr-display-board`, {
      headers: { cookie: `${HHR_DISPLAY_SESSION_COOKIE}=storage-readable-session-token` },
    });
    assert.equal(response.status, 200);
    const board = await response.json() as Record<string, unknown>;
    assert.equal(board['captureKey'], archive.captureKey);
    assert.equal(board['capturedAt'], archive.capturedAt);
    assert.equal(board['productBoardVersion'], PRODUCT_DISPLAY_BOARD_VERSION);
    assert.equal(refreshCalls, 1);
    assert.equal(archiveReads, 4);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
