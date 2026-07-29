import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const scripts = [
  'scripts/m8-terminal-pa-outcome-artifact-utils.mjs',
  'scripts/run-m8-terminal-pa-outcome-gate.mjs',
];

test('terminal PA artifact scripts pass node syntax checking', () => {
  for (const script of scripts) {
    const output = execFileSync(process.execPath, ['--check', script], { encoding: 'utf8' });
    assert.equal(output, '');
  }
});
