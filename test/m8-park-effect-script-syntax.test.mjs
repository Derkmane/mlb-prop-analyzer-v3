import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const scripts = [
  'scripts/m8-park-effect-evaluation-utils.mjs',
  'scripts/evaluate-m8-park-effect.mjs',
];

test('park effect evaluation scripts pass node syntax checking', () => {
  for (const script of scripts) {
    const result = spawnSync(process.execPath, ['--check', script], {
      encoding: 'utf8',
    });
    assert.equal(
      result.status,
      0,
      `${script} failed syntax checking:\n${result.stdout}${result.stderr}`,
    );
  }
});
