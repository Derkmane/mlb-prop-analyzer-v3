import { sha256 } from './provider-probe-utils.mjs';

export const CALIBRATION_TOLERANCE = 1e-12;
export const IDENTITY_MONOTONE_TAIL_CALIBRATION = Object.freeze({
  slope: 1,
  intercept: 0,
});

const PROBABILITY_FLOOR = 1e-300;
const LOGIT_EPSILON = 1e-15;
const ETA_LOWER_BOUND = -2;
const ETA_UPPER_BOUND = 2;
const INTERCEPT_LOWER_BOUND = -40;
const INTERCEPT_UPPER_BOUND = 40;
const GOLDEN_SECTION_ITERATIONS = 96;
const INTERCEPT_BISECTION_ITERATIONS = 180;
const GOLDEN_SECTION_RATIO = (Math.sqrt(5) - 1) / 2;

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

function assertUnitInterval(value, label) {
  const numeric = assertFinite(value, label);
  if (numeric < 0 || numeric > 1) {
    throw new RangeError(`${label} must be in [0,1].`);
  }
  return numeric;
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
  const bounded = Math.min(
    1 - LOGIT_EPSILON,
    Math.max(LOGIT_EPSILON, value),
  );
  return Math.log(bounded / (1 - bounded));
}

function normalizeCalibration(rawCalibration) {
  if (rawCalibration === undefined) {
    return IDENTITY_MONOTONE_TAIL_CALIBRATION;
  }
  if (rawCalibration === null || typeof rawCalibration !== 'object') {
    throw new TypeError('tail calibration must be an object.');
  }
  const slope = assertFinite(rawCalibration.slope, 'calibration slope');
  const intercept = assertFinite(
    rawCalibration.intercept,
    'calibration intercept',
  );
  if (!(slope > 0)) {
    throw new RangeError('calibration slope must be greater than zero.');
  }
  if (slope === 1 && intercept === 0) {
    return IDENTITY_MONOTONE_TAIL_CALIBRATION;
  }
  return Object.freeze({ slope, intercept });
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

export function calibrateTailProbability(
  rawProbability,
  rawCalibration = IDENTITY_MONOTONE_TAIL_CALIBRATION,
) {
  const probability = canonicalProbability(
    rawProbability,
    'raw tail probability',
  );
  const calibration = normalizeCalibration(rawCalibration);
  if (
    probability === 0 ||
    probability === 1 ||
    calibration === IDENTITY_MONOTONE_TAIL_CALIBRATION
  ) {
    return probability;
  }
  return canonicalProbability(
    logistic(
      calibration.slope * logit(probability) + calibration.intercept,
    ),
    'calibrated tail probability',
  );
}

export function calibrateHitsDistribution(
  rawPmf,
  rawCalibration = IDENTITY_MONOTONE_TAIL_CALIBRATION,
) {
  const pmf = normalizePmf(rawPmf);
  const calibration = normalizeCalibration(rawCalibration);
  if (
    pmf.length === 1 ||
    calibration === IDENTITY_MONOTONE_TAIL_CALIBRATION
  ) {
    return pmf;
  }

  const rawTails = hitsTailProbabilities(pmf);
  const calibratedTails = rawTails.map((probability) =>
    calibrateTailProbability(probability, calibration),
  );

  for (let index = 1; index < calibratedTails.length; index += 1) {
    const previous = calibratedTails[index - 1];
    const current = calibratedTails[index];
    if (previous + CALIBRATION_TOLERANCE < current) {
      throw new Error(
        'calibrated Hits tails must remain monotone non-increasing.',
      );
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
    throw new Error(
      `calibrated Hits PMF must sum to one; received ${total}.`,
    );
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
        throw new RangeError(
          'calibration thresholds must be positive integers.',
        );
      }
      const rawProbability = tails[threshold - 1] ?? 0;
      examples.push(
        Object.freeze({
          rawProbability,
          rawLogit:
            rawProbability > 0 && rawProbability < 1
              ? logit(rawProbability)
              : null,
          outcome: actualHits >= threshold ? 1 : 0,
        }),
      );
    }
  }
  return Object.freeze(examples);
}

