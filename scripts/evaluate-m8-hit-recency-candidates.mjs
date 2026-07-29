import { evaluateM8HitRecencyCandidates } from './m8-hit-recency-evaluation-utils.mjs';
import { writeJsonAtomic } from './provider-probe-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const benchmarkPath = requireEnvironmentValue('M8_HIT_BENCHMARK_PATH');
const outputPath = requireEnvironmentValue('M8_HIT_RECENCY_EVALUATION_OUTPUT_PATH');

const evaluation = await evaluateM8HitRecencyCandidates({ benchmarkPath });
await writeJsonAtomic(outputPath, evaluation);

console.log('=== M8 HIT RECENCY BENCHMARK EVALUATION ===');
console.log(`Output: ${outputPath}`);
console.log(`Source benchmark SHA-256: ${evaluation.sourceBenchmarkSha256}`);
console.log(
  `Validation cohort: ${evaluation.cohort.eligibleObservationCount}/${evaluation.cohort.validationObservationCount} observations (${(
    evaluation.cohort.coverageRate * 100
  ).toFixed(2)}%)`,
);
console.log(
  `Cohort exclusions: ${JSON.stringify(evaluation.cohort.exclusionsByReason)}`,
);
console.log('Candidate results:');
for (const result of evaluation.results) {
  console.log(
    `- ${result.candidate.candidateId}: log loss=${result.validationLogLoss.toFixed(9)}, Brier=${result.validationBrierScore.toFixed(9)}, mean prediction=${result.validationMeanPrediction.toFixed(9)}, effective fit weight=${result.effectiveFitObservationWeight.toFixed(3)}`,
  );
}
console.log(`Selection status: ${evaluation.selection.status}`);
console.log(
  `Selected benchmark candidate: ${evaluation.selection.selectedCandidate.candidateId}`,
);
console.log(
  `Uniform log loss: ${evaluation.selection.uniformBaselineLogLoss.toFixed(9)}`,
);
console.log(
  `Selected log loss: ${evaluation.selection.validationLogLoss.toFixed(9)}`,
);
console.log(
  `Untouched test sealed: ${evaluation.untouchedTestReservation.startDate} through ${evaluation.untouchedTestReservation.endDate} — ${evaluation.untouchedTestReservation.plateAppearanceCount} rows excluded`,
);
console.log(`Evaluation SHA-256: ${evaluation.evaluationSha256}`);
console.log(
  'This selection is a binary benchmark result only. It does not define the production categorical recency model, pooling path, or runtime coefficients.',
);
