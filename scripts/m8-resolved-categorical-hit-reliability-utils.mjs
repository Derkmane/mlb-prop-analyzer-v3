import { readFile } from 'node:fs/promises';

import {
  evaluateResolvedCategoricalRareOutcomeUncertainty,
  predictFrozenPlatoonCandidateCohort,
  wilsonScoreInterval95,
} from './m8-resolved-categorical-rare-outcome-uncertainty-utils.mjs';
import { sha256 } from './provider-probe-utils.mjs';

const TOLERANCE = 1e-12;
const VALID_HANDS = new Set(['L', 'R']);
const FIXED_BUCKET_WIDTH = 0.05;
const FIXED_BUCKET_COUNT = 20;
const EQUAL_COUNT_BUCKET_COUNT = 10;

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  return value;
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function assertFiniteProbability(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new RangeError(`${label} must lie strictly between 0 and 1.`);
  }
  return value;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function validateStringList(rawValues, label, minimumLength = 1) {
  const values = assertArray(rawValues, label).map((value, index) =>
    assertNonEmptyString(value, `${label}[${index}]`),
  );
  if (values.length < minimumLength || new Set(values).size !== values.length) {
    throw new Error(`${label} must contain at least ${minimumLength} unique values.`);
  }
  return Object.freeze(values);
}

function matchupKey(batterSide, pitcherHand) {
  if (!VALID_HANDS.has(batterSide) || !VALID_HANDS.has(pitcherHand)) {
    throw new Error('Hit reliability requires normalized L/R handedness.');
  }
  return `${batterSide}-vs-${pitcherHand}`;
}

function sourceObservation(rawRow, periodId, index, modeledCategorySet) {
  const label = `periods.${periodId}.rows[${index}]`;
  const row = assertPlainObject(rawRow, label);
  if (row.mappingStatus !== 'classified-terminal') return null;
  if (row.includedInOverallOutcomeModel !== true) {
    throw new Error(`${label} classified terminal row must be overall eligible.`);
  }
  const terminalCategory = assertNonEmptyString(
    row.terminalCategory,
    `${label}.terminalCategory`,
  );
  if (!modeledCategorySet.has(terminalCategory)) {
    throw new Error(`${label} contains a non-modeled terminal category.`);
  }
  const batterSide = VALID_HANDS.has(row.normalizedBatterSide)
    ? row.normalizedBatterSide
    : null;
  const pitcherHand = VALID_HANDS.has(row.normalizedPitcherHand)
    ? row.normalizedPitcherHand
    : null;
  const handednessUsable = batterSide !== null && pitcherHand !== null;
  const platoonEligible = row.includedInPlatoonModel === true;
  if (platoonEligible !== handednessUsable) {
    throw new Error(`${label} platoon eligibility drifted from normalized handedness.`);
  }
  return Object.freeze({
    observationId: assertNonEmptyString(row.rowId, `${label}.rowId`),
    observedDate: assertNonEmptyString(row.observedDate, `${label}.observedDate`),
    providerBatterId: assertPositiveInteger(
      row.providerBatterId,
      `${label}.providerBatterId`,
    ),
    providerPitcherId: assertPositiveInteger(
      row.providerPitcherId,
      `${label}.providerPitcherId`,
    ),
    terminalCategory,
    platoonEligible,
    normalizedBatterSide: batterSide,
    normalizedPitcherHand: pitcherHand,
    matchupKey: platoonEligible ? matchupKey(batterSide, pitcherHand) : null,
  });
}