function informativeThresholdExamples(rawPredictions, thresholds) {
  const examples = thresholdExamples(rawPredictions, thresholds);
  const informative = examples.filter(
    (example) => example.rawLogit !== null,
  );
  if (informative.length === 0) {
    throw new Error(
      'calibration fitting has no informative tail probabilities.',
    );
  }
  return Object.freeze({ examples, informative });
}

function solveInterceptForSlope(informative, slope) {
  const derivative = (intercept) =>
    informative.reduce(
      (sum, example) =>
        sum + logistic(slope * example.rawLogit + intercept) - example.outcome,
      0,
    );

  let lower = INTERCEPT_LOWER_BOUND;
  let upper = INTERCEPT_UPPER_BOUND;
  const lowerDerivative = derivative(lower);
  const upperDerivative = derivative(upper);

  if (lowerDerivative >= 0) return lower;
  if (upperDerivative <= 0) return upper;

  for (let iteration = 0; iteration < INTERCEPT_BISECTION_ITERATIONS; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    if (derivative(midpoint) > 0) upper = midpoint;
    else lower = midpoint;
  }
  return (lower + upper) / 2;
}

function thresholdBinaryLogLoss(informative, calibration) {
  let total = 0;
  for (const example of informative) {
    const probability = logistic(
      calibration.slope * example.rawLogit + calibration.intercept,
    );
    total +=
      example.outcome === 1
        ? -Math.log(Math.max(probability, PROBABILITY_FLOOR))
        : -Math.log(Math.max(1 - probability, PROBABILITY_FLOOR));
  }
  return total / informative.length;
}

function fittedCalibrationAtEta(informative, eta) {
  const slope = Math.exp(eta);
  const intercept = solveInterceptForSlope(informative, slope);
  const calibration = Object.freeze({ slope, intercept });
  return Object.freeze({
    eta,
    slope,
    intercept,
    objective: thresholdBinaryLogLoss(informative, calibration),
  });
}

export function fitMonotoneTailLogitAffine(
  rawPredictions,
  thresholds = Object.freeze([1, 2, 3]),
) {
  const { examples, informative } = informativeThresholdExamples(
    rawPredictions,
    thresholds,
  );

  let lower = ETA_LOWER_BOUND;
  let upper = ETA_UPPER_BOUND;
  let leftEta = upper - GOLDEN_SECTION_RATIO * (upper - lower);
  let rightEta = lower + GOLDEN_SECTION_RATIO * (upper - lower);
  let left = fittedCalibrationAtEta(informative, leftEta);
  let right = fittedCalibrationAtEta(informative, rightEta);

  for (let iteration = 0; iteration < GOLDEN_SECTION_ITERATIONS; iteration += 1) {
    if (left.objective <= right.objective) {
      upper = rightEta;
      rightEta = leftEta;
      right = left;
      leftEta = upper - GOLDEN_SECTION_RATIO * (upper - lower);
      left = fittedCalibrationAtEta(informative, leftEta);
    } else {
      lower = leftEta;
      leftEta = rightEta;
      left = right;
      rightEta = lower + GOLDEN_SECTION_RATIO * (upper - lower);
      right = fittedCalibrationAtEta(informative, rightEta);
    }
  }

  const midpointEta = (lower + upper) / 2;
  const candidates = [
    fittedCalibrationAtEta(informative, ETA_LOWER_BOUND),
    fittedCalibrationAtEta(informative, ETA_UPPER_BOUND),
    fittedCalibrationAtEta(informative, midpointEta),
    fittedCalibrationAtEta(informative, 0),
  ].sort(
    (first, second) =>
      first.objective - second.objective || first.eta - second.eta,
  );
  const selected = candidates[0];
  const identityObjective = thresholdBinaryLogLoss(
    informative,
    IDENTITY_MONOTONE_TAIL_CALIBRATION,
  );

  const identity = {
    method: 'monotone-logit-affine-v2',
    thresholds: Object.freeze([...thresholds]),
    predictionCount: rawPredictions.length,
    thresholdExampleCount: examples.length,
    informativeExampleCount: informative.length,
    slope: selected.slope,
    intercept: selected.intercept,
    eta: selected.eta,
    objective: selected.objective,
    identityObjective,
    optimization: Object.freeze({
      etaLowerBound: ETA_LOWER_BOUND,
      etaUpperBound: ETA_UPPER_BOUND,
      interceptLowerBound: INTERCEPT_LOWER_BOUND,
      interceptUpperBound: INTERCEPT_UPPER_BOUND,
      goldenSectionIterations: GOLDEN_SECTION_ITERATIONS,
      interceptBisectionIterations: INTERCEPT_BISECTION_ITERATIONS,
    }),
  };
  return Object.freeze({
    ...identity,
    fitSha256: sha256(JSON.stringify(identity)),
  });
}

