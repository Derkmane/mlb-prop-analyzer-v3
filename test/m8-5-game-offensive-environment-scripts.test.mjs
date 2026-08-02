import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const SCRIPTS = [
  'scripts/m8-5-game-offensive-environment-feature-dataset-utils.mjs',
  'scripts/m8-5-game-offensive-environment-model-utils.mjs',
  'scripts/evaluate-m8-5-game-offensive-environment.mjs',
];

test('game-specific offensive-environment executable scripts pass node syntax checking', () => {
  for (const script of SCRIPTS) {
    const result = spawnSync(process.execPath, ['--check', script], {
      encoding: 'utf8',
    });
    assert.equal(
      result.status,
      0,
      `${script} failed syntax checking:\n${result.stderr || result.stdout}`,
    );
  }
});
