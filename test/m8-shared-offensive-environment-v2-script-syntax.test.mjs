import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const scripts = [
  'scripts/m8-starter-bullpen-transition-utils.mjs',
  'scripts/m8-shared-offensive-environment-v2-utils.mjs',
  'scripts/run-m8-shared-offensive-environment-v2-gate.mjs',
];

test('shared environment v2 scripts pass node syntax checking', () => {
  for (const script of scripts) {
    const output = execFileSync(process.execPath, ['--check', script], { encoding: 'utf8' });
    assert.equal(output, '');
  }
});
