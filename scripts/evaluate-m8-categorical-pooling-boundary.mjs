import { evaluateM8CategoricalPoolingBoundary } from './m8-categorical-pooling-boundary-utils.mjs';
import { writeJsonAtomic } from './provider-probe-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const datasetPath = requireEnvironmentValue('M8_RECENCY_DATASET_PATH');
const outputPath = requireEnvironmentValue(
  'M8_CATEGORICAL_POOLING_BOUNDARY_OUTPUT_PATH',
);
const { TERMINAL_PA_CATEGORIES } = await import(
  new URL('../dist/src/domain/terminal-pa.js', import.meta.url),
);

const evaluation = await evaluateM8CategoricalPoolingBoundary({
  datasetPath,
  categories: TERMINAL_PA_CATEGORIES,
});
await writeJsonAtomic(outputPath, evaluation);

console.log('=== M8 CATEGORICAL POOLING BOUNDARY EVALUATION ===');
console.log(`Output: ${outputPath}`);
console.log(`Source dataset SHA-256: ${evaluation.sourceDatasetSha256}`);
console.log(
  `Finite candidates: ${evaluation.finiteCandidates
    .map((candidate) => candidate.leagueEquivalentPa)
    .join(', ')} league-equivalent PAs`,
);
console.log('Exact league-only limit included: true');

for (const parameter of [evaluation.batter, evaluation.pitcherAllowed]) {
  console.log(`\n${parameter.parameterId}`);
  console.log(`Validation observations: ${parameter.validationObservationCount}`);
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
console.log(
  `Boundary evaluation SHA-256: ${evaluation.boundaryEvaluationSha256}`,
);
console.log(
  'This boundary check does not fit platoon effects, combine batter and pitcher vectors, calibrate probabilities, enable runtime prediction, or rank a prop.',
);
