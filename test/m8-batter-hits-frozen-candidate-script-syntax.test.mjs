import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const scripts = [
  'scripts/m8-batter-hits-frozen-candidate-utils.mjs',
  'scripts/m8-batter-hits-untouched-evaluation-utils.mjs',
];

test('frozen M8 Batter Hits scripts pass node syntax checking', () => {
  for (const script of scripts) {
    const output = execFileSync(process.execPath, ['--check', script], {
      encoding: 'utf8',
    });
    assert.equal(output, '');
  }
});