function extractObservations(dataset, modeledCategories) {
  const modeledCategorySet = new Set(modeledCategories);
  const periods = assertPlainObject(dataset.periods, 'dataset periods');
  const extracted = {};
  const seen = new Set();
  for (const periodId of ['fit', 'validation']) {
    const period = assertPlainObject(periods[periodId], `periods.${periodId}`);
    const rows = assertArray(period.rows, `periods.${periodId}.rows`);
    const overall = [];
    const platoon = [];
    for (const [index, row] of rows.entries()) {
      const observation = sourceObservation(
        row,
        periodId,
        index,
        modeledCategorySet,
      );
      if (observation === null) continue;
      if (seen.has(observation.observationId)) {
        throw new Error(`duplicate fit-validation observation ${observation.observationId}.`);
      }
      seen.add(observation.observationId);
      overall.push(observation);
      if (observation.platoonEligible) platoon.push(observation);
    }
    if (overall.length !== period.classifiedTerminalCount) {
      throw new Error(`${periodId} classified terminal count drifted.`);
    }
    if (platoon.length !== period.platoonEligibleCount) {
      throw new Error(`${periodId} platoon eligible count drifted.`);
    }
    extracted[periodId] = Object.freeze({
      overall: Object.freeze(overall),
      platoon: Object.freeze(platoon),
    });
  }
  return Object.freeze({
    fitOverall: extracted.fit.overall,
    fitPlatoon: extracted.fit.platoon,
    validationOverall: extracted.validation.overall,
    validationPlatoon: extracted.validation.platoon,
  });
}

function validateRareOutcomeArtifact(actual, expected, actualText) {
  const artifact = assertPlainObject(actual, 'rare-outcome uncertainty artifact');
  if (
    artifact.rareOutcomeUncertaintySha256 !== expected.rareOutcomeUncertaintySha256 ||
    JSON.stringify(artifact) !== JSON.stringify(expected)
  ) {
    throw new Error(
      'rare-outcome uncertainty artifact drifted from deterministic re-evaluation.',
    );
  }
  const parsedText = parseJson(actualText, 'rare-outcome uncertainty text');
  if (JSON.stringify(parsedText) !== JSON.stringify(artifact)) {
    throw new Error('rare-outcome uncertainty text does not match its artifact.');
  }
  if (
    artifact.untouchedTestReservation?.rowsIncluded !== false ||
    Object.hasOwn(artifact.untouchedTestReservation ?? {}, 'rows')
  ) {
    throw new Error('Hit reliability must keep untouched-test rows sealed.');
  }
  return artifact;
}

function metricDifference(actual, expected, label) {
  const fields = [
    'validationObservationCount',
    'validationCategoricalLogLoss',
    'validationCategoricalBrierScore',
    'validationHitLogLoss',
    'validationHitBrierScore',
  ];
  const differences = {};
  let maximumDifference = 0;
  for (const field of fields) {
    const difference = Math.abs(actual[field] - expected[field]);
    differences[field] = difference;
    maximumDifference = Math.max(maximumDifference, difference);
    if (difference > TOLERANCE) {
      throw new Error(`${label}.${field} drifted by ${difference}.`);
    }
  }
  if (
    actual.validationObservationIdsSha256 !==
    expected.validationObservationIdsSha256
  ) {
    throw new Error(`${label} observation identity drifted.`);
  }
  return Object.freeze({
    differences: Object.freeze(differences),
    maximumDifference,
  });
}

function normalizeHitPredictions(rawPredictions) {
  const predictions = assertArray(rawPredictions, 'predictions');
  if (predictions.length === 0) {
    throw new Error('Hit reliability requires at least one prediction.');
  }
  const seen = new Set();
  return Object.freeze(
    predictions.map((rawPrediction, index) => {
      const prediction = assertPlainObject(rawPrediction, `predictions[${index}]`);
      const observationId = assertNonEmptyString(
        prediction.observationId,
        `predictions[${index}].observationId`,
      );
      if (seen.has(observationId)) {
        throw new Error(`duplicate Hit reliability prediction ${observationId}.`);
      }
      seen.add(observationId);
      const hit = assertNonNegativeInteger(
        prediction.hit,
        `predictions[${index}].hit`,
      );
      if (hit !== 0 && hit !== 1) {
        throw new RangeError(`predictions[${index}].hit must equal 0 or 1.`);
      }
      return Object.freeze({
        observationId,
        observedDate: assertNonEmptyString(
          prediction.observedDate,
          `predictions[${index}].observedDate`,
        ),
        hitProbability: assertFiniteProbability(
          prediction.hitProbability,
          `predictions[${index}].hitProbability`,
        ),
        hit,
      });
    }),
  );
}

