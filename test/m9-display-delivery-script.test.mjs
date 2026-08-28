import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DISPLAY_DELIVERY_OIDC_AUDIENCE,
  buildDisplayDeliveryBundle,
  deliverDisplayBundle,
  findLatestCommonDisplayDay,
  requestGitHubOidcToken,
} from '../scripts/deliver-m9-display-bundle.mjs';

function prefix(capturedAt) {
  return capturedAt.replaceAll('-', '').replaceAll(':', '').replace('.', '');
}

async function writeArchive(root, market, capturedAt, hashCharacter) {
  const filename = `${prefix(capturedAt)}--${hashCharacter.repeat(64)}.json`;
  const directory = path.join(root, market, 'captures');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), JSON.stringify({
    displayArchiveVersion: 1,
    displayArchiveContract: 'phase1-trimmed-board-display-v1',
    market,
    captureKey: filename.slice(0, -'.json'.length),
    capturedAt,
    captureDateUtc: capturedAt.slice(0, 10),
    productionEnabled: false,
    productionRankingEnabled: false,
    rows: [{ rank: 1 }],
  }));
  return filename;
}

test('delivery bundle carries every capture from the newest date shared by Hits and HHR', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'm9-display-bundle-'));
  try {
    await Promise.all([
      writeArchive(root, 'batter-hits', '2026-08-27T23:00:00.000Z', 'a'),
      writeArchive(root, 'batter-hhr', '2026-08-27T23:00:00.000Z', 'b'),
      writeArchive(root, 'batter-hits', '2026-08-28T18:00:00.000Z', 'c'),
      writeArchive(root, 'batter-hhr', '2026-08-28T18:00:00.000Z', 'd'),
      writeArchive(root, 'batter-hits', '2026-08-28T18:30:00.000Z', 'e'),
      writeArchive(root, 'batter-hhr', '2026-08-28T18:30:00.000Z', 'f'),
    ]);
    const day = await findLatestCommonDisplayDay(root);
    assert.equal(day.dateKey, '20260828');
    assert.equal(day.files.length, 4);
    const bundle = await buildDisplayDeliveryBundle(root);
    assert.equal(bundle.displayDateUtc, '2026-08-28');
    assert.equal(bundle.capturedAt, '2026-08-28T18:30:00.000Z');
    assert.equal(bundle.archives.length, 4);
    assert.ok(bundle.archives.every((archive) => /^[a-f0-9]{64}$/u.test(archive.sha256)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('OIDC request uses the dedicated delivery audience without exposing a long-lived credential', async () => {
  let seenUrl = null;
  let seenAuthorization = null;
  const value = await requestGitHubOidcToken({
    requestUrl: 'https://token.actions.githubusercontent.com/example?base=1',
    requestToken: 'ephemeral-request-token',
    fetchImpl: async (input, init) => {
      seenUrl = String(input);
      seenAuthorization = init.headers.authorization;
      return new Response(JSON.stringify({ value: 'short-lived-oidc-jwt' }), { status: 200 });
    },
  });
  assert.equal(value, 'short-lived-oidc-jwt');
  assert.equal(seenAuthorization, 'Bearer ephemeral-request-token');
  assert.equal(new URL(seenUrl).searchParams.get('audience'), DISPLAY_DELIVERY_OIDC_AUDIENCE);
});

test('delivery POST uses the OIDC bearer token and requires HTTP 204', async () => {
  let seen = null;
  const bundle = Object.freeze({
    deliveryVersion: 1,
    displayDateUtc: '2026-08-28',
    capturedAt: '2026-08-28T18:30:00.000Z',
    archives: [],
    categoryPerformance: null,
  });
  await deliverDisplayBundle(bundle, {
    deliveryUrl: 'https://example.test/internal/display-delivery-v1',
    oidcToken: 'short-lived-token',
    fetchImpl: async (input, init) => {
      seen = { input: String(input), init };
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(seen.input, 'https://example.test/internal/display-delivery-v1');
  assert.equal(seen.init.headers.authorization, 'Bearer short-lived-token');
  assert.deepEqual(JSON.parse(seen.init.body), bundle);
});
