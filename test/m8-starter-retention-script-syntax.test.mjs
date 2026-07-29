import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const SCRIPTS = Object.freeze([
  'scripts/build-m8-starter-retention-dataset.mjs',
  'scripts/evaluate-m8-starter-retention.mjs',
  'scripts/build-m8-starter-retention-artifact.mjs',
  'scripts/run-m8-starter-retention-gate.mjs',
]);

test('all starter retention executable scripts pass node syntax checking', () => {
  for (const script of SCRIPTS) {
    const output = execFileSync(process.execPath, ['--check', script], {
      encoding: 'utf8',
    });
    assert.equal(output, '');
  }
});
