import { readFile } from 'node:fs/promises';

import {
  evaluateResolvedCategoricalRareOutcomeUncertainty,
  predictFrozenPlatoonCandidateCohort,
  wilsonScoreInterval95,
} from './m8-resolved-categorical-rare-outcome-uncertainty-utils.mjs';
import { sha256 } from './provider-probe-utils.mjs';

const TOLERANCE = 1e-12;
const EQUAL_COUNT_BUCKET_COUNT = 10;
const VALID_HANDS = new Set(['L', 'R']);

export const M8_RARE_CATEGORY_RELIABILITY_CATEGORIES = Object.freeze(['HR', '3B']);

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
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
    throw new Error('rare-category reliability requires normalized L/R handedness.');
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
    throw new Error('rare-category reliability must keep untouched-test rows sealed.');
  }
  return artifact;
}

function normalizeCategoryPredictions(rawPredictions, category) {
  const predictions = assertArray(rawPredictions, 'predictions');
  if (predictions.length < EQUAL_COUNT_BUCKET_COUNT) {
    throw new Error(
      `equal-count reliability requires at least ${EQUAL_COUNT_BUCKET_COUNT} predictions.`,
    );
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
        throw new Error(`duplicate ${category} reliability prediction ${observationId}.`);
      }
      seen.add(observationId);
      const outcome = assertNonNegativeInteger(
        prediction.outcome,
        `predictions[${index}].outcome`,
      );
      if (outcome !== 0 && outcome !== 1) {
        throw new RangeError(`predictions[${index}].outcome must equal 0 or 1.`);
      }
      return Object.freeze({
        observationId,
        observedDate: assertNonEmptyString(
          prediction.observedDate,
          `predictions[${index}].observedDate`,
        ),
        probability: assertFiniteProbability(
          prediction.probability,
          `predictions[${index}].probability`,
        ),
        outcome,
      });
    }),
  );
}

function aggregateCategoryMetrics(predictions) {
  let observed = 0;
  let expected = 0;
  let logLoss = 0;
  let brier = 0;
  let minimum = 1;
  let maximum = 0;
  for (const prediction of predictions) {
    observed += prediction.outcome;
    expected += prediction.probability;
    logLoss +=
      prediction.outcome === 1
        ? -Math.log(prediction.probability)
        : -Math.log(1 - prediction.probability);
    brier += (prediction.probability - prediction.outcome) ** 2;
    minimum = Math.min(minimum, prediction.probability);
    maximum = Math.max(maximum, prediction.probability);
  }
  const count = predictions.length;
  const observedRate = observed / count;
  const meanPredictedProbability = expected / count;
  const interval = wilsonScoreInterval95(observed, count);
  return Object.freeze({
    validationObservationCount: count,
    validationObservedCount: observed,
    validationObservedRate: observedRate,
    validationObservedRateWilson95: interval,
    validationExpectedCount: expected,
    meanPredictedProbability,
    calibrationGapObservedMinusPredicted:
      observedRate - meanPredictedProbability,
    meanPredictionInsideWilson95:
      meanPredictedProbability >= interval.lower &&
      meanPredictedProbability <= interval.upper,
    binaryLogLoss: logLoss / count,
    binaryBrier: brier / count,
    predictedProbabilityMinimum: minimum,
    predictedProbabilityMaximum: maximum,
  });
}