function summarizeBucket({
  bucketId,
  bucketNumber,
  lowerBound,
  upperBound,
  lowerInclusive = true,
  upperInclusive = false,
  predictions,
}) {
  const count = predictions.length;
  if (count === 0) {
    return Object.freeze({
      bucketId,
      bucketNumber,
      lowerBound,
      upperBound,
      lowerInclusive,
      upperInclusive,
      observationCount: 0,
      observedHitCount: 0,
      expectedHitCount: 0,
      meanPredictedProbability: null,
      observedHitRate: null,
      observedHitRateWilson95: null,
      calibrationGapObservedMinusPredicted: null,
      absoluteCalibrationGap: null,
      binaryLogLoss: null,
      binaryBrier: null,
      predictedProbabilityMinimum: null,
      predictedProbabilityMaximum: null,
      meanPredictedInsideWilson95: null,
      status: 'empty-no-validation-observations',
    });
  }

  let observed = 0;
  let expected = 0;
  let logLoss = 0;
  let brier = 0;
  let minimum = 1;
  let maximum = 0;
  for (const prediction of predictions) {
    const probability = prediction.hitProbability;
    observed += prediction.hit;
    expected += probability;
    logLoss +=
      prediction.hit === 1 ? -Math.log(probability) : -Math.log(1 - probability);
    brier += (probability - prediction.hit) ** 2;
    minimum = Math.min(minimum, probability);
    maximum = Math.max(maximum, probability);
  }
  const meanPredicted = expected / count;
  const observedRate = observed / count;
  const interval = wilsonScoreInterval95(observed, count);
  const gap = observedRate - meanPredicted;
  return Object.freeze({
    bucketId,
    bucketNumber,
    lowerBound,
    upperBound,
    lowerInclusive,
    upperInclusive,
    observationCount: count,
    observedHitCount: observed,
    expectedHitCount: expected,
    meanPredictedProbability: meanPredicted,
    observedHitRate: observedRate,
    observedHitRateWilson95: interval,
    calibrationGapObservedMinusPredicted: gap,
    absoluteCalibrationGap: Math.abs(gap),
    binaryLogLoss: logLoss / count,
    binaryBrier: brier / count,
    predictedProbabilityMinimum: minimum,
    predictedProbabilityMaximum: maximum,
    meanPredictedInsideWilson95:
      interval !== null &&
      meanPredicted >= interval.lower &&
      meanPredicted <= interval.upper,
    status: 'reported-current-season-validation-bucket',
  });
}

function summarizeBucketSet(buckets, totalObservationCount) {
  const nonEmpty = buckets.filter((bucket) => bucket.observationCount > 0);
  const conservedCount = buckets.reduce(
    (sum, bucket) => sum + bucket.observationCount,
    0,
  );
  const conservedObservedHits = buckets.reduce(
    (sum, bucket) => sum + bucket.observedHitCount,
    0,
  );
  const conservedExpectedHits = buckets.reduce(
    (sum, bucket) => sum + bucket.expectedHitCount,
    0,
  );
  if (conservedCount !== totalObservationCount) {
    throw new Error('reliability buckets did not conserve validation observations.');
  }
  const weightedAbsoluteGap = nonEmpty.reduce(
    (sum, bucket) =>
      sum +
      (bucket.observationCount / totalObservationCount) *
        bucket.absoluteCalibrationGap,
    0,
  );
  const weightedSquaredGap = nonEmpty.reduce(
    (sum, bucket) =>
      sum +
      (bucket.observationCount / totalObservationCount) *
        bucket.calibrationGapObservedMinusPredicted ** 2,
    0,
  );
  return Object.freeze({
    bucketCount: buckets.length,
    nonEmptyBucketCount: nonEmpty.length,
    observationCount: conservedCount,
    observedHitCount: conservedObservedHits,
    expectedHitCount: conservedExpectedHits,
    expectedCalibrationError: weightedAbsoluteGap,
    maximumCalibrationError: Math.max(
      0,
      ...nonEmpty.map((bucket) => bucket.absoluteCalibrationGap),
    ),
    rootMeanSquaredCalibrationError: Math.sqrt(weightedSquaredGap),
    meanPredictionInsideWilson95BucketCount: nonEmpty.filter(
      (bucket) => bucket.meanPredictedInsideWilson95,
    ).length,
    emptyBucketCount: buckets.length - nonEmpty.length,
    buckets: Object.freeze(buckets),
  });
}

