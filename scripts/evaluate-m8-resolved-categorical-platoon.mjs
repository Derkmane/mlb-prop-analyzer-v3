import { writeJsonAtomic } from './provider-probe-utils.mjs';
import {
  evaluateM8ResolvedCategoricalPlatoon,
} from './m8-resolved-categorical-platoon-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const datasetPath = requireEnvironmentValue('M8_RESOLVED_CATEGORICAL_DATASET_PATH');
const fixedEvaluationPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_MODEL_EVALUATION_PATH',
);
const walkForwardEvaluationPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_WALK_FORWARD_PATH',
);
const outputPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_PLATOON_OUTPUT_PATH',
);
const { TERMINAL_PA_CATEGORIES } = await import(
  new URL('../dist/src/domain/terminal-pa.js', import.meta.url),
);

const evaluation = await evaluateM8ResolvedCategoricalPlatoon({
  datasetPath,
  fixedEvaluationPath,
  walkForwardEvaluationPath,
  canonicalCategories: TERMINAL_PA_CATEGORIES,
  hitCategories: ['1B', '2B', '3B', 'HR'],
});
await writeJsonAtomic(outputPath, evaluation);

const selected = evaluation.selection.selectedCandidate;
const improvement = evaluation.improvementVersusNoPlatoon;
const flags = evaluation.selectedBoundaryFlags;

console.log('=== M8 RESOLVED CATEGORICAL PLATOON EVALUATION ===');
console.log(`Output: ${outputPath}`);
console.log(`Source dataset SHA-256: ${evaluation.sourceDatasetSha256}`);
console.log(`Source fixed evaluation SHA-256: ${evaluation.sourceFixedEvaluationSha256}`);
console.log(`Source walk-forward SHA-256: ${evaluation.sourceWalkForwardSha256}`);
console.log(
  `Base coherent candidate: ${evaluation.baseParameters.selectedCandidateId}`,
);
console.log(
  `Base pooling strengths: batter=${evaluation.baseParameters.batterPooling}, pitcher=${evaluation.baseParameters.pitcherPooling}`,
);
console.log(
  `Fit observations: overall=${evaluation.cohorts.fitOverallObservationCount}, platoon=${evaluation.cohorts.fitPlatoonObservationCount}, excluded=${evaluation.cohorts.fitPlatoonExcludedCount}`,
);
console.log(
  `Validation observations: overall=${evaluation.cohorts.validationOverallObservationCount}, platoon=${evaluation.cohorts.validationPlatoonObservationCount}, excluded=${evaluation.cohorts.validationPlatoonExcludedCount}`,
);
console.log(`Unique fit batter splits: ${evaluation.cohorts.uniqueFitBatterSplitCount}`);
console.log(`Platoon candidates: ${evaluation.candidates.length}`);
console.log(`Selection status: ${evaluation.selection.status}`);
console.log(`Selected candidate: ${selected?.candidateId ?? 'none'}`);
console.log(
  `No-platoon categorical log loss: ${evaluation.baseline.validationCategoricalLogLoss.toFixed(9)}`,
);
console.log(
  `No-platoon categorical Brier: ${evaluation.baseline.validationCategoricalBrierScore.toFixed(9)}`,
);
console.log(
  `No-platoon Hit log loss: ${evaluation.baseline.validationHitLogLoss.toFixed(9)}`,
);
console.log(
  `No-platoon Hit Brier: ${evaluation.baseline.validationHitBrierScore.toFixed(9)}`,
);
if (selected !== null) {
  console.log(
    `Selected categorical log loss: ${evaluation.selection.validationCategoricalLogLoss.toFixed(9)}`,
  );
  console.log(
    `Selected categorical Brier: ${evaluation.selection.validationCategoricalBrierScore.toFixed(9)}`,
  );
  console.log(
    `Selected Hit log loss: ${evaluation.selection.validationHitLogLoss.toFixed(9)}`,
  );
  console.log(
    `Selected Hit Brier: ${evaluation.selection.validationHitBrierScore.toFixed(9)}`,
  );
  console.log(
    `Improvement versus no platoon: categorical log loss=${improvement.categoricalLogLoss.toFixed(9)}, categorical Brier=${improvement.categoricalBrier.toFixed(9)}, Hit log loss=${improvement.hitLogLoss.toFixed(9)}, Hit Brier=${improvement.hitBrier.toFixed(9)}`,
  );
}
console.log(
  `Boundary flags: coefficient-max=${flags.platoonCoefficientAtTestedMaximum}, league-prior-boundary=${flags.leaguePriorAtFiniteBoundary}, split-prior-boundary=${flags.playerSplitPriorAtFiniteBoundary}`,
);
console.log(
  `Structural-zero categories: ${evaluation.structuralZeroCategories.join(', ') || 'none'}`,
);
console.log(
  `Untouched test sealed: ${evaluation.untouchedTestReservation.startDate} through ${evaluation.untouchedTestReservation.endDate} — ${evaluation.untouchedTestReservation.plateAppearanceCount} rows excluded`,
);
console.log(`Evaluation SHA-256: ${evaluation.platoonEvaluationSha256}`);
console.log(
  'This remains an offline fit-validation evaluation. It does not approve a runtime model, calibrate probabilities, or rank a real prop.',
);
