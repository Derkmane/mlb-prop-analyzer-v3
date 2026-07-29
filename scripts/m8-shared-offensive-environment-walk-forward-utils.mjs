import { createHash } from 'node:crypto';

import {
  evaluateM8SharedOffensiveEnvironment,
  verifyM8SharedOffensiveEnvironmentEvaluation,
} from './m8-shared-offensive-environment-utils.mjs';
import { verifyM8TeamOffensiveEnvironmentDataset } from './m8-team-offensive-environment-dataset-utils.mjs';

const DEFAULT_SCENARIO_COUNTS = Object.freeze([1, 2, 3, 4]);
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

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function datasetIdentity(dataset) {
  return {
    datasetVersion: dataset.datasetVersion,
    provider: dataset.provider,
    activeSeason: dataset.activeSeason,
    sourceCaptureManifestSha256: dataset.sourceCaptureManifestSha256,
    sourceCapturePlanSha256: dataset.sourceCapturePlanSha256,
    sourceResolvedDatasetSha256: dataset.sourceResolvedDatasetSha256,
    sourceResolvedDatasetFileSha256: dataset.sourceResolvedDatasetFileSha256,
    includedPeriods: dataset.includedPeriods,
    untouchedTestReservation: dataset.untouchedTestReservation,
    exclusionPolicy: dataset.exclusionPolicy,
    totals: dataset.totals,
    exclusionReasonCounts: dataset.exclusionReasonCounts,
    periods: dataset.periods,
    excludedGames: dataset.excludedGames,
  };
}

function sortedRows(rows) {
  return rows
    .slice()
    .sort(
      (left, right) =>
        left.observedDate.localeCompare(right.observedDate) ||
        left.gameId - right.gameId ||
        left.side.localeCompare(right.side),
    );
}

function rowForPeriod(row, periodId) {
  if (row.periodId === periodId) return row;
  return Object.freeze({
    ...row,
    rowId: `${periodId}:${row.observedDate}:${row.gameId}:${row.side}:${row.teamId}`,
    periodId,
  });
}

function periodFromRows(rows, periodId) {
  const ordered = sortedRows(rows.map((row) => rowForPeriod(row, periodId)));
  return Object.freeze({
    startDate: ordered[0]?.observedDate ?? null,
    endDate: ordered.at(-1)?.observedDate ?? null,
    rowCount: ordered.length,
    rows: Object.freeze(ordered),
  });
}

function foldTotals(rows) {
  const gameIds = new Set(rows.map((row) => row.gameId));
  if (rows.length !== gameIds.size * 2) {
    throw new Error('walk-forward fold must preserve exactly two team rows per game.');
  }
  return Object.freeze({
    capturedGameCount: gameIds.size,
    candidateTeamGameCount: rows.length,
    includedGameCount: gameIds.size,
    includedTeamGameCount: rows.length,
    excludedGameCount: 0,
    excludedTeamGameCount: 0,
    totalIncludedPlateAppearances: rows.reduce(
      (sum, row) => sum + row.teamPlateAppearances,
      0,
    ),
    totalIncludedHits: rows.reduce((sum, row) => sum + row.teamHits, 0),
    totalIncludedRuns: rows.reduce((sum, row) => sum + row.teamRuns, 0),
    ignoredBaserunningRowCount: rows.reduce(
      (sum, row) => sum + (row.ignoredBaserunningRowCount ?? 0),
      0,
    ),
    optionalDirectPaComparatorSideCount: rows.filter(
      (row) => row.directBatterPaComparator?.available === true,
    ).length,
  });
}

function buildFoldDataset(source, fitRows, validationRows) {
  const periods = Object.freeze({
    fit: periodFromRows(fitRows, 'fit'),
    validation: periodFromRows(validationRows, 'validation'),
  });
  if (periods.fit.rowCount === 0 || periods.validation.rowCount === 0) {
    throw new Error('walk-forward fit and validation periods must both contain rows.');
  }
  if (periods.fit.endDate >= periods.validation.startDate) {
    throw new Error('walk-forward fold fit evidence must precede its validation date.');
  }
  const rows = [...periods.fit.rows, ...periods.validation.rows];
  const identity = {
    datasetVersion: source.datasetVersion,
    provider: source.provider,
    activeSeason: source.activeSeason,
    sourceCaptureManifestSha256: source.sourceCaptureManifestSha256,
    sourceCapturePlanSha256: source.sourceCapturePlanSha256,
    sourceResolvedDatasetSha256: source.sourceResolvedDatasetSha256,
    sourceResolvedDatasetFileSha256: source.sourceResolvedDatasetFileSha256,
    includedPeriods: source.includedPeriods,
    untouchedTestReservation: source.untouchedTestReservation,
    exclusionPolicy: source.exclusionPolicy,
    totals: foldTotals(rows),
    exclusionReasonCounts: Object.freeze({}),
    periods,
    excludedGames: Object.freeze([]),
  };
  return Object.freeze({
    purpose:
      'Ephemeral chronological fold derived from the frozen team offensive-environment dataset for walk-forward benchmark evaluation only.',
    ...identity,
    datasetSha256: sha256(JSON.stringify(datasetIdentity(identity))),
  });
}

