import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  createValidatedM8_5BatterHitsFactorArtifactV1,
  verifyM8_5BatterHitsFactorArtifactV1,
} from '../dist/src/features/batter-hits/index.js';
import {
  selectM8_5TeamBullpenArtifactPair,
} from './m8-5-team-bullpen-artifact-selection-utils.mjs';
import {
  verifyM8FrozenBatterHitsCandidate,
} from './m8-batter-hits-frozen-candidate-utils.mjs';
import {
  buildM8_5TeamBullpenDataset,
  evaluateM8_5TeamBullpenCandidates,
  factorEffectsForM8_5TeamBullpenModel,
} from './m8-5-team-bullpen-outcome-utils.mjs';
import {
  verifyM8SharedOffensiveEnvironmentV2,
} from './m8-shared-offensive-environment-v2-utils.mjs';
import {
  verifyM8TeamOffensiveEnvironmentDataset,
} from './m8-team-offensive-environment-dataset-utils.mjs';
import { sha256, writeJsonAtomic } from './provider-probe-utils.mjs';

const SEARCH_ROOT = process.env.M8_ARTIFACT_SEARCH_ROOT?.trim() || 'artifacts';
const SHARED_PATH =
  process.env.M8_SHARED_ENVIRONMENT_V2_PATH?.trim() ||
  'model-artifacts/m8-shared-offensive-environment-v2.json';
const COMPLETE_CANDIDATE_PATH =
  process.env.M8_BATTER_HITS_COMPLETE_CANDIDATE_PATH?.trim() ||
  'model-artifacts/m8-batter-hits-complete-candidate-v1.json';
const EVALUATION_OUTPUT_PATH =
  process.env.M8_5_TEAM_BULLPEN_EVALUATION_OUTPUT_PATH?.trim() ||
  'artifacts/m8-5-team-bullpen-outcome-evaluation-v1.json';
const FACTOR_OUTPUT_PATH =
  process.env.M8_5_TEAM_BULLPEN_FACTOR_OUTPUT_PATH?.trim() ||
  'model-artifacts/m8-5-team-bullpen-outcome-v1.json';

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

function isResolvedDataset(value) {
  return (
    value?.datasetVersion === 3 &&
    value?.activeSeason === 2026 &&
    typeof value?.datasetSha256 === 'string' &&
    Array.isArray(value?.periods?.fit?.rows) &&
    Array.isArray(value?.periods?.validation?.rows) &&
    value?.untouchedTestReservation?.rowsIncluded === false
  );
}

function isTeamEnvironmentDataset(value) {
  const sample = value?.periods?.fit?.rows?.[0] ?? value?.periods?.validation?.rows?.[0];
  return (
    value?.datasetVersion === 2 &&
    value?.provider === 'BALLDONTLIE MLB API' &&
    value?.activeSeason === 2026 &&
    typeof value?.datasetSha256 === 'string' &&
    typeof value?.sourceResolvedDatasetSha256 === 'string' &&
    Number.isSafeInteger(sample?.teamId) &&
    Number.isSafeInteger(sample?.opponentTeamId) &&
    value?.untouchedTestReservation?.rowsIncluded === false
  );
}

