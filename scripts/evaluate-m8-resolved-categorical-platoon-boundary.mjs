import { writeJsonAtomic } from './provider-probe-utils.mjs';
import {
  evaluateM8ResolvedCategoricalPlatoonBoundary,
  interpretM8PlatoonBoundaryEvaluation,
} from './m8-resolved-categorical-platoon-boundary-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
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
  'M8_RESOLVED_CATEGORICAL_PLATOON_BOUNDARY_OUTPUT_PATH',
);
const { TERMINAL_PA_CATEGORIES } = await import(
  new URL('../dist/src/domain/terminal-pa.js', import.meta.url),
);

const evaluation = await evaluateM8ResolvedCategoricalPlatoonBoundary({
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
const interpretation = interpretM8PlatoonBoundaryEvaluation(evaluation);

console.log('=== M8 RESOLVED CATEGORICAL PLATOON BOUNDARY EVALUATION ===');
console.log(`Output: ${outputPath}`);
console.log(`Source dataset SHA-256: ${evaluation.sourceDatasetSha256}`);
console.log(`Source fixed evaluation SHA-256: ${evaluation.sourceFixedEvaluationSha256}`);
console.log(`Source walk-forward SHA-256: ${evaluation.sourceWalkForwardSha256}`);
console.log(`Platoon candidates: ${evaluation.candidates.length}`);
console.log(`Selection status: ${evaluation.selection.status}`);
console.log(`Selected candidate: ${selected?.candidateId ?? 'none'}`);
console.log(
  `Exact raw league cell selected: ${interpretation.exactRawLeagueCellSelected}`,
);
console.log(
  `Exact raw league cell support valid: ${interpretation.exactRawLeagueCellSupportValid}`,
);
console.log(
  `League prior requires further extension: ${interpretation.leaguePriorRequiresFurtherExtension}`,
);
console.log(
  `No-platoon categorical log loss: ${evaluation.baseline.validationCategoricalLogLoss.toFixed(9)}`,
);
console.log(
  `No-platoon Hit log loss: ${evaluation.baseline.validationHitLogLoss.toFixed(9)}`,
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
  `Raw boundary flags: coefficient-min=${flags.platoonCoefficientAtTestedMinimum}, coefficient-max=${flags.platoonCoefficientAtTestedMaximum}, league-prior-boundary=${flags.leaguePriorAtFiniteBoundary}, split-prior-boundary=${flags.playerSplitPriorAtFiniteBoundary}`,
);
console.log(
  `Untouched test sealed: ${evaluation.untouchedTestReservation.startDate} through ${evaluation.untouchedTestReservation.endDate} — ${evaluation.untouchedTestReservation.plateAppearanceCount} rows excluded`,
);
console.log(`Evaluation SHA-256: ${evaluation.platoonEvaluationSha256}`);
console.log(
  'This evaluates the exact raw current-season league matchup-cell limit through the same verified offline platoon formula. It does not change cohorts, runtime prediction, calibration, or ranking.',
);
