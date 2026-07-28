import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createBdlAdaptiveRateLimiter,
  deriveBdlRateLimitEvidence,
} from '../scripts/bdl-adaptive-rate-limit-utils.mjs';

test('derives safe pacing from official BALLDONTLIE rate-limit headers', () => {
  const evidence = deriveBdlRateLimitEvidence({
    headers: {
      'X-RateLimit-Limit': '60',
      'X-RateLimit-Remaining': '59',
      'X-RateLimit-Reset': '2000000000',
    },
  });

  assert.equal(evidence.source, 'x-ratelimit-limit');
  assert.equal(evidence.limitPerMinute, 60);
  assert.equal(evidence.remaining, 59);
  assert.equal(evidence.resetAtMs, 2_000_000_000_000);
  assert.equal(evidence.intervalMs, 1112);
  assert.equal(evidence.utilization, 0.9);
});

test('supports observed legacy request counters only when they imply a known tier', () => {
  const evidence = deriveBdlRateLimitEvidence({
    headers: {
      'x-requests-used': '17',
      'x-requests-remaining': '583',
    },
  });

  assert.equal(evidence.source, 'x-requests-used-plus-remaining');
  assert.equal(evidence.limitPerMinute, 600);
  assert.equal(evidence.remaining, 583);
  assert.equal(evidence.intervalMs, 112);

  const unsupported = deriveBdlRateLimitEvidence({
    headers: {
      'x-requests-used': '7',
      'x-requests-remaining': '10',
    },
  });
  assert.equal(unsupported.source, 'fallback-delay');
  assert.equal(unsupported.limitPerMinute, null);
  assert.equal(unsupported.intervalMs, 13_000);
});

test('falls back conservatively when no recognized rate headers are present', () => {
  const evidence = deriveBdlRateLimitEvidence({
    headers: { 'content-type': 'application/json' },
    fallbackDelayMs: 12_500,
  });

  assert.equal(evidence.source, 'fallback-delay');
  assert.equal(evidence.limitPerMinute, null);
  assert.equal(evidence.remaining, null);
  assert.equal(evidence.intervalMs, 12_500);
});

test('paces subsequent requests and waits through an exhausted reset window', async () => {
  let currentTime = 10_000;
  const waits = [];
  const limiter = createBdlAdaptiveRateLimiter({
    now: () => currentTime,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      currentTime += milliseconds;
    },
  });

  assert.equal(await limiter.beforeRequest(), 0);
  limiter.afterResponse({
    status: 200,
    headers: {
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '59',
    },
  });

  currentTime += 100;
  assert.equal(await limiter.beforeRequest(), 1012);

  limiter.afterResponse({
    status: 200,
    headers: {
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '14',
    },
  });
  assert.equal(await limiter.beforeRequest(), 2776);
  assert.deepEqual(waits, [1012, 2776]);
});

test('honors Retry-After and clears the pending retry after waiting', async () => {
  let currentTime = 50_000;
  const waits = [];
  const limiter = createBdlAdaptiveRateLimiter({
    now: () => currentTime,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      currentTime += milliseconds;
    },
  });

  await limiter.beforeRequest();
  const state = limiter.afterResponse({
    status: 429,
    headers: {
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '0',
      'retry-after': '2',
    },
  });
  assert.equal(state.pendingRetryMs, 2000);
  assert.equal(await limiter.waitForRetry(), 2000);
  assert.equal(limiter.snapshot().pendingRetryMs, null);
  assert.deepEqual(waits, [2000]);
});
