import { readFile } from 'node:fs/promises';

import {
  evaluateCoherentCategoricalMatchupCandidates,
} from './m8-coherent-categorical-matchup-utils.mjs';
import {
  evaluateResolvedCategoricalModel,
} from './m8-resolved-categorical-model-evaluation-utils.mjs';
import { sha256 } from './provider-probe-utils.mjs';

const TOLERANCE = 1e-12;
const INCLUDED_PERIODS = Object.freeze(['fit', 'validation']);

function assertPlainObject(value, label) {
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

function assertPositiveFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`);
  }
  return value;
}

function assertInteger(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer.`);
  }
  return value;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function sourceObservation(row, periodId, index, modeledCategorySet) {
  const label = `periods.${periodId}.rows[${index}]`;
  const value = assertPlainObject(row, label);
  if (value.mappingStatus !== 'classified-terminal') return null;
  if (value.includedInOverallOutcomeModel !== true) {
    throw new Error(`${label} classified terminal row must be overall eligible.`);
  }
  const terminalCategory = assertNonEmptyString(
    value.terminalCategory,
    `${label}.terminalCategory`,
  );
  if (!modeledCategorySet.has(terminalCategory)) {
    throw new Error(`${label} contains a non-modeled terminal category.`);
  }
  return Object.freeze({
    observationId: assertNonEmptyString(value.rowId, `${label}.rowId`),
    observedDate: assertNonEmptyString(value.observedDate, `${label}.observedDate`),
    providerBatterId: assertInteger(
      value.providerBatterId,
      `${label}.providerBatterId`,
    ),
    providerPitcherId: assertInteger(
      value.providerPitcherId,
      `${label}.providerPitcherId`,
    ),
    terminalCategory,
  });
}

function extractObservations(dataset, fixedEvaluation) {
  const modeledCategories = assertArray(
    fixedEvaluation.canonicalVectorPolicy?.modeledCategories,
    'fixed evaluation modeledCategories',
  ).map((category, index) =>
    assertNonEmptyString(category, `fixed evaluation modeledCategories[${index}]`),
  );
  const modeledCategorySet = new Set(modeledCategories);
  const periods = assertPlainObject(dataset.periods, 'dataset periods');
  const result = {};
  const seen = new Set();

  for (const periodId of INCLUDED_PERIODS) {
    const period = assertPlainObject(periods[periodId], `periods.${periodId}`);
    const rows = assertArray(period.rows, `periods.${periodId}.rows`);
    const observations = [];
    for (const [index, row] of rows.entries()) {
      const observation = sourceObservation(
        row,
        periodId,
        index,
        modeledCategorySet,
      );
      if (observation === null) continue;
      if (seen.has(observation.observationId)) {
        throw new Error(
          `duplicate observation identity across fit-validation periods: ${observation.observationId}.`,
        );
      }
      seen.add(observation.observationId);
      observations.push(observation);
    }
    const expectedCount = assertInteger(
      period.classifiedTerminalCount,
      `periods.${periodId}.classifiedTerminalCount`,
    );
    if (observations.length !== expectedCount) {
      throw new Error(`${periodId} classified terminal count drifted.`);
    }
    result[periodId] = Object.freeze(observations);
  }

  const matchup = assertPlainObject(
    fixedEvaluation.coherentMatchup,
    'fixed evaluation coherentMatchup',
  );
  if (
    result.fit.length !== matchup.fitObservationCount ||
    result.validation.length !== matchup.validationObservationCount
  ) {
    throw new Error('fixed evaluation observation counts drifted from the source dataset.');
  }
  const validationIdsSha256 = sha256(
    JSON.stringify(result.validation.map((observation) => observation.observationId)),
  );
  if (validationIdsSha256 !== matchup.validationObservationIdsSha256) {
    throw new Error('fixed evaluation validation cohort drifted from the source dataset.');
  }

  return Object.freeze({
    modeledCategories: Object.freeze(modeledCategories),
    fit: result.fit,
    validation: result.validation,
  });
}

function validationDates(observations) {
  return Object.freeze(
    [...new Set(observations.map((observation) => observation.observedDate))].sort(
      (left, right) => left.localeCompare(right),
    ),
  );
}

