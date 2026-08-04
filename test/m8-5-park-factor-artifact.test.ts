import assert from 'node:assert/strict';
import test from 'node:test';

import { TERMINAL_PA_CATEGORIES } from '../src/domain/terminal-pa.js';
import {
  applyM8_5ParkTransformationV1,
  createM8_5ParkFactorArtifactV1,
  createValidatedM8_5BatterHitsFactorArtifactV1,
  resolveM8_5ParkTransformationV1,
  verifyM8_5ParkFactorArtifactV1,
  type M8_5ParkBatterHand,
  type M8_5ParkEffectIdentityV1,
  type M8_5ParkTransformationEffect,
} from '../src/features/batter-hits/index.js';

const HANDS: readonly M8_5ParkBatterHand[] = Object.freeze(['L', 'R', 'S']);
const VENUES = Object.freeze(['Park A', 'Park B']);

function effect(
  hand: M8_5ParkBatterHand,
  hitMultiplier: number,
): M8_5ParkTransformationEffect {
  return Object.freeze({
    kind: 'park-transformation' as const,
    applicationStage:
      'terminal-outcome-before-statistic-distribution' as const,
    batterHand: hand,
    relativeRateMultipliers: Object.freeze(
      TERMINAL_PA_CATEGORIES.map((category) =>
        Object.freeze({
          category,
          multiplier:
            category === '1B'
              ? hitMultiplier
              : category === 'BIP_OUT'
                ? 2 - hitMultiplier
                : 1,
        }),
      ),
    ),
  });
}

function artifact() {
  const effects: M8_5ParkTransformationEffect[] = [];
  const effectIdentities: M8_5ParkEffectIdentityV1[] = [];
  for (const [venueIndex, venue] of VENUES.entries()) {
    for (const hand of HANDS) {
      const effectIndex = effects.length;
      effects.push(effect(hand, venueIndex === 0 ? 1.2 : 0.8));
      effectIdentities.push({ venue, batterHand: hand, effectIndex });
    }
  }
  const typedFactorArtifact = createValidatedM8_5BatterHitsFactorArtifactV1({
    factorKey: 'park',
    modelVersion: 'm8-5-park-venue-hand-pool-2500-v1',
    requiredInputs: [
      'exactProviderVenue',
      'batterHand',
      'frozenBaseTerminalOutcomeProbabilities',
    ],
    sourceEvidenceVersion: 'synthetic-park-evaluation-v1',
    validationEvidence: {
      fitPeriod: { start: '2026-05-01', end: '2026-06-30' },
      validationPeriod: { start: '2026-07-01', end: '2026-07-20' },
      walkForwardEvaluated: true,
      untouchedRowsIncluded: false,
      evidenceArtifactSha256: '1'.repeat(64),
    },
    effects,
  });
  return createM8_5ParkFactorArtifactV1({
    sourceVenueAuditSha256: '2'.repeat(64),
    sourceEvaluationDatasetSha256: '3'.repeat(64),
    sourceEvaluationSha256: '4'.repeat(64),
    sourceFrozenBaseParitySha256: '5'.repeat(64),
    sourceFrozenPredictionSha256: '6'.repeat(64),
    typedFactorArtifact,
    effectIdentities,
  });
}

function baseVector() {
  return TERMINAL_PA_CATEGORIES.map((category) => ({
    category,
    probability:
      category === '1B' ? 0.2 : category === 'BIP_OUT' ? 0.4 : 0.4 / 13,
  }));
}

test('resolves one exact provider venue and batter hand without selected-side input', () => {
  const parkArtifact = artifact();
  const resolution = resolveM8_5ParkTransformationV1(parkArtifact, {
    venue: 'Park A',
    batterHand: 'L',
  });

  assert.equal(resolution.venue, 'Park A');
  assert.equal(resolution.batterHand, 'L');
  assert.equal(
    resolution.relativeRateMultipliers.find((entry) => entry.category === '1B')
      ?.multiplier,
    1.2,
  );
  assert.equal(parkArtifact.productionEnabled, false);
  assert.equal(
    parkArtifact.typedFactorArtifact.selectedSideInputAllowed,
    false,
  );
  assert.equal(
    parkArtifact.typedFactorArtifact.directProbabilityEffectAllowed,
    false,
  );
});

