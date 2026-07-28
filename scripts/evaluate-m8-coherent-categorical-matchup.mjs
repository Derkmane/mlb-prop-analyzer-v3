import { evaluateM8CoherentCategoricalMatchup } from './m8-coherent-categorical-matchup-utils.mjs';
import { writeJsonAtomic } from './provider-probe-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const datasetPath = requireEnvironmentValue('M8_RECENCY_DATASET_PATH');
const poolingBoundaryPath = requireEnvironmentValue(
  'M8_CATEGORICAL_POOLING_BOUNDARY_PATH',
);
const outputPath = requireEnvironmentValue(
  'M8_COHERENT_CATEGORICAL_MATCHUP_OUTPUT_PATH',
);
const { TERMINAL_PA_CATEGORIES } = await import(
  new URL('../dist/src/domain/terminal-pa.js', import.meta.url),
);

const evaluation = await evaluateM8CoherentCategoricalMatchup({
  datasetPath,
  poolingBoundaryPath,
  categories: TERMINAL_PA_CATEGORIES,
  hitCategories: ['1B', '2B', '3B', 'HR'],
});

await writeJsonAtomic(outputPath, evaluation);

console.log('=== M8 COHERENT CATEGORICAL MATCHUP EVALUATION ===');
console.log(`Output: ${outputPath}`);
console.log(`Source dataset SHA-256: ${evaluation.sourceDatasetSha256}`);
console.log(
  `Source pooling boundary SHA-256: ${evaluation.sourcePoolingBoundarySha256}`,
);
console.log(`Fit observations: ${evaluation.matchup.fitObservationCount}`);
console.log(
  `Validation observations: ${evaluation.matchup.validationObservationCount}`,
);
console.log(
  `Pooling strengths: batter=${evaluation.matchup.batterLeagueEquivalentPa}, pitcher-allowed=${evaluation.matchup.pitcherAllowedLeagueEquivalentPa} league-equivalent PAs`,
);
console.log(
  `Fit identities: ${evaluation.matchup.uniqueFitBatterCount} batters, ${evaluation.matchup.uniqueFitPitcherCount} pitchers`,
);
console.log(
  `Unseen validation identities: ${evaluation.matchup.unseenValidationBatterCount} batters, ${evaluation.matchup.unseenValidationPitcherCount} pitchers`,
);
console.log('Candidate results:');
for (const result of evaluation.matchup.results) {
  console.log(
    `- ${result.candidate.candidateId}: categorical log loss=${result.validationCategoricalLogLoss.toFixed(9)}, categorical Brier=${result.validationCategoricalBrierScore.toFixed(9)}, Hit log loss=${result.validationHitLogLoss.toFixed(9)}, Hit Brier=${result.validationHitBrierScore.toFixed(9)}`,
  );
}
console.log(`Selection status: ${evaluation.matchup.selection.status}`);
console.log(
  `Selected candidate: ${evaluation.matchup.selection.selectedCandidate?.candidateId ?? 'none'}`,
);
console.log(
  `Untouched test sealed: ${evaluation.untouchedTestReservation.startDate} through ${evaluation.untouchedTestReservation.endDate} — ${evaluation.untouchedTestReservation.plateAppearanceCount} rows excluded`,
);
console.log(
  `Evaluation SHA-256: ${evaluation.coherentMatchupEvaluationSha256}`,
);
console.log(
  'This is one coherent batter-pitcher categorical matchup evaluation. It does not fit platoon effects, calibrate probabilities, enable runtime prediction, or rank a prop.',
);
