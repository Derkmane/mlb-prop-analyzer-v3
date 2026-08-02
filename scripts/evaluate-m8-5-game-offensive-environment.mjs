import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  createM8_5GameOffensiveEnvironmentModelArtifactV1,
  verifyM8_5GameOffensiveEnvironmentModelArtifactV1,
} from '../dist/src/features/batter-hits/index.js';
import {
  buildM8_5GameOffensiveEnvironmentFeatureDataset,
  verifyM8_5GameOffensiveEnvironmentFeatureDataset,
} from './m8-5-game-offensive-environment-feature-dataset-utils.mjs';
import {
  evaluateM8_5GameOffensiveEnvironmentCandidates,
  verifyM8_5GameOffensiveEnvironmentEvaluation,
} from './m8-5-game-offensive-environment-model-utils.mjs';
import {
  verifyM8SharedOffensiveEnvironmentArtifact,
} from './m8-shared-offensive-environment-artifact-utils.mjs';
import {
  verifyM8SharedOffensiveEnvironmentV2,
} from './m8-shared-offensive-environment-v2-utils.mjs';
import {
  verifyM8TeamOffensiveEnvironmentDataset,
} from './m8-team-offensive-environment-dataset-utils.mjs';
import { sha256, writeJsonAtomic } from './provider-probe-utils.mjs';

const SEARCH_ROOTS = (process.env.M8_ARTIFACT_SEARCH_ROOTS?.trim() ||
  'artifacts,model-artifacts')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const SHARED_V2_PATH =
  process.env.M8_SHARED_ENVIRONMENT_V2_PATH?.trim() ||
  'model-artifacts/m8-shared-offensive-environment-v2.json';
const FEATURE_OUTPUT_PATH =
  process.env.M8_5_GAME_ENVIRONMENT_FEATURE_OUTPUT_PATH?.trim() ||
  'artifacts/m8-5-game-offensive-environment-feature-dataset-v1.json';
const EVALUATION_OUTPUT_PATH =
  process.env.M8_5_GAME_ENVIRONMENT_EVALUATION_OUTPUT_PATH?.trim() ||
  'artifacts/m8-5-game-offensive-environment-evaluation-v1.json';
const MODEL_OUTPUT_PATH =
  process.env.M8_5_GAME_ENVIRONMENT_MODEL_OUTPUT_PATH?.trim() ||
  'model-artifacts/m8-5-game-offensive-environment-model-v1.json';