test('applies the park multiplier to the terminal vector and renormalizes once', () => {
  const parkArtifact = artifact();
  const up = resolveM8_5ParkTransformationV1(parkArtifact, {
    venue: 'Park A',
    batterHand: 'R',
  });
  const down = resolveM8_5ParkTransformationV1(parkArtifact, {
    venue: 'Park B',
    batterHand: 'R',
  });
  const base = baseVector();
  const upVector = applyM8_5ParkTransformationV1(base, up);
  const downVector = applyM8_5ParkTransformationV1(base, down);
  const baseHit = base
    .filter((entry) => ['1B', '2B', '3B', 'HR'].includes(entry.category))
    .reduce((sum, entry) => sum + entry.probability, 0);
  const upHit = upVector
    .filter((entry) => ['1B', '2B', '3B', 'HR'].includes(entry.category))
    .reduce((sum, entry) => sum + entry.probability, 0);
  const downHit = downVector
    .filter((entry) => ['1B', '2B', '3B', 'HR'].includes(entry.category))
    .reduce((sum, entry) => sum + entry.probability, 0);

  assert.ok(upHit > baseHit);
  assert.ok(downHit < baseHit);
  assert.ok(
    Math.abs(upVector.reduce((sum, entry) => sum + entry.probability, 0) - 1) <
      1e-12,
  );
  assert.deepEqual(
    upVector.map((entry) => entry.category),
    TERMINAL_PA_CATEGORIES,
  );
});

test('fails closed on unknown venues, selected-side fields, aliases, and incomplete mappings', () => {
  const parkArtifact = artifact();
  assert.throws(
    () =>
      resolveM8_5ParkTransformationV1(parkArtifact, {
        venue: 'Unknown Park',
        batterHand: 'L',
      }),
    /has no effect/u,
  );
  assert.throws(
    () =>
      resolveM8_5ParkTransformationV1(parkArtifact, {
        venue: 'Park A',
        batterHand: 'L',
        selectedSide: 'higher',
      }),
    /unexpected field selectedSide/u,
  );
  assert.throws(
    () =>
      resolveM8_5ParkTransformationV1(parkArtifact, {
        venue: ' Park A',
        batterHand: 'L',
      }),
    /exact nonblank provider venue text/u,
  );
  assert.throws(
    () =>
      verifyM8_5ParkFactorArtifactV1({
        ...parkArtifact,
        effectIdentities: parkArtifact.effectIdentities.slice(1),
      }),
    /must map every typed park effect exactly once/u,
  );
});

test('rejects effect-index drift, wrong hand mapping, and artifact hash drift', () => {
  const parkArtifact = artifact();
  const identities = parkArtifact.effectIdentities.map((identity) => ({
    ...identity,
  }));
  identities[0]!.effectIndex = 1;
  assert.throws(
    () =>
      verifyM8_5ParkFactorArtifactV1({
        ...parkArtifact,
        effectIdentities: identities,
      }),
    /does not match mapped batter hand|duplicate park effect index/u,
  );
  assert.throws(
    () =>
      verifyM8_5ParkFactorArtifactV1({
        ...parkArtifact,
        sourceEvaluationSha256: '7'.repeat(64),
      }),
    /parkArtifactSha256/u,
  );
});

test('identical park inputs produce one deterministic wrapper identity', () => {
  const first = artifact();
  const second = artifact();
  assert.deepEqual(first, second);
  assert.equal(first.parkArtifactSha256, second.parkArtifactSha256);
});
