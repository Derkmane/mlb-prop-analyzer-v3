import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import {
  HHR_DISPLAY_APP_JS,
  renderHhrDisplayAppPage,
} from '../src/adapters/index.js';
import type {
  HhrDisplayArchive,
  HhrDisplayArchiveRepository,
} from '../src/application/index.js';
import { createHhrDisplayAppServer } from '../src/composition/index.js';

const PASSWORD = 'phase5-test-password';
const SESSION_TOKEN = 'phase5-test-session-token-1234567890';

function fixtureArchive(captureKey: string, capturedAt: string): HhrDisplayArchive {
  return Object.freeze({
    captureKey,
    capturedAt,
    modelVersion: 'hhr-model-v1',
    distributionBuilderVersion: 'hhr-distribution-v1',
    rows: Object.freeze([]),
    enrichmentByGamePlayerKey: Object.freeze({}),
  });
}

async function withAppServer(
  repository: HhrDisplayArchiveRepository,
  check: (origin: string) => Promise<void>,
): Promise<void> {
  const server = createHhrDisplayAppServer({
    repository,
    cumulativeRepository: Object.freeze({ readLatest: async () => null }),
    password: PASSWORD,
    sessionToken: SESSION_TOKEN,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const origin = `http://127.0.0.1:${(address as AddressInfo).port}`;
  try {
    await check(origin);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function login(origin: string): Promise<string> {
  const response = await fetch(`${origin}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-proto': 'https',
    },
    body: new URLSearchParams({ password: PASSWORD }).toString(),
  });
  assert.equal(response.status, 303);
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie !== null);
  return setCookie.split(';')[0]!;
}

test('Phase 5 refresh is a single-flight reread of the existing board API with transactional rendering', () => {
  const html = renderHhrDisplayAppPage();
  assert.match(html, /id="refresh-board" class="refresh-button" type="button">Refresh<\/button>/u);

  assert.match(HHR_DISPLAY_APP_JS, /const refreshButton = document\.getElementById\('refresh-board'\);/u);
  assert.match(HHR_DISPLAY_APP_JS, /let loadInFlight = false;/u);
  assert.match(HHR_DISPLAY_APP_JS, /if \(loadInFlight\) return;/u);
  assert.match(HHR_DISPLAY_APP_JS, /refreshButton\.disabled = true;/u);
  assert.match(HHR_DISPLAY_APP_JS, /refreshButton\.disabled = false;/u);
  assert.match(
    HHR_DISPLAY_APP_JS,
    /const response = await fetch\('\/api\/hhr-display-board', \{ cache: 'no-store', credentials: 'same-origin' \}\);/u,
  );
  assert.match(HHR_DISPLAY_APP_JS, /const board = await response\.json\(\);\s+renderBoard\(board\);/u);
  assert.match(
    HHR_DISPLAY_APP_JS,
    /refreshButton\.addEventListener\('click', \(\) => \{\s+void loadBoard\(true\);\s+\}\);/u,
  );
  assert.match(
    HHR_DISPLAY_APP_JS,
    /Refresh failed\. Last loaded HHR display board remains visible\./u,
  );
  assert.equal(HHR_DISPLAY_APP_JS.match(/fetch\('/gu)?.length, 1);
  assert.equal(HHR_DISPLAY_APP_JS.includes('.sort('), false);
  assert.equal(HHR_DISPLAY_APP_JS.includes('.concat('), false);
});

test('successive authenticated board reads return the repository latest capture without a new endpoint', async () => {
  const captures = [
    fixtureArchive(
      '20260814T160000000Z--aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '2026-08-14T16:00:00.000Z',
    ),
    fixtureArchive(
      '20260814T163000000Z--bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '2026-08-14T16:30:00.000Z',
    ),
  ] as const;
  let reads = 0;
  const repository: HhrDisplayArchiveRepository = Object.freeze({
    async readLatest() {
      const archive = captures[Math.min(reads, captures.length - 1)]!;
      reads += 1;
      return archive;
    },
  });

  await withAppServer(repository, async (origin) => {
    const cookie = await login(origin);
    const headers = { cookie };

    const firstResponse = await fetch(`${origin}/api/hhr-display-board`, { headers });
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json() as Record<string, unknown>;
    assert.equal(first['captureKey'], captures[0].captureKey);
    assert.equal(first['capturedAt'], captures[0].capturedAt);

    const secondResponse = await fetch(`${origin}/api/hhr-display-board`, { headers });
    assert.equal(secondResponse.status, 200);
    const second = await secondResponse.json() as Record<string, unknown>;
    assert.equal(second['captureKey'], captures[1].captureKey);
    assert.equal(second['capturedAt'], captures[1].capturedAt);
    assert.equal(reads, 2);
  });
});

test('refresh preserves separate Phase 4 sample-sufficiency and calibration-agreement presentation', () => {
  assert.match(HHR_DISPLAY_APP_JS, /'Sample: ' \+ line\.evidenceStatus\.toUpperCase\(\)/u);
  assert.match(HHR_DISPLAY_APP_JS, /'Calibration: ' \+ agreement\.label/u);
  assert.match(HHR_DISPLAY_APP_JS, /'30-pick count gate'/u);
  assert.match(HHR_DISPLAY_APP_JS, /Math\.abs\(gap\) <= twoStandardErrors/u);
  assert.match(HHR_DISPLAY_APP_JS, /sample-' \+ line\.evidenceStatus/u);
  assert.match(HHR_DISPLAY_APP_JS, /agreement\.className/u);
  assert.equal(HHR_DISPLAY_APP_JS.includes("'Line ' + cohort + ' · '"), false);
});