export function buildFixedWidthHitReliabilityBuckets(rawPredictions) {
  const predictions = normalizeHitPredictions(rawPredictions);
  const groups = Array.from({ length: FIXED_BUCKET_COUNT }, () => []);
  for (const prediction of predictions) {
    const rawIndex = Math.floor(
      (prediction.hitProbability + Number.EPSILON) / FIXED_BUCKET_WIDTH,
    );
    const index = Math.min(FIXED_BUCKET_COUNT - 1, Math.max(0, rawIndex));
    groups[index].push(prediction);
  }
  const buckets = groups.map((group, index) => {
    const lowerBound = index * FIXED_BUCKET_WIDTH;
    const upperBound = (index + 1) * FIXED_BUCKET_WIDTH;
    return summarizeBucket({
      bucketId: `fixed-${lowerBound.toFixed(2)}-${upperBound.toFixed(2)}`,
      bucketNumber: index + 1,
      lowerBound,
      upperBound,
      lowerInclusive: true,
      upperInclusive: index === FIXED_BUCKET_COUNT - 1,
      predictions: group,
    });
  });
  return Object.freeze({
    method: 'fixed-width-5-percentage-point-buckets',
    bucketWidth: FIXED_BUCKET_WIDTH,
    lowerBoundaryRule: 'inclusive',
    upperBoundaryRule: 'exclusive except final bucket includes 1.0',
    ...summarizeBucketSet(buckets, predictions.length),
  });
}

export function buildEqualCountHitReliabilityBuckets(rawPredictions) {
  const predictions = normalizeHitPredictions(rawPredictions);
  if (predictions.length < EQUAL_COUNT_BUCKET_COUNT) {
    throw new Error(
      `equal-count reliability requires at least ${EQUAL_COUNT_BUCKET_COUNT} predictions.`,
    );
  }
  const sorted = [...predictions].sort(
    (left, right) =>
      left.hitProbability - right.hitProbability ||
      left.observationId.localeCompare(right.observationId),
  );
  const buckets = [];
  for (let index = 0; index < EQUAL_COUNT_BUCKET_COUNT; index += 1) {
    const start = Math.floor((index * sorted.length) / EQUAL_COUNT_BUCKET_COUNT);
    const end = Math.floor(
      ((index + 1) * sorted.length) / EQUAL_COUNT_BUCKET_COUNT,
    );
    const group = sorted.slice(start, end);
    buckets.push(
      summarizeBucket({
        bucketId: `equal-count-decile-${String(index + 1).padStart(2, '0')}`,
        bucketNumber: index + 1,
        lowerBound: group[0]?.hitProbability ?? null,
        upperBound: group.at(-1)?.hitProbability ?? null,
        lowerInclusive: true,
        upperInclusive: true,
        predictions: group,
      }),
    );
  }
  const counts = buckets.map((bucket) => bucket.observationCount);
  if (Math.max(...counts) - Math.min(...counts) > 1) {
    throw new Error('equal-count reliability bucket sizes differ by more than one.');
  }
  return Object.freeze({
    method: 'deterministic-equal-count-deciles',
    tieBreakRule: 'hitProbability ascending, then observationId ascending',
    requestedBucketCount: EQUAL_COUNT_BUCKET_COUNT,
    minimumBucketSize: Math.min(...counts),
    maximumBucketSize: Math.max(...counts),
    ...summarizeBucketSet(buckets, predictions.length),
  });
}

