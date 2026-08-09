const LEGACY_INFERRED_LIMITS = new Set([5, 60, 100, 120, 600]);

function assertFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a finite positive number.`);
  }
  return value;
}

function assertUtilization(value) {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new RangeError('utilization must be greater than 0 and at most 1.');
  }
  return value;
}

function normalizedHeaders(rawHeaders) {
  if (rawHeaders === null || typeof rawHeaders !== 'object' || Array.isArray(rawHeaders)) {
    return {};
  }
  const entries =
    typeof rawHeaders.get === 'function' && typeof rawHeaders.forEach === 'function'
      ? (() => {
          const headerEntries = [];
          rawHeaders.forEach((value, name) => {
            headerEntries.push([name, value]);
          });
          return headerEntries;
        })()
      : typeof rawHeaders[Symbol.iterator] === 'function'
        ? [...rawHeaders]
        : Object.entries(rawHeaders);
  return Object.fromEntries(
    entries.map(([name, value]) => [
      String(name).toLowerCase(),
      value === null || value === undefined ? null : String(value),
    ]),
  );
}

function parseNonNegativeInteger(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parsePositiveInteger(value) {
  const parsed = parseNonNegativeInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function parseResetAtMs(value) {
  const parsed = parsePositiveInteger(value);
  if (parsed === null) return null;
  return parsed >= 1_000_000_000_000 ? parsed : parsed * 1_000;
}

function parseRetryAfterMs(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
}

export function deriveBdlRateLimitEvidence({
  headers: rawHeaders,
  fallbackDelayMs = 13_000,
  utilization = 0.9,
}) {
  const fallback = assertFinitePositive(fallbackDelayMs, 'fallbackDelayMs');
  const targetUtilization = assertUtilization(utilization);
  const headers = normalizedHeaders(rawHeaders);

  const officialLimit = parsePositiveInteger(headers['x-ratelimit-limit']);
  const officialRemaining = parseNonNegativeInteger(
    headers['x-ratelimit-remaining'],
  );
  const officialResetAtMs = parseResetAtMs(headers['x-ratelimit-reset']);

  const legacyUsed = parseNonNegativeInteger(headers['x-requests-used']);
  const legacyRemaining = parseNonNegativeInteger(
    headers['x-requests-remaining'],
  );
  const legacyTotal =
    legacyUsed !== null && legacyRemaining !== null
      ? legacyUsed + legacyRemaining
      : null;
  const inferredLegacyLimit =
    legacyTotal !== null && LEGACY_INFERRED_LIMITS.has(legacyTotal)
      ? legacyTotal
      : null;

  const limitPerMinute = officialLimit ?? inferredLegacyLimit;
  const remaining = officialRemaining ?? legacyRemaining;
  const source = officialLimit !== null
    ? 'x-ratelimit-limit'
    : inferredLegacyLimit !== null
      ? 'x-requests-used-plus-remaining'
      : 'fallback-delay';
  const intervalMs =
    limitPerMinute === null
      ? Math.ceil(fallback)
      : Math.ceil(60_000 / (limitPerMinute * targetUtilization));

  return Object.freeze({
    source,
    limitPerMinute,
    remaining,
    resetAtMs: officialResetAtMs,
    retryAfterMs: parseRetryAfterMs(headers['retry-after']),
    intervalMs,
    utilization: targetUtilization,
    fallbackDelayMs: Math.ceil(fallback),
    headers: Object.freeze(headers),
  });
}

export function createBdlAdaptiveRateLimiter({
  fallbackDelayMs = 13_000,
  utilization = 0.9,
  now = () => Date.now(),
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function.');
  if (typeof sleep !== 'function') throw new TypeError('sleep must be a function.');

  const fallback = assertFinitePositive(fallbackDelayMs, 'fallbackDelayMs');
  const targetUtilization = assertUtilization(utilization);
  let evidence = deriveBdlRateLimitEvidence({
    headers: {},
    fallbackDelayMs: fallback,
    utilization: targetUtilization,
  });
  let lastRequestStartedAtMs = null;
  let pendingRetryMs = null;

  async function wait(milliseconds) {
    const duration = Math.max(0, Math.ceil(milliseconds));
    if (duration > 0) await sleep(duration);
    return duration;
  }

  return Object.freeze({
    async beforeRequest() {
      const current = now();
      let requiredWaitMs = 0;
      if (
        evidence.remaining === 0 &&
        evidence.resetAtMs !== null &&
        evidence.resetAtMs > current
      ) {
        requiredWaitMs = evidence.resetAtMs - current + 250;
      } else if (lastRequestStartedAtMs !== null) {
        requiredWaitMs = Math.max(
          0,
          evidence.intervalMs - (current - lastRequestStartedAtMs),
        );
      }
      const waitedMs = await wait(requiredWaitMs);
      lastRequestStartedAtMs = now();
      return waitedMs;
    },

    afterResponse({ status, headers }) {
      if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
        throw new TypeError('status must be an HTTP status integer.');
      }
      evidence = deriveBdlRateLimitEvidence({
        headers,
        fallbackDelayMs: fallback,
        utilization: targetUtilization,
      });
      if (status === 429) {
        const current = now();
        pendingRetryMs =
          evidence.retryAfterMs ??
          (evidence.resetAtMs !== null && evidence.resetAtMs > current
            ? evidence.resetAtMs - current + 250
            : evidence.intervalMs);
      } else {
        pendingRetryMs = null;
      }
      return Object.freeze({
        ...evidence,
        status,
        pendingRetryMs,
      });
    },

    async waitForRetry() {
      if (pendingRetryMs === null) {
        throw new Error('No rate-limit retry is pending.');
      }
      const waitedMs = await wait(pendingRetryMs);
      pendingRetryMs = null;
      lastRequestStartedAtMs = null;
      return waitedMs;
    },

    snapshot() {
      return Object.freeze({
        ...evidence,
        lastRequestStartedAtMs,
        pendingRetryMs,
      });
    },
  });
}
