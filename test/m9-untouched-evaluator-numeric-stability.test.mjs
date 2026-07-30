import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  createProbabilityMassFunction,
  validateProbability,
} from '../dist/src/core/index.js';
import {
  predictM8BatterHitsDistribution,
} from '../scripts/m8-batter-hits-runtime-candidate-utils.mjs';

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

test('probability validation canonicalizes only machine-roundoff boundary excursions', () => {
  assert.equal(validateProbability(-Number.EPSILON), 0);
  assert.equal(validateProbability(1 + Number.EPSILON), 1);
  assert.deepEqual(
    createProbabilityMassFunction([
      -Number.EPSILON,
      1 + Number.EPSILON,
    ]).probabilities,
    [0, 1],
  );

  assert.throws(
    () => validateProbability(-1e-9),
    /between 0 and 1/u,
  );
  assert.throws(
    () => validateProbability(1 + 1e-9),
    /between 0 and 1/u,
  );
});

test('the frozen home scenario and lineup slot two conserve opportunity and hit mass', () => {
  const sharedEnvironmentArtifact = readJson(
    'model-artifacts/m8-shared-offensive-environment-v2.json',
  );
  const starterRetentionArtifact = readJson(
    'model-artifacts/m8-starter-retention-v1.json',
  );
  const terminalOutcomeArtifact = readJson(
    'model-artifacts/m8-terminal-pa-outcome-v1.json',
  );
  const completeCandidate = readJson(
    'model-artifacts/m8-batter-hits-complete-candidate-v1.json',
  );

  const prediction = predictM8BatterHitsDistribution({
    sharedEnvironmentArtifact,
    starterRetentionArtifact,
    terminalOutcomeArtifact,
    bullpenModel: completeCandidate.bullpenModel,
    environmentCoefficient:
      completeCandidate.environmentEffectPolicy.coefficient,
    observation: {
      observationId: 'numeric-stability-home-slot-2',
      side: 'home',
      lineupSlot: 2,
      batterId: 999999,
      starterPitcherId: 999998,
      batterSide: 'L',
      starterPitcherHand: 'R',
      actualHits: 0,
    },
  });

  for (const scenario of prediction.scenarios) {
    assert.ok(
      scenario.opportunityCountPmf.every(
        (mass) => Number.isFinite(mass) && mass >= 0,
      ),
    );
    assert.ok(
      Math.abs(
        scenario.opportunityCountPmf.reduce(
          (sum, mass) => sum + mass,
          0,
        ) - 1
      ) <= 1e-12,
    );
  }

  assert.ok(
    prediction.statisticDistribution.every(
      (mass) => Number.isFinite(mass) && mass >= 0,
    ),
  );
  assert.ok(
    Math.abs(
      prediction.statisticDistribution.reduce(
        (sum, mass) => sum + mass,
        0,
      ) - 1
    ) <= 1e-12,
  );
});