function summarizeBucket({ category, bucketNumber, predictions }) {
  const aggregate = aggregateCategoryMetrics(predictions);
  return Object.freeze({
    bucketId: `${category}-equal-count-decile-${String(bucketNumber).padStart(2, '0')}`,
    bucketNumber,
    lowerBound: predictions[0].probability,
    upperBound: predictions.at(-1).probability,
    observationCount: aggregate.validationObservationCount,
    observedEventCount: aggregate.validationObservedCount,
    expectedEventCount: aggregate.validationExpectedCount,
    meanPredictedProbability: aggregate.meanPredictedProbability,
    observedEventRate: aggregate.validationObservedRate,
    observedEventRateWilson95: aggregate.validationObservedRateWilson95,
    calibrationGapObservedMinusPredicted:
      aggregate.calibrationGapObservedMinusPredicted,
    absoluteCalibrationGap: Math.abs(
      aggregate.calibrationGapObservedMinusPredicted,
    ),
    binaryLogLoss: aggregate.binaryLogLoss,
    binaryBrier: aggregate.binaryBrier,
    predictedProbabilityMinimum: aggregate.predictedProbabilityMinimum,
    predictedProbabilityMaximum: aggregate.predictedProbabilityMaximum,
    meanPredictionInsideWilson95: aggregate.meanPredictionInsideWilson95,
    status: 'reported-current-season-validation-decile',
  });
}

export function buildEqualCountRareCategoryReliabilityBuckets({
  category: rawCategory,
  predictions: rawPredictions,
}) {
  const category = assertNonEmptyString(rawCategory, 'category');
  const predictions = normalizeCategoryPredictions(rawPredictions, category);
  const sorted = [...predictions].sort(
    (left, right) =>
      left.probability - right.probability ||
      left.observationId.localeCompare(right.observationId),
  );
  const buckets = [];
  for (let index = 0; index < EQUAL_COUNT_BUCKET_COUNT; index += 1) {
    const start = Math.floor((index * sorted.length) / EQUAL_COUNT_BUCKET_COUNT);
    const end = Math.floor(
      ((index + 1) * sorted.length) / EQUAL_COUNT_BUCKET_COUNT,
    );
    buckets.push(
      summarizeBucket({
        category,
        bucketNumber: index + 1,
        predictions: sorted.slice(start, end),
      }),
    );
  }
  const counts = buckets.map((bucket) => bucket.observationCount);
  if (Math.max(...counts) - Math.min(...counts) > 1) {
    throw new Error('equal-count reliability bucket sizes differ by more than one.');
  }
  const observationCount = buckets.reduce(
    (sum, bucket) => sum + bucket.observationCount,
    0,
  );
  const observedEventCount = buckets.reduce(
    (sum, bucket) => sum + bucket.observedEventCount,
    0,
  );
  const expectedEventCount = buckets.reduce(
    (sum, bucket) => sum + bucket.expectedEventCount,
    0,
  );
  if (observationCount !== predictions.length) {
    throw new Error('rare-category buckets did not conserve validation observations.');
  }
  const expectedCalibrationError = buckets.reduce(
    (sum, bucket) =>
      sum +
      (bucket.observationCount / observationCount) *
        bucket.absoluteCalibrationGap,
    0,
  );
  const rootMeanSquaredCalibrationError = Math.sqrt(
    buckets.reduce(
      (sum, bucket) =>
        sum +
        (bucket.observationCount / observationCount) *
          bucket.calibrationGapObservedMinusPredicted ** 2,
      0,
    ),
  );
  return Object.freeze({
    method: 'deterministic-equal-count-deciles',
    tieBreakRule: 'probability ascending, then observationId ascending',
    requestedBucketCount: EQUAL_COUNT_BUCKET_COUNT,
    bucketCount: buckets.length,
    minimumBucketSize: Math.min(...counts),
    maximumBucketSize: Math.max(...counts),
    observationCount,
    observedEventCount,
    expectedEventCount,
    expectedCalibrationError,
    maximumCalibrationError: Math.max(
      ...buckets.map((bucket) => bucket.absoluteCalibrationGap),
    ),
    rootMeanSquaredCalibrationError,
    meanPredictionInsideWilson95BucketCount: buckets.filter(
      (bucket) => bucket.meanPredictionInsideWilson95,
    ).length,
    buckets: Object.freeze(buckets),
  });
}

