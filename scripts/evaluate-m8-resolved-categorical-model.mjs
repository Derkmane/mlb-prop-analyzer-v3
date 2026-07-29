import { writeJsonAtomic } from './provider-probe-utils.mjs';
import { evaluateM8ResolvedCategoricalModel } from './m8-resolved-categorical-model-evaluation-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const datasetPath = requireEnvironmentValue('M8_RESOLVED_CATEGORICAL_DATASET_PATH');
const outputPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_MODEL_EVALUATION_OUTPUT_PATH',
);
const { TERMINAL_PA_CATEGORIES } = await import(
  new URL('../dist/src/domain/terminal-pa.js', import.meta.url),
);

const evaluation = await evaluateM8ResolvedCategoricalModel({
  datasetPath,
  canonicalCategories: TERMINAL_PA_CATEGORIES,
  hitCategories: ['1B', '2B', '3B', 'HR'],
});
await writeJsonAtomic(outputPath, evaluation);

const boundary = evaluation.poolingBoundary;
const matchup = evaluation.coherentMatchup;

console.log('=== M8 RESOLVED CATEGORICAL MODEL EVALUATION ===');
console.log(`Output: ${outputPath}`);
console.log(`Source dataset SHA-256: ${evaluation.sourceDatasetSha256}`);
console.log(
  `Canonical categories: ${evaluation.canonicalVectorPolicy.canonicalCategories.length}`,
);
console.log(
  `Modeled categories: ${evaluation.canonicalVectorPolicy.modeledCategories.join(', ')}`,
);
console.log(
  `Structural-zero categories: ${evaluation.canonicalVectorPolicy.structuralZeroCategories.join(', ') || 'none'}`,
);
console.log(
  `Fit terminal observations: ${boundary.batter.fitObservationCount}`,
);
console.log(
  `Validation terminal observations: ${boundary.batter.validationObservationCount}`,
);
console.log(
  `Batter pooling: ${boundary.batter.selection.status} — ${boundary.batter.selection.selectedCandidate?.candidateId ?? 'none'}`,
);
console.log(
  `Pitcher pooling: ${boundary.pitcherAllowed.selection.status} — ${boundary.pitcherAllowed.selection.selectedCandidate?.candidateId ?? 'none'}`,
);
console.log(`Coherent status: ${evaluation.coherentStatus}`);
if (matchup !== null) {
  console.log(`Coefficient candidates: ${matchup.candidates.length}`);
  console.log(`Coefficient selection: ${matchup.selection.status}`);
  console.log(
    `Selected coefficients: ${matchup.selection.selectedCandidate?.candidateId ?? 'none'}`,
  );
  console.log(
    `Selected categorical log loss: ${matchup.selection.validationCategoricalLogLoss?.toFixed(9) ?? 'n/a'}`,
  );
  console.log(
    `Selected categorical Brier: ${matchup.selection.validationCategoricalBrierScore?.toFixed(9) ?? 'n/a'}`,
  );
  console.log(
    `Selected Hit log loss: ${matchup.selection.validationHitLogLoss?.toFixed(9) ?? 'n/a'}`,
  );
  console.log(
    `Selected Hit Brier: ${matchup.selection.validationHitBrierScore?.toFixed(9) ?? 'n/a'}`,
  );
}
console.log(
  `Untouched test sealed: ${evaluation.untouchedTestReservation.startDate} through ${evaluation.untouchedTestReservation.endDate} — ${evaluation.untouchedTestReservation.plateAppearanceCount} rows excluded`,
);
console.log(`Evaluation SHA-256: ${evaluation.evaluationSha256}`);
console.log(
  'This remains an offline fit-validation evaluation. It does not fit platoon effects, calibrate probabilities, enable runtime prediction, or rank a real prop.',
);