export function shrinkMonotoneTailCalibration(fit, lambda) {
  if (fit === null || typeof fit !== 'object') {
    throw new TypeError('monotone calibration fit must be an object.');
  }
  const weight = assertUnitInterval(lambda, 'calibration shrinkage multiplier');
  const fitted = normalizeCalibration({
    slope: fit.slope,
    intercept: fit.intercept,
  });
  if (weight === 0) return IDENTITY_MONOTONE_TAIL_CALIBRATION;
  if (weight === 1) return fitted;
  return normalizeCalibration({
    slope: 1 + weight * (fitted.slope - 1),
    intercept: weight * fitted.intercept,
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
  accumulator.logLoss += -Math.log(
    Math.max(pmf[actualHits] ?? 0, PROBABILITY_FLOOR),
  );
  accumulator.observedHits += actualHits;
  for (let hits = 0; hits < pmf.length; hits += 1) {
    const mass = pmf[hits] ?? 0;
    accumulator.multiclassBrier +=
      (mass - (hits === actualHits ? 1 : 0)) ** 2;
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

export function evaluateCalibratedHitsPredictions(
  rawPredictions,
  rawCalibration = IDENTITY_MONOTONE_TAIL_CALIBRATION,
) {
  const predictions = assertArray(rawPredictions, 'evaluation predictions');
  if (predictions.length === 0) throw new Error('evaluation requires predictions.');
  const calibration = normalizeCalibration(rawCalibration);
  const accumulator = createAccumulator();
  const calibratedPredictionIds = [];
  for (const [index, prediction] of predictions.entries()) {
    const actualHits = assertNonNegativeInteger(
      prediction.actualHits,
      `prediction[${index}].actualHits`,
    );
    const calibratedPmf = calibrateHitsDistribution(
      prediction.pmf,
      calibration,
    );
    addScore(accumulator, calibratedPmf, actualHits);
    calibratedPredictionIds.push(
      prediction.observationId ?? `prediction-${index}`,
    );
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
        other.metrics.logLoss <=
        candidate.metrics.logLoss + CALIBRATION_TOLERANCE;
      const noWorseBrier =
        other.metrics.multiclassBrier <=
        candidate.metrics.multiclassBrier + CALIBRATION_TOLERANCE;
      const strictlyBetter =
        other.metrics.logLoss <
          candidate.metrics.logLoss - CALIBRATION_TOLERANCE ||
        other.metrics.multiclassBrier <
          candidate.metrics.multiclassBrier - CALIBRATION_TOLERANCE;
      return noWorseLogLoss && noWorseBrier && strictlyBetter;
    });
    if (!dominated) ids.push(candidate.candidateId);
  }
  return Object.freeze(ids.sort());
}

export function stableNondominatedCandidateIds(
  fixedCandidateIds,
  walkForwardCandidateIds,
  excludedCandidateIds = Object.freeze([]),
) {
  const fixed = new Set(assertArray(fixedCandidateIds, 'fixed candidate IDs'));
  const walkForward = new Set(
    assertArray(walkForwardCandidateIds, 'walk-forward candidate IDs'),
  );
  const excluded = new Set(
    assertArray(excludedCandidateIds, 'excluded candidate IDs'),
  );
  return Object.freeze(
    [...fixed]
      .filter((candidateId) =>
        typeof candidateId === 'string' &&
        walkForward.has(candidateId) &&
        !excluded.has(candidateId),
      )
      .sort(),
  );
}
