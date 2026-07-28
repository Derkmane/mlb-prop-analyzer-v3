import { writeJsonAtomic } from './provider-probe-utils.mjs';
import {
  evaluateM8ResolvedCategoricalHitOverdispersion,
} from './m8-resolved-categorical-hit-overdispersion-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function percent(value) {
  return `${(value * 100).toFixed(4)}%`;
}

function decimal(value) {
  return value === null ? 'null' : value.toFixed(6);
}

const datasetPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_DATASET_PATH',
);
const fixedEvaluationPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_MODEL_EVALUATION_PATH',
);
const coherentWalkForwardPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_WALK_FORWARD_PATH',
);
const boundaryEvaluationPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_PLATOON_BOUNDARY_PATH',
);
const platoonWalkForwardPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_PLATOON_WALK_FORWARD_PATH',
);
const rareOutcomeUncertaintyPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_RARE_OUTCOME_UNCERTAINTY_PATH',
);
const rareCategoryReliabilityPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_RARE_CATEGORY_RELIABILITY_PATH',
);
const outputPath = requireEnvironmentValue(
  'M8_RESOLVED_CATEGORICAL_HIT_OVERDISPERSION_OUTPUT_PATH',
);

const { TERMINAL_PA_CATEGORIES } = await import(
  new URL('../dist/src/domain/terminal-pa.js', import.meta.url)
);
const evaluation = await evaluateM8ResolvedCategoricalHitOverdispersion({
  datasetPath,
  fixedEvaluationPath,
  coherentWalkForwardPath,
  boundaryEvaluationPath,
  platoonWalkForwardPath,
  rareOutcomeUncertaintyPath,
  rareCategoryReliabilityPath,
  canonicalCategories: TERMINAL_PA_CATEGORIES,
  hitCategories: ['1B', '2B', '3B', 'HR'],
});
await writeJsonAtomic(outputPath, evaluation);

const benchmark = evaluation.benchmark;
const cohort = evaluation.cohorts;
const scorerDifference = Math.max(
  evaluation.scorerEquivalence.maximumFoldDifference,
  evaluation.scorerEquivalence.hitSummaryEquivalence.maximumDifference,
);

console.log('=== M8 BATTER HITS CONDITIONAL OVERDISPERSION BENCHMARK ===');
console.log(`Output: ${outputPath}`);
console.log(
  `Source rare-category reliability SHA-256: ${evaluation.sourceRareCategoryReliabilitySha256}`,
);
console.log(
  `Validation PA: modeled=${cohort.validationPlatoonObservationCount}, overall=${cohort.validationOverallObservationCount}`,
);
console.log(
  `Complete batter-games: ${cohort.completeBatterGameCount}; excluded incomplete batter-games: ${cohort.excludedIncompleteBatterGameCount}; excluded overall PA: ${cohort.excludedOverallPaCount}; excluded modeled PA: ${cohort.excludedPredictedPaCount}`,
);
console.log(
  `Scorer equivalence maximum difference: ${scorerDifference.toExponential(3)}`,
);
console.log(
  `Conditional cohort: games=${benchmark.gameCount}, PA=${benchmark.plateAppearanceCount}, observed hits=${benchmark.observedHitCount}, expected hits=${benchmark.expectedHitCount.toFixed(6)}, observed/game=${benchmark.observedHitsPerGame.toFixed(6)}, expected/game=${benchmark.expectedHitsPerGame.toFixed(6)}`,
);
console.log(
  `Variance: observed=${benchmark.observedBetweenGameHitCountVariance.toFixed(6)}, model=${benchmark.modelExpectedBetweenGameHitCountVariance.toFixed(6)}, difference=${benchmark.varianceDifferenceObservedMinusExpected.toFixed(6)}, ratio=${decimal(benchmark.varianceRatioObservedToExpected)}, Pearson dispersion=${decimal(benchmark.pearsonDispersion)}`,
);
console.log(
  `Second factorial moment: observed=${benchmark.observedSecondFactorialMoment.toFixed(6)}, expected=${benchmark.expectedSecondFactorialMoment.toFixed(6)}, gap=${benchmark.secondFactorialMomentGapObservedMinusExpected.toFixed(6)}`,
);
console.log(
  `Aggregate hit-count standardized residual: ${decimal(benchmark.aggregateHitCountStandardizedResidual)}`,
);
console.log('Count histogram:');
for (const row of benchmark.countHistogram) {
  console.log(
    `  hits=${row.hitCount}: observed=${row.observedGameCount} (${percent(row.observedRate)}), expected=${row.expectedGameCount.toFixed(3)} (${percent(row.expectedRate)}), gap=${percent(row.gapObservedMinusExpected)}`,
  );
}
console.log('Conditional half-line checks:');
for (const report of Object.values(benchmark.lineReports)) {
  for (const side of ['higher', 'lower']) {
    const item = report[side];
    console.log(
      `  ${item.side} ${item.line}: predicted=${percent(item.meanPredictedWinProbability)}, observed=${percent(item.observedWinRate)}, Wilson95=[${percent(item.observedWinRateWilson95.lower)}, ${percent(item.observedWinRateWilson95.upper)}], gap=${percent(item.calibrationGapObservedMinusPredicted)}, inside-Wilson=${item.meanPredictionInsideWilson95}, log-loss=${item.binaryLogLoss.toFixed(9)}, Brier=${item.binaryBrier.toFixed(9)}`,
    );
  }
}
console.log(
  `Correction fit: ${benchmark.decisionBoundary.correctionFit}`,
);
console.log(
  `Correction applied: ${benchmark.decisionBoundary.correctionApplied}`,
);
console.log(
  `Untouched test sealed: ${evaluation.untouchedTestReservation.startDate} through ${evaluation.untouchedTestReservation.endDate} — ${evaluation.untouchedTestReservation.plateAppearanceCount} rows excluded`,
);
console.log(`Hit overdispersion SHA-256: ${evaluation.hitOverdispersionSha256}`);
console.log(
  'This benchmark conditions on realized complete batter-game PA count. It does not fit the pregame opportunity model, complete the posted altline-tail gate, apply an overdispersion correction, access the untouched test period, enable runtime prediction, or rank a real prop.',
);