function selectCandidate(results) {
  const sorted = [...results].sort(
    (left, right) =>
      left.validationCategoricalLogLoss - right.validationCategoricalLogLoss ||
      left.candidate.batterCoefficient + left.candidate.pitcherAllowedCoefficient -
        (right.candidate.batterCoefficient +
          right.candidate.pitcherAllowedCoefficient) ||
      left.candidate.candidateId.localeCompare(right.candidate.candidateId),
  );
  const best = sorted[0];
  const second = sorted[1];
  if (!best || !second) {
    throw new Error('walk-forward selection requires at least two candidates.');
  }
  if (
    Math.abs(
      second.validationCategoricalLogLoss - best.validationCategoricalLogLoss,
    ) <= TOLERANCE
  ) {
    return Object.freeze({
      status: 'ambiguous-validation-result',
      selectedCandidate: null,
    });
  }
  return Object.freeze({
    status: 'validation-candidate-selected',
    selectedCandidate: best.candidate,
    validationCategoricalLogLoss: best.validationCategoricalLogLoss,
    validationCategoricalBrierScore: best.validationCategoricalBrierScore,
    validationHitLogLoss: best.validationHitLogLoss,
    validationHitBrierScore: best.validationHitBrierScore,
  });
}

function aggregateCandidateResults(candidates, folds) {
  return Object.freeze(
    candidates.map((candidate) => {
      let validationObservationCount = 0;
      let categoricalLogLossTotal = 0;
      let categoricalBrierTotal = 0;
      let hitLogLossTotal = 0;
      let hitBrierTotal = 0;
      let actualProbabilityMinimum = 1;
      let actualProbabilityMaximum = 0;
      let hitProbabilityMinimum = 1;
      let hitProbabilityMaximum = 0;

      for (const fold of folds) {
        const result = fold.results.find(
          (entry) => entry.candidate.candidateId === candidate.candidateId,
        );
        if (!result) {
          throw new Error(
            `walk-forward fold ${fold.validationDate} is missing candidate ${candidate.candidateId}.`,
          );
        }
        const count = result.validationObservationCount;
        validationObservationCount += count;
        categoricalLogLossTotal += result.validationCategoricalLogLoss * count;
        categoricalBrierTotal += result.validationCategoricalBrierScore * count;
        hitLogLossTotal += result.validationHitLogLoss * count;
        hitBrierTotal += result.validationHitBrierScore * count;
        actualProbabilityMinimum = Math.min(
          actualProbabilityMinimum,
          result.actualProbabilityMinimum,
        );
        actualProbabilityMaximum = Math.max(
          actualProbabilityMaximum,
          result.actualProbabilityMaximum,
        );
        hitProbabilityMinimum = Math.min(
          hitProbabilityMinimum,
          result.hitProbabilityMinimum,
        );
        hitProbabilityMaximum = Math.max(
          hitProbabilityMaximum,
          result.hitProbabilityMaximum,
        );
      }

      if (validationObservationCount === 0) {
        throw new Error(
          `walk-forward candidate ${candidate.candidateId} has no observations.`,
        );
      }
      return Object.freeze({
        candidate,
        validationObservationCount,
        validationCategoricalLogLoss:
          categoricalLogLossTotal / validationObservationCount,
        validationCategoricalBrierScore:
          categoricalBrierTotal / validationObservationCount,
        validationHitLogLoss: hitLogLossTotal / validationObservationCount,
        validationHitBrierScore: hitBrierTotal / validationObservationCount,
        actualProbabilityMinimum,
        actualProbabilityMaximum,
        hitProbabilityMinimum,
        hitProbabilityMaximum,
      });
    }),
  );
}

function rankCandidates(results) {
  return [...results].sort(
    (left, right) =>
      left.validationCategoricalLogLoss - right.validationCategoricalLogLoss ||
      left.candidate.batterCoefficient + left.candidate.pitcherAllowedCoefficient -
        (right.candidate.batterCoefficient +
          right.candidate.pitcherAllowedCoefficient) ||
      left.candidate.candidateId.localeCompare(right.candidate.candidateId),
  );
}

function candidateSummary(results, candidateId) {
  const ranked = rankCandidates(results);
  const index = ranked.findIndex(
    (result) => result.candidate.candidateId === candidateId,
  );
  if (index < 0) {
    throw new Error(`candidate ${candidateId} is missing from aggregate results.`);
  }
  return Object.freeze({
    rank: index + 1,
    result: ranked[index],
  });
}

