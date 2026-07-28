import { writeJsonAtomic } from './provider-probe-utils.mjs';
import {
  evaluateM8ResolvedCategoricalPlatoonWalkForward,
} from './m8-resolved-categorical-platoon-walk-forward-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
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
const outputPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_PLATOON_WALK_FORWARD_OUTPUT_PATH',
);
const { TERMINAL_PA_CATEGORIES } = await import(
  new URL('../dist/src/domain/terminal-pa.js', import.meta.url),
);

const evaluation = await evaluateM8ResolvedCategoricalPlatoonWalkForward({
  datasetPath,
  fixedEvaluationPath,
  coherentWalkForwardPath,
  boundaryEvaluationPath,
  canonicalCategories: TERMINAL_PA_CATEGORIES,
  hitCategories: ['1B', '2B', '3B', 'HR'],
});
await writeJsonAtomic(outputPath, evaluation);

const selected = evaluation.aggregateSelected;
const baseline = evaluation.aggregateBaseline;
const improvement = evaluation.aggregateImprovement;
const stability = evaluation.stability;
const equivalence = evaluation.fullValidationEquivalence;
const maximumEquivalenceDifference = Math.max(
  ...Object.values(equivalence.selected),
  ...Object.values(equivalence.baseline),
);

console.log('=== M8 RESOLVED CATEGORICAL PLATOON WALK-FORWARD ===');
console.log(`Output: ${outputPath}`);
console.log(`Source dataset SHA-256: ${evaluation.sourceDatasetSha256}`);
console.log(
  `Source platoon boundary SHA-256: ${evaluation.sourcePlatoonBoundarySha256}`,
);
console.log(`Frozen candidate: ${evaluation.frozenCandidate.candidateId}`);
console.log(`Baseline candidate: ${evaluation.baselineCandidate.candidateId}`);
console.log(`Folds: ${evaluation.folds.length}`);
console.log(
  `Aggregate validation observations: ${selected.validationObservationCount}`,
);
console.log(
  `Full-validation equivalence maximum difference: ${maximumEquivalenceDifference.toExponential(3)}`,
);
console.log(
  `Selected categorical log loss: ${selected.validationCategoricalLogLoss.toFixed(9)}`,
);
console.log(
  `No-platoon categorical log loss: ${baseline.validationCategoricalLogLoss.toFixed(9)}`,
);
console.log(
  `Selected Hit log loss: ${selected.validationHitLogLoss.toFixed(9)}`,
);
console.log(
  `No-platoon Hit log loss: ${baseline.validationHitLogLoss.toFixed(9)}`,
);
console.log(
  `Aggregate improvement: categorical log loss=${improvement.categoricalLogLoss.toFixed(9)}, categorical Brier=${improvement.categoricalBrier.toFixed(9)}, Hit log loss=${improvement.hitLogLoss.toFixed(9)}, Hit Brier=${improvement.hitBrier.toFixed(9)}`,
);
console.log(
  `Fold wins: categorical=${stability.selectedBeatsBaselineCategoricalFoldCount}/${evaluation.folds.length}, Hit=${stability.selectedBeatsBaselineHitFoldCount}/${evaluation.folds.length}, both=${stability.selectedBeatsBaselineBothFoldCount}/${evaluation.folds.length}`,
);
console.log(
  `Fold categorical improvement range: ${stability.categoricalImprovementMinimum.toFixed(9)} to ${stability.categoricalImprovementMaximum.toFixed(9)}`,
);
console.log(
  `Fold Hit improvement range: ${stability.hitImprovementMinimum.toFixed(9)} to ${stability.hitImprovementMaximum.toFixed(9)}`,
);
console.log(
  `Untouched test sealed: ${evaluation.untouchedTestReservation.startDate} through ${evaluation.untouchedTestReservation.endDate} — ${evaluation.untouchedTestReservation.plateAppearanceCount} rows excluded`,
);
console.log(`Walk-forward SHA-256: ${evaluation.platoonWalkForwardSha256}`);
console.log(
  'This freezes the fixed-validation platoon candidate and evaluates it chronologically against no platoon. It does not calibrate probabilities, enable runtime prediction, or rank a real prop.',
);
