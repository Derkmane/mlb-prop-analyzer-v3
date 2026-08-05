import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

test('temporary M9 commence-time correction transport files are absent', async () => {
  await Promise.all([
    assert.rejects(
      access('scripts/__apply-m9-commence-time-join.mjs'),
      /ENOENT/u,
    ),
    assert.rejects(
      access('scripts/__patch-m9-commence-test-expectations.mjs'),
      /ENOENT/u,
    ),
    assert.rejects(
      access('.github/workflows/__apply-m9-commence-time-join.yml'),
      /ENOENT/u,
    ),
  ]);
});