function aggregateHitMetrics(predictions) {
  let observed = 0;
  let expected = 0;
  let logLoss = 0;
  let brier = 0;
  let minimum = 1;
  let maximum = 0;
  for (const prediction of predictions) {
    const probability = prediction.hitProbability;
    observed += prediction.hit;
    expected += probability;
    logLoss +=
      prediction.hit === 1 ? -Math.log(probability) : -Math.log(1 - probability);
    brier += (probability - prediction.hit) ** 2;
    minimum = Math.min(minimum, probability);
    maximum = Math.max(maximum, probability);
  }
  const count = predictions.length;
  return Object.freeze({
    validationObservationCount: count,
    validationObservedCount: observed,
    validationObservedRate: observed / count,
    validationExpectedCount: expected,
    meanPredictedProbability: expected / count,
    calibrationGapObservedMinusPredicted: observed / count - expected / count,
    binaryLogLoss: logLoss / count,
    binaryBrier: brier / count,
    predictedProbabilityMinimum: minimum,
    predictedProbabilityMaximum: maximum,
  });
}

function assertSourceHitSummaryEquivalence(actual, source) {
  const expected = assertPlainObject(source, 'sourceHitSummary');
  const fields = [
    'validationObservationCount',
    'validationObservedCount',
    'validationObservedRate',
    'validationExpectedCount',
    'meanPredictedProbability',
    'calibrationGapObservedMinusPredicted',
    'binaryLogLoss',
    'binaryBrier',
    'predictedProbabilityMinimum',
    'predictedProbabilityMaximum',
  ];
  const differences = {};
  let maximumDifference = 0;
  for (const field of fields) {
    const difference = Math.abs(actual[field] - expected[field]);
    differences[field] = difference;
    maximumDifference = Math.max(maximumDifference, difference);
    if (difference > TOLERANCE) {
      throw new Error(`source Hit summary ${field} drifted by ${difference}.`);
    }
  }
  return Object.freeze({
    tolerance: TOLERANCE,
    differences: Object.freeze(differences),
    maximumDifference,
  });
}

export function summarizeHitReliabilityPredictions({
  predictions: rawPredictions,
  sourceHitSummary,
}) {
  const predictions = normalizeHitPredictions(rawPredictions);
  const overall = aggregateHitMetrics(predictions);
  const sourceEquivalence = assertSourceHitSummaryEquivalence(
    overall,
    sourceHitSummary,
  );
  const fixedWidth = buildFixedWidthHitReliabilityBuckets(predictions);
  const equalCount = buildEqualCountHitReliabilityBuckets(predictions);
  const fixedExpectedDifference = Math.abs(
    fixedWidth.expectedHitCount - overall.validationExpectedCount,
  );
  const equalCountExpectedDifference = Math.abs(
    equalCount.expectedHitCount - overall.validationExpectedCount,
  );
  const expectedMassTolerance =
    TOLERANCE *
    Math.max(
      1,
      Math.abs(overall.validationExpectedCount),
      Math.abs(fixedWidth.expectedHitCount),
      Math.abs(equalCount.expectedHitCount),
    );
  if (
    fixedWidth.observedHitCount !== overall.validationObservedCount ||
    equalCount.observedHitCount !== overall.validationObservedCount ||
    fixedExpectedDifference > expectedMassTolerance ||
    equalCountExpectedDifference > expectedMassTolerance
  ) {
    throw new Error(
      `Hit reliability bucket totals drifted from aggregate metrics: fixed expected difference ${fixedExpectedDifference}, equal-count expected difference ${equalCountExpectedDifference}, allowed ${expectedMassTolerance}.`,
    );
  }
  return Object.freeze({
    overall,
    sourceEquivalence,
    fixedWidth,
    equalCount,
    calibrationDecision: Object.freeze({
      calibrationModelFit: false,
      calibrationApplied: false,
      hardAcceptanceThresholdApplied: false,
      currentReportPurpose:
        'Measure current-season reliability before deciding whether an approved calibration model is necessary.',
      productionValidated: false,
      remainingGate:
        'Review fixed-width and equal-count reliability evidence, then define and chronologically validate calibration only if supported; the untouched latest-current-season test remains sealed.',
    }),
  });
}

