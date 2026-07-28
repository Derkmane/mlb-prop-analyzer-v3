import { writeJsonAtomic } from './provider-probe-utils.mjs';
import { evaluateM8ResolvedCategoricalWalkForward } from './m8-resolved-categorical-walk-forward-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const datasetPath = requireEnvironmentValue('M8_RESOLVED_CATEGORICAL_DATASET_PATH');
const fixedEvaluationPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_MODEL_EVALUATION_PATH',
);
const outputPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_WALK_FORWARD_OUTPUT_PATH',
);
const { TERMINAL_PA_CATEGORIES } = await import(
  new URL('../dist/src/domain/terminal-pa.js', import.meta.url),
);

const evaluation = await evaluateM8ResolvedCategoricalWalkForward({
  datasetPath,
  fixedEvaluationPath,
  canonicalCategories: TERMINAL_PA_CATEGORIES,
  hitCategories: ['1B', '2B', '3B', 'HR'],
});
await writeJsonAtomic(outputPath, evaluation);

const stability = evaluation.stability;
console.log('=== M8 RESOLVED CATEGORICAL WALK-FORWARD ===');
console.log(`Output: ${outputPath}`);
console.log(`Source dataset SHA-256: ${evaluation.sourceDatasetSha256}`);
console.log(`Source fixed evaluation SHA-256: ${evaluation.sourceFixedEvaluationSha256}`);
console.log(`Folds: ${evaluation.folds.length}`);
console.log(
  `Aggregate validation observations: ${evaluation.aggregateResults[0].validationObservationCount}`,
);
console.log(
  `Pooling strengths: batter=${evaluation.poolingStrengths.batterLeagueEquivalentPa}, pitcher=${evaluation.poolingStrengths.pitcherAllowedLeagueEquivalentPa}`,
);
console.log(`Coefficient candidates: ${evaluation.candidates.length}`);
console.log(
  `Fixed-holdout selection: ${stability.fixedHoldoutSelectedCandidate.candidateId}`,
);
console.log(
  `Aggregate selection: ${evaluation.aggregateSelection.selectedCandidate?.candidateId ?? 'none'}`,
);
console.log(
  `Fixed-holdout candidate aggregate rank: ${stability.fixedHoldoutCandidateAggregateRank}/${evaluation.candidates.length}`,
);
console.log(
  `Same fixed selection by fold: ${stability.sameAsFixedHoldoutSelectionCount}/${evaluation.folds.length}`,
);
console.log(
  `Fixed candidate categorical log loss: ${stability.fixedHoldoutCandidateAggregateMetrics.validationCategoricalLogLoss.toFixed(9)}`,
);
console.log(
  `League-only categorical log loss: ${stability.leagueOnlyCandidateAggregateMetrics.validationCategoricalLogLoss.toFixed(9)}`,
);
console.log(
  `Fixed candidate Hit log loss: ${stability.fixedHoldoutCandidateAggregateMetrics.validationHitLogLoss.toFixed(9)}`,
);
console.log(
  `League-only Hit log loss: ${stability.leagueOnlyCandidateAggregateMetrics.validationHitLogLoss.toFixed(9)}`,
);
console.log(`Fold selections: ${JSON.stringify(stability.foldSelectionCounts)}`);
console.log(
  `Untouched test sealed: ${evaluation.untouchedTestReservation.startDate} through ${evaluation.untouchedTestReservation.endDate} — ${evaluation.untouchedTestReservation.plateAppearanceCount} rows excluded`,
);
console.log(`Walk-forward SHA-256: ${evaluation.walkForwardSha256}`);
console.log(
  'This remains an offline robustness evaluation. It does not fit platoon effects, calibrate probabilities, enable runtime prediction, or rank a real prop.',
);
