import { createHash } from 'node:crypto';

import { verifyM8SharedOffensiveEnvironmentEvaluation } from './m8-shared-offensive-environment-utils.mjs';
import { verifyM8SharedOffensiveEnvironmentWalkForward } from './m8-shared-offensive-environment-walk-forward-utils.mjs';
import { verifyM8TeamOffensiveEnvironmentDataset } from './m8-team-offensive-environment-dataset-utils.mjs';

const EXPECTED_CANDIDATE_ID = 'shared-environment-k4';
const EXPECTED_SCENARIO_COUNT = 4;
const EXPECTED_CANDIDATE_COUNTS = Object.freeze([1, 2, 3, 4]);
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

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
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
    throw new RangeError(`${label} must be a probability.`);
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function validateUntouchedReservation(rawValue, label) {
  const value = assertObject(rawValue, label);
  if (value.rowsIncluded !== false || Object.hasOwn(value, 'rows')) {
    throw new Error(`${label} must keep untouched-test rows excluded.`);
  }
  return Object.freeze({ ...value, rowsIncluded: false });
}

function candidateById(candidates, candidateId, label) {
  const candidate = assertArray(candidates, label).find(
    (value) => value.candidateId === candidateId,
  );
  if (candidate === undefined) {
    throw new Error(`${label} is missing ${candidateId}.`);
  }
  return assertObject(candidate, `${label}.${candidateId}`);
}

function validateMetricBlock(rawMetrics, label, expectedGameCount) {
  const metrics = assertObject(rawMetrics, label);
  const gameCount = assertPositiveInteger(metrics.gameCount, `${label}.gameCount`);
  if (gameCount !== expectedGameCount) {
    throw new Error(`${label}.gameCount drifted.`);
  }
  return Object.freeze({
    gameCount,
    jointLogLoss: assertFiniteNonNegative(metrics.jointLogLoss, `${label}.jointLogLoss`),
    paLogLoss: assertFiniteNonNegative(metrics.paLogLoss, `${label}.paLogLoss`),
    hitConditionalLogLoss: assertFiniteNonNegative(
      metrics.hitConditionalLogLoss,
      `${label}.hitConditionalLogLoss`,
    ),
  });
}

function validateScenarioSide(rawSide, label) {
  const side = assertObject(rawSide, label);
  return Object.freeze({
    meanPa: assertFiniteNonNegative(side.meanPa, `${label}.meanPa`),
    sigmaPa: assertFiniteNonNegative(side.sigmaPa, `${label}.sigmaPa`),
    hitProbability: assertProbability(side.hitProbability, `${label}.hitProbability`),
    expectedHits: assertFiniteNonNegative(side.expectedHits, `${label}.expectedHits`),
  });
}

function validateScenarios(rawScenarios) {
  const scenarios = assertArray(rawScenarios, 'selected candidate scenarios');
  if (scenarios.length !== EXPECTED_SCENARIO_COUNT) {
    throw new Error(`selected candidate must contain ${EXPECTED_SCENARIO_COUNT} scenarios.`);
  }
  const seenIndexes = new Set();
  const normalized = scenarios.map((rawScenario, index) => {
    const scenario = assertObject(rawScenario, `scenario[${index}]`);
    const scenarioIndex = Number.isSafeInteger(scenario.scenarioIndex)
      ? scenario.scenarioIndex
      : index;
    if (scenarioIndex < 0 || scenarioIndex >= EXPECTED_SCENARIO_COUNT) {
      throw new Error(`scenario[${index}].scenarioIndex is invalid.`);
    }
    if (seenIndexes.has(scenarioIndex)) {
      throw new Error(`scenario index ${scenarioIndex} is duplicated.`);
    }
    seenIndexes.add(scenarioIndex);
    const away = validateScenarioSide(scenario.away, `scenario[${index}].away`);
    const home = validateScenarioSide(scenario.home, `scenario[${index}].home`);
    const expectedTotalPa = assertFiniteNonNegative(
      scenario.expectedTotalPa,
      `scenario[${index}].expectedTotalPa`,
    );
    const expectedTotalHits = assertFiniteNonNegative(
      scenario.expectedTotalHits,
      `scenario[${index}].expectedTotalHits`,
    );
    if (Math.abs(expectedTotalPa - (away.meanPa + home.meanPa)) > TOLERANCE) {
      throw new Error(`scenario[${index}] expected total PA is inconsistent.`);
    }
    if (Math.abs(expectedTotalHits - (away.expectedHits + home.expectedHits)) > TOLERANCE) {
      throw new Error(`scenario[${index}] expected total hits are inconsistent.`);
    }
    return Object.freeze({
      scenarioIndex,
      weight: assertProbability(scenario.weight, `scenario[${index}].weight`),
      expectedTotalPa,
      expectedTotalHits,
      away,
      home,
    });
  });
  const weightSum = normalized.reduce((sum, scenario) => sum + scenario.weight, 0);
  if (Math.abs(weightSum - 1) > TOLERANCE) {
    throw new Error('selected scenario weights must sum to one.');
  }
  return Object.freeze(
    normalized.sort((left, right) => left.scenarioIndex - right.scenarioIndex),
  );
}

