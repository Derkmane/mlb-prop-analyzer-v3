import { sha256 } from './provider-probe-utils.mjs';

export const CALIBRATION_TOLERANCE = 1e-12;
const PROBABILITY_FLOOR = 1e-300;
const LOGIT_EPSILON = 1e-15;

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function assertFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
  return value;
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function canonicalProbability(value, label) {
  assertFinite(value, label);
  if (
    value < -CALIBRATION_TOLERANCE ||
    value > 1 + CALIBRATION_TOLERANCE
  ) {
    throw new RangeError(`${label} must be in [0,1].`);
  }
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function normalizePmf(rawPmf, label = 'Hits PMF') {
  const pmf = assertArray(rawPmf, label).map((value, index) =>
    canonicalProbability(value, `${label}[${index}]`),
  );
  if (pmf.length === 0) throw new RangeError(`${label} must not be empty.`);
  const total = pmf.reduce((sum, value) => sum + value, 0);
  if (!(total > 0) || Math.abs(total - 1) > CALIBRATION_TOLERANCE) {
    throw new RangeError(`${label} must sum to one; received ${total}.`);
  }
  return Object.freeze(pmf.map((value) => value / total));
}

function logistic(value) {
  if (value >= 0) {
    const exp = Math.exp(-value);
    return 1 / (1 + exp);
  }
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function logit(value) {
  const bounded = Math.min(1 - LOGIT_EPSILON, Math.max(LOGIT_EPSILON, value));
  return Math.log(bounded / (1 - bounded));
}

export function hitsTailProbabilities(rawPmf) {
  const pmf = normalizePmf(rawPmf);
  const tails = [];
  let running = 0;
  for (let hits = pmf.length - 1; hits >= 1; hits -= 1) {
    running += pmf[hits];
    tails[hits - 1] = canonicalProbability(running, `Hits tail ${hits}`);
  }
  return Object.freeze(tails);
}

export function calibrateTailProbability(rawProbability, delta) {
  const probability = canonicalProbability(rawProbability, 'raw tail probability');
  const shift = assertFinite(delta, 'calibration delta');
  if (probability === 0 || probability === 1 || shift === 0) return probability;
  return canonicalProbability(logistic(logit(probability) + shift), 'calibrated tail probability');
}

export function calibrateHitsDistribution(rawPmf, delta) {
  const pmf = normalizePmf(rawPmf);
  if (pmf.length === 1) return pmf;
  const rawTails = hitsTailProbabilities(pmf);
  const calibratedTails = rawTails.map((probability) =>
    calibrateTailProbability(probability, delta),
  );
  for (let index = 1; index < calibratedTails.length; index += 1) {
    const previous = calibratedTails[index - 1];
    const current = calibratedTails[index];
    if (previous + CALIBRATION_TOLERANCE < current) {
      throw new Error('calibrated Hits tails must remain monotone non-increasing.');
    }
  }
  const output = Array(pmf.length).fill(0);
  output[0] = 1 - calibratedTails[0];
  for (let hits = 1; hits < pmf.length - 1; hits += 1) {
    output[hits] = calibratedTails[hits - 1] - calibratedTails[hits];
  }
  output[pmf.length - 1] = calibratedTails.at(-1);
  const stabilized = output.map((value, index) => {
    if (value < -CALIBRATION_TOLERANCE) {
      throw new Error(`calibrated Hits PMF[${index}] is materially negative.`);
    }
    return value < 0 ? 0 : value;
  });
  const total = stabilized.reduce((sum, value) => sum + value, 0);
  if (!(total > 0) || Math.abs(total - 1) > CALIBRATION_TOLERANCE) {
    throw new Error(`calibrated Hits PMF must sum to one; received ${total}.`);
  }
  return Object.freeze(stabilized.map((value) => value / total));
}

function thresholdExamples(rawPredictions, thresholds) {
  const predictions = assertArray(rawPredictions, 'calibration predictions');
  if (predictions.length === 0) {
    throw new Error('calibration fitting requires predictions.');
  }
  const examples = [];
  for (const [index, rawPrediction] of predictions.entries()) {
    const prediction = rawPrediction;
    const pmf = normalizePmf(prediction.pmf, `prediction[${index}].pmf`);
    const actualHits = assertNonNegativeInteger(
      prediction.actualHits,
      `prediction[${index}].actualHits`,
    );
    const tails = hitsTailProbabilities(pmf);
    for (const threshold of thresholds) {
      if (!Number.isSafeInteger(threshold) || threshold <= 0) {
        throw new RangeError('calibration thresholds must be positive integers.');
      }
      const rawProbability = tails[threshold - 1] ?? 0;
      examples.push(
        Object.freeze({
          rawProbability,
          outcome: actualHits >= threshold ? 1 : 0,
        }),
      );
    }
  }
  return Object.freeze(examples);
}

export function fitSharedTailLogitIntercept(
  rawPredictions,
  thresholds = Object.freeze([1, 2, 3]),
) {
  const examples = thresholdExamples(rawPredictions, thresholds);
  const informative = examples.filter(
    (example) => example.rawProbability > 0 && example.rawProbability < 1,
  );
  if (informative.length === 0) {
    throw new Error('calibration fitting has no informative tail probabilities.');
  }
  const derivative = (delta) =>
    informative.reduce(
      (sum, example) =>
        sum +
        calibrateTailProbability(example.rawProbability, delta) -
        example.outcome,
      0,
    );
  let lower = -40;
  let upper = 40;
  const lowerDerivative = derivative(lower);
  const upperDerivative = derivative(upper);
  let delta;
  if (lowerDerivative >= 0) delta = lower;
  else if (upperDerivative <= 0) delta = upper;
  else {
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const midpoint = (lower + upper) / 2;
      if (derivative(midpoint) > 0) upper = midpoint;
      else lower = midpoint;
    }
    delta = (lower + upper) / 2;
  }
  const identity = {
    method: 'shared-logit-intercept-v1',
    thresholds: Object.freeze([...thresholds]),
    predictionCount: rawPredictions.length,
    thresholdExampleCount: examples.length,
    informativeExampleCount: informative.length,
    delta,
  };
  return Object.freeze({
    ...identity,
    fitSha256: sha256(JSON.stringify(identity)),
  });
}

function createAccumulator() {
  return {
    observationCount: 0,
    logLoss: 0,
    multiclassBrier: 0,
    higher05Brier: 0,
    higher15Brier: 0,
    higher25Brier: 0,
    observedHits: 0,
    predictedHits: 0,
  };
}

function addScore(accumulator, pmf, actualHits) {
  accumulator.observationCount += 1;
  accumulator.logLoss += -Math.log(Math.max(pmf[actualHits] ?? 0, PROBABILITY_FLOOR));
  accumulator.observedHits += actualHits;
  for (let hits = 0; hits < pmf.length; hits += 1) {
    const mass = pmf[hits] ?? 0;
    accumulator.multiclassBrier += (mass - (hits === actualHits ? 1 : 0)) ** 2;
    accumulator.predictedHits += hits * mass;
  }
  const tails = hitsTailProbabilities(pmf);
  for (const [threshold, field] of [
    [1, 'higher05Brier'],
    [2, 'higher15Brier'],
    [3, 'higher25Brier'],
  ]) {
    const probability = tails[threshold - 1] ?? 0;
    const outcome = actualHits >= threshold ? 1 : 0;
    accumulator[field] += (probability - outcome) ** 2;
  }
}

export function evaluateCalibratedHitsPredictions(rawPredictions, delta) {
  const predictions = assertArray(rawPredictions, 'evaluation predictions');
  if (predictions.length === 0) throw new Error('evaluation requires predictions.');
  const accumulator = createAccumulator();
  const calibratedPredictionIds = [];
  for (const [index, prediction] of predictions.entries()) {
    const actualHits = assertNonNegativeInteger(
      prediction.actualHits,
      `prediction[${index}].actualHits`,
    );
    const calibratedPmf = calibrateHitsDistribution(prediction.pmf, delta);
    addScore(accumulator, calibratedPmf, actualHits);
    calibratedPredictionIds.push(prediction.observationId ?? `prediction-${index}`);
  }
  const count = accumulator.observationCount;
  const metrics = Object.freeze({
    observationCount: count,
    logLoss: accumulator.logLoss / count,
    multiclassBrier: accumulator.multiclassBrier / count,
    higher05Brier: accumulator.higher05Brier / count,
    higher15Brier: accumulator.higher15Brier / count,
    higher25Brier: accumulator.higher25Brier / count,
    observedMeanHits: accumulator.observedHits / count,
    predictedMeanHits: accumulator.predictedHits / count,
  });
  return Object.freeze({
    metrics,
    observationIdsSha256: sha256(JSON.stringify(calibratedPredictionIds)),
  });
}

export function nondominatedCandidateIds(results) {
  const candidates = assertArray(results, 'candidate results');
  const ids = [];
  for (const candidate of candidates) {
    const dominated = candidates.some((other) => {
      if (other.candidateId === candidate.candidateId) return false;
      const noWorseLogLoss =
        other.metrics.logLoss <= candidate.metrics.logLoss + CALIBRATION_TOLERANCE;
      const noWorseBrier =
        other.metrics.multiclassBrier <=
        candidate.metrics.multiclassBrier + CALIBRATION_TOLERANCE;
      const strictlyBetter =
        other.metrics.logLoss < candidate.metrics.logLoss - CALIBRATION_TOLERANCE ||
        other.metrics.multiclassBrier <
          candidate.metrics.multiclassBrier - CALIBRATION_TOLERANCE;
      return noWorseLogLoss && noWorseBrier && strictlyBetter;
    });
    if (!dominated) ids.push(candidate.candidateId);
  }
  return Object.freeze(ids.sort());
}

export function lineBriersNoWorse(candidateMetrics, benchmarkMetrics) {
  return Object.freeze({
    higher05:
      candidateMetrics.higher05Brier <=
      benchmarkMetrics.higher05Brier + CALIBRATION_TOLERANCE,
    higher15:
      candidateMetrics.higher15Brier <=
      benchmarkMetrics.higher15Brier + CALIBRATION_TOLERANCE,
    higher25:
      candidateMetrics.higher25Brier <=
      benchmarkMetrics.higher25Brier + CALIBRATION_TOLERANCE,
  });
}