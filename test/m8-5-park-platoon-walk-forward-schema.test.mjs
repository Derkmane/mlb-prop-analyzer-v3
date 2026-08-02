import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adaptFrozenPlatoonWalkForwardArtifact,
} from '../scripts/m8-5-park-platoon-walk-forward-schema-utils.mjs';

const SHA = 'a'.repeat(64);

function artifact(overrides = {}) {
  return {
    platoonWalkForwardVersion: 1,
    platoonWalkForwardSha256: SHA,
    status: 'offline-resolved-categorical-platoon-walk-forward-not-production-model',
    ...overrides,
  };
}

test('adapts the canonical platoon walk-forward identity without changing serialized evidence', () => {
  const source = artifact();
  const sourceJson = JSON.stringify(source);
  const adapted = adaptFrozenPlatoonWalkForwardArtifact(source);

  assert.notEqual(adapted, source);
  assert.equal(adapted.walkForwardSha256, SHA);
  assert.equal(adapted.platoonWalkForwardSha256, SHA);
  assert.equal(Object.keys(adapted).includes('walkForwardSha256'), false);
  assert.equal(JSON.stringify(adapted), sourceJson);
  assert.equal(Object.hasOwn(source, 'walkForwardSha256'), false);
  assert.equal(Object.isFrozen(adapted), true);
});

test('rejects missing, malformed, or conflicting platoon walk-forward identities', () => {
  assert.throws(
    () => adaptFrozenPlatoonWalkForwardArtifact(artifact({ platoonWalkForwardVersion: 2 })),
    /version must equal 1/,
  );
  assert.throws(
    () => adaptFrozenPlatoonWalkForwardArtifact(artifact({ platoonWalkForwardSha256: 'bad' })),
    /lowercase SHA-256/,
  );
  assert.throws(
    () =>
      adaptFrozenPlatoonWalkForwardArtifact(
        artifact({ walkForwardSha256: 'b'.repeat(64) }),
      ),
    /alias conflicts/,
  );
});
