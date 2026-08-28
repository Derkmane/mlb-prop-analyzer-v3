import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import {
  createGitHubActionsDisplayDeliveryHttpHandler,
  createGitHubActionsOidcVerifier,
  DISPLAY_DELIVERY_OIDC_AUDIENCE,
  DISPLAY_DELIVERY_REF,
  DISPLAY_DELIVERY_REPOSITORY,
  DISPLAY_DELIVERY_REPOSITORY_ID,
  DISPLAY_DELIVERY_WORKFLOW_REF,
  GITHUB_OIDC_ISSUER,
  GitHubActionsOidcVerificationError,
  type DisplayDeliveryBundleV1,
} from '../src/adapters/index.js';

const NOW_SECONDS = 1_787_940_000;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'test-signing-key',
  alg: 'RS256',
  use: 'sig',
};

function token(overrides: Readonly<Record<string, unknown>> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-signing-key', typ: 'JWT' }))
    .toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: GITHUB_OIDC_ISSUER,
    aud: DISPLAY_DELIVERY_OIDC_AUDIENCE,
    repository: DISPLAY_DELIVERY_REPOSITORY,
    repository_id: DISPLAY_DELIVERY_REPOSITORY_ID,
    ref: DISPLAY_DELIVERY_REF,
    ref_type: 'branch',
    workflow_ref: DISPLAY_DELIVERY_WORKFLOW_REF,
    repository_visibility: 'private',
    runner_environment: 'github-hosted',
    iat: NOW_SECONDS - 10,
    nbf: NOW_SECONDS - 10,
    exp: NOW_SECONDS + 300,
    ...overrides,
  })).toString('base64url');
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`, 'utf8'),
    privateKey,
  ).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

function verifier() {
  return createGitHubActionsOidcVerifier({
    now: () => NOW_SECONDS * 1000,
    fetchImpl: async () => new Response(JSON.stringify({ keys: [publicJwk] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
}

test('GitHub Actions OIDC verifier accepts only the authorized main delivery workflow identity', async () => {
  const verifyToken = verifier();
  await verifyToken(token());
  await assert.rejects(
    verifyToken(token({ workflow_ref: 'Derkmane/mlb-prop-analyzer-v3/.github/workflows/other.yml@refs/heads/main' })),
    (error: unknown) =>
      error instanceof GitHubActionsOidcVerificationError && /workflow_ref/u.test(error.message),
  );
  await assert.rejects(
    verifyToken(token({ repository: 'Derkmane/not-the-app' })),
    (error: unknown) =>
      error instanceof GitHubActionsOidcVerificationError && /repository/u.test(error.message),
  );
});

const MOCK_BUNDLE: DisplayDeliveryBundleV1 = Object.freeze({
  deliveryVersion: 1,
  capturedAt: '2026-08-28T18:30:00.000Z',
  archives: Object.freeze([
    Object.freeze({
      market: 'batter-hits',
      filename: `${'20260828T183000000Z'}--${'a'.repeat(64)}.json`,
      sha256: '1'.repeat(64),
      bytesBase64: 'e30=',
    }),
    Object.freeze({
      market: 'batter-hhr',
      filename: `${'20260828T183000000Z'}--${'b'.repeat(64)}.json`,
      sha256: '2'.repeat(64),
      bytesBase64: 'e30=',
    }),
  ]),
});

test('display delivery endpoint requires bearer identity and accepts a verified delivery', async () => {
  let deliveredBody: unknown = null;
  const handler = createGitHubActionsDisplayDeliveryHttpHandler({
    verifyToken: async (value) => {
      assert.equal(value, 'verified-token');
    },
    service: Object.freeze({
      async deliver(body: unknown): Promise<DisplayDeliveryBundleV1> {
        deliveredBody = body;
        return MOCK_BUNDLE;
      },
    }),
  });
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const unauthorized = await fetch(origin, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(unauthorized.status, 401);

    const payload = { deliveryVersion: 1, probe: 'body-survives-auth-boundary' };
    const accepted = await fetch(origin, {
      method: 'POST',
      headers: {
        authorization: 'Bearer verified-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    assert.equal(accepted.status, 204);
    assert.equal(accepted.headers.get('x-display-captured-at'), MOCK_BUNDLE.capturedAt);
    assert.deepEqual(deliveredBody, payload);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
