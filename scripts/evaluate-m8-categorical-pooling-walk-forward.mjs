import {
  evaluateM8CategoricalPoolingWalkForwardFiles,
  verifyM8CategoricalPoolingWalkForward,
} from './m8-categorical-pooling-walk-forward-utils.mjs';
import { writeJsonAtomic } from './provider-probe-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const datasetPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_DATASET_PATH',
);
const fixedEvaluationPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_MODEL_EVALUATION_PATH',
);
const outputPath = requireEnvironmentValue(
  'M8_CATEGORICAL_POOLING_WALK_FORWARD_OUTPUT_PATH',
);
const { TERMINAL_PA_CATEGORIES } = await import(
  new URL('../dist/src/domain/terminal-pa.js', import.meta.url),
);

const evaluation = await evaluateM8CategoricalPoolingWalkForwardFiles({
  datasetPath,
  fixedEvaluationPath,
  canonicalCategories: TERMINAL_PA_CATEGORIES,
  hitCategories: ['1B', '2B', '3B', 'HR'],
});
verifyM8CategoricalPoolingWalkForward(evaluation);
await writeJsonAtomic(outputPath, evaluation);

console.log('=== M8 CATEGORICAL POOLING WALK-FORWARD COMPLETE ===');
for (const key of ['batter', 'pitcherAllowed']) {
  const parameter = evaluation.parameters[key];
  console.log(`${key}:`);
  console.log(
    `  fixed nondominated: ${parameter.fixedNondominatedCandidateIds.join(', ')}`,
  );
  console.log(
    `  walk-forward nondominated: ${parameter.walkForwardNondominatedCandidateIds.join(', ')}`,
  );
  console.log(`  stable intersection: ${parameter.stableCandidateIds.join(', ')}`);
  console.log(`  selected: ${parameter.selectedCandidateId}`);
}
console.log(`Folds: ${evaluation.folds.length}`);
console.log(`Output: ${outputPath}`);
console.log(`Evaluation SHA-256: ${evaluation.poolingWalkForwardSha256}`);
console.log('Production enabled: false');
console.log('Untouched-test rows accessed: false');
