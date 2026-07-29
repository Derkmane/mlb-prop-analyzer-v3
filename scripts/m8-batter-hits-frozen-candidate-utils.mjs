import { buildGenericBullpenModel } from './m8-batter-hits-runtime-candidate-utils.mjs';
import { verifyM8SharedOffensiveEnvironmentV2 } from './m8-shared-offensive-environment-v2-utils.mjs';
import { verifyM8StarterRetentionArtifact } from './m8-starter-retention-artifact-utils.mjs';
import { verifyM8TerminalPaOutcomeArtifact } from './m8-terminal-pa-outcome-artifact-utils.mjs';
import { sha256 } from './provider-probe-utils.mjs';

const FIXED_ENVIRONMENT_COEFFICIENT = 1;
const TOLERANCE = 1e-12;

function assertObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function candidateIdentity(value) {
  return {
    artifactVersion: value.artifactVersion,
    modelVersion: value.modelVersion,
    status: value.status,
    productionEnabled: value.productionEnabled,
    activeSeason: value.activeSeason,
    sourceSharedEnvironmentArtifactSha256:
      value.sourceSharedEnvironmentArtifactSha256,
    sourceStarterRetentionArtifactSha256:
      value.sourceStarterRetentionArtifactSha256,
    sourceTerminalOutcomeArtifactSha256:
      value.sourceTerminalOutcomeArtifactSha256,
    environmentEffectPolicy: value.environmentEffectPolicy,
    bullpenModel: value.bullpenModel,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

export function buildM8FrozenBatterHitsCandidate({
  sharedEnvironmentArtifact: rawShared,
  starterRetentionArtifact: rawRetention,
  terminalOutcomeArtifact: rawTerminal,
  fitBullpenRows,
}) {
  const shared = verifyM8SharedOffensiveEnvironmentV2(rawShared);
  const retention = verifyM8StarterRetentionArtifact(rawRetention);
  const terminal = verifyM8TerminalPaOutcomeArtifact(rawTerminal);

  if (
    shared.activeSeason !== retention.activeSeason ||
    shared.activeSeason !== terminal.activeSeason
  ) {
    throw new Error('complete Batter Hits artifacts do not share one active season.');
  }
  for (const artifact of [retention, terminal]) {
    if (
      artifact.untouchedTestReservation.startDate !==
        shared.untouchedTestReservation.startDate ||
      artifact.untouchedTestReservation.endDate !==
        shared.untouchedTestReservation.endDate
    ) {
      throw new Error('complete Batter Hits artifacts do not share one untouched reservation.');
    }
  }

  const bullpenModel = buildGenericBullpenModel({
    terminalArtifact: terminal,
    bullpenRows: assertArray(fitBullpenRows, 'fit bullpen rows'),
  });
  const identity = {
    artifactVersion: 1,
    modelVersion: 'm8-batter-hits-complete-candidate-v1',
    status: 'frozen-complete-current-season-candidate-before-untouched-test',
    productionEnabled: false,
    activeSeason: shared.activeSeason,
    sourceSharedEnvironmentArtifactSha256: shared.artifactSha256,
    sourceStarterRetentionArtifactSha256: retention.artifactSha256,
    sourceTerminalOutcomeArtifactSha256: terminal.artifactSha256,
    environmentEffectPolicy: Object.freeze({
      coefficient: FIXED_ENVIRONMENT_COEFFICIENT,
      selectionMethod:
        'predeclared full application of the already-selected shared offensive environment; not retuned on validation or test rows',
      noEnvironmentBenchmarkCoefficient: 0,
      testUse: 'acceptance-comparison-only-never-candidate-selection',
    }),
    bullpenModel,
    untouchedTestReservation: Object.freeze({
      ...shared.untouchedTestReservation,
      rowsIncluded: false,
    }),
  };
  return Object.freeze({
    purpose:
      'Frozen complete M8 Batter Hits candidate assembled before the untouched test from shared game, workload, named-hitter retention, and terminal PA artifacts.',
    ...identity,
    artifactSha256: sha256(JSON.stringify(candidateIdentity(identity))),
  });
}

export function verifyM8FrozenBatterHitsCandidate(rawCandidate) {
  const candidate = assertObject(rawCandidate, 'frozen Batter Hits candidate');
  if (
    candidate.artifactVersion !== 1 ||
    candidate.modelVersion !== 'm8-batter-hits-complete-candidate-v1' ||
    candidate.status !==
      'frozen-complete-current-season-candidate-before-untouched-test' ||
    candidate.productionEnabled !== false
  ) {
    throw new Error('unsupported frozen Batter Hits candidate contract.');
  }
  if (
    candidate.environmentEffectPolicy?.coefficient !==
      FIXED_ENVIRONMENT_COEFFICIENT ||
    candidate.environmentEffectPolicy?.noEnvironmentBenchmarkCoefficient !== 0
  ) {
    throw new Error('frozen Batter Hits environment policy drifted.');
  }
  if (candidate.untouchedTestReservation?.rowsIncluded !== false) {
    throw new Error('frozen Batter Hits candidate exposes untouched-test rows.');
  }
  const weights = assertObject(
    candidate.bullpenModel?.handWeights,
    'bullpen hand weights',
  );
  if (Math.abs(weights.L + weights.R - 1) > TOLERANCE) {
    throw new Error('bullpen hand weights do not sum to one.');
  }
  if (
    candidate.artifactSha256 !==
    sha256(JSON.stringify(candidateIdentity(candidate)))
  ) {
    throw new Error('frozen Batter Hits candidate SHA-256 is invalid.');
  }
  return candidate;
}
