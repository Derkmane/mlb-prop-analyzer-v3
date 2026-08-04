import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('M8.5 times-through-order executable scripts pass node syntax checking', () => {
  for (const relativePath of [
    'scripts/m8-5-times-through-order-utils.mjs',
    'scripts/evaluate-m8-5-times-through-order.mjs',
  ]) {
    const result = spawnSync(process.execPath, ['--check', path.resolve(relativePath)], {
      encoding: 'utf8',
    });
    assert.equal(
      result.status,
      0,
      `${relativePath} failed syntax checking:\n${result.stdout}\n${result.stderr}`,
    );
  }
});
