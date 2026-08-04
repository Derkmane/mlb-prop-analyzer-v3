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
const HISTORICAL_BOUNDARY_FILE_SHA = 'e'.repeat(64);

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

function artifact(overrides = {}) {
  return {
    platoonWalkForwardVersion: 1,
    platoonWalkForwardSha256: DERIVED_SHA,
    sourceCoherentWalkForwardSha256: COHERENT_SHA,
    sourceCoherentWalkForwardFileSha256: COHERENT_FILE_SHA,
    sourcePlatoonBoundarySha256: BOUNDARY_SHA,
    sourcePlatoonBoundaryFileSha256: HISTORICAL_BOUNDARY_FILE_SHA,
    status: 'offline-resolved-categorical-platoon-walk-forward-not-production-model',
    ...overrides,
  };
}

function terminalPaOutcome(boundaryText, overrides = {}) {
  return {
    artifactVersion: 1,
    modelVersion: 'm8-terminal-pa-outcome-v1',
    productionEnabled: false,
    sourcePlatoonEvaluationSha256: BOUNDARY_SHA,
    sourcePlatoonEvaluationFileSha256: sha256(boundaryText),
    ...overrides,
  };
}

function lineage(overrides = {}) {
  const platoonBoundary = overrides.platoonBoundary ?? boundary();
  const platoonBoundaryText =
    overrides.platoonBoundaryText ?? JSON.stringify(platoonBoundary);
  const walkForwardArtifact = overrides.artifact ?? artifact();
  const terminal =
    overrides.terminalPaOutcome ?? terminalPaOutcome(platoonBoundaryText);
  return {
    artifact: walkForwardArtifact,
    artifactText: overrides.artifactText ?? JSON.stringify(walkForwardArtifact),
    platoonBoundary,
    platoonBoundaryText,
    terminalPaOutcome: terminal,
    terminalPaOutcomeText:
      overrides.terminalPaOutcomeText ?? JSON.stringify(terminal),
  };
}

test('authenticates current boundary bytes separately from preserved historical lineage bytes', () => {
  const source = lineage();
  const sourceJson = JSON.stringify(source.artifact);
  const result = verifyAndAdaptFrozenPlatoonWalkForwardArtifact(source);

  assert.notEqual(result.adaptedArtifact, source.artifact);
  assert.equal(result.adaptedArtifact.walkForwardSha256, COHERENT_SHA);
  assert.equal(result.adaptedArtifact.platoonWalkForwardSha256, DERIVED_SHA);
  assert.equal(result.coherentSourceIdentity, COHERENT_SHA);
  assert.equal(result.canonicalIdentity, DERIVED_SHA);
  assert.equal(result.boundaryIdentity, BOUNDARY_SHA);
  assert.equal(
    result.historicalBoundaryFileIdentity,
    HISTORICAL_BOUNDARY_FILE_SHA,
  );
  assert.equal(
    result.currentBoundaryFileIdentity,
    sha256(source.platoonBoundaryText),
  );
  assert.notEqual(
    result.historicalBoundaryFileIdentity,
    result.currentBoundaryFileIdentity,
  );
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
      predictionSha256: 'f'.repeat(64),
      paritySha256: '0'.repeat(64),
      predictions: [{ observationId: 'validation:1' }],
    },
    canonicalPlatoonWalkForwardSha256: result.canonicalIdentity,
  });
  assert.equal(finalized.sourcePlatoonWalkForwardSha256, DERIVED_SHA);
  assert.notEqual(finalized.paritySha256, '0'.repeat(64));
  assert.deepEqual(finalized.predictions, [{ observationId: 'validation:1' }]);
});

test('rejects swapped or drifted coherent, boundary, and derived identities', () => {
  assert.throws(
    () =>
      verifyAndAdaptFrozenPlatoonWalkForwardArtifact(
        lineage({
          artifact: artifact({
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
      verifyAndAdaptFrozenPlatoonWalkForwardArtifact(
        lineage({
          artifact: artifact({ sourcePlatoonBoundarySha256: BOUNDARY_SHA }),
          platoonBoundary: mismatchedBoundary,
          platoonBoundaryText: mismatchedBoundaryText,
          terminalPaOutcome: terminalPaOutcome(mismatchedBoundaryText, {
            sourcePlatoonEvaluationSha256: BOUNDARY_SHA,
          }),
        }),
      ),
    /boundary source identity must equal/,
  );

  assert.throws(
    () =>
      verifyAndAdaptFrozenPlatoonWalkForwardArtifact(
        lineage({
          terminalPaOutcome: terminalPaOutcome(
            JSON.stringify(boundary()),
            { sourcePlatoonEvaluationSha256: '2'.repeat(64) },
          ),
        }),
      ),
    /terminal PA outcome boundary source identity must equal/,
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

test('rejects tampered current boundary bytes even when historical bytes remain preserved', () => {
  const source = lineage();
  const tamperedBoundary = {
    ...source.platoonBoundary,
    harmlessLookingDrift: true,
  };
  const tamperedBoundaryText = JSON.stringify(tamperedBoundary);

  assert.throws(
    () =>
      verifyAndAdaptFrozenPlatoonWalkForwardArtifact({
        ...source,
        platoonBoundary: tamperedBoundary,
        platoonBoundaryText: tamperedBoundaryText,
      }),
    /terminal PA outcome boundary source file identity must equal/,
  );

  assert.throws(
    () =>
      verifyAndAdaptFrozenPlatoonWalkForwardArtifact(
        lineage({
          terminalPaOutcome: terminalPaOutcome(
            JSON.stringify(boundary()),
            { sourcePlatoonEvaluationFileSha256: '3'.repeat(64) },
          ),
        }),
      ),
    /terminal PA outcome boundary source file identity must equal/,
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
        lineage({ terminalPaOutcomeText: '{bad' }),
      ),
    /not valid JSON/,
  );
  assert.throws(
    () =>
      verifyAndAdaptFrozenPlatoonWalkForwardArtifact(
        lineage({ artifact: artifact({ platoonWalkForwardVersion: 2 }) }),
      ),
    /version must equal 1/,
  );
  assert.throws(
    () =>
      verifyAndAdaptFrozenPlatoonWalkForwardArtifact(
        lineage({
          terminalPaOutcome: terminalPaOutcome(JSON.stringify(boundary()), {
            artifactVersion: 2,
          }),
        }),
      ),
    /must be production-disabled m8-terminal-pa-outcome-v1/,
  );
});
