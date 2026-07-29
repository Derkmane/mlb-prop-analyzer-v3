import { createHash } from 'node:crypto';

import { verifyM8StarterRetentionDataset } from './m8-starter-retention-dataset-utils.mjs';
import { verifyM8StarterRetentionEvaluation } from './m8-starter-retention-evaluation-utils.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TOLERANCE = 1e-12;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

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

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function assertProbability(value, label) {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new RangeError(`${label} must be greater than 0 and at most 1.`);
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function validateUntouchedReservation(raw, label) {
  const value = assertObject(raw, label);
  if (value.rowsIncluded !== false || Object.hasOwn(value, 'rows')) {
    throw new Error(`${label} must keep untouched-test rows sealed.`);
  }
  return Object.freeze({ ...value, rowsIncluded: false });
}

function requiredGroups(grouping) {
  if (grouping === 'league') return Object.freeze(['league']);
  if (grouping === 'side') return Object.freeze(['away', 'home']);
  if (grouping === 'slot') {
    return Object.freeze(Array.from({ length: 9 }, (_, index) => `slot:${index + 1}`));
  }
  if (grouping === 'slot-side') {
    return Object.freeze(
      ['away', 'home'].flatMap((side) =>
        Array.from({ length: 9 }, (_, index) => `${side}:slot:${index + 1}`),
      ),
    );
  }
  throw new Error(`unsupported starter retention grouping ${grouping}.`);
}

function conditionalRetention(model, groupKey, turn) {
  const league = model.leagueTurnStats[turn];
  if (league === undefined || league.risk === 0) {
    throw new Error(`frozen retention model lacks league risk for turn ${turn}.`);
  }
  const leagueRate = league.retained / league.risk;
  if (model.candidate.grouping === 'league') return leagueRate;
  const group = model.groupTurnStats[groupKey]?.[turn];
  if (group === undefined) {
    throw new Error(`frozen retention model lacks required group ${groupKey}.`);
  }
  const strength = model.candidate.leagueEquivalentRisk;
  return (group.retained + strength * leagueRate) / (group.risk + strength);
}

function freezeConditionalRetention(model) {
  const groups = requiredGroups(model.candidate.grouping);
  return Object.freeze(
    Object.fromEntries(
      groups.map((groupKey) => {
        const values = [];
        for (let turn = 1; turn <= model.turnMaximum; turn += 1) {
          const value = assertProbability(
            conditionalRetention(model, groupKey, turn),
            `${groupKey} turn ${turn}`,
          );
          if (turn === 1 && Math.abs(value - 1) > TOLERANCE) {
            throw new Error(`${groupKey} first-turn retention must equal 1.`);
          }
          values.push(value);
        }
        return [groupKey, Object.freeze(values)];
      }),
    ),
  );
}

function resultByCandidate(evaluation, candidateId, label) {
  const result = assertArray(evaluation.fixedResults, 'fixedResults').find(
    (candidate) => candidate.candidate.candidateId === candidateId,
  );
  if (result === undefined) throw new Error(`${label} result is missing.`);
  return result;
}

function artifactIdentity(artifact) {
  return {
    artifactVersion: artifact.artifactVersion,
    modelVersion: artifact.modelVersion,
    status: artifact.status,
    productionEnabled: artifact.productionEnabled,
    activeSeason: artifact.activeSeason,
    sourceDatasetSha256: artifact.sourceDatasetSha256,
    sourceDatasetFileSha256: artifact.sourceDatasetFileSha256,
    sourceEvaluationSha256: artifact.sourceEvaluationSha256,
    sourceEvaluationFileSha256: artifact.sourceEvaluationFileSha256,
    fitWindow: artifact.fitWindow,
    validationWindow: artifact.validationWindow,
    selectedCandidate: artifact.selectedCandidate,
    turnMaximum: artifact.turnMaximum,
    conditionalRetentionByGroup: artifact.conditionalRetentionByGroup,
    validationEvidence: artifact.validationEvidence,
    untouchedTestReservation: artifact.untouchedTestReservation,
  };
}

export function buildM8StarterRetentionArtifact({
  rawDataset,
  datasetFileSha256,
  rawEvaluation,
  evaluationFileSha256,
}) {
  const dataset = verifyM8StarterRetentionDataset(rawDataset);
  const evaluation = verifyM8StarterRetentionEvaluation(rawEvaluation);
  const datasetFileSha = assertSha256(datasetFileSha256, 'datasetFileSha256');
  const evaluationFileSha = assertSha256(
    evaluationFileSha256,
    'evaluationFileSha256',
  );
  if (
    evaluation.sourceDatasetSha256 !== dataset.datasetSha256 ||
    evaluation.sourceDatasetFileSha256 !== datasetFileSha
  ) {
    throw new Error('starter retention evaluation does not reference the supplied dataset.');
  }
  if (
    evaluation.status !== 'starter-retention-candidate-selected' ||
    evaluation.selectionAgreement !== true ||
    evaluation.selectedBeatsNoRetention !== true ||
    evaluation.selectedCandidate === null ||
    evaluation.finalModel === null
  ) {
    throw new Error('starter retention evaluation did not select an approved candidate.');
  }
  if (evaluation.selectedCandidate.kind !== 'retention') {
    throw new Error('the no-retention slot-turn baseline cannot be frozen as a model.');
  }
  if (
    evaluation.fixedSelectedCandidateId !==
      evaluation.walkForward.selectedCandidateId ||
    evaluation.fixedSelectedCandidateId !==
      evaluation.selectedCandidate.candidateId
  ) {
    throw new Error('starter retention fixed and walk-forward selections drifted.');
  }
  const selected = resultByCandidate(
    evaluation,
    evaluation.selectedCandidate.candidateId,
    'selected',
  );
  const baseline = resultByCandidate(
    evaluation,
    'no-retention-slot-turns',
    'no-retention baseline',
  );
  if (
    selected.metrics.overall.logLoss >= baseline.metrics.overall.logLoss ||
    selected.metrics.overall.multiclassBrier >=
      baseline.metrics.overall.multiclassBrier
  ) {
    throw new Error('selected retention candidate does not beat no-retention.');
  }
  const untouchedTestReservation = validateUntouchedReservation(
    dataset.untouchedTestReservation,
    'dataset untouchedTestReservation',
  );
  validateUntouchedReservation(
    evaluation.untouchedTestReservation,
    'evaluation untouchedTestReservation',
  );
  const conditionalRetentionByGroup = freezeConditionalRetention(
    evaluation.finalModel,
  );
  const artifact = {
    artifactVersion: 1,
    modelVersion: 'm8-starter-retention-v1',
    status: 'frozen-current-season-candidate-awaiting-untouched-test',
    productionEnabled: false,
    activeSeason: dataset.activeSeason,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: datasetFileSha,
    sourceEvaluationSha256: evaluation.evaluationSha256,
    sourceEvaluationFileSha256: evaluationFileSha,
    fitWindow: evaluation.fitWindow,
    validationWindow: evaluation.validationWindow,
    selectedCandidate: evaluation.selectedCandidate,
    turnMaximum: assertPositiveInteger(
      evaluation.finalModel.turnMaximum,
      'finalModel.turnMaximum',
    ),
    conditionalRetentionByGroup,
    validationEvidence: Object.freeze({
      selected: selected.metrics,
      noRetentionBaseline: baseline.metrics,
      fixedSelectedCandidateId: evaluation.fixedSelectedCandidateId,
      walkForwardSelectedCandidateId:
        evaluation.walkForward.selectedCandidateId,
      walkForwardFoldCount: assertPositiveInteger(
        evaluation.walkForward.foldCount,
        'walkForward.foldCount',
      ),
      selectionAgreement: true,
      selectedBeatsNoRetention: true,
    }),
    untouchedTestReservation,
  };
  return Object.freeze({
    purpose:
      'Frozen current-season named-starter retention probabilities that convert batting-slot turns into named-hitter plate appearances. This artifact remains disabled until the one-time untouched test passes.',
    ...artifact,
    artifactSha256: sha256(JSON.stringify(artifactIdentity(artifact))),
  });
}

export function verifyM8StarterRetentionArtifact(rawArtifact) {
  const artifact = assertObject(rawArtifact, 'starter retention artifact');
  if (
    artifact.artifactVersion !== 1 ||
    artifact.modelVersion !== 'm8-starter-retention-v1' ||
    artifact.status !==
      'frozen-current-season-candidate-awaiting-untouched-test' ||
    artifact.productionEnabled !== false
  ) {
    throw new Error('unsupported starter retention artifact contract.');
  }
  assertPositiveInteger(artifact.activeSeason, 'artifact.activeSeason');
  for (const [label, value] of [
    ['sourceDatasetSha256', artifact.sourceDatasetSha256],
    ['sourceDatasetFileSha256', artifact.sourceDatasetFileSha256],
    ['sourceEvaluationSha256', artifact.sourceEvaluationSha256],
    ['sourceEvaluationFileSha256', artifact.sourceEvaluationFileSha256],
    ['artifactSha256', artifact.artifactSha256],
  ]) {
    assertSha256(value, label);
  }
  validateUntouchedReservation(
    artifact.untouchedTestReservation,
    'artifact untouchedTestReservation',
  );
  assertNonEmptyString(
    artifact.selectedCandidate?.candidateId,
    'selectedCandidate.candidateId',
  );
  const groups = requiredGroups(artifact.selectedCandidate.grouping);
  const frozenGroups = Object.keys(
    assertObject(
      artifact.conditionalRetentionByGroup,
      'conditionalRetentionByGroup',
    ),
  ).sort();
  if (JSON.stringify(frozenGroups) !== JSON.stringify([...groups].sort())) {
    throw new Error('starter retention artifact group identities drifted.');
  }
  for (const group of groups) {
    const values = assertArray(
      artifact.conditionalRetentionByGroup[group],
      `${group} retention`,
    );
    if (values.length !== artifact.turnMaximum) {
      throw new Error(`${group} retention support drifted.`);
    }
    values.forEach((value, index) =>
      assertProbability(value, `${group} retention turn ${index + 1}`),
    );
    if (Math.abs(values[0] - 1) > TOLERANCE) {
      throw new Error(`${group} first-turn retention must equal 1.`);
    }
  }
  const expected = sha256(JSON.stringify(artifactIdentity(artifact)));
  if (artifact.artifactSha256 !== expected) {
    throw new Error('starter retention artifact SHA-256 is invalid.');
  }
  return artifact;
}
