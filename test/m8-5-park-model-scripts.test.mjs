import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

for (const script of [
  'scripts/m8-5-park-candidate-selection-utils.mjs',
  'scripts/m8-5-park-model-utils.mjs',
  'scripts/evaluate-m8-5-park-model.mjs',
]) {
  test(`${script} passes node syntax checking`, () => {
    const result = spawnSync(process.execPath, ['--check', script], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
}
