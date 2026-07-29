import { evaluateM8HitRecencyWalkForward } from './m8-hit-recency-walk-forward-utils.mjs';
import { writeJsonAtomic } from './provider-probe-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const benchmarkPath = requireEnvironmentValue('M8_HIT_BENCHMARK_PATH');
const outputPath = requireEnvironmentValue(
  'M8_HIT_RECENCY_WALK_FORWARD_OUTPUT_PATH',
);

const evaluation = await evaluateM8HitRecencyWalkForward({ benchmarkPath });
await writeJsonAtomic(outputPath, evaluation);

console.log('=== M8 HIT RECENCY WALK-FORWARD EVALUATION ===');
console.log(`Output: ${outputPath}`);
console.log(`Source benchmark SHA-256: ${evaluation.sourceBenchmarkSha256}`);
console.log(`Validation folds: ${evaluation.folds.length}`);
console.log(
  `Aggregate eligible observations: ${evaluation.aggregateResults[0].validationObservationCount}`,
);
console.log('Aggregate candidate results:');
for (const result of evaluation.aggregateResults) {
  console.log(
    `- ${result.candidate.candidateId}: log loss=${result.validationLogLoss.toFixed(9)}, Brier=${result.validationBrierScore.toFixed(9)}, mean prediction=${result.validationMeanPrediction.toFixed(9)}`,
  );
}
console.log(`Selection status: ${evaluation.selection.status}`);
console.log(
  `Selected walk-forward benchmark candidate: ${evaluation.selection.selectedCandidate.candidateId}`,
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
console.log(`Walk-forward SHA-256: ${evaluation.walkForwardSha256}`);
console.log(
  'This is a binary benchmark robustness result only. It does not define production categorical pooling or runtime coefficients.',
);
