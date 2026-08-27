import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CATEGORY_PERFORMANCE_RECORD_START_DATE,
  CATEGORY_PERFORMANCE_RECORD_TIME_ZONE,
  isCategoryPerformanceRecordCapture,
} from '../scripts/build-m10-category-performance.mjs';

test('category W-L-V history starts on August 26 in America/Chicago, not at UTC midnight', () => {
  assert.equal(CATEGORY_PERFORMANCE_RECORD_START_DATE, '2026-08-26');
  assert.equal(CATEGORY_PERFORMANCE_RECORD_TIME_ZONE, 'America/Chicago');

  assert.equal(
    isCategoryPerformanceRecordCapture('2026-08-26T04:59:59.999Z'),
    false,
    'August 25 at 23:59:59.999 CDT must not enter the new record',
  );
  assert.equal(
    isCategoryPerformanceRecordCapture('2026-08-26T05:00:00.000Z'),
    true,
    'August 26 at 00:00 CDT is the inclusive record epoch',
  );
  assert.equal(
    isCategoryPerformanceRecordCapture('2026-08-27T00:27:31.148Z'),
    true,
    'a post-midnight UTC capture that is still August 26 CDT must remain in the August 26 record',
  );
});

test('category W-L-V epoch rejects malformed timestamps instead of guessing a date', () => {
  assert.throws(
    () => isCategoryPerformanceRecordCapture('not-a-timestamp'),
    /must be an ISO timestamp/u,
  );
});
