import { sha256 } from './provider-probe-utils.mjs';
import { verifyM8StarterBullpenEvaluation } from './m8-starter-bullpen-transition-utils.mjs';

const TOLERANCE = 1e-12;
const SIDES = Object.freeze(['away', 'home']);

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function string(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function validatePmf(raw, label) {
  const values = array(raw, label);
  let total = 0;
  for (const value of values) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} contains invalid mass.`);
    total += value;
  }
  if (Math.abs(total - 1) > TOLERANCE) throw new Error(`${label} must sum to one.`);
  return Object.freeze([...values]);
}

function v1Identity(artifact) {
  return {
    artifactVersion: artifact.artifactVersion,
    purpose: artifact.purpose,
    status: artifact.status,
    productionEnabled: artifact.productionEnabled,
    activeSeason: artifact.activeSeason,
    sourceDatasetSha256: artifact.sourceDatasetSha256,
    sourceDatasetFileSha256: artifact.sourceDatasetFileSha256,
    sourceHoldoutEvaluationSha256: artifact.sourceHoldoutEvaluationSha256,
    sourceHoldoutEvaluationFileSha256: artifact.sourceHoldoutEvaluationFileSha256,
    sourceWalkForwardSha256: artifact.sourceWalkForwardSha256,
    sourceWalkForwardFileSha256: artifact.sourceWalkForwardFileSha256,
    fitWindow: artifact.fitWindow,
    validationWindow: artifact.validationWindow,
    candidateScenarioCounts: artifact.candidateScenarioCounts,
    selectedCandidateId: artifact.selectedCandidateId,
    scenarioCount: artifact.scenarioCount,
    scenarioCountPolicy: artifact.scenarioCountPolicy,
    scenarios: artifact.scenarios,
    validationEvidence: artifact.validationEvidence,
    untouchedTestReservation: artifact.untouchedTestReservation,
  };
}

function validateV1(rawArtifact) {
  const artifact = object(rawArtifact, 'shared environment v1 artifact');
  if (
    artifact.artifactVersion !== 1 ||
    artifact.selectedCandidateId !== 'shared-environment-k4' ||
    artifact.scenarioCount !== 4 ||
    artifact.productionEnabled !== false
  ) {
    throw new Error('shared environment v1 artifact is not the selected K=4 candidate.');
  }
  if (artifact.artifactSha256 !== sha256(JSON.stringify(v1Identity(artifact)))) {
    throw new Error('shared environment v1 artifact SHA-256 is invalid.');
  }
  const scenarios = array(artifact.scenarios, 'shared environment scenarios');
  if (scenarios.length !== 4) throw new Error('shared environment must contain four scenarios.');
  const weight = scenarios.reduce((sum, scenario) => sum + scenario.weight, 0);
  if (Math.abs(weight - 1) > TOLERANCE || scenarios.some((scenario) => scenario.weight < 0)) {
    throw new Error('shared environment scenario weights are invalid.');
  }
  for (const scenario of scenarios) {
    for (const side of SIDES) {
      const state = object(scenario[side], `${side} scenario state`);
      if (!(state.meanPa > 0) || !(state.sigmaPa >= 0)) {
        throw new Error(`${side} scenario PA parameters are invalid.`);
      }
      if (!(state.hitProbability > 0 && state.hitProbability < 1)) {
        throw new Error(`${side} scenario hit probability is invalid.`);
      }
    }
  }
  if (artifact.untouchedTestReservation?.rowsIncluded !== false) {
    throw new Error('shared environment v1 exposes untouched-test rows.');
  }
  return artifact;
}

function artifactIdentity(value) {
  return {
    artifactVersion: value.artifactVersion,
    modelVersion: value.modelVersion,
    status: value.status,
    productionEnabled: value.productionEnabled,
    activeSeason: value.activeSeason,
    sourceSharedEnvironmentArtifactSha256: value.sourceSharedEnvironmentArtifactSha256,
    sourceSharedEnvironmentArtifactFileSha256: value.sourceSharedEnvironmentArtifactFileSha256,
    sourceStarterBullpenDatasetSha256: value.sourceStarterBullpenDatasetSha256,
    sourceStarterBullpenEvaluationSha256: value.sourceStarterBullpenEvaluationSha256,
    sourceStarterBullpenEvaluationFileSha256: value.sourceStarterBullpenEvaluationFileSha256,
    fitWindow: value.fitWindow,
    validationWindow: value.validationWindow,
    scenarioCount: value.scenarioCount,
    scenarios: value.scenarios,
    starterBullpenTransition: value.starterBullpenTransition,
    validationEvidence: value.validationEvidence,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

export function buildM8SharedOffensiveEnvironmentV2({
  rawSharedEnvironmentArtifact,
  sharedEnvironmentArtifactFileSha256,
  rawStarterBullpenEvaluation,
  starterBullpenEvaluationFileSha256,
}) {
  const shared = validateV1(rawSharedEnvironmentArtifact);
  const transition = verifyM8StarterBullpenEvaluation(rawStarterBullpenEvaluation);
  if (shared.activeSeason !== transition.activeSeason) {
    throw new Error('shared environment and starter-bullpen active seasons differ.');
  }
  if (
    shared.untouchedTestReservation.startDate !== transition.untouchedTestReservation.startDate ||
    shared.untouchedTestReservation.endDate !== transition.untouchedTestReservation.endDate
  ) {
    throw new Error('shared environment and starter-bullpen untouched reservations differ.');
  }
  const bySide = Object.freeze(
    Object.fromEntries(
      SIDES.map((side) => [side, validatePmf(transition.finalModel.bySide[side], `${side} starter BF PMF`)]),
    ),
  );
  const selectedFixedResult = transition.fixedResults.find(
    (result) => result.candidate.candidateId === transition.selectedCandidateId,
  );
  if (!selectedFixedResult) {
    throw new Error('starter-bullpen selected candidate fixed result is missing.');
  }
  const identity = {
    artifactVersion: 2,
    modelVersion: 'm8-shared-offensive-environment-v2',
    status: 'frozen-current-season-candidate-awaiting-downstream-untouched-test',
    productionEnabled: false,
    activeSeason: positiveInteger(shared.activeSeason, 'active season'),
    sourceSharedEnvironmentArtifactSha256: string(shared.artifactSha256, 'shared artifact SHA-256'),
    sourceSharedEnvironmentArtifactFileSha256: string(sharedEnvironmentArtifactFileSha256, 'shared artifact file SHA-256'),
    sourceStarterBullpenDatasetSha256: string(transition.sourceDatasetSha256, 'starter-bullpen dataset SHA-256'),
    sourceStarterBullpenEvaluationSha256: string(transition.evaluationSha256, 'starter-bullpen evaluation SHA-256'),
    sourceStarterBullpenEvaluationFileSha256: string(starterBullpenEvaluationFileSha256, 'starter-bullpen evaluation file SHA-256'),
    fitWindow: transition.fitWindow,
    validationWindow: transition.validationWindow,
    scenarioCount: shared.scenarioCount,
    scenarios: Object.freeze(shared.scenarios.map((scenario) => Object.freeze({ ...scenario }))),
    starterBullpenTransition: Object.freeze({
      selectedCandidate: transition.finalModel.candidate,
      supportMaximum: transition.supportMaximum,
      bySide,
      scenarioDependence: 'not-selected; one side-specific current-season distribution is shared across scenarios',
    }),
    validationEvidence: Object.freeze({
      sharedEnvironment: shared.validationEvidence,
      starterBullpenSelectedFixedMetrics: selectedFixedResult.metrics,
      starterBullpenFixedMinimumLogLossCandidateId: transition.fixedSelectedCandidateId,
      starterBullpenWalkForwardMinimumLogLossCandidateId: transition.walkForward.selectedCandidateId,
      starterBullpenFixedNondominatedCandidateIds: transition.fixedNondominatedCandidateIds,
      starterBullpenWalkForwardNondominatedCandidateIds:
        transition.walkForwardNondominatedCandidateIds,
      starterBullpenAdmissibleCandidateIds: transition.admissibleCandidateIds,
      starterBullpenSelectedCandidateId: transition.selectedCandidateId,
      starterBullpenWalkForwardFoldCount: transition.walkForward.foldCount,
      starterBullpenStableSelection: transition.stableSelection,
    }),
    untouchedTestReservation: Object.freeze({ ...shared.untouchedTestReservation, rowsIncluded: false }),
  };
  return Object.freeze({
    purpose: 'Frozen current-season shared offensive scenarios with side-specific opposing-starter batters-faced distributions and an explicit bullpen transition.',
    ...identity,
    artifactSha256: sha256(JSON.stringify(artifactIdentity(identity))),
  });
}

export function verifyM8SharedOffensiveEnvironmentV2(rawArtifact) {
  const artifact = object(rawArtifact, 'shared environment v2 artifact');
  if (
    artifact.artifactVersion !== 2 ||
    artifact.modelVersion !== 'm8-shared-offensive-environment-v2' ||
    artifact.productionEnabled !== false ||
    artifact.scenarioCount !== 4
  ) {
    throw new Error('unsupported shared environment v2 artifact contract.');
  }
  const scenarios = array(artifact.scenarios, 'scenarios');
  if (scenarios.length !== artifact.scenarioCount) throw new Error('scenario count drifted.');
  const weight = scenarios.reduce((sum, scenario) => sum + scenario.weight, 0);
  if (Math.abs(weight - 1) > TOLERANCE) throw new Error('scenario weights do not sum to one.');
  for (const side of SIDES) {
    validatePmf(artifact.starterBullpenTransition.bySide?.[side], `${side} starter BF PMF`);
  }
  if (artifact.untouchedTestReservation?.rowsIncluded !== false) {
    throw new Error('shared environment v2 exposes untouched-test rows.');
  }
  if (artifact.artifactSha256 !== sha256(JSON.stringify(artifactIdentity(artifact)))) {
    throw new Error('shared environment v2 SHA-256 is invalid.');
  }
  return artifact;
}