function assertSourceCategorySummaryEquivalence(actual, source, category) {
  const expected = assertPlainObject(source, `${category} source category summary`);
  const pairs = [
    ['validationObservationCount', 'validationObservationCount'],
    ['validationObservedCount', 'validationObservedCount'],
    ['validationObservedRate', 'validationObservedRate'],
    ['validationExpectedCount', 'validationExpectedCount'],
    ['meanPredictedProbability', 'meanPredictedProbability'],
    ['calibrationGapObservedMinusPredicted', 'calibrationGapObservedMinusPredicted'],
    ['binaryLogLoss', 'oneVsRestLogLoss'],
    ['binaryBrier', 'oneVsRestBrier'],
    ['predictedProbabilityMinimum', 'predictedProbabilityMinimum'],
    ['predictedProbabilityMaximum', 'predictedProbabilityMaximum'],
  ];
  const differences = {};
  let maximumDifference = 0;
  for (const [actualField, sourceField] of pairs) {
    const difference = Math.abs(actual[actualField] - expected[sourceField]);
    differences[actualField] = difference;
    maximumDifference = Math.max(maximumDifference, difference);
    if (difference > TOLERANCE) {
      throw new Error(
        `${category} source category summary ${sourceField} drifted by ${difference}.`,
      );
    }
  }
  return Object.freeze({
    tolerance: TOLERANCE,
    differences: Object.freeze(differences),
    maximumDifference,
  });
}

export function summarizeRareCategoryReliability({
  category: rawCategory,
  predictions: rawPredictions,
  sourceCategorySummary,
}) {
  const category = assertNonEmptyString(rawCategory, 'category');
  const predictions = normalizeCategoryPredictions(rawPredictions, category);
  const overall = aggregateCategoryMetrics(predictions);
  const sourceEquivalence = assertSourceCategorySummaryEquivalence(
    overall,
    sourceCategorySummary,
    category,
  );
  const equalCount = buildEqualCountRareCategoryReliabilityBuckets({
    category,
    predictions,
  });
  const expectedDifference = Math.abs(
    equalCount.expectedEventCount - overall.validationExpectedCount,
  );
  const expectedMassTolerance =
    TOLERANCE *
    Math.max(
      1,
      Math.abs(equalCount.expectedEventCount),
      Math.abs(overall.validationExpectedCount),
    );
  if (
    equalCount.observedEventCount !== overall.validationObservedCount ||
    expectedDifference > expectedMassTolerance
  ) {
    throw new Error(
      `${category} reliability bucket totals drifted: expected difference ${expectedDifference}, allowed ${expectedMassTolerance}.`,
    );
  }
  return Object.freeze({
    category,
    overall,
    sourceEquivalence,
    equalCount,
    calibrationDecision: Object.freeze({
      calibrationModelFit: false,
      calibrationApplied: false,
      hardAcceptanceThresholdApplied: false,
      productionValidated: false,
      remainingGate:
        'Review category reliability and uncertainty before defining any calibration candidate; the untouched latest-current-season test remains sealed.',
    }),
  });
}

