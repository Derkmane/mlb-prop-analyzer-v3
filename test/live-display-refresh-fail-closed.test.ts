import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { HHR_DISPLAY_SESSION_COOKIE } from '../src/adapters/index.js';
import {
  PRODUCT_DISPLAY_BOARD_VERSION,
  type ResearchDisplayArchive,
  type ResearchDisplayMarket,
  type HhrDisplayArchive,
} from '../src/application/index.js';
import { createHhrDisplayAppServer } from '../src/composition/index.js';

const PRIVATE_REPOSITORY_TREE_NOT_FOUND =
  'Unable to refresh current display board from GitHub tree: HTTP 404.';

test('deployable app fails closed on refresh failures after the GitHub tree lookup', async () => {
  let refreshCalls = 0;
  let archiveReads = 0;
  const server = createHhrDisplayAppServer({
    password: 'refresh-fail-closed-password',
    sessionToken: 'refresh-fail-closed-session-token',
    repository: Object.freeze({
      async readLatest() {
        archiveReads += 1;
        throw new Error('archive read must not run after a non-tree refresh failure');
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
      throw new Error('Unable to refresh current batter-hhr display archive: HTTP 404.');
    },
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const origin = `http://127.0.0.1:${(address as AddressInfo).port}`;

  try {
    const response = await fetch(`${origin}/api/hhr-display-board`, {
      headers: {
        cookie: `${HHR_DISPLAY_SESSION_COOKIE}=refresh-fail-closed-session-token`,
      },
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'hhr-display-board-unavailable',
    });
    assert.equal(refreshCalls, 1);
    assert.equal(archiveReads, 0);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('deployable app still fails closed when private-repository tree refresh is unavailable and no readable archive exists', async () => {
  let refreshCalls = 0;
  let archiveReads = 0;
  const server = createHhrDisplayAppServer({
    password: 'tree-404-no-archive-password',
    sessionToken: 'tree-404-no-archive-session-token',
    repository: Object.freeze({
      async readLatest() {
        archiveReads += 1;
        throw new Error('forced unreadable committed archive');
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
      throw new Error(PRIVATE_REPOSITORY_TREE_NOT_FOUND);
    },
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const origin = `http://127.0.0.1:${(address as AddressInfo).port}`;

  try {
    const response = await fetch(`${origin}/api/hhr-display-board`, {
      headers: {
        cookie: `${HHR_DISPLAY_SESSION_COOKIE}=tree-404-no-archive-session-token`,
      },
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'hhr-display-board-unavailable',
    });
    assert.equal(refreshCalls, 1);
    assert.equal(archiveReads, 1);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('deployable app serves the latest readable board when private-repository tree refresh returns 404', async () => {
  let refreshCalls = 0;
  let archiveReads = 0;
  const archive: HhrDisplayArchive = Object.freeze({
    captureKey: '20260824T120000000Z--aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    capturedAt: '2026-08-24T12:00:00.000Z',
    modelVersion: 'hhr-model-v1',
    distributionBuilderVersion: 'hhr-distribution-v1',
    rows: Object.freeze([]),
    enrichmentByGamePlayerKey: Object.freeze({}),
  });
  const server = createHhrDisplayAppServer({
    password: 'tree-404-readable-password',
    sessionToken: 'tree-404-readable-session-token',
    repository: Object.freeze({
      async readLatest() {
        archiveReads += 1;
        return archive;
      },
    }),
    cumulativeRepository: Object.freeze({
      async readLatest() {
        archiveReads += 1;
        return null;
      },
    }),
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
      throw new Error(PRIVATE_REPOSITORY_TREE_NOT_FOUND);
    },
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const origin = `http://127.0.0.1:${(address as AddressInfo).port}`;

  try {
    const response = await fetch(`${origin}/api/hhr-display-board`, {
      headers: {
        cookie: `${HHR_DISPLAY_SESSION_COOKIE}=tree-404-readable-session-token`,
      },
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
