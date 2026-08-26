import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const SCRIPT_PATHS = Object.freeze([
  'scripts/m10-category-performance-utils.mjs',
  'scripts/build-m10-category-performance.mjs',
]);

test('category performance scripts pass Node syntax checking', () => {
  for (const scriptPath of SCRIPT_PATHS) {
    const result = spawnSync(process.execPath, ['--check', scriptPath], {
      encoding: 'utf8',
    });
    assert.equal(
      result.status,
      0,
      `${scriptPath}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
});
