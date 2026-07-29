import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const scripts = [
  'scripts/m8-park-venue-lineage-utils.mjs',
  'scripts/build-m8-park-venue-lineage.mjs',
];

test('park venue lineage scripts pass node syntax checking', () => {
  for (const script of scripts) {
    const output = execFileSync(process.execPath, ['--check', script], {
      encoding: 'utf8',
    });
    assert.equal(output, '');
  }
});
