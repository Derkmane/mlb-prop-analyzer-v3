import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { createHhrDisplayAppHttpHandler } from '../dist/src/adapters/http/hhr-display-app-http.js';

async function withServer(handler, run) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await run(origin);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('healthz exercises the board refresh/read path and reports ready on success', async () => {
  let reads = 0;
  const handler = createHhrDisplayAppHttpHandler({
    password: 'health-password',
    sessionToken: 'health-session',
    async readBoard() {
      reads += 1;
      return {};
    },
  });

  await withServer(handler, async (origin) => {
    const response = await fetch(`${origin}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.equal(reads, 1);
  });
});

test('healthz reports unavailable when the board refresh/read path fails', async () => {
  let reads = 0;
  const handler = createHhrDisplayAppHttpHandler({
    password: 'health-password',
    sessionToken: 'health-session',
    async readBoard() {
      reads += 1;
      throw new Error('forced refresh failure');
    },
  });

  await withServer(handler, async (origin) => {
    const response = await fetch(`${origin}/healthz`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'unavailable' });
    assert.equal(reads, 1);
  });
});