async function readJson(filePath, label = filePath) {
  const text = await readFile(filePath, 'utf8');
  try {
    return Object.freeze({ path: filePath, text, value: JSON.parse(text) });
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function walk(directory, results = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(fullPath, results);
    else if (entry.name.endsWith('.json')) results.push(fullPath);
  }
  return results;
}

async function existingSearchRoots() {
  const roots = [];
  for (const root of SEARCH_ROOTS) {
    try {
      await access(root);
      roots.push(root);
    } catch {
      // An optional search root may be absent.
    }
  }
  if (roots.length === 0) {
    throw new Error('No configured artifact search root exists.');
  }
  return roots;
}

async function discoverJson() {
  const files = [];
  for (const root of await existingSearchRoots()) await walk(root, files);
  return files.sort();
}

function isSharedV1(value) {
  return (
    value?.artifactVersion === 1 &&
    value?.activeSeason === 2026 &&
    value?.selectedCandidateId === 'shared-environment-k4' &&
    typeof value?.artifactSha256 === 'string' &&
    typeof value?.sourceDatasetSha256 === 'string'
  );
}

function isTeamEnvironmentDataset(value) {
  return (
    value?.datasetVersion === 2 &&
    value?.provider === 'BALLDONTLIE MLB API' &&
    value?.activeSeason === 2026 &&
    typeof value?.datasetSha256 === 'string' &&
    Array.isArray(value?.periods?.fit?.rows) &&
    Array.isArray(value?.periods?.validation?.rows) &&
    value?.untouchedTestReservation?.rowsIncluded === false
  );
}

function chooseExact(candidates, label) {
  if (candidates.length === 0) throw new Error(`No ${label} matched frozen lineage.`);
  const identities = new Set(candidates.map((candidate) => candidate.identity));
  if (identities.size !== 1) {
    throw new Error(`Multiple ${label} identities matched frozen lineage.`);
  }
  return candidates.slice().sort((left, right) => left.path.localeCompare(right.path))[0];
}

await access(SHARED_V2_PATH);
const sharedV2File = await readJson(SHARED_V2_PATH, 'shared environment v2 artifact');
const sharedV2 = verifyM8SharedOffensiveEnvironmentV2(sharedV2File.value);
const sharedV2FileSha256 = sha256(sharedV2File.text);

const discovered = [];
for (const filePath of await discoverJson()) {
  if (path.resolve(filePath) === path.resolve(SHARED_V2_PATH)) continue;
  try {
    discovered.push(await readJson(filePath));
  } catch {
    // Unrelated invalid JSON is not a candidate artifact.
  }
}

const sharedV1Candidate = chooseExact(
  discovered
    .filter((candidate) => isSharedV1(candidate.value))
    .filter(
      (candidate) =>
        candidate.value.artifactSha256 ===
          sharedV2.sourceSharedEnvironmentArtifactSha256 &&
        sha256(candidate.text) ===
          sharedV2.sourceSharedEnvironmentArtifactFileSha256,
    )
    .map((candidate) => ({
      ...candidate,
      identity: candidate.value.artifactSha256,
    })),
  'shared environment v1 artifact',
);
const sharedV1 = verifyM8SharedOffensiveEnvironmentArtifact(
  sharedV1Candidate.value,
);

const teamDatasetCandidate = chooseExact(
  discovered
    .filter((candidate) => isTeamEnvironmentDataset(candidate.value))
    .filter(
      (candidate) =>
        candidate.value.datasetSha256 === sharedV1.sourceDatasetSha256 &&
        sha256(candidate.text) === sharedV1.sourceDatasetFileSha256,
    )
    .map((candidate) => ({
      ...candidate,
      identity: candidate.value.datasetSha256,
    })),
  'team offensive-environment dataset',
);
const teamDataset = verifyM8TeamOffensiveEnvironmentDataset(
  teamDatasetCandidate.value,
);
const teamDatasetFileSha256 = sha256(teamDatasetCandidate.text);

const featureDataset = buildM8_5GameOffensiveEnvironmentFeatureDataset({
  rawTeamEnvironmentDataset: teamDataset,
  sourceTeamEnvironmentDatasetFileSha256: teamDatasetFileSha256,
});
verifyM8_5GameOffensiveEnvironmentFeatureDataset(featureDataset);
await writeJsonAtomic(FEATURE_OUTPUT_PATH, featureDataset);
const featureFile = await readJson(FEATURE_OUTPUT_PATH, 'written feature dataset');
const featureFileSha256 = sha256(featureFile.text);
verifyM8_5GameOffensiveEnvironmentFeatureDataset(featureFile.value);

const evaluation = evaluateM8_5GameOffensiveEnvironmentCandidates({
  rawFeatureDataset: featureFile.value,
  sourceFeatureDatasetFileSha256: featureFileSha256,
  rawSharedEnvironmentArtifact: sharedV2,
  sourceSharedEnvironmentArtifactFileSha256: sharedV2FileSha256,
});
verifyM8_5GameOffensiveEnvironmentEvaluation(evaluation);
await writeJsonAtomic(EVALUATION_OUTPUT_PATH, evaluation);
const evaluationFile = await readJson(
  EVALUATION_OUTPUT_PATH,
  'written game environment evaluation',
);
verifyM8_5GameOffensiveEnvironmentEvaluation(evaluationFile.value);
const evaluationFileSha256 = sha256(evaluationFile.text);

let modelArtifact = null;
let modelFileSha256 = null;
if (evaluation.decision === 'VALIDATED_GAME_SIGNAL') {
  modelArtifact = createM8_5GameOffensiveEnvironmentModelArtifactV1({
    modelVersion: `m8-5-game-offensive-environment-${evaluation.finalModel.candidateId}-v1`,
    sourceSharedEnvironmentModelVersion:
      evaluation.sourceSharedEnvironmentModelVersion,
    sourceSharedEnvironmentArtifactSha256:
      evaluation.sourceSharedEnvironmentArtifactSha256,
    scenarioIds: evaluation.scenarioIds,
    featureNames: evaluation.finalModel.featureNames,
    featureNormalization: evaluation.finalModel.featureNormalization,
    scenarioLogits: evaluation.finalModel.scenarioLogits,
    validationEvidence: {
      fitPeriod: {
        start: evaluation.fitWindow.start,
        end: evaluation.fitWindow.end,
      },
      validationPeriod: {
        start: evaluation.validationWindow.start,
        end: evaluation.validationWindow.end,
      },
      walkForwardEvaluated: true,
      untouchedRowsIncluded: false,
      evidenceArtifactSha256: evaluation.evaluationSha256,
    },
  });
  verifyM8_5GameOffensiveEnvironmentModelArtifactV1(modelArtifact);
  await writeJsonAtomic(MODEL_OUTPUT_PATH, modelArtifact);
  const modelFile = await readJson(MODEL_OUTPUT_PATH, 'written game environment model');
  verifyM8_5GameOffensiveEnvironmentModelArtifactV1(modelFile.value);
  modelFileSha256 = sha256(modelFile.text);
}

console.log('=== M8.5 GAME-SPECIFIC OFFENSIVE-ENVIRONMENT EVALUATION ===');
console.log(`Shared v2 artifact: ${SHARED_V2_PATH}`);
console.log(`Shared v1 artifact: ${sharedV1Candidate.path}`);
console.log(`Team environment dataset: ${teamDatasetCandidate.path}`);
console.log(`Eligible fit games: ${featureDataset.periods.fit.rowCount}`);
console.log(`Eligible validation games: ${featureDataset.periods.validation.rowCount}`);
console.log(`Feature exclusions: ${featureDataset.totals.excludedGameCount}`);
console.log(`Selected candidate: ${evaluation.fixedHoldout.selectedCandidateId}`);
console.log(`Decision: ${evaluation.decision}`);
console.log(
  `Global fixed joint log loss: ${evaluation.fixedHoldout.baseline.validation.jointLogLoss}`,
);
console.log(
  `Selected fixed joint log loss: ${evaluation.fixedHoldout.candidates[0].validation.jointLogLoss}`,
);
console.log(
  `Global walk-forward joint log loss: ${evaluation.walkForward.baseline.jointLogLoss}`,
);
console.log(
  `Selected walk-forward joint log loss: ${evaluation.walkForward.selected.jointLogLoss}`,
);
console.log(`Evaluation SHA-256: ${evaluation.evaluationSha256}`);
console.log(`Evaluation file byte SHA-256: ${evaluationFileSha256}`);
console.log(`Feature dataset SHA-256: ${featureDataset.datasetSha256}`);
console.log(`Feature file byte SHA-256: ${featureFileSha256}`);
console.log(`Production enabled: ${evaluation.productionEnabled}`);
console.log(`Selected-side input used: ${evaluation.selectedSideInputUsed}`);
console.log(
  `Direct probability adjustment used: ${evaluation.directProbabilityAdjustmentUsed}`,
);
console.log(
  `Shared scenario definitions changed: ${evaluation.sharedScenarioDefinitionsChanged}`,
);
console.log(
  `Excluded offensive statistics used: ${evaluation.excludedOffensiveStatisticsUsed}`,
);
console.log(`Untouched-test rows accessed: ${evaluation.untouchedTestRowsAccessed}`);
if (modelArtifact !== null) {
  console.log(`Model artifact: ${MODEL_OUTPUT_PATH}`);
  console.log(`Model artifact SHA-256: ${modelArtifact.artifactSha256}`);
  console.log(`Model file byte SHA-256: ${modelFileSha256}`);
} else {
  console.log('Model artifact: not written because no validated game signal passed.');
}
