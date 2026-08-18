import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createBdlAdaptiveRateLimiter,
  deriveBdlRateLimitEvidence,
} from '../scripts/bdl-adaptive-rate-limit-utils.mjs';

const HHR_GRADER_PATH = 'scripts/grade-m10-hhr-pending-archives.mjs';
const HITS_ENTRYPOINT_PATH = 'scripts/grade-m10-pending-archives.mjs';
const HITS_GRADER_PATH = 'scripts/grade-m10-batter-hits-pending-archives-v2.mjs';
const WORKFLOW_PATH = '.github/workflows/m10-grade-pending-archives.yml';

test('grading adaptive pacing uses the provider header and retains the 13000ms no-header fallback', () => {
  const observed = deriveBdlRateLimitEvidence({
    headers: new Headers({
      'x-ratelimit-limit': '600',
      'x-ratelimit-remaining': '599',
    }),
    fallbackDelayMs: 13_000,
    utilization: 0.9,
  });
  assert.equal(observed.source, 'x-ratelimit-limit');
  assert.equal(observed.limitPerMinute, 600);
  assert.equal(observed.intervalMs, 112);

  const fallback = deriveBdlRateLimitEvidence({
    headers: new Headers({ 'content-type': 'application/json' }),
    fallbackDelayMs: 13_000,
    utilization: 0.9,
  });
  assert.equal(fallback.source, 'fallback-delay');
  assert.equal(fallback.limitPerMinute, null);
  assert.equal(fallback.intervalMs, 13_000);
});

test('adaptive limiter continues to honor Retry-After for 429 responses', async () => {
  let currentTime = 50_000;
  const waits = [];
  const limiter = createBdlAdaptiveRateLimiter({
    fallbackDelayMs: 13_000,
    utilization: 0.9,
    now: () => currentTime,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      currentTime += milliseconds;
    },
  });

  await limiter.beforeRequest();
  const state = limiter.afterResponse({
    status: 429,
    headers: new Headers({
      'x-ratelimit-limit': '600',
      'x-ratelimit-remaining': '0',
      'retry-after': '2',
    }),
  });
  assert.equal(state.intervalMs, 112);
  assert.equal(state.pendingRetryMs, 2_000);
  assert.equal(await limiter.waitForRetry(), 2_000);
  assert.deepEqual(waits, [2_000]);
});

test('both pending-archive graders are wired to adaptive pacing and visible rate-limit diagnostics', async () => {
  const [hhr, hits, hitsEntrypoint] = await Promise.all([
    readFile(HHR_GRADER_PATH, 'utf8'),
    readFile(HITS_GRADER_PATH, 'utf8'),
    readFile(HITS_ENTRYPOINT_PATH, 'utf8'),
  ]);

  for (const source of [hhr, hits]) {
    assert.match(source, /createBdlAdaptiveRateLimiter/u);
    assert.match(source, /fallbackDelayMs: 13_000/u);
    assert.match(source, /utilization: 0\.9/u);
    assert.match(source, /bdlRateLimiter\.afterResponse\(\{/u);
    assert.match(source, /BDL RATE LIMIT PER MINUTE/u);
    assert.match(source, /BDL INTERVAL MS/u);
  }

  assert.equal(
    hitsEntrypoint,
    "import './grade-m10-batter-hits-pending-archives-v2.mjs';\n",
  );
  assert.doesNotMatch(
    hhr,
    /process\.env\.M10_BDL_MIN_REQUEST_INTERVAL_MS\?\.trim\(\) \|\| '13000'/u,
  );
  assert.doesNotMatch(hits, /DEFAULT_MINIMUM_REQUEST_INTERVAL_MS/u);
  assert.doesNotMatch(hits, /createRequestPacer/u);
});

test('scheduled grading no longer forces a fixed interval and both 429 branches retain Retry-After handling', async () => {
  const [workflow, hhr, hits] = await Promise.all([
    readFile(WORKFLOW_PATH, 'utf8'),
    readFile(HHR_GRADER_PATH, 'utf8'),
    readFile(HITS_GRADER_PATH, 'utf8'),
  ]);

  assert.doesNotMatch(workflow, /M10_BDL_MIN_REQUEST_INTERVAL_MS/u);

  const retryBranch =
    "const retrySeconds = Number(response.headers.get('retry-after'));\n" +
    '      await sleep(Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 13_000);';
  assert.ok(hhr.includes(retryBranch));
  assert.ok(hits.includes(retryBranch));
});
