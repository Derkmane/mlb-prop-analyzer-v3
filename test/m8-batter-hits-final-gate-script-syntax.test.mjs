import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const scripts = [
  'scripts/run-m8-batter-hits-freeze-gate.mjs',
  'scripts/m8-untouched-hit-observation-utils.mjs',
  'scripts/run-m8-batter-hits-untouched-test.mjs',
];

test('final M8 Batter Hits gate scripts pass node syntax checking', () => {
  for (const script of scripts) {
    const output = execFileSync(process.execPath, ['--check', script], {
      encoding: 'utf8',
    });
    assert.equal(output, '');
  }
});
