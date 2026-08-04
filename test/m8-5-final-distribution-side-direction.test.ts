import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareSettlementResultsForRanking,
  mixBernoulliOutcomesOverCountDistribution,
  mixProbabilityMassFunctions,
} from '../src/core/index.js';
import {
  buildM8_5ValidatedFinalDistributionV1,
  createM8_5FinalDistributionV1,
  settleM8BatterHitsBaseOffer,
  settleM8_5FinalOfferV1,
  verifyM8_5BatterHitsFactorArtifactV1,
  type FrozenBatterHitsRuntimeDistribution,
  type M8BatterHitsBaseDistributionV1,
  type M8_5FinalDistributionV1,
  type NormalizedBatterHitsBoardOffer,
} from '../src/features/batter-hits/index.js';
import {
  loadFinalEvaluationFixture,
  offerAt,
} from './helpers/m8-5-final-evaluation-fixture.js';

const LINE = 0.5;
const TOLERANCE = 1e-12;

function directionalShiftMagnitude(
  distribution: FrozenBatterHitsRuntimeDistribution,
): number {
  let minimumMargin = Number.POSITIVE_INFINITY;
  for (const scenario of distribution.scenarios) {
    for (const probability of scenario.perOpportunityHitProbabilities) {
      minimumMargin = Math.min(
        minimumMargin,
        probability,
        1 - probability,
      );
    }
  }
  assert.ok(Number.isFinite(minimumMargin) && minimumMargin > 0);
  return minimumMargin / 4;
}

function shiftHitDistribution(
  source: FrozenBatterHitsRuntimeDistribution,
  delta: number,
): FrozenBatterHitsRuntimeDistribution {
  assert.ok(Number.isFinite(delta) && delta !== 0);
  const scenarios = Object.freeze(
    source.scenarios.map((scenario) => {
      const perOpportunityHitProbabilities = Object.freeze(
        scenario.perOpportunityHitProbabilities.map((probability) => {
          const shifted = probability + delta;
          assert.ok(shifted > 0 && shifted < 1);
          return shifted;
        }),
      );
      return Object.freeze({
        ...scenario,
        perOpportunityHitProbabilities,
        hitDistribution: mixBernoulliOutcomesOverCountDistribution(
          scenario.opportunityCountDistribution,
          perOpportunityHitProbabilities,
        ),
      });
    }),
  );
  return Object.freeze({
    distributionBuilderVersion: source.distributionBuilderVersion,
    opportunityDistribution: source.opportunityDistribution,
    statisticDistribution: mixProbabilityMassFunctions(
      scenarios.map((scenario) => ({
        weight: scenario.weight,
        distribution: scenario.hitDistribution,
      })),
    ),
    scenarios,
  });
}

function tailProbability(
  distribution: FrozenBatterHitsRuntimeDistribution['statisticDistribution'],
  threshold: number,
): number {
  return distribution.probabilities.reduce(
    (sum, probability, value) =>
      value > threshold ? sum + probability : sum,
    0,
  );
}

function requiredProbability(value: number | null, label: string): number {
  if (value === null) {
    throw new Error(`${label} must be rankable`);
  }
  return value;
}

function settleBothSides(
  finalDistribution: M8_5FinalDistributionV1,
  sourceBaseDistribution: M8BatterHitsBaseDistributionV1,
  offer: NormalizedBatterHitsBoardOffer,
) {
  const higherBase = settleM8BatterHitsBaseOffer(
    sourceBaseDistribution,
    offerAt(offer, 'higher', LINE),
  );
  const lowerBase = settleM8BatterHitsBaseOffer(
    sourceBaseDistribution,
    offerAt(offer, 'lower', LINE),
  );
  return Object.freeze({
    higher: settleM8_5FinalOfferV1({
      sourceM8Evaluation: higherBase,
      finalDistribution,
    }),
    lower: settleM8_5FinalOfferV1({
      sourceM8Evaluation: lowerBase,
      finalDistribution,
    }),
  });
}

