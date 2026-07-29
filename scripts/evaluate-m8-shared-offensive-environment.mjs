import { readFile } from 'node:fs/promises';

import { sha256, writeJsonAtomic } from './provider-probe-utils.mjs';
import {
  evaluateM8SharedOffensiveEnvironment,
  verifyM8SharedOffensiveEnvironmentEvaluation,
} from './m8-shared-offensive-environment-utils.mjs';

function requireEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function readJson(filePath, label) {
  const text = await readFile(filePath, 'utf8');
  try {
    return { text, value: JSON.parse(text) };
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

const datasetPath = requireEnvironmentValue(
  'M8_TEAM_OFFENSIVE_ENVIRONMENT_DATASET_PATH',
);
const outputPath = requireEnvironmentValue(
  'M8_SHARED_OFFENSIVE_ENVIRONMENT_EVALUATION_OUTPUT_PATH',
);
const datasetFile = await readJson(datasetPath, 'team offensive-environment dataset');
const evaluation = evaluateM8SharedOffensiveEnvironment({
  dataset: datasetFile.value,
  sourceDatasetFileSha256: sha256(datasetFile.text),
});
await writeJsonAtomic(outputPath, evaluation);
const written = (
  await readJson(outputPath, 'written shared offensive-environment evaluation')
).value;
verifyM8SharedOffensiveEnvironmentEvaluation(written);
if (written.evaluationSha256 !== evaluation.evaluationSha256) {
  throw new Error('written shared offensive-environment evaluation identity changed.');
}

console.log('=== M8 SHARED OFFENSIVE-ENVIRONMENT EVALUATION COMPLETE ===');
console.log(`Active season: ${evaluation.activeSeason}`);
console.log(
  `Fit window: ${evaluation.fitWindow.startDate} through ${evaluation.fitWindow.endDate}`,
);
console.log(`Fit paired games: ${evaluation.fitWindow.gameCount}`);
console.log(
  `Validation window: ${evaluation.validationWindow.startDate} through ${evaluation.validationWindow.endDate}`,
);
console.log(`Validation paired games: ${evaluation.validationWindow.gameCount}`);
console.log('--- Candidate ranking ---');
for (const [index, candidate] of evaluation.candidates.entries()) {
  console.log(
    `${index + 1}. ${candidate.candidateId}; validation joint log loss ${candidate.validation.jointLogLoss}; PA log loss ${candidate.validation.paLogLoss}; hits|PA log loss ${candidate.validation.hitConditionalLogLoss}; converged ${candidate.converged}; initialization ${candidate.selectedInitialization}`,
  );
}
console.log(`Selected candidate: ${evaluation.selectedCandidate.candidateId}`);
console.log(
  `Independence baseline joint log loss: ${evaluation.independenceBaseline.validation.jointLogLoss}`,
);
console.log(
  `Best shared-scenario joint log loss: ${evaluation.bestSharedScenarioCandidate.validation.jointLogLoss}`,
);
console.log(
  `Shared-scenario absolute improvement: ${evaluation.independenceBaseline.validation.jointLogLoss - evaluation.bestSharedScenarioCandidate.validation.jointLogLoss}`,
);
console.log(
  `Shared-scenario relative improvement: ${(evaluation.independenceBaseline.validation.jointLogLoss - evaluation.bestSharedScenarioCandidate.validation.jointLogLoss) / evaluation.independenceBaseline.validation.jointLogLoss}`,
);
console.log(`Holdout supports shared scenarios: ${evaluation.holdoutSupportsSharedScenarios}`);
console.log('--- Selected scenarios ---');
for (const scenario of evaluation.selectedCandidate.scenarios) {
  console.log(
    `${scenario.scenarioIndex}: weight ${scenario.weight}; expected total PA ${scenario.expectedTotalPa}; expected total hits ${scenario.expectedTotalHits}; away mean PA ${scenario.away.meanPa}; away hit probability ${scenario.away.hitProbability}; home mean PA ${scenario.home.meanPa}; home hit probability ${scenario.home.hitProbability}`,
  );
}
console.log(`Evaluation SHA-256: ${evaluation.evaluationSha256}`);
console.log(`Output: ${outputPath}`);
console.log('Status: benchmark-only-not-production-validated');
console.log('Untouched-test rows accessed: false');
