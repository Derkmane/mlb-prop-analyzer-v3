export const M8_UNTOUCHED_ACCESS_OPENS_AT = '2026-08-05T00:00:00-05:00';

export function assertM8UntouchedAccessOpen({ now = new Date() } = {}) {
  const observed = now instanceof Date ? now : new Date(now);
  const observedTime = observed.getTime();
  if (!Number.isFinite(observedTime)) {
    throw new TypeError('untouched access time must be a valid timestamp.');
  }
  const opensAt = Date.parse(M8_UNTOUCHED_ACCESS_OPENS_AT);
  if (observedTime < opensAt) {
    throw new Error(
      `M8 untouched acceptance remains sealed until ${M8_UNTOUCHED_ACCESS_OPENS_AT}. No untouched files were read.`,
    );
  }
  return Object.freeze({
    openedAt: M8_UNTOUCHED_ACCESS_OPENS_AT,
    evaluatedAt: observed.toISOString(),
  });
}
