import { createHash } from 'node:crypto';

import {
  DEFAULT_M8_PA_SURVIVAL_CANDIDATES,
  evaluateM8PaSurvivalCandidates,
} from './m8-pa-survival-evaluation-utils.mjs';

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

function assertFiniteMetric(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
  return value;
}

function validateRows(rawPeriod, periodId, activeSeason, seenRowIds) {
  const period = assertObject(rawPeriod, `periods.${periodId}`);
  const rows = assertArray(period.rows, `periods.${periodId}.rows`);
  if (
    assertNonNegativeInteger(period.rowCount, `periods.${periodId}.rowCount`) !==
    rows.length
  ) {
    throw new Error(`${periodId} rowCount does not match rows.`);
  }

  const validated = rows.map((rawRow, index) => {
    const row = assertObject(rawRow, `${periodId} row ${index}`);
    const rowId = assertNonEmptyString(row.rowId, `${periodId} row ${index}.rowId`);
    if (seenRowIds.has(rowId)) {
      throw new Error(`duplicate PA-survival row ${rowId}.`);
    }
    seenRowIds.add(rowId);
    const observedDate = assertNonEmptyString(row.observedDate, `${rowId}.observedDate`);
    if (!observedDate.startsWith(`${activeSeason}-`)) {
      throw new Error(`${rowId} is outside active season ${activeSeason}.`);
    }
    if (row.periodId !== periodId) {
      throw new Error(`${rowId} periodId does not match ${periodId}.`);
    }
    const gameId = assertPositiveInteger(
      row.gameId,
      `${rowId}.gameId`,
    );
    const side = assertNonEmptyString(
      row.side,
      `${rowId}.side`,
    );
    const lineupSlot = assertPositiveInteger(
      row.lineupSlot,
      `${rowId}.lineupSlot`,
    );
    const playerId = assertPositiveInteger(
      row.playerId,
      `${rowId}.playerId`,
    );
    return Object.freeze({
      ...row,
      rowId,
      observedDate,
      periodId,
      gameId,
      side,
      lineupSlot,
      playerId,
    });
  });

  const ordered = validated.slice().sort(
    (left, right) =>
      left.observedDate.localeCompare(right.observedDate) ||
      left.gameId - right.gameId ||
      left.side.localeCompare(right.side) ||
      left.lineupSlot - right.lineupSlot ||
      left.playerId - right.playerId,
  );
  if (validated.some((row, index) => row.rowId !== ordered[index].rowId)) {
    throw new Error(`${periodId} rows must be chronologically ordered.`);
  }
  return Object.freeze(validated);
}

function validateSourceDataset(rawDataset, datasetFileSha256) {
  const dataset = assertObject(rawDataset, 'PA-survival dataset');
  if (dataset.datasetVersion !== 1 || dataset.provider !== 'BALLDONTLIE MLB API') {
    throw new Error('unsupported PA-survival dataset contract.');
  }
  const activeSeason = assertPositiveInteger(dataset.activeSeason, 'activeSeason');
  const datasetSha256 = assertSha256(dataset.datasetSha256, 'datasetSha256');
  assertSha256(datasetFileSha256, 'datasetFileSha256');
  const untouched = assertObject(
    dataset.untouchedTestReservation,
    'untouchedTestReservation',
  );
  if (untouched.rowsIncluded !== false || Object.hasOwn(untouched, 'rows')) {
    throw new Error('untouched-test rows must remain excluded.');
  }
  if (
    dataset.exclusionPolicy?.componentArithmeticFallback !== 'prohibited' ||
    dataset.exclusionPolicy?.componentArithmeticMismatch !==
      'retain-direct-stats.plate_appearances-and-preserve-audit-flag'
  ) {
    throw new Error('source dataset does not preserve the direct-PA authority boundary.');
  }

  const seenRowIds = new Set();
  const fit = validateRows(dataset.periods?.fit, 'fit', activeSeason, seenRowIds);
  const validation = validateRows(
    dataset.periods?.validation,
    'validation',
    activeSeason,
    seenRowIds,
  );
  if (fit.length === 0 || validation.length === 0) {
    throw new Error('fit and validation periods must both contain observations.');
  }
  const fitEndDate = fit.at(-1).observedDate;
  const validationStartDate = validation[0].observedDate;
  if (fitEndDate >= validationStartDate) {
    throw new Error('fit and validation periods must be strictly chronological.');
  }

  const validationDates = Object.freeze([
    ...new Set(validation.map((row) => row.observedDate)),
  ].sort((left, right) => left.localeCompare(right)));
  if (validationDates.length < 2) {
    throw new Error('walk-forward evaluation requires at least two validation dates.');
  }

  return Object.freeze({
    dataset,
    activeSeason,
    datasetSha256,
    datasetFileSha256,
    fit,
    validation,
    validationDates,
    untouchedTestReservation: Object.freeze({ ...untouched, rowsIncluded: false }),
  });
}

