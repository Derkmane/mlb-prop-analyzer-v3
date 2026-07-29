import { readFile } from 'node:fs/promises';

import {
  DEFAULT_M8_PA_SURVIVAL_CANDIDATES,
  evaluateM8PaSurvivalCandidates,
} from './m8-pa-survival-evaluation-utils.mjs';
import {
  verifyM8PaSurvivalDataset,
} from './m8-pa-survival-dataset-utils.mjs';
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

const datasetPath = requireEnvironmentValue(
  'M8_PA_SURVIVAL_DATASET_PATH',
);
const outputPath = requireEnvironmentValue(
  'M8_PA_SURVIVAL_EVALUATION_OUTPUT_PATH',
);
const datasetText = await readFile(datasetPath, 'utf8');
const rawDataset = parseJson(
  datasetText,
  'M8 PA-survival dataset',
);
verifyM8PaSurvivalDataset(rawDataset);

const evaluation = evaluateM8PaSurvivalCandidates({
  rawDataset,
  datasetFileSha256: sha256(datasetText),
  candidates: DEFAULT_M8_PA_SURVIVAL_CANDIDATES,
});

await writeJsonAtomic(outputPath, evaluation);

console.log(
  '=== M8 HITTER PA-SURVIVAL BASELINE EVALUATION COMPLETE ===',
);
console.log(`Active season: ${evaluation.activeSeason}`);
console.log(
  `Fit window: ${evaluation.fitWindow.startDate} through ${evaluation.fitWindow.endDate}`,
);
console.log(
  `Validation window: ${evaluation.validationWindow.startDate} through ${evaluation.validationWindow.endDate}`,
);
console.log(`Fit observations: ${evaluation.fitObservationCount}`);
console.log(
  `Validation observations: ${evaluation.validationObservationCount}`,
);
console.log(
  `PA-count support: ${evaluation.countSupport.minimum} through ${evaluation.countSupport.maximum}`,
);
console.log(
  `Candidates evaluated: ${evaluation.candidateSummaries.length}`,
);
console.log(`Selected candidate: ${evaluation.selectedCandidateId}`);
console.log('--- Best candidate by grouping ---');
for (const [grouping, result] of Object.entries(
  evaluation.bestByGrouping,
)) {
  if (result === null) {
    console.log(`${grouping}: unavailable`);
    continue;
  }
  console.log(
    `${grouping}: ${result.candidateId}; log loss ${result.logLoss}; Brier ${result.multiclassBrier}`,
  );
}
console.log('--- Candidate ranking ---');
for (const [index, candidate] of evaluation.candidateSummaries.entries()) {
  console.log(
    `${index + 1}. ${candidate.candidateId}; log loss ${candidate.logLoss}; Brier ${candidate.multiclassBrier}; minimum actual probability ${candidate.actualProbabilityMinimum}`,
  );
}
console.log(
  `Best slot versus league log-loss improvement: ${evaluation.comparisons.bestSlotVersusLeague?.logLossImprovement ?? 'unavailable'}`,
);
console.log(
  `Best slot+home/away versus slot log-loss improvement: ${evaluation.comparisons.bestSlotHomeAwayVersusBestSlot?.logLossImprovement ?? 'unavailable'}`,
);
console.log(
  `Raw survival curves monotone by construction: ${evaluation.selectedModel.rawCurvesMonotoneByConstruction}`,
);
console.log(
  `Fitted survival curves monotone by construction: ${evaluation.selectedModel.fittedCurvesMonotoneByConstruction}`,
);
console.log(
  `Monotone projection applied: ${evaluation.selectedModel.monotoneProjectionApplied}`,
);
console.log(`Evaluation SHA-256: ${evaluation.evaluationSha256}`);
console.log(`Output: ${outputPath}`);
console.log('Untouched-test rows accessed: false');