function rebuildWalkForwardHitPredictions({
  dataset,
  rareOutcomeArtifact,
  platoonWalkForward,
  hitCategories,
}) {
  const modeledCategories = validateStringList(
    rareOutcomeArtifact.modeledCategories,
    'rare-outcome modeledCategories',
    2,
  );
  const observations = extractObservations(dataset, modeledCategories);
  const hitSet = new Set(hitCategories);
  const validationDates = [
    ...new Set(
      observations.validationPlatoon.map(
        (observation) => observation.observedDate,
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const trainingOverall = [...observations.fitOverall];
  const trainingPlatoon = [...observations.fitPlatoon];
  const predictions = [];
  const foldEquivalences = [];

  for (const [index, validationDate] of validationDates.entries()) {
    if (
      trainingOverall.some((observation) => observation.observedDate >= validationDate)
    ) {
      throw new Error(`Hit reliability fold ${validationDate} contains future training rows.`);
    }
    const foldValidation = observations.validationPlatoon.filter(
      (observation) => observation.observedDate === validationDate,
    );
    const predicted = predictFrozenPlatoonCandidateCohort({
      categories: modeledCategories,
      hitCategories,
      trainingOverall: Object.freeze([...trainingOverall]),
      trainingPlatoon: Object.freeze([...trainingPlatoon]),
      validationPlatoon: Object.freeze(foldValidation),
      baseParameters: rareOutcomeArtifact.baseParameters,
      candidate: rareOutcomeArtifact.frozenCandidate,
    });
    const sourceFold = platoonWalkForward.folds[index];
    if (sourceFold?.validationDate !== validationDate) {
      throw new Error(`Hit reliability source fold ${validationDate} is missing.`);
    }
    foldEquivalences.push(
      Object.freeze({
        foldNumber: index + 1,
        validationDate,
        ...metricDifference(
          predicted.metrics,
          sourceFold.selected,
          `Hit reliability fold ${validationDate}`,
        ),
      }),
    );
    predictions.push(
      ...predicted.predictions.map((prediction) =>
        Object.freeze({
          observationId: prediction.observationId,
          observedDate: prediction.observedDate,
          hitProbability: prediction.hitProbability,
          hit: hitSet.has(prediction.terminalCategory) ? 1 : 0,
        }),
      ),
    );
    const dateOverall = observations.validationOverall.filter(
      (observation) => observation.observedDate === validationDate,
    );
    trainingOverall.push(...dateOverall);
    trainingPlatoon.push(...foldValidation);
  }

  if (predictions.length !== observations.validationPlatoon.length) {
    throw new Error('Hit reliability walk-forward did not conserve validation rows.');
  }
  const observationIdsSha256 = sha256(
    JSON.stringify(predictions.map((prediction) => prediction.observationId)),
  );
  if (
    observationIdsSha256 !==
    rareOutcomeArtifact.cohorts.validationObservationIdsSha256
  ) {
    throw new Error('Hit reliability observation identities drifted from uncertainty artifact.');
  }
  return Object.freeze({
    modeledCategories,
    observations,
    validationDates: Object.freeze(validationDates),
    predictions: Object.freeze(predictions),
    observationIdsSha256,
    foldEquivalences: Object.freeze(foldEquivalences),
    maximumFoldEquivalenceDifference: Math.max(
      0,
      ...foldEquivalences.map((fold) => fold.maximumDifference),
    ),
  });
}

export function evaluateResolvedCategoricalHitReliability({
  dataset,
  datasetText,
  fixedEvaluation,
  fixedEvaluationText,
  coherentWalkForward,
  coherentWalkForwardText,
  boundaryEvaluation,
  boundaryEvaluationText,
  platoonWalkForward,
  platoonWalkForwardText,
  rareOutcomeUncertainty,
  rareOutcomeUncertaintyText,
  canonicalCategories: rawCanonicalCategories,
  hitCategories: rawHitCategories,
}) {
  const canonicalCategories = validateStringList(
    rawCanonicalCategories,
    'canonicalCategories',
    2,
  );
  const hitCategories = validateStringList(rawHitCategories, 'hitCategories', 1);
  const expectedUncertainty = evaluateResolvedCategoricalRareOutcomeUncertainty({
    dataset,
    datasetText: assertNonEmptyString(datasetText, 'datasetText'),
    fixedEvaluation,
    fixedEvaluationText: assertNonEmptyString(
      fixedEvaluationText,
      'fixedEvaluationText',
    ),
    coherentWalkForward,
    coherentWalkForwardText: assertNonEmptyString(
      coherentWalkForwardText,
      'coherentWalkForwardText',
    ),
    boundaryEvaluation,
    boundaryEvaluationText: assertNonEmptyString(
      boundaryEvaluationText,
      'boundaryEvaluationText',
    ),
    platoonWalkForward,
    platoonWalkForwardText: assertNonEmptyString(
      platoonWalkForwardText,
      'platoonWalkForwardText',
    ),
    canonicalCategories,
    hitCategories,
  });
  const uncertainty = validateRareOutcomeArtifact(
    rareOutcomeUncertainty,
    expectedUncertainty,
    assertNonEmptyString(
      rareOutcomeUncertaintyText,
      'rareOutcomeUncertaintyText',
    ),
  );
  const rebuilt = rebuildWalkForwardHitPredictions({
    dataset,
    rareOutcomeArtifact: uncertainty,
    platoonWalkForward,
    hitCategories,
  });
  const reliability = summarizeHitReliabilityPredictions({
    predictions: rebuilt.predictions,
    sourceHitSummary: uncertainty.summary.hitSummary,
  });

  const identity = {
    activeSeason: uncertainty.activeSeason,
    sourceDatasetSha256: uncertainty.sourceDatasetSha256,
    sourceDatasetFileSha256: uncertainty.sourceDatasetFileSha256,
    sourceFixedEvaluationSha256: uncertainty.sourceFixedEvaluationSha256,
    sourceCoherentWalkForwardSha256:
      uncertainty.sourceCoherentWalkForwardSha256,
    sourcePlatoonBoundarySha256: uncertainty.sourcePlatoonBoundarySha256,
    sourcePlatoonWalkForwardSha256:
      uncertainty.sourcePlatoonWalkForwardSha256,
    sourceRareOutcomeUncertaintySha256:
      uncertainty.rareOutcomeUncertaintySha256,
    sourceRareOutcomeUncertaintyFileSha256: sha256(
      rareOutcomeUncertaintyText,
    ),
    canonicalCategories,
    modeledCategories: rebuilt.modeledCategories,
    structuralZeroCategories: uncertainty.structuralZeroCategories,
    hitCategories,
    frozenCandidate: uncertainty.frozenCandidate,
    baseParameters: uncertainty.baseParameters,
    cohorts: Object.freeze({
      fitOverallObservationCount: rebuilt.observations.fitOverall.length,
      fitPlatoonObservationCount: rebuilt.observations.fitPlatoon.length,
      validationOverallObservationCount:
        rebuilt.observations.validationOverall.length,
      validationPlatoonObservationCount:
        rebuilt.observations.validationPlatoon.length,
      validationDateCount: rebuilt.validationDates.length,
      validationObservationIdsSha256: rebuilt.observationIdsSha256,
    }),
    scorerEquivalence: Object.freeze({
      tolerance: TOLERANCE,
      foldEquivalences: rebuilt.foldEquivalences,
      maximumFoldDifference: rebuilt.maximumFoldEquivalenceDifference,
      aggregateHitSummaryDifference:
        reliability.sourceEquivalence.maximumDifference,
    }),
    bucketMethods: Object.freeze({
      fixedWidth:
        'Twenty fixed 5-percentage-point Hit-probability buckets across [0,1].',
      equalCount:
        'Ten deterministic equal-count buckets sorted by Hit probability and observation identity.',
      observedRateInterval: '95% Wilson score interval',
      calibrationMetrics:
        'Expected calibration error, maximum calibration error, and root-mean-squared calibration error are descriptive validation diagnostics, not automatic acceptance thresholds.',
    }),
    reliability,
    untouchedTestReservation: uncertainty.untouchedTestReservation,
  };
  return Object.freeze({
    hitReliabilityVersion: 1,
    purpose:
      'Report current-season chronological Hit reliability curves and probability-bucket counts with uncertainty for the frozen categorical model without fitting or applying calibration.',
    status:
      'offline-resolved-categorical-hit-reliability-not-production-model',
    ...identity,
    hitReliabilitySha256: sha256(JSON.stringify(identity)),
  });
}

export async function evaluateM8ResolvedCategoricalHitReliability({
  datasetPath,
  fixedEvaluationPath,
  coherentWalkForwardPath,
  boundaryEvaluationPath,
  platoonWalkForwardPath,
  rareOutcomeUncertaintyPath,
  canonicalCategories,
  hitCategories,
}) {
  const [
    datasetText,
    fixedEvaluationText,
    coherentWalkForwardText,
    boundaryEvaluationText,
    platoonWalkForwardText,
    rareOutcomeUncertaintyText,
  ] = await Promise.all([
    readFile(assertNonEmptyString(datasetPath, 'datasetPath'), 'utf8'),
    readFile(
      assertNonEmptyString(fixedEvaluationPath, 'fixedEvaluationPath'),
      'utf8',
    ),
    readFile(
      assertNonEmptyString(coherentWalkForwardPath, 'coherentWalkForwardPath'),
      'utf8',
    ),
    readFile(
      assertNonEmptyString(boundaryEvaluationPath, 'boundaryEvaluationPath'),
      'utf8',
    ),
    readFile(
      assertNonEmptyString(platoonWalkForwardPath, 'platoonWalkForwardPath'),
      'utf8',
    ),
    readFile(
      assertNonEmptyString(
        rareOutcomeUncertaintyPath,
        'rareOutcomeUncertaintyPath',
      ),
      'utf8',
    ),
  ]);
  return evaluateResolvedCategoricalHitReliability({
    dataset: parseJson(datasetText, 'resolved categorical dataset'),
    datasetText,
    fixedEvaluation: parseJson(
      fixedEvaluationText,
      'fixed categorical evaluation',
    ),
    fixedEvaluationText,
    coherentWalkForward: parseJson(
      coherentWalkForwardText,
      'coherent categorical walk-forward',
    ),
    coherentWalkForwardText,
    boundaryEvaluation: parseJson(
      boundaryEvaluationText,
      'platoon boundary evaluation',
    ),
    boundaryEvaluationText,
    platoonWalkForward: parseJson(
      platoonWalkForwardText,
      'platoon walk-forward evaluation',
    ),
    platoonWalkForwardText,
    rareOutcomeUncertainty: parseJson(
      rareOutcomeUncertaintyText,
      'rare-outcome uncertainty evaluation',
    ),
    rareOutcomeUncertaintyText,
    canonicalCategories,
    hitCategories,
  });
}