function buildFoldDataset({ source, trainingRows, validationRows, validationDate }) {
  const trainingEndDate = trainingRows.at(-1)?.observedDate;
  if (trainingEndDate === undefined || !(trainingEndDate < validationDate)) {
    throw new Error(`fold ${validationDate} training must end before validation.`);
  }
  if (trainingRows.some((row) => row.observedDate >= validationDate)) {
    throw new Error(`fold ${validationDate} contains future training rows.`);
  }
  if (validationRows.some((row) => row.observedDate !== validationDate)) {
    throw new Error(`fold ${validationDate} contains rows from another date.`);
  }

  const foldFitRows = trainingRows.map((row) => ({ ...row, periodId: 'fit' }));
  const foldValidationRows = validationRows.map((row) => ({
    ...row,
    periodId: 'validation',
  }));
  const identity = {
    datasetVersion: 1,
    provider: source.dataset.provider,
    activeSeason: source.activeSeason,
    sourceCaptureManifestSha256: source.dataset.sourceCaptureManifestSha256,
    sourceCapturePlanSha256: source.dataset.sourceCapturePlanSha256,
    sourceResolvedDatasetSha256: source.dataset.sourceResolvedDatasetSha256,
    includedPeriods: Object.freeze(['fit', 'validation']),
    untouchedTestReservation: source.untouchedTestReservation,
    exclusionPolicy: source.dataset.exclusionPolicy,
    totals: {
      includedObservationCount: foldFitRows.length + foldValidationRows.length,
    },
    periods: {
      fit: {
        rowCount: foldFitRows.length,
        rows: foldFitRows,
      },
      validation: {
        rowCount: foldValidationRows.length,
        rows: foldValidationRows,
      },
    },
  };
  return Object.freeze({
    purpose: `Expanding PA-survival walk-forward fold for ${validationDate}.`,
    ...identity,
    datasetSha256: sha256(JSON.stringify(identity)),
  });
}

function aggregateCandidateResults(candidateMetadata, folds) {
  return Object.freeze(
    candidateMetadata.map((candidate) => {
      let validationObservationCount = 0;
      let logLossTotal = 0;
      let brierTotal = 0;
      let actualProbabilityMinimum = 1;
      let actualProbabilityMaximum = 0;
      let foldWinCount = 0;
      let foldRankTotal = 0;

      for (const fold of folds) {
        const rankIndex = fold.candidateSummaries.findIndex(
          (result) => result.candidateId === candidate.candidateId,
        );
        if (rankIndex < 0) {
          throw new Error(
            `fold ${fold.validationDate} is missing candidate ${candidate.candidateId}.`,
          );
        }
        const result = fold.candidateSummaries[rankIndex];
        const count = assertPositiveInteger(
          result.validationObservationCount,
          `${candidate.candidateId} fold validationObservationCount`,
        );
        validationObservationCount += count;
        logLossTotal += assertFiniteMetric(
          result.logLoss,
          `${candidate.candidateId} fold logLoss`,
        ) * count;
        brierTotal += assertFiniteMetric(
          result.multiclassBrier,
          `${candidate.candidateId} fold multiclassBrier`,
        ) * count;
        actualProbabilityMinimum = Math.min(
          actualProbabilityMinimum,
          result.actualProbabilityMinimum,
        );
        actualProbabilityMaximum = Math.max(
          actualProbabilityMaximum,
          result.actualProbabilityMaximum,
        );
        foldRankTotal += rankIndex + 1;
        if (fold.selectedCandidateId === candidate.candidateId) {
          foldWinCount += 1;
        }
      }

      if (validationObservationCount === 0) {
        throw new Error(`${candidate.candidateId} has no walk-forward observations.`);
      }
      return Object.freeze({
        candidateId: candidate.candidateId,
        grouping: candidate.grouping,
        leagueEquivalentObservations: candidate.leagueEquivalentObservations,
        validationObservationCount,
        logLoss: logLossTotal / validationObservationCount,
        multiclassBrier: brierTotal / validationObservationCount,
        actualProbabilityMinimum,
        actualProbabilityMaximum,
        foldWinCount,
        meanFoldRank: foldRankTotal / folds.length,
      });
    }),
  );
}

