import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const scripts = [
  'scripts/m8-5-park-frozen-base-prediction-utils.mjs',
  'scripts/build-m8-5-park-frozen-base-predictions.mjs',
  'scripts/dump-artifact-lineage.mjs',
  'scripts/dump-m8-5-park-lineage.mjs',
];

test('M8.5 park frozen-base prediction scripts pass node syntax checking', () => {
  for (const script of scripts) {
    const result = spawnSync(process.execPath, ['--check', script], {
      encoding: 'utf8',
    });
    assert.equal(
      result.status,
      0,
      `${script} failed syntax checking:\n${result.stdout}\n${result.stderr}`,
    );
  }
});