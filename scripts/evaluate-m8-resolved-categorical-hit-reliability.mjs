import { writeJsonAtomic } from './provider-probe-utils.mjs';
import { evaluateM8ResolvedCategoricalHitReliability } from './m8-resolved-categorical-hit-reliability-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function percent(value) {
  return `${(value * 100).toFixed(4)}%`;
}

function printBucket(bucket) {
  console.log(
    `  ${bucket.bucketId}: n=${bucket.observationCount}, predicted=${percent(
      bucket.meanPredictedProbability,
    )}, observed=${percent(bucket.observedHitRate)}, Wilson95=[${percent(
      bucket.observedHitRateWilson95.lower,
    )}, ${percent(bucket.observedHitRateWilson95.upper)}], gap=${percent(
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
  'M8_RESOLVED_CATEGORICAL_HIT_RELIABILITY_OUTPUT_PATH',
);

const { TERMINAL_PA_CATEGORIES } = await import(
  new URL('../dist/src/domain/terminal-pa.js', import.meta.url),
);
const evaluation = await evaluateM8ResolvedCategoricalHitReliability({
  datasetPath,
  fixedEvaluationPath,
  coherentWalkForwardPath,
  boundaryEvaluationPath,
  platoonWalkForwardPath,
  rareOutcomeUncertaintyPath,
  canonicalCategories: TERMINAL_PA_CATEGORIES,
  hitCategories: ['1B', '2B', '3B', 'HR'],
});
await writeJsonAtomic(outputPath, evaluation);

const reliability = evaluation.reliability;
const overall = reliability.overall;
const fixed = reliability.fixedWidth;
const equal = reliability.equalCount;

console.log('=== M8 RESOLVED CATEGORICAL HIT RELIABILITY ===');
console.log(`Output: ${outputPath}`);
console.log(
  `Source rare-outcome uncertainty SHA-256: ${evaluation.sourceRareOutcomeUncertaintySha256}`,
);
console.log(`Validation observations: ${overall.validationObservationCount}`);
console.log(
  `Scorer equivalence maximum difference: ${Math.max(
    evaluation.scorerEquivalence.maximumFoldDifference,
    evaluation.scorerEquivalence.aggregateHitSummaryDifference,
  ).toExponential(3)}`,
);
console.log(
  `Overall Hit: predicted=${percent(overall.meanPredictedProbability)}, observed=${percent(
    overall.validationObservedRate,
  )}, gap=${percent(overall.calibrationGapObservedMinusPredicted)}, log-loss=${overall.binaryLogLoss.toFixed(
    9,
  )}, Brier=${overall.binaryBrier.toFixed(9)}`,
);
console.log(
  `Fixed 5% buckets: nonempty=${fixed.nonEmptyBucketCount}/${fixed.bucketCount}, ECE=${percent(
    fixed.expectedCalibrationError,
  )}, MCE=${percent(fixed.maximumCalibrationError)}, RMSCE=${percent(
    fixed.rootMeanSquaredCalibrationError,
  )}`,
);
for (const bucket of fixed.buckets.filter((item) => item.observationCount > 0)) {
  printBucket(bucket);
}
console.log(
  `Equal-count deciles: n=${equal.minimumBucketSize}-${equal.maximumBucketSize}, ECE=${percent(
    equal.expectedCalibrationError,
  )}, MCE=${percent(equal.maximumCalibrationError)}, RMSCE=${percent(
    equal.rootMeanSquaredCalibrationError,
  )}`,
);
for (const bucket of equal.buckets) {
  printBucket(bucket);
}
console.log(
  `Calibration model fit: ${reliability.calibrationDecision.calibrationModelFit}`,
);
console.log(
  `Calibration applied: ${reliability.calibrationDecision.calibrationApplied}`,
);
console.log(
  `Untouched test sealed: ${evaluation.untouchedTestReservation.startDate} through ${evaluation.untouchedTestReservation.endDate} — ${evaluation.untouchedTestReservation.plateAppearanceCount} rows excluded`,
);
console.log(`Reliability SHA-256: ${evaluation.hitReliabilitySha256}`);
console.log(
  'This is an offline reliability report. It does not fit calibration, access the untouched test period, enable runtime prediction, or rank a real prop.',
);
