import { writeJsonAtomic } from './provider-probe-utils.mjs';
import {
  evaluateM8ResolvedCategoricalRareOutcomeUncertainty,
} from './m8-resolved-categorical-rare-outcome-uncertainty-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function percent(value) {
  return `${(value * 100).toFixed(4)}%`;
}

const datasetPath = requireEnvironmentValue('M8_RESOLVED_CATEGORICAL_DATASET_PATH');
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
const outputPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_RARE_OUTCOME_UNCERTAINTY_OUTPUT_PATH',
);
const { TERMINAL_PA_CATEGORIES } = await import(
  new URL('../dist/src/domain/terminal-pa.js', import.meta.url),
);

const evaluation =
  await evaluateM8ResolvedCategoricalRareOutcomeUncertainty({
    datasetPath,
    fixedEvaluationPath,
    coherentWalkForwardPath,
    boundaryEvaluationPath,
    platoonWalkForwardPath,
    canonicalCategories: TERMINAL_PA_CATEGORIES,
    hitCategories: ['1B', '2B', '3B', 'HR'],
  });
await writeJsonAtomic(outputPath, evaluation);

console.log('=== M8 RESOLVED CATEGORICAL RARE-OUTCOME UNCERTAINTY ===');
console.log(`Output: ${outputPath}`);
console.log(`Source dataset SHA-256: ${evaluation.sourceDatasetSha256}`);
console.log(
  `Source platoon walk-forward SHA-256: ${evaluation.sourcePlatoonWalkForwardSha256}`,
);
console.log(
  `Validation observations: ${evaluation.summary.validationObservationCount}`,
);
console.log(
  `Scorer equivalence maximum difference: ${evaluation.scorerEquivalence.maximumDifference.toExponential(3)}`,
);
console.log('Rare-outcome focus:');
for (const category of evaluation.focusCategories) {
  const report = evaluation.summary.focusReports[category];
  const interval = report.validationObservedRateWilson95;
  console.log(
    `  ${category}: fit=${report.fitOverallCount}, validation=${report.validationObservedCount}, expected=${report.validationExpectedCount.toFixed(3)}, observed-rate=${percent(report.validationObservedRate)}, predicted-rate=${percent(report.meanPredictedProbability)}, Wilson95=${interval === null ? 'n/a' : `[${percent(interval.lower)}, ${percent(interval.upper)}]`}, status=${report.evidenceStatus}`,
  );
}
const hit = evaluation.summary.hitSummary;
console.log(
  `Hit summary: observed=${hit.validationObservedCount}/${hit.validationObservationCount} (${percent(hit.validationObservedRate)}), expected=${hit.validationExpectedCount.toFixed(3)} (${percent(hit.meanPredictedProbability)}), Wilson95=[${percent(hit.validationObservedRateWilson95.lower)}, ${percent(hit.validationObservedRateWilson95.upper)}], log-loss=${hit.binaryLogLoss.toFixed(9)}, Brier=${hit.binaryBrier.toFixed(9)}`,
);
console.log(
  `Automatic insufficient categories: ${evaluation.summary.evidenceDecision.automaticInsufficientCategories.join(', ') || 'none'}`,
);
console.log(
  `Hard sample threshold applied: ${evaluation.summary.evidenceDecision.hardSampleThresholdApplied}`,
);
console.log(
  `Prior-season rows used: ${evaluation.summary.evidenceDecision.priorSeasonRowsUsed}`,
);
console.log(
  `Production validated: ${evaluation.summary.evidenceDecision.productionValidated}`,
);
console.log(
  `Untouched test sealed: ${evaluation.untouchedTestReservation.startDate} through ${evaluation.untouchedTestReservation.endDate} — ${evaluation.untouchedTestReservation.plateAppearanceCount} rows excluded`,
);
console.log(
  `Uncertainty SHA-256: ${evaluation.rareOutcomeUncertaintySha256}`,
);
console.log(
  'This is an offline uncertainty and reliability report. It does not alter fitted probabilities, calibrate the model, enable runtime prediction, or rank a real prop.',
);
