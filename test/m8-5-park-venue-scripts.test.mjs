import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const scripts = [
  'scripts/m8-5-park-venue-evidence-utils.mjs',
  'scripts/audit-m8-5-park-venue-evidence.mjs',
];

test('M8.5 park venue evidence scripts pass node syntax checking', () => {
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