function weightedAggregate(candidatesByFold, scenarioCount, totalGameCount) {
  const rows = candidatesByFold.map(({ fold, candidate, rank }) => ({
    fold,
    candidate,
    rank,
  }));
  const weighted = (selector) =>
    rows.reduce(
      (sum, row) => sum + selector(row.candidate.validation) * row.fold.validationGameCount,
      0,
    ) / totalGameCount;
  return Object.freeze({
    candidateId: `shared-environment-k${scenarioCount}`,
    scenarioCount,
    validation: Object.freeze({
      gameCount: totalGameCount,
      jointLogLoss: weighted((metrics) => metrics.jointLogLoss),
      paLogLoss: weighted((metrics) => metrics.paLogLoss),
      hitConditionalLogLoss: weighted((metrics) => metrics.hitConditionalLogLoss),
    }),
    foldWins: rows.filter((row) => row.rank === 1).length,
    meanFoldRank: rows.reduce((sum, row) => sum + row.rank, 0) / rows.length,
    convergedFoldCount: rows.filter((row) => row.candidate.converged).length,
    foldCount: rows.length,
  });
}

function walkForwardIdentity(evaluation) {
  return {
    walkForwardVersion: evaluation.walkForwardVersion,
    purpose: evaluation.purpose,
    status: evaluation.status,
    activeSeason: evaluation.activeSeason,
    sourceDatasetSha256: evaluation.sourceDatasetSha256,
    sourceDatasetFileSha256: evaluation.sourceDatasetFileSha256,
    sourceEvaluationSha256: evaluation.sourceEvaluationSha256,
    sourceEvaluationFileSha256: evaluation.sourceEvaluationFileSha256,
    candidateScenarioCounts: evaluation.candidateScenarioCounts,
    fitWindow: evaluation.fitWindow,
    validationWindow: evaluation.validationWindow,
    foldCount: evaluation.foldCount,
    validationGameCount: evaluation.validationGameCount,
    folds: evaluation.folds,
    aggregateCandidates: evaluation.aggregateCandidates,
    selectedCandidate: evaluation.selectedCandidate,
    independenceBaseline: evaluation.independenceBaseline,
    bestSharedScenarioCandidate: evaluation.bestSharedScenarioCandidate,
    walkForwardSupportsSharedScenarios: evaluation.walkForwardSupportsSharedScenarios,
    sourceSelectionAgreement: evaluation.sourceSelectionAgreement,
    allValidationGamesScoredExactlyOnce: evaluation.allValidationGamesScoredExactlyOnce,
    untouchedTestReservation: evaluation.untouchedTestReservation,
    untouchedTestRowsRead: evaluation.untouchedTestRowsRead,
  };
}

