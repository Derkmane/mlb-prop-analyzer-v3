import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const SCRIPT_PATHS = Object.freeze([
  'scripts/bootstrap-m10-archive-ledger.mjs',
  'scripts/m10-selected-side-grade-metrics-utils.mjs',
  'scripts/build-m10-selected-side-cumulative-grades.mjs',
]);

test('archive bootstrap, selected-side, and cumulative grading scripts pass Node syntax checking', () => {
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