function countFoldSelections(folds) {
  const counts = {};
  for (const fold of folds) {
    const selectedId =
      fold.selection.selectedCandidate?.candidateId ?? 'ambiguous-selection';
    counts[selectedId] = (counts[selectedId] ?? 0) + 1;
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(counts).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

function validateFixedArtifact(actual, expected) {
  const fixed = assertPlainObject(actual, 'fixed resolved categorical evaluation');
  if (fixed.evaluationVersion !== 1) {
    throw new Error('fixed evaluationVersion must equal 1.');
  }
  if (fixed.evaluationSha256 !== expected.evaluationSha256) {
    throw new Error('fixed evaluation SHA-256 drifted from deterministic re-evaluation.');
  }
  if (JSON.stringify(fixed) !== JSON.stringify(expected)) {
    throw new Error('fixed evaluation content drifted from deterministic re-evaluation.');
  }
  if (fixed.coherentStatus !== 'coherent-matchup-evaluated') {
    throw new Error('fixed evaluation must contain a completed coherent matchup.');
  }
  if (fixed.untouchedTestReservation?.rowsIncluded !== false) {
    throw new Error('fixed evaluation must keep untouched-test rows sealed.');
  }
  return fixed;
}

function validateFinitePoolingStrength(fixed, parameterKey) {
  const parameter = assertPlainObject(
    fixed.poolingBoundary?.[parameterKey],
    `fixed poolingBoundary.${parameterKey}`,
  );
  if (parameter.selection?.status !== 'finite-pooling-candidate-selected') {
    throw new Error(`${parameterKey} pooling selection must be finite.`);
  }
  return assertPositiveFinite(
    parameter.selection.selectedCandidate?.leagueEquivalentPa,
    `${parameterKey} leagueEquivalentPa`,
  );
}

export function evaluateResolvedCategoricalWalkForward({
  dataset,
  datasetText,
  fixedEvaluation,
  fixedEvaluationText,
  canonicalCategories,
  hitCategories,
}) {
  const sourceText = assertNonEmptyString(datasetText, 'datasetText');
  const fixedText = assertNonEmptyString(
    fixedEvaluationText,
    'fixedEvaluationText',
  );
  const expectedFixed = evaluateResolvedCategoricalModel({
    dataset,
    datasetText: sourceText,
    canonicalCategories,
    hitCategories,
  });
  const fixed = validateFixedArtifact(fixedEvaluation, expectedFixed);
  if (sha256(fixedText) !== sha256(JSON.stringify(fixedEvaluation))) {
    const reparsed = parseJson(fixedText, 'fixedEvaluationText');
    if (JSON.stringify(reparsed) !== JSON.stringify(fixedEvaluation)) {
      throw new Error('fixed evaluation text does not match the supplied artifact.');
    }
  }

  const observations = extractObservations(dataset, fixed);
  const dates = validationDates(observations.validation);
  if (dates.length < 2) {
    throw new Error('walk-forward evaluation requires at least two validation dates.');
  }

  const fixedMatchup = assertPlainObject(
    fixed.coherentMatchup,
    'fixed coherentMatchup',
  );
  const candidates = assertArray(
    fixedMatchup.candidates,
    'fixed coherent candidates',
  );
  const fixedSelectedCandidate = assertPlainObject(
    fixedMatchup.selection?.selectedCandidate,
    'fixed selected candidate',
  );
  const fixedSelectedCandidateId = assertNonEmptyString(
    fixedSelectedCandidate.candidateId,
    'fixed selected candidateId',
  );
  const leagueOnlyCandidateId = 'batter-0.00-pitcher-0.00';
  if (
    !candidates.some(
      (candidate) => candidate.candidateId === leagueOnlyCandidateId,
    )
  ) {
    throw new Error('coherent candidate grid must contain the league-only 0/0 candidate.');
  }

  const batterLeagueEquivalentPa = validateFinitePoolingStrength(
    fixed,
    'batter',
  );
  const pitcherAllowedLeagueEquivalentPa = validateFinitePoolingStrength(
    fixed,
    'pitcherAllowed',
  );
  const folds = [];
  const trainingObservations = [...observations.fit];

  for (const [index, validationDate] of dates.entries()) {
    if (
      trainingObservations.some(
        (observation) => observation.observedDate >= validationDate,
      )
    ) {
      throw new Error(`walk-forward fold ${validationDate} contains future training rows.`);
    }
    const foldValidation = observations.validation.filter(
      (observation) => observation.observedDate === validationDate,
    );
    if (foldValidation.length === 0) {
      throw new Error(`walk-forward fold ${validationDate} has no observations.`);
    }
    const evaluation = evaluateCoherentCategoricalMatchupCandidates({
      categories: observations.modeledCategories,
      hitCategories,
      fitObservations: Object.freeze([...trainingObservations]),
      validationObservations: Object.freeze(foldValidation),
      batterLeagueEquivalentPa,
      pitcherAllowedLeagueEquivalentPa,
      candidates,
    });
    folds.push(
      Object.freeze({
        foldNumber: index + 1,
        validationDate,
        trainingStartDate: trainingObservations[0].observedDate,
        trainingEndDate: trainingObservations.at(-1).observedDate,
        trainingObservationCount: trainingObservations.length,
        validationObservationCount: foldValidation.length,
        validationObservationIdsSha256:
          evaluation.validationObservationIdsSha256,
        results: evaluation.results,
        selection: evaluation.selection,
      }),
    );
    trainingObservations.push(...foldValidation);
  }

  const aggregateResults = aggregateCandidateResults(candidates, folds);
  const aggregateObservationCount = aggregateResults[0].validationObservationCount;
  if (
    aggregateResults.some(
      (result) => result.validationObservationCount !== aggregateObservationCount,
    ) ||
    aggregateObservationCount !== observations.validation.length
  ) {
    throw new Error('walk-forward candidates did not use one identical aggregate cohort.');
  }

  const aggregateSelection = selectCandidate(aggregateResults);
  const fixedCandidateSummary = candidateSummary(
    aggregateResults,
    fixedSelectedCandidateId,
  );
  const leagueOnlySummary = candidateSummary(
    aggregateResults,
    leagueOnlyCandidateId,
  );
  const aggregateSelectedId =
    aggregateSelection.selectedCandidate?.candidateId ?? null;
  const aggregateSelectedSummary =
    aggregateSelectedId === null
      ? null
      : candidateSummary(aggregateResults, aggregateSelectedId);
  const foldSelectionCounts = countFoldSelections(folds);
  const sameAsFixedHoldoutSelectionCount =
    foldSelectionCounts[fixedSelectedCandidateId] ?? 0;

  const stability = Object.freeze({
    fixedHoldoutSelectedCandidate: fixedSelectedCandidate,
    fixedHoldoutCandidateAggregateRank: fixedCandidateSummary.rank,
    fixedHoldoutCandidateAggregateMetrics: fixedCandidateSummary.result,
    leagueOnlyCandidateAggregateRank: leagueOnlySummary.rank,
    leagueOnlyCandidateAggregateMetrics: leagueOnlySummary.result,
    aggregateSelectedCandidate: aggregateSelection.selectedCandidate,
    aggregateSelectedCandidateMetrics:
      aggregateSelectedSummary?.result ?? null,
    aggregateSelectedCandidateRank: aggregateSelectedSummary?.rank ?? null,
    foldSelectionCounts,
    sameAsFixedHoldoutSelectionCount,
    sameAsFixedHoldoutSelectionRate:
      sameAsFixedHoldoutSelectionCount / folds.length,
    fixedHoldoutCategoricalLogLossImprovementVersusLeagueOnly:
      leagueOnlySummary.result.validationCategoricalLogLoss -
      fixedCandidateSummary.result.validationCategoricalLogLoss,
    fixedHoldoutHitLogLossImprovementVersusLeagueOnly:
      leagueOnlySummary.result.validationHitLogLoss -
      fixedCandidateSummary.result.validationHitLogLoss,
  });

  const identity = {
    activeSeason: fixed.activeSeason,
    sourceDatasetSha256: fixed.sourceDatasetSha256,
    sourceDatasetFileSha256: fixed.sourceDatasetFileSha256,
    sourceFixedEvaluationSha256: fixed.evaluationSha256,
    sourceFixedEvaluationFileSha256: sha256(fixedText),
    canonicalCategories: fixed.canonicalVectorPolicy.canonicalCategories,
    modeledCategories: observations.modeledCategories,
    structuralZeroCategories:
      fixed.canonicalVectorPolicy.structuralZeroCategories,
    hitCategories: fixedMatchup.hitCategories,
    poolingStrengths: Object.freeze({
      batterLeagueEquivalentPa,
      pitcherAllowedLeagueEquivalentPa,
    }),
    candidates,
    folds: Object.freeze(folds),
    aggregateResults,
    aggregateSelection,
    stability,
    untouchedTestReservation: fixed.untouchedTestReservation,
  };
  return Object.freeze({
    walkForwardVersion: 1,
    purpose:
      'Evaluate the fixed resolved categorical pooling strengths and coherent batter-pitcher coefficient grid through expanding daily current-season validation folds without accessing the untouched test period.',
    status: 'offline-resolved-categorical-walk-forward-not-production-model',
    ...identity,
    walkForwardSha256: sha256(JSON.stringify(identity)),
  });
}

export async function evaluateM8ResolvedCategoricalWalkForward({
  datasetPath,
  fixedEvaluationPath,
  canonicalCategories,
  hitCategories,
}) {
  const sourcePath = assertNonEmptyString(datasetPath, 'datasetPath');
  const evaluationPath = assertNonEmptyString(
    fixedEvaluationPath,
    'fixedEvaluationPath',
  );
  const [datasetText, fixedEvaluationText] = await Promise.all([
    readFile(sourcePath, 'utf8'),
    readFile(evaluationPath, 'utf8'),
  ]);
  return evaluateResolvedCategoricalWalkForward({
    dataset: parseJson(datasetText, 'M8 resolved categorical dataset'),
    datasetText,
    fixedEvaluation: parseJson(
      fixedEvaluationText,
      'M8 fixed resolved categorical evaluation',
    ),
    fixedEvaluationText,
    canonicalCategories,
    hitCategories,
  });
}
