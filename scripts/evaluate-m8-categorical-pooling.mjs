import { evaluateM8CategoricalPoolingCandidates } from './m8-categorical-pooling-utils.mjs';
import { writeJsonAtomic } from './provider-probe-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const datasetPath = requireEnvironmentValue('M8_RECENCY_DATASET_PATH');
const outputPath = requireEnvironmentValue('M8_CATEGORICAL_POOLING_OUTPUT_PATH');
const { TERMINAL_PA_CATEGORIES } = await import(
  new URL('../dist/src/domain/terminal-pa.js', import.meta.url),
);

const evaluation = await evaluateM8CategoricalPoolingCandidates({
  datasetPath,
  categories: TERMINAL_PA_CATEGORIES,
});
await writeJsonAtomic(outputPath, evaluation);

console.log('=== M8 CATEGORICAL POOLING EVALUATION ===');
console.log(`Output: ${outputPath}`);
console.log(`Source dataset SHA-256: ${evaluation.sourceDatasetSha256}`);
console.log(`Fit categories: ${evaluation.categories.join(', ')}`);

for (const parameter of [evaluation.batter, evaluation.pitcherAllowed]) {
  console.log(`\n${parameter.parameterId}`);
  console.log(`Fit observations: ${parameter.fitObservationCount}`);
  console.log(`Validation observations: ${parameter.validationObservationCount}`);
  console.log(`Unique fit identities: ${parameter.uniqueFitIdentityCount}`);
  console.log(`Unseen validation identities: ${parameter.unseenValidationIdentityCount}`);
  for (const result of parameter.results) {
    console.log(
      `- ${result.candidate.candidateId}: log loss=${result.validationLogLoss.toFixed(9)}, Brier=${result.validationBrierScore.toFixed(9)}, min actual p=${result.actualProbabilityMinimum.toFixed(9)}, max actual p=${result.actualProbabilityMaximum.toFixed(9)}`,
    );
  }
  console.log(`Selection status: ${parameter.selection.status}`);
  console.log(
    `Selected candidate: ${parameter.selection.selectedCandidate?.candidateId ?? 'none'}`,
  );
}

console.log(
  `\nUntouched test sealed: ${evaluation.untouchedTestReservation.startDate} through ${evaluation.untouchedTestReservation.endDate} — ${evaluation.untouchedTestReservation.plateAppearanceCount} rows excluded`,
);
console.log(`Evaluation SHA-256: ${evaluation.evaluationSha256}`);
console.log(
  'This is an offline single-pooling-path evaluation only. It does not combine batter and pitcher effects, fit platoon effects, calibrate probabilities, enable runtime prediction, or rank a prop.',
);
