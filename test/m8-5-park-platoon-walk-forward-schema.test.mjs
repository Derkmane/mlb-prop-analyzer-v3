import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  finalizeM8_5ParkFrozenBaseParity,
  verifyAndAdaptFrozenPlatoonWalkForwardArtifact,
} from '../scripts/m8-5-park-platoon-walk-forward-schema-utils.mjs';

const COHERENT_SHA = 'a'.repeat(64);
const COHERENT_FILE_SHA = 'b'.repeat(64);
const BOUNDARY_SHA = 'c'.repeat(64);
const DERIVED_SHA = 'd'.repeat(64);

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function boundary(overrides = {}) {
  return {
    sourceWalkForwardSha256: COHERENT_SHA,
    sourceWalkForwardFileSha256: COHERENT_FILE_SHA,
    platoonEvaluationSha256: BOUNDARY_SHA,
    ...overrides,
  };
}

function artifact(boundaryText, overrides = {}) {
  return {
    platoonWalkForwardVersion: 1,
    platoonWalkForwardSha256: DERIVED_SHA,
    sourceCoherentWalkForwardSha256: COHERENT_SHA,
    sourceCoherentWalkForwardFileSha256: COHERENT_FILE_SHA,
    sourcePlatoonBoundarySha256: BOUNDARY_SHA,
    sourcePlatoonBoundaryFileSha256: sha256(boundaryText),
    status: 'offline-resolved-categorical-platoon-walk-forward-not-production-model',
    ...overrides,
  };
}

function lineage(overrides = {}) {
  const platoonBoundary = overrides.platoonBoundary ?? boundary();
  const platoonBoundaryText =
    overrides.platoonBoundaryText ?? JSON.stringify(platoonBoundary);
  const walkForwardArtifact =
    overrides.artifact ?? artifact(platoonBoundaryText);
  return {
    artifact: walkForwardArtifact,
    artifactText: overrides.artifactText ?? JSON.stringify(walkForwardArtifact),
    platoonBoundary,
    platoonBoundaryText,
  };
}

test('keeps coherent source, platoon boundary, and derived walk-forward identities distinct', () => {
  const source = lineage();
  const sourceJson = JSON.stringify(source.artifact);
  const result = verifyAndAdaptFrozenPlatoonWalkForwardArtifact(source);

  assert.notEqual(result.adaptedArtifact, source.artifact);
  assert.equal(result.adaptedArtifact.walkForwardSha256, COHERENT_SHA);
  assert.equal(result.adaptedArtifact.platoonWalkForwardSha256, DERIVED_SHA);
  assert.equal(result.coherentSourceIdentity, COHERENT_SHA);
  assert.equal(result.canonicalIdentity, DERIVED_SHA);
  assert.equal(
    Object.keys(result.adaptedArtifact).includes('walkForwardSha256'),
    false,
  );
  assert.equal(JSON.stringify(result.adaptedArtifact), sourceJson);
  assert.equal(Object.hasOwn(source.artifact, 'walkForwardSha256'), false);
  assert.equal(Object.isFrozen(result.adaptedArtifact), true);

  const finalized = finalizeM8_5ParkFrozenBaseParity({
    parity: {
      parityVersion: 1,
      sourcePlatoonWalkForwardSha256: COHERENT_SHA,
      predictionSha256: 'e'.repeat(64),
      paritySha256: 'f'.repeat(64),
      predictions: [{ observationId: 'validation:1' }],
    },
    canonicalPlatoonWalkForwardSha256: result.canonicalIdentity,
  });
  assert.equal(finalized.sourcePlatoonWalkForwardSha256, DERIVED_SHA);
  assert.notEqual(finalized.paritySha256, 'f'.repeat(64));
  assert.deepEqual(finalized.predictions, [{ observationId: 'validation:1' }]);
});

test('rejects swapped or drifted coherent, boundary, and derived identities', () => {
  assert.throws(
    () =>
      verifyAndAdaptFrozenPlatoonWalkForwardArtifact(
        lineage({
          artifact: artifact(JSON.stringify(boundary()), {
            sourceCoherentWalkForwardSha256: DERIVED_SHA,
          }),
        }),
      ),
    /coherent source identity must equal/,
  );

  const mismatchedBoundary = boundary({ platoonEvaluationSha256: '1'.repeat(64) });
  const mismatchedBoundaryText = JSON.stringify(mismatchedBoundary);
  assert.throws(
    () =>
      verifyAndAdaptFrozenPlatoonWalkForwardArtifact({
        artifact: artifact(mismatchedBoundaryText, {
          sourcePlatoonBoundarySha256: BOUNDARY_SHA,
        }),
        artifactText: JSON.stringify(
          artifact(mismatchedBoundaryText, {
            sourcePlatoonBoundarySha256: BOUNDARY_SHA,
          }),
        ),
        platoonBoundary: mismatchedBoundary,
        platoonBoundaryText: mismatchedBoundaryText,
      }),
    /boundary source identity must equal/,
  );

  assert.throws(
    () =>
      finalizeM8_5ParkFrozenBaseParity({
        parity: {
          sourcePlatoonWalkForwardSha256: DERIVED_SHA,
          predictions: [],
        },
        canonicalPlatoonWalkForwardSha256: DERIVED_SHA,
      }),
    /must remain distinct/,
  );
});

test('rejects malformed serialized evidence and unsupported versions', () => {
  assert.throws(
    () =>
      verifyAndAdaptFrozenPlatoonWalkForwardArtifact(
        lineage({ artifactText: '{bad' }),
      ),
    /not valid JSON/,
  );
  assert.throws(
    () =>
      verifyAndAdaptFrozenPlatoonWalkForwardArtifact(
        lineage({
          artifact: artifact(JSON.stringify(boundary()), {
            platoonWalkForwardVersion: 2,
          }),
        }),
      ),
    /version must equal 1/,
  );
});
