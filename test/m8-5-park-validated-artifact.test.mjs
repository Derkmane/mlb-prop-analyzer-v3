import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ARTIFACT_PATH = 'model-artifacts/m8-5-park-transformation-v1.json';
const EXPECTED_FILE_SHA256 =
  'efc8f4b91eb00d5a961ace09dda951a08a008011791be6e43160d6fef64015ae';
const EXPECTED_PARK_ARTIFACT_SHA256 =
  'f1bd0d83997dd1efede69fa3ab69162938dd5df7d65732d44ec1f9689eaf85f9';
const EXPECTED_TYPED_ARTIFACT_SHA256 =
  'c70550bd4798bd5ad6de7263801a7794b2c4eba8d2c86957d0992e3591aee985';
const EXPECTED_EVALUATION_SHA256 =
  'd715419f9bcbb118540f11f7431729f56ab85b12cc3ab7311216417006b690b9';
const EXPECTED_DATASET_SHA256 =
  '074af50e2a881e7ab8df47480bc67e68c15ce03987bf153a587c86bb249712bb';
const EXPECTED_VENUE_AUDIT_SHA256 =
  '69aab27d1aa798e197b38e4a8a1a6538965265e5833d944acb115df34c165338';
const EXPECTED_FROZEN_BASE_PARITY_SHA256 =
  '2c342da6b903585713b3a6fc23debb907e5b6a763dd559fb2fc90de292cbcf2a';
const EXPECTED_FROZEN_PREDICTION_SHA256 =
  'df0dc84fab7baf05fa69f4e892cf76705064eb8603c6c9cb3e46d1100b280547';
const HANDS = ['L', 'R', 'S'];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('locks the validated real M8.5 park artifact, exact venue coverage, and safety boundary', async () => {
  const text = await readFile(ARTIFACT_PATH, 'utf8');
  assert.equal(sha256(text), EXPECTED_FILE_SHA256);

  const artifact = JSON.parse(text);
  assert.equal(artifact.parkArtifactVersion, 1);
  assert.equal(artifact.parkArtifactSha256, EXPECTED_PARK_ARTIFACT_SHA256);
  assert.equal(artifact.factorKey, 'park');
  assert.equal(artifact.activeSeason, 2026);
  assert.equal(
    artifact.modelVersion,
    'm8-5-park-venue-hand-pool-2500-v1',
  );
  assert.equal(artifact.productionEnabled, false);
  assert.equal(
    artifact.sourceVenueAuditSha256,
    EXPECTED_VENUE_AUDIT_SHA256,
  );
  assert.equal(
    artifact.sourceEvaluationDatasetSha256,
    EXPECTED_DATASET_SHA256,
  );
  assert.equal(
    artifact.sourceEvaluationSha256,
    EXPECTED_EVALUATION_SHA256,
  );
  assert.equal(
    artifact.sourceFrozenBaseParitySha256,
    EXPECTED_FROZEN_BASE_PARITY_SHA256,
  );
  assert.equal(
    artifact.sourceFrozenPredictionSha256,
    EXPECTED_FROZEN_PREDICTION_SHA256,
  );
  assert.equal(artifact.providerVenueTextPreservedExactly, true);
  assert.equal(artifact.homeTeamVenueInferenceUsed, false);
  assert.equal(artifact.venueAliasMergingUsed, false);
  assert.equal(artifact.untouchedTestReservation.rowsIncluded, false);

  const factor = artifact.typedFactorArtifact;
  assert.equal(factor.artifactSha256, EXPECTED_TYPED_ARTIFACT_SHA256);
  assert.equal(factor.factorKey, 'park');
  assert.equal(factor.status, 'validated');
  assert.equal(factor.validationStatus, 'current-season-validated');
  assert.equal(factor.productionEnabled, false);
  assert.equal(factor.selectedSideInputAllowed, false);
  assert.equal(factor.directProbabilityEffectAllowed, false);
  assert.deepEqual(factor.requiredInputs, [
    'exactProviderVenue',
    'batterHand',
    'frozenBaseTerminalOutcomeProbabilities',
  ]);
  assert.deepEqual(factor.validationEvidence.fitPeriod, {
    start: '2026-05-26',
    end: '2026-06-21',
  });
  assert.deepEqual(factor.validationEvidence.validationPeriod, {
    start: '2026-06-22',
    end: '2026-07-05',
  });
  assert.equal(factor.validationEvidence.walkForwardEvaluated, true);
  assert.equal(factor.validationEvidence.untouchedRowsIncluded, false);
  assert.equal(
    factor.validationEvidence.evidenceArtifactSha256,
    EXPECTED_EVALUATION_SHA256,
  );
  assert.equal(factor.untouchedTestReservation.rowsIncluded, false);

  assert.equal(factor.effects.length, 96);
  assert.equal(artifact.effectIdentities.length, 96);
  const venueHands = new Map();
  for (const identity of artifact.effectIdentities) {
    assert.equal(typeof identity.venue, 'string');
    assert.ok(identity.venue.length > 0);
    assert.ok(HANDS.includes(identity.batterHand));
    assert.equal(Number.isSafeInteger(identity.effectIndex), true);
    const effect = factor.effects[identity.effectIndex];
    assert.notEqual(effect, undefined);
    assert.equal(effect.kind, 'park-transformation');
    assert.equal(effect.batterHand, identity.batterHand);
    assert.equal(
      effect.applicationStage,
      'terminal-outcome-before-statistic-distribution',
    );
    assert.equal(effect.relativeRateMultipliers.length, 15);
    assert.equal(Object.hasOwn(effect, 'selectedSide'), false);
    assert.equal(Object.hasOwn(effect, 'probabilityDelta'), false);
    assert.equal(Object.hasOwn(effect, 'coefficient'), false);

    const hands = venueHands.get(identity.venue) ?? new Set();
    assert.equal(hands.has(identity.batterHand), false);
    hands.add(identity.batterHand);
    venueHands.set(identity.venue, hands);
  }

  assert.equal(venueHands.size, 32);
  for (const hands of venueHands.values()) {
    assert.deepEqual([...hands].sort(), HANDS);
  }
});