function evaluationIdentity(value) {
  return {
    evaluationVersion: value.evaluationVersion,
    modelFamily: value.modelFamily,
    activeSeason: value.activeSeason,
    sourceResolvedDatasetSha256: value.sourceResolvedDatasetSha256,
    sourceResolvedDatasetFileSha256: value.sourceResolvedDatasetFileSha256,
    sourceTeamEnvironmentDatasetSha256:
      value.sourceTeamEnvironmentDatasetSha256,
    sourceTeamEnvironmentDatasetFileSha256:
      value.sourceTeamEnvironmentDatasetFileSha256,
    sourceSharedEnvironmentArtifactSha256:
      value.sourceSharedEnvironmentArtifactSha256,
    sourceCompleteCandidateArtifactSha256:
      value.sourceCompleteCandidateArtifactSha256,
    sourceStarterBullpenTransitionSha256:
      value.sourceStarterBullpenTransitionSha256,
    sourceGenericBullpenModelVersion: value.sourceGenericBullpenModelVersion,
    teamBullpenDataset: value.teamBullpenDataset,
    evaluation: value.evaluation,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

await Promise.all([
  access(SEARCH_ROOT),
  access(SHARED_PATH),
  access(COMPLETE_CANDIDATE_PATH),
]);

const [sharedFile, candidateFile] = await Promise.all([
  readJson(SHARED_PATH, 'shared environment artifact'),
  readJson(COMPLETE_CANDIDATE_PATH, 'complete Batter Hits candidate'),
]);
const shared = verifyM8SharedOffensiveEnvironmentV2(sharedFile.value);
const completeCandidate = verifyM8FrozenBatterHitsCandidate(candidateFile.value);
if (
  completeCandidate.sourceSharedEnvironmentArtifactSha256 !==
  shared.artifactSha256
) {
  throw new Error('complete candidate and shared environment artifacts disagree.');
}
if (
  completeCandidate.bullpenModel?.modelVersion !==
  'm8-generic-bullpen-outcome-v1'
) {
  throw new Error('complete candidate does not contain the frozen generic bullpen model.');
}

const artifactFiles = await walk(SEARCH_ROOT);
const resolvedCandidates = [];
const environmentCandidates = [];
for (const filePath of artifactFiles) {
  const item = await readJson(filePath);
  if (isResolvedDataset(item.value)) resolvedCandidates.push(item);
  if (isTeamEnvironmentDataset(item.value)) environmentCandidates.push(item);
}
const artifactSelection = selectM8_5TeamBullpenArtifactPair({
  resolvedCandidates,
  environmentCandidates,
  frozenStarterBullpenDatasetSha256:
    shared.sourceStarterBullpenDatasetSha256,
});
const { resolved, teamEnvironment } = artifactSelection;
verifyM8TeamOffensiveEnvironmentDataset(teamEnvironment.value);

const starterBullpenTransitionSha256 = sha256(
  JSON.stringify(shared.starterBullpenTransition),
);
const teamBullpenDataset = buildM8_5TeamBullpenDataset({
  resolvedDataset: resolved.value,
  teamEnvironmentDataset: teamEnvironment.value,
  starterBullpenTransitionSha256,
});
const evaluation = evaluateM8_5TeamBullpenCandidates({
  dataset: teamBullpenDataset,
  genericBullpenModel: completeCandidate.bullpenModel,
});

const withoutHash = {
  evaluationVersion: 1,
  modelFamily: 'm8-5-team-specific-bullpen-terminal-outcome',
  activeSeason: 2026,
  sourceResolvedDatasetSha256: resolved.value.datasetSha256,
  sourceResolvedDatasetFileSha256: sha256(resolved.text),
  sourceTeamEnvironmentDatasetSha256: teamEnvironment.value.datasetSha256,
  sourceTeamEnvironmentDatasetFileSha256: sha256(teamEnvironment.text),
  sourceSharedEnvironmentArtifactSha256: shared.artifactSha256,
  sourceCompleteCandidateArtifactSha256: completeCandidate.artifactSha256,
  sourceStarterBullpenTransitionSha256: starterBullpenTransitionSha256,
  sourceGenericBullpenModelVersion: completeCandidate.bullpenModel.modelVersion,
  teamBullpenDataset,
  evaluation,
  untouchedTestReservation: Object.freeze({ rowsIncluded: false }),
};
const evidence = Object.freeze({
  purpose:
    'Current-season fixed-holdout and expanding walk-forward evaluation of team-specific bullpen terminal-outcome vectors against the frozen M8 generic bullpen baseline while preserving the fitted starter-to-bullpen workload transition unchanged.',
  ...withoutHash,
  evaluationSha256: sha256(JSON.stringify(evaluationIdentity(withoutHash))),
});
await writeJsonAtomic(EVALUATION_OUTPUT_PATH, evidence);
const persistedEvidence = await readJson(
  EVALUATION_OUTPUT_PATH,
  'persisted team bullpen evaluation',
);
if (
  persistedEvidence.value.evaluationSha256 !== evidence.evaluationSha256 ||
  sha256(JSON.stringify(evaluationIdentity(persistedEvidence.value))) !==
    evidence.evaluationSha256
) {
  throw new Error('persisted team bullpen evaluation identity changed after writing.');
}

let factorArtifact = null;
if (evaluation.decision === 'VALIDATED_TEAM_SIGNAL') {
  if (evaluation.selectedModel === null) {
    throw new Error('validated team signal is missing its selected model.');
  }
  factorArtifact = createValidatedM8_5BatterHitsFactorArtifactV1({
    factorKey: 'teamSpecificBullpen',
    modelVersion: evaluation.selectedModel.modelVersion,
    requiredInputs: [
      'opposingPitchingTeamId',
      'bullpenPitcherHand',
      'frozenGenericBullpenHandWeights',
      'frozenStarterBullpenTransition',
    ],
    sourceEvidenceVersion: 'm8-5-team-bullpen-outcome-evaluation-v1',
    validationEvidence: {
      fitPeriod: {
        start: teamBullpenDataset.periods.fit.startDate,
        end: teamBullpenDataset.periods.fit.endDate,
      },
      validationPeriod: {
        start: teamBullpenDataset.periods.validation.startDate,
        end: teamBullpenDataset.periods.validation.endDate,
      },
      walkForwardEvaluated: true,
      untouchedRowsIncluded: false,
      evidenceArtifactSha256: evidence.evaluationSha256,
    },
    effects: factorEffectsForM8_5TeamBullpenModel(
      evaluation.selectedModel,
    ),
  });
  verifyM8_5BatterHitsFactorArtifactV1(factorArtifact);
  await writeJsonAtomic(FACTOR_OUTPUT_PATH, factorArtifact);
  const persistedFactor = await readJson(
    FACTOR_OUTPUT_PATH,
    'persisted team bullpen factor artifact',
  );
  verifyM8_5BatterHitsFactorArtifactV1(persistedFactor.value);
  if (persistedFactor.value.artifactSha256 !== factorArtifact.artifactSha256) {
    throw new Error('persisted team bullpen factor artifact changed after writing.');
  }
} else if (evaluation.decision !== 'IDENTITY_RETAINED_NO_VALIDATED_TEAM_SIGNAL') {
  throw new Error(`unsupported team bullpen evaluation decision ${evaluation.decision}.`);
}

console.log('=== M8.5 TEAM-SPECIFIC BULLPEN OUTCOME EVALUATION ===');
console.log(`Resolved dataset: ${resolved.path}`);
console.log(`Team environment dataset: ${teamEnvironment.path}`);
console.log(
  `Resolved dataset candidates discovered: ${artifactSelection.resolvedCandidateCount}`,
);
console.log(
  `Frozen-lineage resolved copies matched: ${artifactSelection.frozenLineageCopyCount}`,
);
console.log(
  `Matching team-environment copies found: ${artifactSelection.matchingEnvironmentCopyCount}`,
);
console.log(`Fit bullpen PA: ${teamBullpenDataset.periods.fit.rowCount}`);
console.log(`Validation bullpen PA: ${teamBullpenDataset.periods.validation.rowCount}`);
console.log(`Pitching teams: ${teamBullpenDataset.totals.pitchingTeamCount}`);
console.log(`Decision: ${evaluation.decision}`);
console.log(`Selected candidate: ${evaluation.selectedCandidateId ?? 'none'}`);
console.log(`Generic fixed log loss: ${evaluation.genericFixedMetrics.logLoss}`);
console.log(
  `Selected fixed log loss: ${evaluation.selectedFixedMetrics?.logLoss ?? 'identity'}`,
);
console.log(
  `Generic walk-forward log loss: ${evaluation.genericWalkForwardMetrics.logLoss}`,
);
console.log(
  `Selected walk-forward log loss: ${
    evaluation.selectedWalkForwardMetrics?.logLoss ?? 'identity'
  }`,
);
console.log(
  `Starter/bullpen transition SHA-256 preserved: ${starterBullpenTransitionSha256}`,
);
console.log(`Evaluation SHA-256: ${evidence.evaluationSha256}`);
console.log(`Evaluation evidence: ${EVALUATION_OUTPUT_PATH}`);
console.log(
  `Factor artifact: ${factorArtifact === null ? 'not-created-identity-retained' : FACTOR_OUTPUT_PATH}`,
);
if (factorArtifact !== null) {
  console.log(`Factor artifact SHA-256: ${factorArtifact.artifactSha256}`);
  console.log(`Typed team-hand effects: ${factorArtifact.effects.length}`);
}
console.log('Selected-side input used: false');
console.log('Direct probability adjustment used: false');
console.log('Starter/bullpen workload transition changed: false');
console.log('Production enabled: false');
console.log('Untouched-test rows accessed: false');