export function evaluateM8SharedOffensiveEnvironmentWalkForward({
  dataset: rawDataset,
  sourceDatasetFileSha256,
  sourceEvaluation: rawSourceEvaluation,
  sourceEvaluationFileSha256,
  candidateScenarioCounts = DEFAULT_SCENARIO_COUNTS,
}) {
  const dataset = verifyM8TeamOffensiveEnvironmentDataset(rawDataset);
  const sourceEvaluation = verifyM8SharedOffensiveEnvironmentEvaluation(rawSourceEvaluation);
  const datasetFileSha = assertSha256(sourceDatasetFileSha256, 'sourceDatasetFileSha256');
  const evaluationFileSha = assertSha256(
    sourceEvaluationFileSha256,
    'sourceEvaluationFileSha256',
  );
  if (sourceEvaluation.sourceDatasetSha256 !== dataset.datasetSha256) {
    throw new Error('source shared-environment evaluation does not match the dataset.');
  }
  if (sourceEvaluation.sourceDatasetFileSha256 !== datasetFileSha) {
    throw new Error('source shared-environment evaluation dataset file SHA-256 drifted.');
  }
  if (
    dataset.untouchedTestReservation?.rowsIncluded !== false ||
    Object.hasOwn(dataset.untouchedTestReservation ?? {}, 'rows')
  ) {
    throw new Error('walk-forward evaluation must keep untouched-test rows sealed.');
  }
  const scenarioCounts = [...new Set(assertArray(candidateScenarioCounts, 'candidateScenarioCounts'))]
    .map((value) => assertPositiveInteger(value, 'scenario count'))
    .sort((left, right) => left - right);
  if (!scenarioCounts.includes(1)) {
    throw new Error('candidateScenarioCounts must include the K=1 independence baseline.');
  }
  if (
    JSON.stringify(scenarioCounts) !== JSON.stringify(sourceEvaluation.candidateScenarioCounts)
  ) {
    throw new Error('walk-forward candidate counts must match the source holdout evaluation.');
  }
  const baseFitRows = sortedRows(dataset.periods.fit.rows);
  const validationRows = sortedRows(dataset.periods.validation.rows);
  const validationDates = [...new Set(validationRows.map((row) => row.observedDate))].sort();
  const folds = [];
  const seenValidationGameIds = new Set();
  for (const observedDate of validationDates) {
    const priorValidationRows = validationRows.filter((row) => row.observedDate < observedDate);
    const foldValidationRows = validationRows.filter((row) => row.observedDate === observedDate);
    const foldDataset = buildFoldDataset(
      dataset,
      [...baseFitRows, ...priorValidationRows],
      foldValidationRows,
    );
    const foldEvaluation = evaluateM8SharedOffensiveEnvironment({
      dataset: foldDataset,
      sourceDatasetFileSha256: datasetFileSha,
      candidateScenarioCounts: scenarioCounts,
    });
    const validationGameIds = [...new Set(foldValidationRows.map((row) => row.gameId))].sort(
      (left, right) => left - right,
    );
    for (const gameId of validationGameIds) {
      if (seenValidationGameIds.has(gameId)) {
        throw new Error(`validation game ${gameId} was scored more than once.`);
      }
      seenValidationGameIds.add(gameId);
    }
    const candidates = foldEvaluation.candidates.map((candidate, index) =>
      Object.freeze({
        rank: index + 1,
        candidateId: candidate.candidateId,
        scenarioCount: candidate.scenarioCount,
        selectedInitialization: candidate.selectedInitialization,
        converged: candidate.converged,
        iterations: candidate.iterations,
        validation: candidate.validation,
        scenarioWeightSum: candidate.scenarios.reduce(
          (sum, scenario) => sum + scenario.weight,
          0,
        ),
      }),
    );
    folds.push(
      Object.freeze({
        foldIndex: folds.length + 1,
        validationDate: observedDate,
        fitStartDate: foldDataset.periods.fit.startDate,
        fitEndDate: foldDataset.periods.fit.endDate,
        fitGameCount: foldDataset.periods.fit.rowCount / 2,
        validationGameCount: validationGameIds.length,
        validationGameIds: Object.freeze(validationGameIds),
        selectedCandidateId: foldEvaluation.selectedCandidate.candidateId,
        selectedScenarioCount: foldEvaluation.selectedCandidate.scenarioCount,
        holdoutSupportsSharedScenarios: foldEvaluation.holdoutSupportsSharedScenarios,
        candidates: Object.freeze(candidates),
      }),
    );
  }
  const expectedValidationGameIds = new Set(validationRows.map((row) => row.gameId));
  const allValidationGamesScoredExactlyOnce =
    seenValidationGameIds.size === expectedValidationGameIds.size &&
    [...expectedValidationGameIds].every((gameId) => seenValidationGameIds.has(gameId));
  if (!allValidationGamesScoredExactlyOnce) {
    throw new Error('walk-forward evaluation did not score each validation game exactly once.');
  }
  const totalValidationGameCount = expectedValidationGameIds.size;
  const aggregateCandidates = scenarioCounts.map((scenarioCount) => {
    const candidatesByFold = folds.map((fold) => {
      const candidate = fold.candidates.find((value) => value.scenarioCount === scenarioCount);
      if (candidate === undefined) {
        throw new Error(`fold ${fold.foldIndex} is missing K=${scenarioCount}.`);
      }
      return { fold, candidate, rank: candidate.rank };
    });
    return weightedAggregate(candidatesByFold, scenarioCount, totalValidationGameCount);
  });
  aggregateCandidates.sort(
    (left, right) =>
      left.validation.jointLogLoss - right.validation.jointLogLoss ||
      left.scenarioCount - right.scenarioCount ||
      left.candidateId.localeCompare(right.candidateId),
  );
  const selectedCandidate = aggregateCandidates[0];
  const independenceBaseline = aggregateCandidates.find(
    (candidate) => candidate.scenarioCount === 1,
  );
  const bestSharedScenarioCandidate = aggregateCandidates.find(
    (candidate) => candidate.scenarioCount > 1,
  );
  const walkForwardSupportsSharedScenarios =
    selectedCandidate.scenarioCount > 1 &&
    selectedCandidate.validation.jointLogLoss < independenceBaseline.validation.jointLogLoss;
  const evaluation = {
    walkForwardVersion: 1,
    purpose:
      'Daily expanding-window walk-forward evaluation of latent shared offensive-environment scenario counts, with every validation game scored exactly once and K=1 retained as the independence baseline.',
    status: 'benchmark-only-not-production-validated',
    activeSeason: dataset.activeSeason,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: datasetFileSha,
    sourceEvaluationSha256: sourceEvaluation.evaluationSha256,
    sourceEvaluationFileSha256: evaluationFileSha,
    candidateScenarioCounts: Object.freeze(scenarioCounts),
    fitWindow: Object.freeze({
      startDate: dataset.periods.fit.startDate,
      endDate: dataset.periods.fit.endDate,
      initialGameCount: dataset.periods.fit.rowCount / 2,
    }),
    validationWindow: Object.freeze({
      startDate: dataset.periods.validation.startDate,
      endDate: dataset.periods.validation.endDate,
    }),
    foldCount: folds.length,
    validationGameCount: totalValidationGameCount,
    folds: Object.freeze(folds),
    aggregateCandidates: Object.freeze(aggregateCandidates),
    selectedCandidate,
    independenceBaseline,
    bestSharedScenarioCandidate,
    walkForwardSupportsSharedScenarios,
    sourceSelectionAgreement:
      selectedCandidate.scenarioCount === sourceEvaluation.selectedCandidate.scenarioCount,
    allValidationGamesScoredExactlyOnce,
    untouchedTestReservation: dataset.untouchedTestReservation,
    untouchedTestRowsRead: false,
  };
  return Object.freeze({
    ...evaluation,
    walkForwardSha256: sha256(JSON.stringify(walkForwardIdentity(evaluation))),
  });
}