function settlementForRanking(evaluation: ReturnType<typeof settleM8_5FinalOfferV1>) {
  return Object.freeze({
    eligibilityProbability:
      evaluation.sourceM8Evaluation.baseDistribution.baseballInputs
        .eligibilityProbability,
    line: evaluation.offer.line,
    selectedSide: evaluation.offer.selectedSide,
    winProbability: evaluation.probabilities.pWin,
    lossProbability: evaluation.probabilities.pLoss,
    voidProbability: evaluation.probabilities.pVoid,
    winProbabilityGivenGrades: evaluation.probabilities.pFinal,
  });
}

test('an upward D_final shift helps Higher and hurts Lower under exact settlement', async () => {
  const inputs = await loadFinalEvaluationFixture();
  const composed = buildM8_5ValidatedFinalDistributionV1({
    sourceBaseDistribution: inputs.sourceBaseDistribution,
    offer: inputs.offer,
    observation: inputs.observation,
    artifacts: inputs.artifacts,
    rawGameEnvironmentModelArtifact: inputs.gameModel,
    gameEnvironmentResolutionInput: inputs.gameResolutionInput,
    rawTeamBullpenFactorArtifact: inputs.teamArtifact,
    rawParkFactorArtifact: inputs.parkArtifact,
  });
  const teamArtifact = verifyM8_5BatterHitsFactorArtifactV1(
    inputs.teamArtifact,
  );
  const factorArtifacts = Object.freeze([
    composed.gameEnvironmentResolution.factorArtifact,
    teamArtifact,
    composed.timesThroughOrderArtifact,
    composed.parkArtifact.typedFactorArtifact,
  ]);
  const shiftMagnitude = directionalShiftMagnitude(
    composed.finalDistribution.dFinal,
  );
  const upwardRuntimeDistribution = shiftHitDistribution(
    composed.finalDistribution.dFinal,
    shiftMagnitude,
  );
  const downwardRuntimeDistribution = shiftHitDistribution(
    composed.finalDistribution.dFinal,
    -shiftMagnitude,
  );
  const upwardFinalDistribution = createM8_5FinalDistributionV1({
    sourceBaseDistribution: inputs.sourceBaseDistribution,
    dFinal: upwardRuntimeDistribution,
    contextModelVersion: composed.contextModelVersion,
    factorArtifacts,
    factorRuntimeDecisions:
      composed.finalDistribution.factorRuntimeDecisions,
  });
  const downwardFinalDistribution = createM8_5FinalDistributionV1({
    sourceBaseDistribution: inputs.sourceBaseDistribution,
    dFinal: downwardRuntimeDistribution,
    contextModelVersion: composed.contextModelVersion,
    factorArtifacts,
    factorRuntimeDecisions:
      composed.finalDistribution.factorRuntimeDecisions,
  });

  for (
    let threshold = 0;
    threshold <
    composed.finalDistribution.dFinal.statisticDistribution.probabilities.length -
      1;
    threshold += 1
  ) {
    const upwardTail = tailProbability(
      upwardRuntimeDistribution.statisticDistribution,
      threshold,
    );
    const neutralTail = tailProbability(
      composed.finalDistribution.dFinal.statisticDistribution,
      threshold,
    );
    const downwardTail = tailProbability(
      downwardRuntimeDistribution.statisticDistribution,
      threshold,
    );
    assert.ok(upwardTail + TOLERANCE >= neutralTail);
    assert.ok(neutralTail + TOLERANCE >= downwardTail);
  }

  const upward = settleBothSides(
    upwardFinalDistribution,
    inputs.sourceBaseDistribution,
    inputs.offer,
  );
  const neutral = settleBothSides(
    composed.finalDistribution,
    inputs.sourceBaseDistribution,
    inputs.offer,
  );
  const downward = settleBothSides(
    downwardFinalDistribution,
    inputs.sourceBaseDistribution,
    inputs.offer,
  );

  const upwardHigher = requiredProbability(
    upward.higher.probabilities.pFinal,
    'upward Higher p_final',
  );
  const neutralHigher = requiredProbability(
    neutral.higher.probabilities.pFinal,
    'neutral Higher p_final',
  );
  const downwardHigher = requiredProbability(
    downward.higher.probabilities.pFinal,
    'downward Higher p_final',
  );
  const upwardLower = requiredProbability(
    upward.lower.probabilities.pFinal,
    'upward Lower p_final',
  );
  const neutralLower = requiredProbability(
    neutral.lower.probabilities.pFinal,
    'neutral Lower p_final',
  );
  const downwardLower = requiredProbability(
    downward.lower.probabilities.pFinal,
    'downward Lower p_final',
  );

  assert.ok(upwardHigher > neutralHigher);
  assert.ok(neutralHigher > downwardHigher);
  assert.ok(upwardLower < neutralLower);
  assert.ok(neutralLower < downwardLower);

  for (const pair of [upward, neutral, downward]) {
    assert.equal(
      pair.higher.probabilities.pWin,
      pair.lower.probabilities.pLoss,
    );
    assert.equal(
      pair.higher.probabilities.pLoss,
      pair.lower.probabilities.pWin,
    );
    assert.equal(
      pair.higher.probabilities.pVoid,
      pair.lower.probabilities.pVoid,
    );
    assert.strictEqual(
      pair.higher.finalDistribution,
      pair.lower.finalDistribution,
    );
  }
});

