import assert from 'node:assert/strict';
import test from 'node:test';

import { TERMINAL_PA_CATEGORIES } from '../src/domain/terminal-pa.js';
import {
  createDisabledM8_5BatterHitsFactorArtifactV1,
  createValidatedM8_5BatterHitsFactorArtifactV1,
  resolveM8_5TeamBullpenOutcomeV1,
  type M8_5TerminalOutcomeVectorEffect,
} from '../src/features/batter-hits/index.js';

const EVIDENCE = Object.freeze({
  fitPeriod: Object.freeze({ start: '2026-03-26', end: '2026-06-21' }),
  validationPeriod: Object.freeze({ start: '2026-06-22', end: '2026-07-05' }),
  walkForwardEvaluated: true as const,
  untouchedRowsIncluded: false as const,
  evidenceArtifactSha256:
    '1111111111111111111111111111111111111111111111111111111111111111',
});

function effect(
  teamId: number,
  hand: 'L' | 'R',
  hitProbability: number,
): M8_5TerminalOutcomeVectorEffect {
  const remaining = (1 - hitProbability) / (TERMINAL_PA_CATEGORIES.length - 1);
  return Object.freeze({
    kind: 'terminal-outcome-vector' as const,
    applicationStage:
      'terminal-outcome-before-statistic-distribution' as const,
    scope: 'bullpen' as const,
    matchupKey: `pitching-team:${teamId}|pitcher-hand:${hand}`,
    categoryProbabilities: Object.freeze(
      TERMINAL_PA_CATEGORIES.map((category) =>
        Object.freeze({
          category,
          probability: category === '1B' ? hitProbability : remaining,
        }),
      ),
    ),
  });
}

function validatedArtifact(
  effects: readonly M8_5TerminalOutcomeVectorEffect[] = [
    effect(100, 'L', 0.2),
    effect(100, 'R', 0.1),
    effect(200, 'L', 0.3),
    effect(200, 'R', 0.15),
  ],
) {
  return createValidatedM8_5BatterHitsFactorArtifactV1({
    factorKey: 'teamSpecificBullpen',
    modelVersion: 'm8-5-team-bullpen-test-v1',
    requiredInputs: [
      'opposingPitchingTeamId',
      'bullpenPitcherHand',
      'frozenGenericBullpenHandWeights',
      'frozenStarterBullpenTransition',
    ],
    sourceEvidenceVersion: 'm8-5-team-bullpen-outcome-evaluation-v1',
    validationEvidence: EVIDENCE,
    effects,
  });
}

test('resolves one exact opposing-team and pitcher-hand terminal vector without side input', () => {
  const resolution = resolveM8_5TeamBullpenOutcomeV1(
    validatedArtifact(),
    {
      opposingPitchingTeamId: 200,
      bullpenPitcherHand: 'L',
    },
  );

  assert.equal(resolution.status, 'validated');
  assert.equal(resolution.opposingPitchingTeamId, 200);
  assert.equal(resolution.bullpenPitcherHand, 'L');
  assert.equal(Object.hasOwn(resolution, 'selectedSide'), false);
  if (resolution.status === 'validated') {
    assert.equal(
      resolution.categoryProbabilities.find((entry) => entry.category === '1B')
        ?.probability,
      0.3,
    );
  }
});

test('a disabled team bullpen factor resolves to explicit identity', () => {
  const artifact = createDisabledM8_5BatterHitsFactorArtifactV1({
    factorKey: 'teamSpecificBullpen',
    requiredInputs: ['opposingPitchingTeamId', 'bullpenPitcherHand'],
    sourceEvidenceVersion: 'm8-5-team-bullpen-not-yet-validated-v1',
  });
  const resolution = resolveM8_5TeamBullpenOutcomeV1(artifact, {
    opposingPitchingTeamId: 100,
    bullpenPitcherHand: 'R',
  });

  assert.equal(resolution.status, 'identity');
  assert.equal(Object.hasOwn(resolution, 'categoryProbabilities'), false);
});

test('wrong factor, missing team-hand pairs, duplicates, and unknown teams fail closed', () => {
  const wrongFactor = createDisabledM8_5BatterHitsFactorArtifactV1({
    factorKey: 'park',
    requiredInputs: ['venueId'],
    sourceEvidenceVersion: 'park-disabled-v1',
  });
  assert.throws(
    () =>
      resolveM8_5TeamBullpenOutcomeV1(wrongFactor, {
        opposingPitchingTeamId: 100,
        bullpenPitcherHand: 'L',
      }),
    /not the teamSpecificBullpen/u,
  );

  assert.throws(
    () =>
      resolveM8_5TeamBullpenOutcomeV1(
        validatedArtifact([effect(100, 'L', 0.2)]),
        { opposingPitchingTeamId: 100, bullpenPitcherHand: 'L' },
      ),
    /both L and R/u,
  );

  assert.throws(
    () =>
      resolveM8_5TeamBullpenOutcomeV1(
        validatedArtifact([
          effect(100, 'L', 0.2),
          effect(100, 'L', 0.25),
          effect(100, 'R', 0.1),
        ]),
        { opposingPitchingTeamId: 100, bullpenPitcherHand: 'L' },
      ),
    /duplicate/u,
  );

  assert.throws(
    () =>
      resolveM8_5TeamBullpenOutcomeV1(validatedArtifact(), {
        opposingPitchingTeamId: 999,
        bullpenPitcherHand: 'R',
      }),
    /has no effect/u,
  );
});
