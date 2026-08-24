import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rules = readFileSync(new URL('../PROJECT_RULES.md', import.meta.url), 'utf8');
const math = readFileSync(new URL('../CANONICAL_MATH_SPEC.md', import.meta.url), 'utf8');

test('canonical authorities separate research ranking from production calibration', () => {
  assert.match(rules, /\*\*Version:\*\* 2\.15/u);
  assert.match(math, /\*\*Version:\*\* 1\.15/u);

  assert.match(rules, /Research ranking.*production-calibrated probability authorization[\s\S]*separate states/u);
  assert.match(math, /Research ranking and production-calibrated probability authorization are[\s\S]*separate states/u);

  for (const required of [
    'UNVALIDATED RESEARCH',
    'versioned market-specific settlement rule',
    'deterministic and exact',
    'P(Win | grades)',
    'P(Void)',
  ]) {
    assert.ok(rules.includes(required), `PROJECT_RULES missing ${required}`);
  }

  assert.match(rules, /explicitly versioned\s+current-season fitted distribution/u);
  assert.match(math, /frozen or otherwise explicitly versioned[\s\S]*current-season fitted distribution/u);
  assert.match(math, /exact posted selected side and line[\s\S]*generic[\s\S]*Higher\/Lower settlement/u);
  assert.match(math, /category ordering uses only `P\(Win \| grades\)` descending and `P\(Void\)`[\s\S]*ascending/u);
});

test('research ranking remains visibly unvalidated and surfaces known failures', () => {
  assert.match(rules, /Every probability displayed through the research-ranking path[\s\S]*UNVALIDATED RESEARCH/u);
  assert.match(rules, /known calibration, distribution-shape, sample-sufficiency, or[\s\S]*validation failure[\s\S]*surfaced/u);

  assert.match(math, /Every probability displayed through this path must be visibly labeled[\s\S]*UNVALIDATED RESEARCH/u);
  assert.match(math, /known calibration, distribution-shape, sample-sufficiency, or[\s\S]*validation evidence[\s\S]*surfaced/u);

  assert.match(math, /0\.5  Higher\s+85\s+0\.6554\s+0\.5412/u);
  assert.match(math, /sampleSufficiency = SUFFICIENT\s+calibrationAgreement = FAIL\s+overallCalibrationGate = FAIL/u);
});

test('research ranking cannot resurrect rejected candidates or weaken production calibration', () => {
  assert.match(rules, /rejected candidate that was never frozen/u);
  assert.match(rules, /must not silently convert a[\s\S]*disabled feature into a production-enabled feature/u);
  assert.match(rules, /No real prop may be presented as a production-calibrated prediction/u);

  assert.match(math, /A candidate rejected before freeze[\s\S]*is ineligible for[\s\S]*research ranking/u);
  assert.match(math, /rejected, unfrozen continuation-ratio candidate is also ineligible for[\s\S]*research ranking/u);
  assert.match(math, /Family B distribution failing its calibration gate fails closed for[\s\S]*production-calibrated output/u);
  assert.match(math, /Calibration failure never authorizes substitution of a shallower line/u);
});
