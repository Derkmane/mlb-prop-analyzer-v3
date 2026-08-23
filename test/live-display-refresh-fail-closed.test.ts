import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { HHR_DISPLAY_SESSION_COOKIE } from '../src/adapters/index.js';
import { createHhrDisplayAppServer } from '../src/composition/index.js';

test('deployable app fails closed instead of serving stale archives when live refresh fails', async () => {
  let refreshCalls = 0;
  let archiveReads = 0;
  const server = createHhrDisplayAppServer({
    password: 'refresh-fail-closed-password',
    sessionToken: 'refresh-fail-closed-session-token',
    repository: Object.freeze({
      async readLatest() {
        archiveReads += 1;
        throw new Error('archive read must not run after refresh failure');
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
      throw new Error('forced private-repository refresh failure');
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
