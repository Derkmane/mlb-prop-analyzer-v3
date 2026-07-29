import { createHash } from 'node:crypto';

import { verifyM8PaSurvivalDataset } from './m8-pa-survival-dataset-utils.mjs';
import { m8PaSurvivalToCountPmf } from './m8-pa-survival-evaluation-utils.mjs';

const EXPECTED_CANDIDATE_ID = 'slot-home-away-pool-50';
const EXPECTED_GROUPING = 'slot-home-away';
const EXPECTED_POOLING_STRENGTH = 50;
const SIDES = Object.freeze(['away', 'home']);
const SLOTS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]);
const TOLERANCE = 1e-12;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

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
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
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

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function assertFiniteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and non-negative.`);
  }
  return value;
}

function assertProbability(value, label) {
  if (!Number.isFinite(value) || value < -TOLERANCE || value > 1 + TOLERANCE) {
    throw new RangeError(`${label} must be a finite probability.`);
  }
  return value;
}

function validateUntouchedReservation(rawReservation) {
  const reservation = assertObject(rawReservation, 'untouchedTestReservation');
  if (reservation.rowsIncluded !== false || Object.hasOwn(reservation, 'rows')) {
    throw new Error('untouched-test rows must remain excluded.');
  }
  return Object.freeze({ ...reservation, rowsIncluded: false });
}

function expectedGroupKeys() {
  return SIDES.flatMap((side) => SLOTS.map((slot) => `${side}:slot:${slot}`));
}

function validatePmf(rawPmf, label, expectedLength) {
  const pmf = assertArray(rawPmf, label).map((value, index) =>
    assertProbability(value, `${label}[${index}]`),
  );
  if (pmf.length !== expectedLength) {
    throw new Error(`${label} length must equal ${expectedLength}.`);
  }
  const total = pmf.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > TOLERANCE) {
    throw new Error(`${label} must sum to 1.`);
  }
  return Object.freeze(pmf);
}

function validateSurvival(rawSurvival, label, expectedLength, pmf) {
  const survival = assertArray(rawSurvival, label).map((value, index) =>
    assertProbability(value, `${label}[${index}]`),
  );
  if (survival.length !== expectedLength) {
    throw new Error(`${label} length must equal ${expectedLength}.`);
  }
  for (let index = 1; index < survival.length; index += 1) {
    if (survival[index] > survival[index - 1] + TOLERANCE) {
      throw new Error(`${label} must be monotone non-increasing.`);
    }
  }
  const reconstructed = m8PaSurvivalToCountPmf(survival);
  for (let index = 0; index < pmf.length; index += 1) {
    if (Math.abs(reconstructed[index] - pmf[index]) > TOLERANCE) {
      throw new Error(`${label} does not reconstruct its count PMF.`);
    }
  }
  return Object.freeze(survival);
}

function validateSelectedModel(rawModel, countSupport) {
  const model = assertObject(rawModel, 'evaluation.selectedModel');
  if (model.candidateId !== EXPECTED_CANDIDATE_ID) {
    throw new Error('holdout selected model is not the approved PA-survival baseline.');
  }
  if (model.grouping !== EXPECTED_GROUPING) {
    throw new Error('holdout selected model grouping drifted.');
  }
  if (model.leagueEquivalentObservations !== EXPECTED_POOLING_STRENGTH) {
    throw new Error('holdout selected model pooling strength drifted.');
  }
  if (
    model.rawCurvesMonotoneByConstruction !== true ||
    model.fittedCurvesMonotoneByConstruction !== true ||
    model.monotoneProjectionApplied !== false
  ) {
    throw new Error('selected model monotonicity evidence drifted.');
  }

  const supportMinimum = assertNonNegativeInteger(countSupport.minimum, 'countSupport.minimum');
  const supportMaximum = assertPositiveInteger(countSupport.maximum, 'countSupport.maximum');
  if (supportMinimum !== 0 || supportMaximum < 1) {
    throw new Error('PA-count support must begin at zero and include positive counts.');
  }
  const expectedPmfLength = supportMaximum + 1;
  const expectedSurvivalLength = supportMaximum;
  const expectedKeys = expectedGroupKeys();
  const groups = assertArray(model.groups, 'selectedModel.groups');
  if (groups.length !== expectedKeys.length) {
    throw new Error('selected model must preserve exactly 18 slot/home-away groups.');
  }
  const seen = new Set();
  const normalizedGroups = groups.map((rawGroup) => {
    const group = assertObject(rawGroup, 'selected model group');
    const groupKey = assertNonEmptyString(group.groupKey, 'selected model groupKey');
    if (!expectedKeys.includes(groupKey) || seen.has(groupKey)) {
      throw new Error(`selected model contains invalid or duplicate group ${groupKey}.`);
    }
    seen.add(groupKey);
    const fitObservationCount = assertPositiveInteger(
      group.fitObservationCount,
      `${groupKey}.fitObservationCount`,
    );
    const countVector = assertArray(group.countVector, `${groupKey}.countVector`).map(
      (value, index) => assertNonNegativeInteger(value, `${groupKey}.countVector[${index}]`),
    );
    if (countVector.length !== expectedPmfLength) {
      throw new Error(`${groupKey}.countVector length drifted.`);
    }
    if (countVector.reduce((sum, value) => sum + value, 0) !== fitObservationCount) {
      throw new Error(`${groupKey}.countVector does not conserve fit observations.`);
    }
    const rawPmf = validatePmf(group.rawPmf, `${groupKey}.rawPmf`, expectedPmfLength);
    const fittedPmf = validatePmf(
      group.fittedPmf,
      `${groupKey}.fittedPmf`,
      expectedPmfLength,
    );
    const rawSurvival = validateSurvival(
      group.rawSurvival,
      `${groupKey}.rawSurvival`,
      expectedSurvivalLength,
      rawPmf,
    );
    const fittedSurvival = validateSurvival(
      group.fittedSurvival,
      `${groupKey}.fittedSurvival`,
      expectedSurvivalLength,
      fittedPmf,
    );
    return Object.freeze({
      groupKey,
      fitObservationCount,
      countVector: Object.freeze(countVector),
      rawPmf,
      rawSurvival,
      fittedPmf,
      fittedSurvival,
    });
  });
  if (expectedKeys.some((key) => !seen.has(key))) {
    throw new Error('selected model is missing an expected slot/home-away group.');
  }
  return Object.freeze(
    normalizedGroups.sort((left, right) => left.groupKey.localeCompare(right.groupKey)),
  );
}

function artifactIdentity(artifact) {
  return {
    artifactVersion: artifact.artifactVersion,
    status: artifact.status,
    activeSeason: artifact.activeSeason,
    sourceDatasetSha256: artifact.sourceDatasetSha256,
    sourceDatasetFileSha256: artifact.sourceDatasetFileSha256,
    sourceHoldoutEvaluationSha256: artifact.sourceHoldoutEvaluationSha256,
    sourceHoldoutEvaluationFileSha256: artifact.sourceHoldoutEvaluationFileSha256,
    sourceWalkForwardSha256: artifact.sourceWalkForwardSha256,
    sourceWalkForwardFileSha256: artifact.sourceWalkForwardFileSha256,
    fitWindow: artifact.fitWindow,
    validationWindow: artifact.validationWindow,
    selectedCandidateId: artifact.selectedCandidateId,
    grouping: artifact.grouping,
    leagueEquivalentObservations: artifact.leagueEquivalentObservations,
    countSupport: artifact.countSupport,
    groups: artifact.groups,
    validationEvidence: artifact.validationEvidence,
    monotonicity: artifact.monotonicity,
    untouchedTestReservation: artifact.untouchedTestReservation,
  };
}

export function buildM8PaSurvivalBaselineArtifact({
  rawDataset,
  datasetFileSha256,
  rawEvaluation,
  evaluationFileSha256,
  rawWalkForward,
  walkForwardFileSha256,
}) {
  const dataset = verifyM8PaSurvivalDataset(rawDataset);
  assertSha256(datasetFileSha256, 'datasetFileSha256');
  const evaluation = assertObject(rawEvaluation, 'PA-survival evaluation');
  const walkForward = assertObject(rawWalkForward, 'PA-survival walk-forward');
  const untouchedTestReservation = validateUntouchedReservation(
    dataset.untouchedTestReservation,
  );

  if (evaluation.evaluationVersion !== 1 || walkForward.walkForwardVersion !== 1) {
    throw new Error('unsupported PA-survival evaluation artifact version.');
  }
  const evaluationSha256 = assertSha256(
    evaluation.evaluationSha256,
    'evaluation.evaluationSha256',
  );
  const walkForwardSha256 = assertSha256(
    walkForward.walkForwardSha256,
    'walkForward.walkForwardSha256',
  );
  assertSha256(evaluationFileSha256, 'evaluationFileSha256');
  assertSha256(walkForwardFileSha256, 'walkForwardFileSha256');

  for (const [label, sourceDatasetSha256] of [
    ['evaluation', evaluation.sourceDatasetSha256],
    ['walk-forward', walkForward.sourceDatasetSha256],
  ]) {
    if (sourceDatasetSha256 !== dataset.datasetSha256) {
      throw new Error(`${label} source dataset SHA-256 drifted.`);
    }
  }
  for (const [label, sourceDatasetFileSha256] of [
    ['evaluation', evaluation.sourceDatasetFileSha256],
    ['walk-forward', walkForward.sourceDatasetFileSha256],
  ]) {
    if (sourceDatasetFileSha256 !== datasetFileSha256) {
      throw new Error(`${label} source dataset file SHA-256 drifted.`);
    }
  }
  if (
    evaluation.selectedCandidateId !== EXPECTED_CANDIDATE_ID ||
    walkForward.sourceHoldoutSelectedCandidateId !== EXPECTED_CANDIDATE_ID ||
    walkForward.selectedCandidateId !== EXPECTED_CANDIDATE_ID
  ) {
    throw new Error('holdout and walk-forward selection do not agree on pool-50.');
  }
  if (walkForward.sourceHoldoutEvaluationSha256 !== evaluationSha256) {
    throw new Error('walk-forward does not reference the supplied holdout evaluation.');
  }
  if (
    walkForward.rawCurvesMonotoneByConstruction !== true ||
    walkForward.fittedCurvesMonotoneByConstruction !== true ||
    walkForward.monotoneProjectionApplied !== false
  ) {
    throw new Error('walk-forward monotonicity evidence drifted.');
  }
  validateUntouchedReservation(evaluation.untouchedTestReservation);
  validateUntouchedReservation(walkForward.untouchedTestReservation);

  const countSupport = assertObject(evaluation.countSupport, 'evaluation.countSupport');
  const groups = validateSelectedModel(evaluation.selectedModel, countSupport);
  const validationObservationCount = assertPositiveInteger(
    evaluation.validationObservationCount,
    'evaluation.validationObservationCount',
  );
  if (walkForward.aggregateValidationObservationCount !== validationObservationCount) {
    throw new Error('holdout and walk-forward validation cohort sizes drifted.');
  }
  const aggregateSelected = assertArray(
    walkForward.aggregateResults,
    'walkForward.aggregateResults',
  ).find((result) => result.candidateId === EXPECTED_CANDIDATE_ID);
  if (aggregateSelected === undefined) {
    throw new Error('walk-forward aggregate result is missing the selected candidate.');
  }
  const holdoutSelected = assertArray(
    evaluation.candidateSummaries,
    'evaluation.candidateSummaries',
  ).find((result) => result.candidateId === EXPECTED_CANDIDATE_ID);
  if (holdoutSelected === undefined) {
    throw new Error('holdout evaluation is missing the selected candidate summary.');
  }
  const holdoutLogLoss = assertFiniteNonNegative(
    holdoutSelected.logLoss,
    'holdout selected log loss',
  );
  const holdoutMulticlassBrier = assertFiniteNonNegative(
    holdoutSelected.multiclassBrier,
    'holdout selected multiclass Brier',
  );
  const walkForwardLogLoss = assertFiniteNonNegative(
    aggregateSelected.logLoss,
    'walk-forward selected log loss',
  );
  const walkForwardMulticlassBrier = assertFiniteNonNegative(
    aggregateSelected.multiclassBrier,
    'walk-forward selected multiclass Brier',
  );

  const identity = {
    artifactVersion: 1,
    status: 'benchmark-only-not-production-validated',
    activeSeason: dataset.activeSeason,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: datasetFileSha256,
    sourceHoldoutEvaluationSha256: evaluationSha256,
    sourceHoldoutEvaluationFileSha256: evaluationFileSha256,
    sourceWalkForwardSha256: walkForwardSha256,
    sourceWalkForwardFileSha256: walkForwardFileSha256,
    fitWindow: evaluation.fitWindow,
    validationWindow: evaluation.validationWindow,
    selectedCandidateId: EXPECTED_CANDIDATE_ID,
    grouping: EXPECTED_GROUPING,
    leagueEquivalentObservations: EXPECTED_POOLING_STRENGTH,
    countSupport: Object.freeze({
      minimum: assertNonNegativeInteger(countSupport.minimum, 'countSupport.minimum'),
      maximum: assertPositiveInteger(countSupport.maximum, 'countSupport.maximum'),
    }),
    groups,
    validationEvidence: Object.freeze({
      holdoutValidationObservationCount: validationObservationCount,
      holdoutLogLoss,
      holdoutMulticlassBrier,
      walkForwardFoldCount: assertPositiveInteger(walkForward.foldCount, 'walkForward.foldCount'),
      walkForwardValidationObservationCount: assertPositiveInteger(
        walkForward.aggregateValidationObservationCount,
        'walkForward.aggregateValidationObservationCount',
      ),
      walkForwardLogLoss,
      walkForwardMulticlassBrier,
      foldSelectedCandidateCounts: walkForward.selectedCandidateCounts,
      foldSelectedGroupingCounts: walkForward.selectedGroupingCounts,
    }),
    monotonicity: Object.freeze({
      rawCurvesMonotoneByConstruction: true,
      fittedCurvesMonotoneByConstruction: true,
      monotoneProjectionApplied: false,
    }),
    untouchedTestReservation,
  };

  return Object.freeze({
    purpose:
      'Frozen benchmark-only hitter PA-count model selected consistently by fixed holdout and expanding walk-forward validation.',
    ...identity,
    artifactSha256: sha256(JSON.stringify(identity)),
  });
}

export function verifyM8PaSurvivalBaselineArtifact(rawArtifact) {
  const artifact = assertObject(rawArtifact, 'PA-survival baseline artifact');
  validateUntouchedReservation(artifact.untouchedTestReservation);
  const expected = sha256(JSON.stringify(artifactIdentity(artifact)));
  if (artifact.artifactSha256 !== expected) {
    throw new Error('PA-survival baseline artifact SHA-256 is invalid.');
  }
  return artifact;
}