function rebuildWalkForwardCategoricalPredictions({
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
      throw new Error(
        `rare-category reliability fold ${validationDate} contains future training rows.`,
      );
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
      throw new Error(`rare-category source fold ${validationDate} is missing.`);
    }
    foldEquivalences.push(
      Object.freeze({
        foldNumber: index + 1,
        validationDate,
        ...metricDifference(
          predicted.metrics,
          sourceFold.selected,
          `rare-category reliability fold ${validationDate}`,
        ),
      }),
    );
    predictions.push(...predicted.predictions);
    const dateOverall = observations.validationOverall.filter(
      (observation) => observation.observedDate === validationDate,
    );
    trainingOverall.push(...dateOverall);
    trainingPlatoon.push(...foldValidation);
  }

  if (predictions.length !== observations.validationPlatoon.length) {
    throw new Error(
      'rare-category reliability walk-forward did not conserve validation rows.',
    );
  }
  const observationIdsSha256 = sha256(
    JSON.stringify(predictions.map((prediction) => prediction.observationId)),
  );
  if (
    observationIdsSha256 !==
    rareOutcomeArtifact.cohorts.validationObservationIdsSha256
  ) {
    throw new Error(
      'rare-category reliability observation identities drifted from uncertainty artifact.',
    );
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

export function evaluateResolvedCategoricalRareCategoryReliability({
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
  focusCategories: rawFocusCategories = M8_RARE_CATEGORY_RELIABILITY_CATEGORIES,
}) {
  const canonicalCategories = validateStringList(
    rawCanonicalCategories,
    'canonicalCategories',
    2,
  );
  const hitCategories = validateStringList(rawHitCategories, 'hitCategories', 1);
  const focusCategories = validateStringList(
    rawFocusCategories,
    'focusCategories',
    1,
  );
  const canonicalSet = new Set(canonicalCategories);
  for (const category of focusCategories) {
    if (!canonicalSet.has(category)) {
      throw new Error(`focus category ${category} is not canonical.`);
    }
  }

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
  const rebuilt = rebuildWalkForwardCategoricalPredictions({
    dataset,
    rareOutcomeArtifact: uncertainty,
    platoonWalkForward,
    hitCategories,
  });
  const modeledSet = new Set(rebuilt.modeledCategories);
  const reports = {};
  let maximumSourceCategoryDifference = 0;
  for (const category of focusCategories) {
    if (!modeledSet.has(category)) {
      throw new Error(`focus category ${category} is not modeled.`);
    }
    const report = summarizeRareCategoryReliability({
      category,
      predictions: rebuilt.predictions.map((prediction) =>
        Object.freeze({
          observationId: prediction.observationId,
          observedDate: prediction.observedDate,
          probability: prediction.probabilities[category],
          outcome: prediction.terminalCategory === category ? 1 : 0,
        }),
      ),
      sourceCategorySummary: uncertainty.summary.categoryReports[category],
    });
    reports[category] = report;
    maximumSourceCategoryDifference = Math.max(
      maximumSourceCategoryDifference,
      report.sourceEquivalence.maximumDifference,
    );
  }

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
    focusCategories,
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
      maximumSourceCategoryDifference,
    }),
    bucketMethod: Object.freeze({
      method: 'deterministic-equal-count-deciles',
      reason:
        'Rare-category reporting uses equal-count deciles to preserve useful event counts without inventing arbitrary fixed probability cutoffs.',
      observedRateInterval: '95% Wilson score interval',
      calibrationMetrics:
        'Expected calibration error, maximum calibration error, and root-mean-squared calibration error are descriptive diagnostics, not automatic acceptance thresholds.',
    }),
    reports: Object.freeze(reports),
    calibrationDecision: Object.freeze({
      calibrationModelFit: false,
      calibrationApplied: false,
      hardAcceptanceThresholdApplied: false,
      productionValidated: false,
      remainingGate:
        'Review HR and 3B reliability evidence before defining any calibration candidate; altline-tail and overdispersion checks remain separate M8 gates.',
    }),
    untouchedTestReservation: uncertainty.untouchedTestReservation,
  };
  return Object.freeze({
    rareCategoryReliabilityVersion: 1,
    purpose:
      'Report current-season chronological HR and 3B reliability with probability-bucket counts and uncertainty for the frozen categorical model without fitting or applying calibration.',
    status:
      'offline-resolved-categorical-rare-category-reliability-not-production-model',
    ...identity,
    rareCategoryReliabilitySha256: sha256(JSON.stringify(identity)),
  });
}

export async function evaluateM8ResolvedCategoricalRareCategoryReliability({
  datasetPath,
  fixedEvaluationPath,
  coherentWalkForwardPath,
  boundaryEvaluationPath,
  platoonWalkForwardPath,
  rareOutcomeUncertaintyPath,
  canonicalCategories,
  hitCategories,
  focusCategories = M8_RARE_CATEGORY_RELIABILITY_CATEGORIES,
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
  return evaluateResolvedCategoricalRareCategoryReliability({
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
    focusCategories,
  });
}