function artifactIdentity(artifact) {
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

export function buildM8SharedOffensiveEnvironmentArtifact({
  rawDataset,
  datasetFileSha256,
  rawEvaluation,
  evaluationFileSha256,
  rawWalkForward,
  walkForwardFileSha256,
}) {
  const dataset = verifyM8TeamOffensiveEnvironmentDataset(rawDataset);
  const evaluation = verifyM8SharedOffensiveEnvironmentEvaluation(rawEvaluation);
  const walkForward = verifyM8SharedOffensiveEnvironmentWalkForward(rawWalkForward);
  const datasetFileSha = assertSha256(datasetFileSha256, 'datasetFileSha256');
  const evaluationFileSha = assertSha256(evaluationFileSha256, 'evaluationFileSha256');
  const walkForwardFileSha = assertSha256(walkForwardFileSha256, 'walkForwardFileSha256');
  const untouchedTestReservation = validateUntouchedReservation(
    dataset.untouchedTestReservation,
    'dataset untouchedTestReservation',
  );
  validateUntouchedReservation(
    evaluation.untouchedTestReservation,
    'evaluation untouchedTestReservation',
  );
  validateUntouchedReservation(
    walkForward.untouchedTestReservation,
    'walk-forward untouchedTestReservation',
  );

  if (
    evaluation.sourceDatasetSha256 !== dataset.datasetSha256 ||
    walkForward.sourceDatasetSha256 !== dataset.datasetSha256
  ) {
    throw new Error('shared-environment sources do not reference the supplied dataset.');
  }
  if (
    evaluation.sourceDatasetFileSha256 !== datasetFileSha ||
    walkForward.sourceDatasetFileSha256 !== datasetFileSha
  ) {
    throw new Error('shared-environment source dataset file SHA-256 drifted.');
  }
  if (walkForward.sourceEvaluationSha256 !== evaluation.evaluationSha256) {
    throw new Error('walk-forward does not reference the supplied holdout evaluation.');
  }
  if (walkForward.sourceEvaluationFileSha256 !== evaluationFileSha) {
    throw new Error('walk-forward holdout evaluation file SHA-256 drifted.');
  }
  if (
    dataset.activeSeason !== evaluation.activeSeason ||
    dataset.activeSeason !== walkForward.activeSeason
  ) {
    throw new Error('shared-environment source active seasons drifted.');
  }
  if (
    JSON.stringify(evaluation.candidateScenarioCounts) !==
      JSON.stringify(EXPECTED_CANDIDATE_COUNTS) ||
    JSON.stringify(walkForward.candidateScenarioCounts) !==
      JSON.stringify(EXPECTED_CANDIDATE_COUNTS)
  ) {
    throw new Error('shared-environment candidate scenario counts drifted.');
  }
  if (
    evaluation.selectedCandidate?.candidateId !== EXPECTED_CANDIDATE_ID ||
    evaluation.selectedCandidate?.scenarioCount !== EXPECTED_SCENARIO_COUNT ||
    walkForward.selectedCandidate?.candidateId !== EXPECTED_CANDIDATE_ID ||
    walkForward.selectedCandidate?.scenarioCount !== EXPECTED_SCENARIO_COUNT ||
    walkForward.sourceSelectionAgreement !== true
  ) {
    throw new Error('holdout and walk-forward do not agree on shared-environment-k4.');
  }
  if (
    evaluation.holdoutSupportsSharedScenarios !== true ||
    walkForward.walkForwardSupportsSharedScenarios !== true ||
    walkForward.allValidationGamesScoredExactlyOnce !== true
  ) {
    throw new Error('shared-scenario validation evidence is incomplete.');
  }

  const validationGameCount = assertPositiveInteger(
    evaluation.validationWindow?.gameCount,
    'evaluation.validationWindow.gameCount',
  );
  if (walkForward.validationGameCount !== validationGameCount) {
    throw new Error('holdout and walk-forward validation game counts drifted.');
  }
  const holdoutSelected = candidateById(
    evaluation.candidates,
    EXPECTED_CANDIDATE_ID,
    'evaluation.candidates',
  );
  const holdoutBaseline = candidateById(
    evaluation.candidates,
    'shared-environment-k1',
    'evaluation.candidates',
  );
  const walkForwardSelected = candidateById(
    walkForward.aggregateCandidates,
    EXPECTED_CANDIDATE_ID,
    'walkForward.aggregateCandidates',
  );
  const walkForwardBaseline = candidateById(
    walkForward.aggregateCandidates,
    'shared-environment-k1',
    'walkForward.aggregateCandidates',
  );
  const holdoutSelectedMetrics = validateMetricBlock(
    holdoutSelected.validation,
    'holdout selected validation',
    validationGameCount,
  );
  const holdoutBaselineMetrics = validateMetricBlock(
    holdoutBaseline.validation,
    'holdout baseline validation',
    validationGameCount,
  );
  const walkForwardSelectedMetrics = validateMetricBlock(
    walkForwardSelected.validation,
    'walk-forward selected validation',
    validationGameCount,
  );
  const walkForwardBaselineMetrics = validateMetricBlock(
    walkForwardBaseline.validation,
    'walk-forward baseline validation',
    validationGameCount,
  );
  if (
    holdoutSelectedMetrics.jointLogLoss >= holdoutBaselineMetrics.jointLogLoss ||
    walkForwardSelectedMetrics.jointLogLoss >= walkForwardBaselineMetrics.jointLogLoss
  ) {
    throw new Error('shared-environment-k4 does not beat the K=1 independence baseline.');
  }

  const scenarios = validateScenarios(evaluation.selectedCandidate.scenarios);
  const holdoutAbsoluteImprovement =
    holdoutBaselineMetrics.jointLogLoss - holdoutSelectedMetrics.jointLogLoss;
  const walkForwardAbsoluteImprovement =
    walkForwardBaselineMetrics.jointLogLoss - walkForwardSelectedMetrics.jointLogLoss;
  const validationEvidence = Object.freeze({
    holdout: Object.freeze({
      selected: holdoutSelectedMetrics,
      independenceBaseline: holdoutBaselineMetrics,
      absoluteJointLogLossImprovement: holdoutAbsoluteImprovement,
      relativeJointLogLossImprovement:
        holdoutAbsoluteImprovement / holdoutBaselineMetrics.jointLogLoss,
    }),
    walkForward: Object.freeze({
      foldCount: assertPositiveInteger(walkForward.foldCount, 'walkForward.foldCount'),
      validationGameCount,
      selected: walkForwardSelectedMetrics,
      independenceBaseline: walkForwardBaselineMetrics,
      absoluteJointLogLossImprovement: walkForwardAbsoluteImprovement,
      relativeJointLogLossImprovement:
        walkForwardAbsoluteImprovement / walkForwardBaselineMetrics.jointLogLoss,
      selectedFoldWins: assertFiniteNonNegative(
        walkForwardSelected.foldWins,
        'walkForward selected foldWins',
      ),
      selectedMeanFoldRank: assertFiniteNonNegative(
        walkForwardSelected.meanFoldRank,
        'walkForward selected meanFoldRank',
      ),
      sourceSelectionAgreement: true,
      allValidationGamesScoredExactlyOnce: true,
    }),
  });

  const artifact = {
    artifactVersion: 1,
    purpose:
      'Frozen current-season benchmark parameters for one shared game-level offensive-environment variable that jointly moves away/home team plate-appearance distributions and hit probabilities.',
    status: 'benchmark-only-not-production-validated',
    productionEnabled: false,
    activeSeason: dataset.activeSeason,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: datasetFileSha,
    sourceHoldoutEvaluationSha256: evaluation.evaluationSha256,
    sourceHoldoutEvaluationFileSha256: evaluationFileSha,
    sourceWalkForwardSha256: walkForward.walkForwardSha256,
    sourceWalkForwardFileSha256: walkForwardFileSha,
    fitWindow: evaluation.fitWindow,
    validationWindow: evaluation.validationWindow,
    candidateScenarioCounts: Object.freeze([...EXPECTED_CANDIDATE_COUNTS]),
    selectedCandidateId: EXPECTED_CANDIDATE_ID,
    scenarioCount: EXPECTED_SCENARIO_COUNT,
    scenarioCountPolicy: Object.freeze({
      selectionBasis: 'chronological-holdout-plus-daily-expanding-walk-forward-joint-log-loss',
      permanentFixedCount: false,
      requiredFutureGate:
        'reselect-or-revalidate-scenario-count-when-the-current-season-evidence-window-or-downstream-tail-benchmark-changes',
    }),
    scenarios,
    validationEvidence,
    untouchedTestReservation,
  };
  return Object.freeze({
    ...artifact,
    artifactSha256: sha256(JSON.stringify(artifactIdentity(artifact))),
  });
}

export function verifyM8SharedOffensiveEnvironmentArtifact(rawArtifact) {
  const artifact = assertObject(rawArtifact, 'shared offensive-environment artifact');
  if (
    artifact.artifactVersion !== 1 ||
    artifact.status !== 'benchmark-only-not-production-validated' ||
    artifact.productionEnabled !== false
  ) {
    throw new Error('unsupported shared offensive-environment artifact contract.');
  }
  assertPositiveInteger(artifact.activeSeason, 'artifact.activeSeason');
  for (const [label, value] of [
    ['sourceDatasetSha256', artifact.sourceDatasetSha256],
    ['sourceDatasetFileSha256', artifact.sourceDatasetFileSha256],
    ['sourceHoldoutEvaluationSha256', artifact.sourceHoldoutEvaluationSha256],
    ['sourceHoldoutEvaluationFileSha256', artifact.sourceHoldoutEvaluationFileSha256],
    ['sourceWalkForwardSha256', artifact.sourceWalkForwardSha256],
    ['sourceWalkForwardFileSha256', artifact.sourceWalkForwardFileSha256],
  ]) {
    assertSha256(value, label);
  }
  validateUntouchedReservation(
    artifact.untouchedTestReservation,
    'artifact untouchedTestReservation',
  );
  if (
    assertNonEmptyString(artifact.selectedCandidateId, 'artifact.selectedCandidateId') !==
      EXPECTED_CANDIDATE_ID ||
    artifact.scenarioCount !== EXPECTED_SCENARIO_COUNT
  ) {
    throw new Error('artifact selected scenario structure drifted.');
  }
  validateScenarios(artifact.scenarios);
  const holdout = assertObject(artifact.validationEvidence?.holdout, 'validationEvidence.holdout');
  const walkForward = assertObject(
    artifact.validationEvidence?.walkForward,
    'validationEvidence.walkForward',
  );
  if (
    holdout.selected.jointLogLoss >= holdout.independenceBaseline.jointLogLoss ||
    walkForward.selected.jointLogLoss >= walkForward.independenceBaseline.jointLogLoss ||
    walkForward.sourceSelectionAgreement !== true ||
    walkForward.allValidationGamesScoredExactlyOnce !== true
  ) {
    throw new Error('artifact validation evidence no longer supports shared-environment-k4.');
  }
  const expectedSha = sha256(JSON.stringify(artifactIdentity(artifact)));
  if (assertSha256(artifact.artifactSha256, 'artifactSha256') !== expectedSha) {
    throw new Error('shared offensive-environment artifact SHA-256 is invalid.');
  }
  return artifact;
}
