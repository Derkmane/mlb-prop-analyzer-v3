import { readFile } from 'node:fs/promises';

import {
  sha256,
  writeJsonAtomic,
} from './provider-probe-utils.mjs';
import {
  evaluateM8SharedOffensiveEnvironmentWalkForward,
  verifyM8SharedOffensiveEnvironmentWalkForward,
} from './m8-shared-offensive-environment-walk-forward-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function readJson(filePath, label = filePath) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `${label} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return { text, value: JSON.parse(text) };
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

const datasetPath = requireEnvironmentValue(
  'M8_TEAM_OFFENSIVE_ENVIRONMENT_DATASET_PATH',
);
const sourceEvaluationPath = requireEnvironmentValue(
  'M8_SHARED_OFFENSIVE_ENVIRONMENT_EVALUATION_PATH',
);
const outputPath = requireEnvironmentValue(
  'M8_SHARED_OFFENSIVE_ENVIRONMENT_WALK_FORWARD_OUTPUT_PATH',
);

const datasetFile = await readJson(datasetPath, 'team offensive-environment dataset');
const sourceEvaluationFile = await readJson(
  sourceEvaluationPath,
  'shared offensive-environment source evaluation',
);

const evaluation = evaluateM8SharedOffensiveEnvironmentWalkForward({
  dataset: datasetFile.value,
  sourceDatasetFileSha256: sha256(datasetFile.text),
  sourceEvaluation: sourceEvaluationFile.value,
  sourceEvaluationFileSha256: sha256(sourceEvaluationFile.text),
});
await writeJsonAtomic(outputPath, evaluation);
const written = (
  await readJson(outputPath, 'written shared-environment walk-forward evaluation')
).value;
verifyM8SharedOffensiveEnvironmentWalkForward(written);
if (written.walkForwardSha256 !== evaluation.walkForwardSha256) {
  throw new Error('written shared-environment walk-forward identity changed.');
}

console.log('=== M8 SHARED OFFENSIVE-ENVIRONMENT WALK-FORWARD COMPLETE ===');
console.log(`Active season: ${evaluation.activeSeason}`);
console.log(
  `Initial fit window: ${evaluation.fitWindow.startDate} through ${evaluation.fitWindow.endDate}`,
);
console.log(`Initial fit paired games: ${evaluation.fitWindow.initialGameCount}`);
console.log(
  `Validation window: ${evaluation.validationWindow.startDate} through ${evaluation.validationWindow.endDate}`,
);
console.log(`Daily folds: ${evaluation.foldCount}`);
console.log(`Validation paired games scored: ${evaluation.validationGameCount}`);
console.log('--- Fold selections ---');
for (const fold of evaluation.folds) {
  console.log(
    `${fold.validationDate}: ${fold.selectedCandidateId}; games ${fold.validationGameCount}; shared supported ${fold.holdoutSupportsSharedScenarios}`,
  );
}
console.log('--- Aggregate candidate ranking ---');
for (const [index, candidate] of evaluation.aggregateCandidates.entries()) {
  console.log(
    `${index + 1}. ${candidate.candidateId}; joint log loss ${candidate.validation.jointLogLoss}; PA log loss ${candidate.validation.paLogLoss}; hits|PA log loss ${candidate.validation.hitConditionalLogLoss}; fold wins ${candidate.foldWins}; mean fold rank ${candidate.meanFoldRank}`,
  );
}
console.log(`Selected candidate: ${evaluation.selectedCandidate.candidateId}`);
console.log(
  `Source holdout selected candidate: ${sourceEvaluationFile.value.selectedCandidate.candidateId}`,
);
console.log(`Source selection agreement: ${evaluation.sourceSelectionAgreement}`);
console.log(
  `Walk-forward supports shared scenarios: ${evaluation.walkForwardSupportsSharedScenarios}`,
);
console.log(
  `All validation games scored exactly once: ${evaluation.allValidationGamesScoredExactlyOnce}`,
);
console.log(`Walk-forward SHA-256: ${evaluation.walkForwardSha256}`);
console.log(`Output: ${outputPath}`);
console.log(`Status: ${evaluation.status}`);
console.log('Untouched-test rows accessed: false');
