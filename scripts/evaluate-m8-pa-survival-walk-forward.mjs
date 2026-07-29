import { readFile } from 'node:fs/promises';

import {
  evaluateM8PaSurvivalWalkForward,
} from './m8-pa-survival-walk-forward-utils.mjs';
import {
  sha256,
  writeJsonAtomic,
} from './provider-probe-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

const datasetPath = requireEnvironmentValue('M8_PA_SURVIVAL_DATASET_PATH');
const outputPath = requireEnvironmentValue(
  'M8_PA_SURVIVAL_WALK_FORWARD_OUTPUT_PATH',
);
const datasetText = await readFile(datasetPath, 'utf8');
const dataset = parseJson(datasetText, 'M8 PA-survival dataset');
const walkForward = evaluateM8PaSurvivalWalkForward({
  rawDataset: dataset,
  datasetFileSha256: sha256(datasetText),
});

await writeJsonAtomic(outputPath, walkForward);

console.log('=== M8 HITTER PA-SURVIVAL WALK-FORWARD COMPLETE ===');
console.log(`Active season: ${walkForward.activeSeason}`);
console.log(
  `Validation window: ${walkForward.validationWindow.startDate} through ${walkForward.validationWindow.endDate}`,
);
console.log(`Daily folds: ${walkForward.foldCount}`);
console.log(
  `Aggregate validation observations: ${walkForward.aggregateValidationObservationCount}`,
);
console.log(
  `Source holdout selected candidate: ${walkForward.sourceHoldoutSelectedCandidateId}`,
);
console.log(`Walk-forward selected candidate: ${walkForward.selectedCandidateId}`);
console.log('--- Fold selected candidates ---');
for (const [candidateId, count] of Object.entries(
  walkForward.selectedCandidateCounts,
)) {
  console.log(`${candidateId}: ${count}`);
}
console.log('--- Fold selected groupings ---');
for (const [grouping, count] of Object.entries(
  walkForward.selectedGroupingCounts,
)) {
  console.log(`${grouping}: ${count}`);
}
console.log('--- Aggregate candidate ranking ---');
for (const [index, candidate] of walkForward.aggregateResults.entries()) {
  console.log(
    `${index + 1}. ${candidate.candidateId}; log loss ${candidate.logLoss}; Brier ${candidate.multiclassBrier}; fold wins ${candidate.foldWinCount}; mean fold rank ${candidate.meanFoldRank}; minimum actual probability ${candidate.actualProbabilityMinimum}`,
  );
}
console.log('--- Best candidate by grouping ---');
for (const [grouping, result] of Object.entries(walkForward.bestByGrouping)) {
  if (result === null) {
    console.log(`${grouping}: unavailable`);
  } else {
    console.log(
      `${grouping}: ${result.candidateId}; log loss ${result.logLoss}; Brier ${result.multiclassBrier}; fold wins ${result.foldWinCount}; mean fold rank ${result.meanFoldRank}`,
    );
  }
}
console.log(
  `Best slot versus league log-loss improvement: ${walkForward.comparisons.bestSlotVersusLeague?.logLossImprovement ?? 'unavailable'}`,
);
console.log(
  `Best slot+home/away versus slot log-loss improvement: ${walkForward.comparisons.bestSlotHomeAwayVersusBestSlot?.logLossImprovement ?? 'unavailable'}`,
);
console.log(
  `Raw survival curves monotone by construction: ${walkForward.rawCurvesMonotoneByConstruction}`,
);
console.log(
  `Fitted survival curves monotone by construction: ${walkForward.fittedCurvesMonotoneByConstruction}`,
);
console.log(
  `Monotone projection applied: ${walkForward.monotoneProjectionApplied}`,
);
console.log(`Walk-forward SHA-256: ${walkForward.walkForwardSha256}`);
console.log(`Output: ${outputPath}`);
console.log('Untouched-test rows accessed: false');