function bestByGrouping(results) {
  return Object.fromEntries(
    ['league', 'slot', 'home-away', 'slot-home-away'].map((grouping) => {
      const result = results.find((candidate) => candidate.grouping === grouping) ?? null;
      return [
        grouping,
        result === null
          ? null
          : {
              candidateId: result.candidateId,
              logLoss: result.logLoss,
              multiclassBrier: result.multiclassBrier,
              foldWinCount: result.foldWinCount,
              meanFoldRank: result.meanFoldRank,
            },
      ];
    }),
  );
}

function countSelections(folds, keyBuilder) {
  const counts = new Map();
  for (const fold of folds) {
    const key = keyBuilder(fold);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.freeze(
    Object.fromEntries(
      [...counts.entries()].sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
      ),
    ),
  );
}

export function evaluateM8PaSurvivalWalkForward({
  rawDataset,
  datasetFileSha256,
  candidates = DEFAULT_M8_PA_SURVIVAL_CANDIDATES,
  evaluateCandidates = evaluateM8PaSurvivalCandidates,
}) {
  if (typeof evaluateCandidates !== 'function') {
    throw new TypeError('evaluateCandidates must be a function.');
  }
  const source = validateSourceDataset(rawDataset, datasetFileSha256);
  const candidateList = assertArray(candidates, 'candidates');
  if (candidateList.length < 2) {
    throw new RangeError('walk-forward evaluation requires at least two candidates.');
  }
  const sourceEvaluation = evaluateCandidates({
    rawDataset: source.dataset,
    datasetFileSha256: source.datasetFileSha256,
    candidates: candidateList,
  });
  const candidateMetadata = assertArray(
    sourceEvaluation.candidateSummaries,
    'source evaluation candidateSummaries',
  ).map((candidate) => Object.freeze({
    candidateId: assertNonEmptyString(candidate.candidateId, 'candidateId'),
    grouping: assertNonEmptyString(candidate.grouping, 'candidate grouping'),
    leagueEquivalentObservations: candidate.leagueEquivalentObservations,
  }));
  if (candidateMetadata.length !== candidateList.length) {
    throw new Error('source evaluation candidate count drifted.');
  }

  const folds = [];
  const trainingRows = [...source.fit];
  for (const [index, validationDate] of source.validationDates.entries()) {
    const foldValidationRows = source.validation.filter(
      (row) => row.observedDate === validationDate,
    );
    const foldDataset = buildFoldDataset({
      source,
      trainingRows: [...trainingRows],
      validationRows: foldValidationRows,
      validationDate,
    });
    const foldText = JSON.stringify(foldDataset);
    const evaluation = evaluateCandidates({
      rawDataset: foldDataset,
      datasetFileSha256: sha256(foldText),
      candidates: candidateList,
    });
    if (evaluation.validationObservationCount !== foldValidationRows.length) {
      throw new Error(`fold ${validationDate} validation cohort drifted.`);
    }
    const candidateSummaries = assertArray(
      evaluation.candidateSummaries,
      `fold ${validationDate} candidateSummaries`,
    );
    if (candidateSummaries.length !== candidateMetadata.length) {
      throw new Error(`fold ${validationDate} candidate count drifted.`);
    }
    folds.push(Object.freeze({
      foldNumber: index + 1,
      validationDate,
      trainingStartDate: trainingRows[0].observedDate,
      trainingEndDate: trainingRows.at(-1).observedDate,
      trainingObservationCount: trainingRows.length,
      validationObservationCount: foldValidationRows.length,
      validationObservationIdsSha256: sha256(
        JSON.stringify(foldValidationRows.map((row) => row.rowId)),
      ),
      selectedCandidateId: evaluation.selectedCandidateId,
      selectedGrouping: candidateMetadata.find(
        (candidate) => candidate.candidateId === evaluation.selectedCandidateId,
      )?.grouping ?? null,
      candidateSummaries: Object.freeze(candidateSummaries),
      evaluationSha256: assertSha256(
        evaluation.evaluationSha256,
        `fold ${validationDate} evaluationSha256`,
      ),
    }));
    trainingRows.push(...foldValidationRows);
    trainingRows.sort(
      (left, right) =>
        left.observedDate.localeCompare(right.observedDate) ||
        left.rowId.localeCompare(right.rowId),
    );
  }

  const aggregateValidationObservationCount = folds.reduce(
    (total, fold) => total + fold.validationObservationCount,
    0,
  );
  if (aggregateValidationObservationCount !== source.validation.length) {
    throw new Error('walk-forward validation observation conservation failed.');
  }

  const aggregateResults = aggregateCandidateResults(candidateMetadata, folds)
    .slice()
    .sort(
      (left, right) =>
        left.logLoss - right.logLoss ||
        left.multiclassBrier - right.multiclassBrier ||
        left.candidateId.localeCompare(right.candidateId),
    );
  if (
    aggregateResults.some(
      (result) => result.validationObservationCount !== source.validation.length,
    )
  ) {
    throw new Error('walk-forward candidates did not use an identical cohort.');
  }

  const selected = aggregateResults[0];
  const grouped = bestByGrouping(aggregateResults);
  const league = grouped.league;
  const slot = grouped.slot;
  const slotHomeAway = grouped['slot-home-away'];
  const comparisons = {
    bestSlotVersusLeague:
      league === null || slot === null
        ? null
        : {
            logLossImprovement: league.logLoss - slot.logLoss,
            brierImprovement: league.multiclassBrier - slot.multiclassBrier,
          },
    bestSlotHomeAwayVersusBestSlot:
      slot === null || slotHomeAway === null
        ? null
        : {
            logLossImprovement: slot.logLoss - slotHomeAway.logLoss,
            brierImprovement: slot.multiclassBrier - slotHomeAway.multiclassBrier,
          },
  };
  const selectedCandidateCounts = countSelections(
    folds,
    (fold) => fold.selectedCandidateId,
  );
  const selectedGroupingCounts = countSelections(
    folds,
    (fold) => fold.selectedGrouping ?? 'unknown',
  );
  const identity = {
    walkForwardVersion: 1,
    activeSeason: source.activeSeason,
    sourceDatasetSha256: source.datasetSha256,
    sourceDatasetFileSha256: source.datasetFileSha256,
    sourceHoldoutEvaluationSha256: assertSha256(
      sourceEvaluation.evaluationSha256,
      'source holdout evaluationSha256',
    ),
    sourceHoldoutSelectedCandidateId: sourceEvaluation.selectedCandidateId,
    validationWindow: Object.freeze({
      startDate: source.validation[0].observedDate,
      endDate: source.validation.at(-1).observedDate,
    }),
    foldCount: folds.length,
    aggregateValidationObservationCount,
    validationObservationIdsSha256: sha256(
      JSON.stringify(source.validation.map((row) => row.rowId)),
    ),
    candidates: Object.freeze(candidateMetadata),
    folds: Object.freeze(folds),
    aggregateResults: Object.freeze(aggregateResults),
    selectionRule:
      'aggregate expanding-fold log loss ascending, multiclass Brier ascending, candidate ID ascending',
    selectedCandidateId: selected.candidateId,
    selectedCandidateCounts,
    selectedGroupingCounts,
    bestByGrouping: grouped,
    comparisons,
    rawCurvesMonotoneByConstruction: true,
    fittedCurvesMonotoneByConstruction: true,
    monotoneProjectionApplied: false,
    untouchedTestReservation: source.untouchedTestReservation,
  };
  return Object.freeze({
    purpose:
      'Expanding daily current-season walk-forward validation of hitter PA-count grouping and pooling candidates using only earlier observations.',
    ...identity,
    walkForwardSha256: sha256(JSON.stringify(identity)),
  });
}
