import assert from 'node:assert/strict';
import test from 'node:test';

import { TERMINAL_PA_CATEGORIES } from '../src/domain/terminal-pa.js';
import {
  M8_5_BATTER_HITS_BATTED_BALL_CATEGORIES,
  M8_5_BATTER_HITS_EFFECT_KINDS,
  createDisabledM8_5BatterHitsFactorArtifactV1,
  createValidatedM8_5BatterHitsFactorArtifactV1,
  verifyM8_5BatterHitsFactorArtifactV1,
  type M8_5BatterHitsContextEffect,
} from '../src/features/batter-hits/index.js';

type NonIdentityEffect = Exclude<
  M8_5BatterHitsContextEffect,
  { readonly kind: 'identity' }
>;

const EVIDENCE = Object.freeze({
  fitPeriod: Object.freeze({ start: '2026-03-25', end: '2026-06-30' }),
  validationPeriod: Object.freeze({ start: '2026-07-01', end: '2026-07-20' }),
  walkForwardEvaluated: true as const,
  untouchedRowsIncluded: false as const,
  evidenceArtifactSha256:
    '1111111111111111111111111111111111111111111111111111111111111111',
});

const TERMINAL_VECTOR = Object.freeze(
  TERMINAL_PA_CATEGORIES.map((category) =>
    Object.freeze({
      category,
      probability: 1 / TERMINAL_PA_CATEGORIES.length,
    }),
  ),
);

function validatedArtifact(effect: NonIdentityEffect) {
  return createValidatedM8_5BatterHitsFactorArtifactV1({
    factorKey: 'teamSpecificBullpen',
    modelVersion: `test-${effect.kind}-v1`,
    requiredInputs: ['providerGameId', 'providerTeamId'],
    sourceEvidenceVersion: 'synthetic-contract-test-v1',
    validationEvidence: EVIDENCE,
    effects: [effect],
  });
}

const EFFECTS: readonly NonIdentityEffect[] = Object.freeze([
  Object.freeze({
    kind: 'terminal-outcome-vector' as const,
    applicationStage: 'terminal-outcome-before-statistic-distribution' as const,
    scope: 'bullpen' as const,
    matchupKey: 'team-100-vs-R',
    categoryProbabilities: TERMINAL_VECTOR,
  }),
  Object.freeze({
    kind: 'scenario-mixture' as const,
    applicationStage: 'shared-scenario-before-statistic-distribution' as const,
    scenarioWeights: Object.freeze([
      Object.freeze({ scenarioId: 'low', weight: 0.4 }),
      Object.freeze({ scenarioId: 'high', weight: 0.6 }),
    ]),
  }),
  Object.freeze({
    kind: 'opportunity-survival' as const,
    applicationStage: 'opportunity-before-count-conversion' as const,
    lineupSlot: 3 as const,
    survivalProbabilities: Object.freeze([1, 0.92, 0.71, 0.38]),
  }),
  Object.freeze({
    kind: 'workload-transition' as const,
    applicationStage: 'workload-before-shared-scenario-mixing' as const,
    teamSide: 'away' as const,
    transitionRows: Object.freeze([
      Object.freeze({
        fromState: 'starter-active',
        destinations: Object.freeze([
          Object.freeze({ toState: 'starter-active', probability: 0.65 }),
          Object.freeze({ toState: 'bullpen-active', probability: 0.35 }),
        ]),
      }),
    ]),
  }),
  Object.freeze({
    kind: 'park-transformation' as const,
    applicationStage: 'terminal-outcome-before-statistic-distribution' as const,
    batterHand: 'L' as const,
    relativeRateMultipliers: Object.freeze([
      Object.freeze({ category: '1B' as const, multiplier: 1.04 }),
      Object.freeze({ category: 'BIP_OUT' as const, multiplier: 0.98 }),
    ]),
  }),
  Object.freeze({
    kind: 'batted-ball-translation' as const,
    applicationStage: 'terminal-outcome-before-statistic-distribution' as const,
    teamSide: 'home' as const,
    transitionRows: Object.freeze([
      Object.freeze({
        fromCategory: 'BIP_OUT' as const,
        destinations: Object.freeze([
          Object.freeze({ category: 'BIP_OUT' as const, probability: 0.9 }),
          Object.freeze({ category: '1B' as const, probability: 0.1 }),
        ]),
      }),
    ]),
  }),
]);

