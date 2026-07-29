import { writeJsonAtomic } from './provider-probe-utils.mjs';
import { evaluateM8ResolvedCategoricalRareCategoryReliability } from './m8-resolved-categorical-rare-category-reliability-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function percent(value) {
  return `${(value * 100).toFixed(4)}%`;
}

function printBucket(bucket) {
  console.log(
    `  ${bucket.bucketId}: n=${bucket.observationCount}, events=${bucket.observedEventCount}, predicted=${percent(
      bucket.meanPredictedProbability,
    )}, observed=${percent(bucket.observedEventRate)}, Wilson95=[${percent(
      bucket.observedEventRateWilson95.lower,
    )}, ${percent(bucket.observedEventRateWilson95.upper)}], gap=${percent(
      bucket.calibrationGapObservedMinusPredicted,
    )}`,
  );
}

const datasetPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_DATASET_PATH',
);
const fixedEvaluationPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_MODEL_EVALUATION_PATH',
);
const coherentWalkForwardPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_WALK_FORWARD_PATH',
);
const boundaryEvaluationPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_PLATOON_BOUNDARY_PATH',
);
const platoonWalkForwardPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_PLATOON_WALK_FORWARD_PATH',
);
const rareOutcomeUncertaintyPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_RARE_OUTCOME_UNCERTAINTY_PATH',
);
const outputPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_RARE_CATEGORY_RELIABILITY_OUTPUT_PATH',
);

const { TERMINAL_PA_CATEGORIES } = await import(
  new URL('../dist/src/domain/terminal-pa.js', import.meta.url),
);
const evaluation =
  await evaluateM8ResolvedCategoricalRareCategoryReliability({
    datasetPath,
    fixedEvaluationPath,
    coherentWalkForwardPath,
    boundaryEvaluationPath,
    platoonWalkForwardPath,
    rareOutcomeUncertaintyPath,
    canonicalCategories: TERMINAL_PA_CATEGORIES,
    hitCategories: ['1B', '2B', '3B', 'HR'],
    focusCategories: ['HR', '3B'],
  });
await writeJsonAtomic(outputPath, evaluation);

console.log('=== M8 RESOLVED CATEGORICAL HR AND 3B RELIABILITY ===');
console.log(`Output: ${outputPath}`);
console.log(
  `Source rare-outcome uncertainty SHA-256: ${evaluation.sourceRareOutcomeUncertaintySha256}`,
);
console.log(
  `Validation observations: ${evaluation.cohorts.validationPlatoonObservationCount}`,
);
console.log(
  `Scorer equivalence maximum difference: ${Math.max(
    evaluation.scorerEquivalence.maximumFoldDifference,
    evaluation.scorerEquivalence.maximumSourceCategoryDifference,
  ).toExponential(3)}`,
);

for (const category of evaluation.focusCategories) {
  const report = evaluation.reports[category];
  const overall = report.overall;
  const equal = report.equalCount;
  console.log(
    `${category} overall: events=${overall.validationObservedCount}, predicted=${percent(
      overall.meanPredictedProbability,
    )}, observed=${percent(overall.validationObservedRate)}, Wilson95=[${percent(
      overall.validationObservedRateWilson95.lower,
    )}, ${percent(
      overall.validationObservedRateWilson95.upper,
    )}], gap=${percent(
      overall.calibrationGapObservedMinusPredicted,
    )}, log-loss=${overall.binaryLogLoss.toFixed(9)}, Brier=${overall.binaryBrier.toFixed(
      9,
    )}`,
  );
  console.log(
    `${category} equal-count deciles: n=${equal.minimumBucketSize}-${equal.maximumBucketSize}, ECE=${percent(
      equal.expectedCalibrationError,
    )}, MCE=${percent(equal.maximumCalibrationError)}, RMSCE=${percent(
      equal.rootMeanSquaredCalibrationError,
    )}, inside-Wilson=${equal.meanPredictionInsideWilson95BucketCount}/${equal.bucketCount}`,
  );
  for (const bucket of equal.buckets) printBucket(bucket);
}

console.log(
  `Calibration model fit: ${evaluation.calibrationDecision.calibrationModelFit}`,
);
console.log(
  `Calibration applied: ${evaluation.calibrationDecision.calibrationApplied}`,
);
console.log(
  `Untouched test sealed: ${evaluation.untouchedTestReservation.startDate} through ${evaluation.untouchedTestReservation.endDate} — ${evaluation.untouchedTestReservation.plateAppearanceCount} rows excluded`,
);
console.log(
  `Rare-category reliability SHA-256: ${evaluation.rareCategoryReliabilitySha256}`,
);
console.log(
  'This is an offline HR/3B reliability report. It does not fit calibration, access the untouched test period, enable runtime prediction, or rank a real prop.',
);
