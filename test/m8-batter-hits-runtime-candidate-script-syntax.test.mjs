import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('complete M8 Batter Hits candidate script passes node syntax checking', () => {
  const output = execFileSync(
    process.execPath,
    ['--check', 'scripts/m8-batter-hits-runtime-candidate-utils.mjs'],
    { encoding: 'utf8' },
  );
  assert.equal(output, '');
});