test('contextProbabilityDelta is diagnostic and cannot alter ranking order', async () => {
  const inputs = await loadFinalEvaluationFixture();
  const composed = buildM8_5ValidatedFinalDistributionV1({
    sourceBaseDistribution: inputs.sourceBaseDistribution,
    offer: inputs.offer,
    observation: inputs.observation,
    artifacts: inputs.artifacts,
    rawGameEnvironmentModelArtifact: inputs.gameModel,
    gameEnvironmentResolutionInput: inputs.gameResolutionInput,
    rawTeamBullpenFactorArtifact: inputs.teamArtifact,
    rawParkFactorArtifact: inputs.parkArtifact,
  });
  const teamArtifact = verifyM8_5BatterHitsFactorArtifactV1(
    inputs.teamArtifact,
  );
  const factorArtifacts = Object.freeze([
    composed.gameEnvironmentResolution.factorArtifact,
    teamArtifact,
    composed.timesThroughOrderArtifact,
    composed.parkArtifact.typedFactorArtifact,
  ]);
  const shiftMagnitude = directionalShiftMagnitude(
    composed.finalDistribution.dFinal,
  );
  const upwardFinalDistribution = createM8_5FinalDistributionV1({
    sourceBaseDistribution: inputs.sourceBaseDistribution,
    dFinal: shiftHitDistribution(
      composed.finalDistribution.dFinal,
      shiftMagnitude,
    ),
    contextModelVersion: composed.contextModelVersion,
    factorArtifacts,
    factorRuntimeDecisions:
      composed.finalDistribution.factorRuntimeDecisions,
  });
  const upward = settleBothSides(
    upwardFinalDistribution,
    inputs.sourceBaseDistribution,
    inputs.offer,
  ).higher;
  const neutral = settleBothSides(
    composed.finalDistribution,
    inputs.sourceBaseDistribution,
    inputs.offer,
  ).higher;

  assert.ok(
    requiredProbability(upward.probabilities.pFinal, 'upward p_final') >
      requiredProbability(neutral.probabilities.pFinal, 'neutral p_final'),
  );
  assert.equal(
    compareSettlementResultsForRanking(
      settlementForRanking(upward),
      settlementForRanking(neutral),
    ),
    -1,
  );

  const sameSettlement = settlementForRanking(neutral);
  const firstDiagnostic = Object.freeze({
    settlement: sameSettlement,
    contextProbabilityDelta: -0.5,
  });
  const secondDiagnostic = Object.freeze({
    settlement: sameSettlement,
    contextProbabilityDelta: 0.5,
  });
  assert.equal(
    compareSettlementResultsForRanking(
      firstDiagnostic.settlement,
      secondDiagnostic.settlement,
    ),
    0,
  );
});
