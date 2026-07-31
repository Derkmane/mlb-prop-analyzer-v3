import { predictM8BatterHitsDistribution } from './m8-batter-hits-runtime-candidate-utils.mjs';
import { verifyM8FrozenBatterHitsCandidate } from './m8-batter-hits-frozen-candidate-utils.mjs';
import { sha256 } from './provider-probe-utils.mjs';

const PROBABILITY_FLOOR = 1e-300;

export const M8_UNTOUCHED_MINIMUM_INCLUDED_STARTER_OBSERVATIONS = 900;
export const M8_UNTOUCHED_MINIMUM_ACTUAL_HITS_ABOVE_25 = 35;

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertActualHits(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function accumulator() {
  return {
    count: 0,
    logLoss: 0,
    multiclassBrier: 0,
    lineBrier: { '0.5': 0, '1.5': 0, '2.5': 0 },
    observedHits: 0,
    predictedHits: 0,
  };
}

function score(acc, pmf, actualHits) {
  acc.count += 1;
  acc.logLoss += -Math.log(Math.max(pmf[actualHits] ?? 0, PROBABILITY_FLOOR));
  acc.observedHits += actualHits;
  for (let hits = 0; hits < pmf.length; hits += 1) {
    acc.multiclassBrier += (pmf[hits] - (hits === actualHits ? 1 : 0)) ** 2;
    acc.predictedHits += hits * pmf[hits];
  }
  for (const line of [0.5, 1.5, 2.5]) {
    const higher = pmf
      .slice(Math.floor(line) + 1)
      .reduce((sum, value) => sum + value, 0);
    acc.lineBrier[String(line)] += (higher - (actualHits > line ? 1 : 0)) ** 2;
  }
}

function finalize(acc) {
  return Object.freeze({
    observationCount: acc.count,
    logLoss: acc.logLoss / acc.count,
    multiclassBrier: acc.multiclassBrier / acc.count,
    higher05Brier: acc.lineBrier['0.5'] / acc.count,
    higher15Brier: acc.lineBrier['1.5'] / acc.count,
    higher25Brier: acc.lineBrier['2.5'] / acc.count,
    observedMeanHits: acc.observedHits / acc.count,
    predictedMeanHits: acc.predictedHits / acc.count,
  });
}

export function evaluateM8UntouchedEvidenceThresholds(rawObservations) {
  const observations = assertArray(rawObservations, 'untouched observations');
  const actualHitsAbove25Count = observations.reduce((count, observation, index) => {
    const actualHits = assertActualHits(
      observation?.actualHits,
      `untouched observations[${index}].actualHits`,
    );
    return count + (actualHits > 2.5 ? 1 : 0);
  }, 0);
  const includedStarterObservationsPass =
    observations.length >= M8_UNTOUCHED_MINIMUM_INCLUDED_STARTER_OBSERVATIONS;
  const actualHitsAbove25Pass =
    actualHitsAbove25Count >= M8_UNTOUCHED_MINIMUM_ACTUAL_HITS_ABOVE_25;
  return Object.freeze({
    minimumIncludedStarterObservations:
      M8_UNTOUCHED_MINIMUM_INCLUDED_STARTER_OBSERVATIONS,
    includedStarterObservationCount: observations.length,
    includedStarterObservationsPass,
    minimumActualHitsAbove25: M8_UNTOUCHED_MINIMUM_ACTUAL_HITS_ABOVE_25,
    actualHitsAbove25Count,
    actualHitsAbove25Pass,
    allRequiredEvidencePass:
      includedStarterObservationsPass && actualHitsAbove25Pass,
  });
}

export function evaluateM8FrozenBatterHitsCandidate({
  candidate: rawCandidate,
  sharedEnvironmentArtifact,
  starterRetentionArtifact,
  terminalOutcomeArtifact,
  observations: rawObservations,
}) {
  const candidate = verifyM8FrozenBatterHitsCandidate(rawCandidate);
  const observations = assertArray(rawObservations, 'untouched observations');
  if (observations.length === 0) throw new Error('untouched evaluation has no observations.');
  const evidenceThresholds = evaluateM8UntouchedEvidenceThresholds(observations);

  const ids = [];
  const selected = accumulator();
  const noEnvironment = accumulator();
  for (const observation of observations) {
    ids.push(assertString(observation.observationId, 'observation id'));
    const actualHits = assertActualHits(observation.actualHits, 'observation actualHits');
    const selectedPrediction = predictM8BatterHitsDistribution({
      sharedEnvironmentArtifact,
      starterRetentionArtifact,
      terminalOutcomeArtifact,
      bullpenModel: candidate.bullpenModel,
      environmentCoefficient: candidate.environmentEffectPolicy.coefficient,
      observation,
    });
    const baselinePrediction = predictM8BatterHitsDistribution({
      sharedEnvironmentArtifact,
      starterRetentionArtifact,
      terminalOutcomeArtifact,
      bullpenModel: candidate.bullpenModel,
      environmentCoefficient:
        candidate.environmentEffectPolicy.noEnvironmentBenchmarkCoefficient,
      observation,
    });
    score(selected, selectedPrediction.statisticDistribution, actualHits);
    score(noEnvironment, baselinePrediction.statisticDistribution, actualHits);
  }

  const selectedMetrics = finalize(selected);
  const baselineMetrics = finalize(noEnvironment);
  const lineBrierPasses = Object.freeze({
    higher05: selectedMetrics.higher05Brier <= baselineMetrics.higher05Brier,
    higher15: selectedMetrics.higher15Brier <= baselineMetrics.higher15Brier,
    higher25: selectedMetrics.higher25Brier <= baselineMetrics.higher25Brier,
  });
  const environmentImprovesLogLoss =
    selectedMetrics.logLoss < baselineMetrics.logLoss;
  const environmentDoesNotWorsenMulticlassBrier =
    selectedMetrics.multiclassBrier <= baselineMetrics.multiclassBrier;
  const acceptance = Object.freeze({
    candidateFrozenBeforeTest: true,
    evidenceSufficient: evidenceThresholds.allRequiredEvidencePass,
    evidenceThresholds,
    environmentImprovesLogLoss,
    environmentDoesNotWorsenMulticlassBrier,
    lineBrierPasses,
    allRequiredGatesPass:
      evidenceThresholds.allRequiredEvidencePass &&
      environmentImprovesLogLoss &&
      environmentDoesNotWorsenMulticlassBrier &&
      Object.values(lineBrierPasses).every(Boolean),
  });

  return Object.freeze({
    evaluationVersion: 2,
    purpose:
      'One-time untouched current-season acceptance evaluation of the frozen complete Batter Hits candidate against its predeclared no-environment benchmark.',
    modelVersion: candidate.modelVersion,
    modelArtifactSha256: candidate.artifactSha256,
    testWindow: Object.freeze({
      startDate: candidate.untouchedTestReservation.startDate,
      endDate: candidate.untouchedTestReservation.endDate,
      observationCount: observations.length,
    }),
    selected: selectedMetrics,
    noEnvironmentBenchmark: baselineMetrics,
    acceptance,
    observationIdsSha256: sha256(JSON.stringify(ids)),
  });
}
