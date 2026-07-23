import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const fixtureRoot = 'test/architecture/fixtures/src';

test('protective architecture check rejects domain importing an adapter', () => {
  const result = spawnSync(
    'npm',
    [
      'exec',
      '--',
      'depcruise',
      '--config',
      '.dependency-cruiser.cjs',
      fixtureRoot,
      '--include-only',
      `^${fixtureRoot}`,
      '--output-type',
      'err',
    ],
    { encoding: 'utf8' },
  );

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  assert.notEqual(result.status, 0, 'the deliberately forbidden dependency must fail');
  assert.match(output, /domain-no-outward-dependencies/);
});