test('typed factor contract exposes every approved non-identity baseball effect kind', () => {
  assert.deepEqual(M8_5_BATTER_HITS_EFFECT_KINDS, [
    'identity',
    'terminal-outcome-vector',
    'scenario-mixture',
    'opportunity-survival',
    'workload-transition',
    'park-transformation',
    'batted-ball-translation',
  ]);
  assert.deepEqual(M8_5_BATTER_HITS_BATTED_BALL_CATEGORIES, [
    '1B',
    '2B',
    '3B',
    'ROE',
    'FC',
    'SF',
    'SH',
    'BIP_OUT',
  ]);
  for (const effect of EFFECTS) {
    const artifact = validatedArtifact(effect);
    assert.equal(artifact.effects[0]?.kind, effect.kind);
    assert.equal(artifact.productionEnabled, false);
    assert.equal(artifact.selectedSideInputAllowed, false);
    assert.equal(artifact.directProbabilityEffectAllowed, false);
  }
});

test('every factor defaults to one explicit disabled identity effect', () => {
  const artifact = createDisabledM8_5BatterHitsFactorArtifactV1({
    factorKey: 'park',
    requiredInputs: ['venueId', 'batterHand'],
    sourceEvidenceVersion: 'park-deferred-v1',
  });

  assert.equal(artifact.status, 'disabled');
  assert.deepEqual(artifact.effects, [
    {
      kind: 'identity',
      applicationStage: 'identity',
    },
  ]);
  assert.match(artifact.artifactSha256, /^[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(artifact), true);
});

test('selected-side and direct-probability fields fail closed', () => {
  const artifact = validatedArtifact(EFFECTS[0]!);

  assert.throws(
    () => verifyM8_5BatterHitsFactorArtifactV1({ ...artifact, selectedSide: 'higher' }),
    /unexpected field selectedSide/u,
  );
  assert.throws(
    () => verifyM8_5BatterHitsFactorArtifactV1({ ...artifact, probabilityDelta: 0.05 }),
    /unexpected field probabilityDelta/u,
  );
  assert.throws(
    () =>
      verifyM8_5BatterHitsFactorArtifactV1({
        ...artifact,
        effects: [{ ...artifact.effects[0], coefficient: 1 }],
      }),
    /unexpected field coefficient/u,
  );
});

test('wrong season, unknown factor keys, missing evidence, and hash drift fail closed', () => {
  const artifact = validatedArtifact(EFFECTS[1]!);

  assert.throws(
    () => verifyM8_5BatterHitsFactorArtifactV1({ ...artifact, activeSeason: 2025 }),
    /activeSeason/u,
  );
  assert.throws(
    () => verifyM8_5BatterHitsFactorArtifactV1({ ...artifact, factorKey: 'mystery' }),
    /factorKey/u,
  );
  assert.throws(
    () => verifyM8_5BatterHitsFactorArtifactV1({ ...artifact, validationEvidence: null }),
    /validationEvidence/u,
  );
  assert.throws(
    () => verifyM8_5BatterHitsFactorArtifactV1({ ...artifact, modelVersion: 'tampered' }),
    /artifactSha256/u,
  );
});

test('effect schemas conserve their own probability structures and reject malformed payloads', () => {
  const scenario = validatedArtifact(EFFECTS[1]!);
  assert.throws(
    () =>
      verifyM8_5BatterHitsFactorArtifactV1({
        ...scenario,
        effects: [{ ...scenario.effects[0], scenarioWeights: [
          { scenarioId: 'low', weight: 0.7 },
          { scenarioId: 'high', weight: 0.7 },
        ] }],
      }),
    /scenarioWeights must sum to 1/u,
  );

  const survival = validatedArtifact(EFFECTS[2]!);
  assert.throws(
    () =>
      verifyM8_5BatterHitsFactorArtifactV1({
        ...survival,
        effects: [{ ...survival.effects[0], survivalProbabilities: [1, 0.7, 0.8] }],
      }),
    /monotone non-increasing/u,
  );

  const defense = validatedArtifact(EFFECTS[5]!);
  assert.throws(
    () =>
      verifyM8_5BatterHitsFactorArtifactV1({
        ...defense,
        effects: [{
          ...defense.effects[0],
          transitionRows: [{
            fromCategory: 'BIP_OUT',
            destinations: [{ category: 'HR', probability: 1 }],
          }],
        }],
      }),
    /batted-ball category/u,
  );
});

test('identical versioned factor inputs produce identical deterministic artifacts', () => {
  const input = {
    factorKey: 'gameSpecificOffensiveEnvironment' as const,
    modelVersion: 'test-scenario-mixture-v1',
    requiredInputs: ['providerGameId'],
    sourceEvidenceVersion: 'synthetic-contract-test-v1',
    validationEvidence: EVIDENCE,
    effects: [EFFECTS[1]!] as const,
  };
  const first = createValidatedM8_5BatterHitsFactorArtifactV1(input);
  const second = createValidatedM8_5BatterHitsFactorArtifactV1(input);

  assert.deepEqual(first, second);
  assert.equal(first.artifactSha256, second.artifactSha256);
});