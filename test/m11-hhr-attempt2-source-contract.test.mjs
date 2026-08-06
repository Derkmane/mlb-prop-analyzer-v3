import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('M11 HHR attempt 2 encodes the corrected gate, standardized scale, and leakage-safe expanded window', async () => {
  const [capture, fit, attempt1Capture, attempt1Fit] = await Promise.all([
    readFile('scripts/capture-m11-hhr-respecified-evidence.mjs', 'utf8'),
    readFile('scripts/fit-m11-batter-hhr-respecified.mjs', 'utf8'),
    readFile('artifacts/workflow-logs/m11-hhr-attempt1-capture.log', 'utf8'),
    readFile('artifacts/workflow-logs/m11-hhr-attempt1-fit.log', 'utf8'),
  ]);
  assert.match(capture, /FIT_START_DATE = '2026-07-06'/u);
  assert.match(capture, /FROZEN_HISTORY_END_DATE = '2026-07-05'/u);
  assert.match(capture, /fittedRowsOnOrBeforePitcherAllowedEndDate/u);
  assert.match(capture, /exclusionExamples/u);
  assert.match(fit, /LINEUP_SLOT_ABSOLUTE_MAXIMUM = 0.15/u);
  assert.match(fit, /standardized-per-sample-standard-deviation/u);
  assert.doesNotMatch(fit, /coefficient <= 0/u);
  assert.match(attempt1Capture, /ROWS: 783/u);
  assert.match(attempt1Fit, /GATE B LINEUP SLOT NON-POSITIVE: false/u);
});