export function verifyM8SharedOffensiveEnvironmentWalkForward(rawEvaluation) {
  const evaluation = assertObject(rawEvaluation, 'shared-environment walk-forward evaluation');
  if (evaluation.walkForwardVersion !== 1) {
    throw new Error('unsupported shared-environment walk-forward version.');
  }
  if (
    evaluation.untouchedTestReservation?.rowsIncluded !== false ||
    evaluation.untouchedTestRowsRead !== false ||
    Object.hasOwn(evaluation.untouchedTestReservation ?? {}, 'rows')
  ) {
    throw new Error('walk-forward evaluation must keep untouched-test rows sealed.');
  }
  const folds = assertArray(evaluation.folds, 'folds');
  if (folds.length !== assertPositiveInteger(evaluation.foldCount, 'foldCount')) {
    throw new Error('walk-forward fold count drifted.');
  }
  let scoredGames = 0;
  const seenGameIds = new Set();
  for (const fold of folds) {
    if (fold.fitEndDate >= fold.validationDate) {
      throw new Error(`fold ${fold.foldIndex} leaks validation chronology.`);
    }
    scoredGames += assertPositiveInteger(
      fold.validationGameCount,
      `fold ${fold.foldIndex} validationGameCount`,
    );
    for (const gameId of assertArray(fold.validationGameIds, 'validationGameIds')) {
      assertPositiveInteger(gameId, 'validation gameId');
      if (seenGameIds.has(gameId)) {
        throw new Error(`validation game ${gameId} appears in multiple folds.`);
      }
      seenGameIds.add(gameId);
    }
    for (const candidate of assertArray(fold.candidates, 'fold candidates')) {
      assertFiniteNumber(candidate.validation.jointLogLoss, 'fold validation joint log loss');
      if (Math.abs(candidate.scenarioWeightSum - 1) > 1e-12) {
        throw new Error(`${candidate.candidateId} fold scenario weights do not sum to one.`);
      }
    }
  }
  if (
    scoredGames !== assertPositiveInteger(evaluation.validationGameCount, 'validationGameCount') ||
    seenGameIds.size !== evaluation.validationGameCount ||
    evaluation.allValidationGamesScoredExactlyOnce !== true
  ) {
    throw new Error('walk-forward validation game accounting failed.');
  }
  const aggregateCandidates = assertArray(
    evaluation.aggregateCandidates,
    'aggregateCandidates',
  );
  if (!aggregateCandidates.some((candidate) => candidate.scenarioCount === 1)) {
    throw new Error('walk-forward evaluation must contain the K=1 baseline.');
  }
  for (const candidate of aggregateCandidates) {
    assertPositiveInteger(candidate.scenarioCount, `${candidate.candidateId}.scenarioCount`);
    assertFiniteNumber(
      candidate.validation.jointLogLoss,
      `${candidate.candidateId}.jointLogLoss`,
    );
  }
  const expectedSha = sha256(JSON.stringify(walkForwardIdentity(evaluation)));
  if (assertSha256(evaluation.walkForwardSha256, 'walkForwardSha256') !== expectedSha) {
    throw new Error('shared-environment walk-forward SHA-256 is invalid.');
  }
  return evaluation;
}
