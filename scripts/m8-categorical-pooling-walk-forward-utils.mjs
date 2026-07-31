import { readFile } from 'node:fs/promises';

import {
  evaluateCategoricalPoolingPath,
} from './m8-categorical-pooling-utils.mjs';
import {
  evaluateResolvedCategoricalModel,
} from './m8-resolved-categorical-model-evaluation-utils.mjs';
import { sha256 } from './provider-probe-utils.mjs';

const LEAGUE_ONLY_CANDIDATE_ID = 'league-only-limit';
const PARAMETER_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: 'batter',
    identityKey: 'providerBatterId',
    parameterId: 'batter-terminal-category-vector',
  }),
  Object.freeze({
    key: 'pitcherAllowed',
    identityKey: 'providerPitcherId',
    parameterId: 'pitcher-allowed-terminal-category-vector',
  }),
]);

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function integer(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer.`);
  }
  return value;
}

function positive(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be positive and finite.`);
  }
  return value;
}

function finiteMetric(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
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

function validateCategories(rawCategories, label) {
  const categories = array(rawCategories, label).map((category, index) =>
    string(category, `${label}[${index}]`),
  );
  if (categories.length < 2 || new Set(categories).size !== categories.length) {
    throw new Error(`${label} must contain at least two unique categories.`);
  }
  return Object.freeze(categories);
}

function candidateId(result, label) {
  return string(result?.candidate?.candidateId, `${label}.candidate.candidateId`);
}

function validateCandidateResults(rawResults, label) {
  const seen = new Set();
  return Object.freeze(
    array(rawResults, label).map((rawResult, index) => {
      const result = object(rawResult, `${label}[${index}]`);
      const id = candidateId(result, `${label}[${index}]`);
      if (seen.has(id)) {
        throw new Error(`${label} contains duplicate candidate ${id}.`);
      }
      seen.add(id);
      finiteMetric(result.validationLogLoss, `${id}.validationLogLoss`);
      finiteMetric(result.validationBrierScore, `${id}.validationBrierScore`);
      return result;
    }),
  );
}

function dominates(left, right) {
  const noWorse =
    left.validationLogLoss <= right.validationLogLoss &&
    left.validationBrierScore <= right.validationBrierScore;
  const strictlyBetter =
    left.validationLogLoss < right.validationLogLoss ||
    left.validationBrierScore < right.validationBrierScore;
  return noWorse && strictlyBetter;
}

export function computeM8CategoricalPoolingNondominatedCandidateIds(rawResults) {
  const results = validateCandidateResults(
    rawResults,
    'categorical pooling candidate results',
  );
  return Object.freeze(
    results
      .filter(
        (candidateResult, candidateIndex) =>
          !results.some(
            (otherResult, otherIndex) =>
              otherIndex !== candidateIndex &&
              dominates(otherResult, candidateResult),
          ),
      )
      .map((result) => result.candidate.candidateId),
  );
}

function poolingStrength(candidate) {
  const value = object(candidate, 'categorical pooling candidate');
  const id = string(value.candidateId, 'categorical pooling candidateId');
  if (id === LEAGUE_ONLY_CANDIDATE_ID) {
    if (value.leagueEquivalentPa !== null) {
      throw new Error('league-only pooling candidate must use null equivalent PA.');
    }
    return Number.POSITIVE_INFINITY;
  }
  return positive(value.leagueEquivalentPa, `${id}.leagueEquivalentPa`);
}

export function selectM8CategoricalPoolingStableCandidate({
  fixedResults,
  walkForwardResults,
}) {
  const fixed = validateCandidateResults(fixedResults, 'fixed pooling results');
  const walk = validateCandidateResults(
    walkForwardResults,
    'walk-forward pooling results',
  );
  const fixedById = new Map(
    fixed.map((result) => [result.candidate.candidateId, result]),
  );
  const walkIds = new Set(
    walk.map((result) => result.candidate.candidateId),
  );
  if (
    fixedById.size !== walkIds.size ||
    [...fixedById.keys()].some((id) => !walkIds.has(id))
  ) {
    throw new Error('fixed and walk-forward pooling candidate sets differ.');
  }
  const fixedNondominatedCandidateIds =
    computeM8CategoricalPoolingNondominatedCandidateIds(fixed);
  const walkForwardNondominatedCandidateIds =
    computeM8CategoricalPoolingNondominatedCandidateIds(walk);
  const walkNondominated = new Set(walkForwardNondominatedCandidateIds);
  const stableCandidateIds = Object.freeze(
    fixedNondominatedCandidateIds.filter((id) => walkNondominated.has(id)),
  );
  const selectedCandidateId =
    [...stableCandidateIds]
      .sort((leftId, rightId) => {
        const leftStrength = poolingStrength(fixedById.get(leftId).candidate);
        const rightStrength = poolingStrength(fixedById.get(rightId).candidate);
        if (leftStrength !== rightStrength) {
          return leftStrength > rightStrength ? -1 : 1;
        }
        return leftId.localeCompare(rightId);
      })[0] ?? null;
  return Object.freeze({
    fixedNondominatedCandidateIds,
    walkForwardNondominatedCandidateIds,
    stableCandidateIds,
    stableSelection: selectedCandidateId !== null,
    selectionReason:
      selectedCandidateId === null ? 'EMPTY_STABLE_INTERSECTION' : null,
    selectedCandidateId,
  });
}

function sourceObservation(rawRow, periodId, index, modeledCategorySet) {
  const label = `periods.${periodId}.rows[${index}]`;
  const row = object(rawRow, label);
  if (row.mappingStatus !== 'classified-terminal') return null;
  if (row.includedInOverallOutcomeModel !== true) {
    throw new Error(`${label} classified terminal row must be overall eligible.`);
  }
  const terminalCategory = string(row.terminalCategory, `${label}.terminalCategory`);
  if (!modeledCategorySet.has(terminalCategory)) {
    throw new Error(`${label} contains a non-modeled terminal category.`);
  }
  return Object.freeze({
    observationId: string(row.rowId, `${label}.rowId`),
    observedDate: string(row.observedDate, `${label}.observedDate`),
    providerBatterId: integer(row.providerBatterId, `${label}.providerBatterId`),
    providerPitcherId: integer(
      row.providerPitcherId,
      `${label}.providerPitcherId`,
    ),
    terminalCategory,
  });
}

function extractObservations(dataset, fixedEvaluation) {
  const categories = validateCategories(
    fixedEvaluation.canonicalVectorPolicy?.modeledCategories,
    'fixed modeledCategories',
  );
  const categorySet = new Set(categories);
  const periods = object(dataset.periods, 'dataset periods');
  const seen = new Set();
  const result = {};
  for (const periodId of ['fit', 'validation']) {
    const period = object(periods[periodId], `periods.${periodId}`);
    const rows = array(period.rows, `periods.${periodId}.rows`);
    const observations = [];
    for (const [index, row] of rows.entries()) {
      const observation = sourceObservation(row, periodId, index, categorySet);
      if (observation === null) continue;
      if (seen.has(observation.observationId)) {
        throw new Error(`duplicate fit-validation observation ${observation.observationId}.`);
      }
      seen.add(observation.observationId);
      observations.push(observation);
    }
    if (observations.length !== period.classifiedTerminalCount) {
      throw new Error(`${periodId} classified terminal count drifted.`);
    }
    result[periodId] = Object.freeze(observations);
  }
  if (result.fit.length === 0 || result.validation.length === 0) {
    throw new Error('pooling walk-forward requires non-empty fit and validation cohorts.');
  }
  return Object.freeze({
    categories,
    fit: result.fit,
    validation: result.validation,
  });
}

function leagueOnlyResult({
  categories,
  trainingObservations,
  validationObservations,
  parameterId,
}) {
  const counts = Object.fromEntries(categories.map((category) => [category, 0]));
  for (const observation of trainingObservations) {
    counts[observation.terminalCategory] += 1;
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total <= 0 || categories.some((category) => counts[category] <= 0)) {
    throw new Error(`${parameterId} league-only fold lacks fit support.`);
  }
  const leagueTarget = Object.freeze(
    Object.fromEntries(
      categories.map((category) => [category, counts[category] / total]),
    ),
  );
  let logLoss = 0;
  let brier = 0;
  let minimum = 1;
  let maximum = 0;
  for (const observation of validationObservations) {
    const probability = leagueTarget[observation.terminalCategory];
    logLoss += -Math.log(probability);
    minimum = Math.min(minimum, probability);
    maximum = Math.max(maximum, probability);
    for (const category of categories) {
      const target = category === observation.terminalCategory ? 1 : 0;
      brier += (leagueTarget[category] - target) ** 2;
    }
  }
  const count = validationObservations.length;
  return Object.freeze({
    candidate: Object.freeze({
      candidateId: LEAGUE_ONLY_CANDIDATE_ID,
      kind: LEAGUE_ONLY_CANDIDATE_ID,
      leagueEquivalentPa: null,
    }),
    validationObservationCount: count,
    validationObservationIdsSha256: sha256(
      JSON.stringify(validationObservations.map((row) => row.observationId)),
    ),
    validationLogLoss: logLoss / count,
    validationBrierScore: brier / count,
    actualProbabilityMinimum: minimum,
    actualProbabilityMaximum: maximum,
  });
}

function finiteCandidates(fixedParameter) {
  return Object.freeze(
    validateCandidateResults(fixedParameter.results, 'fixed parameter results')
      .map((result) => result.candidate)
      .filter((candidate) => candidate.candidateId !== LEAGUE_ONLY_CANDIDATE_ID)
      .map((candidate) =>
        Object.freeze({
          candidateId: string(candidate.candidateId, 'finite candidateId'),
          leagueEquivalentPa: positive(
            candidate.leagueEquivalentPa,
            `${candidate.candidateId}.leagueEquivalentPa`,
          ),
        }),
      ),
  );
}

function aggregateResults(folds, parameterKey) {
  const candidateIds = folds[0][parameterKey].results.map(
    (result) => result.candidate.candidateId,
  );
  return Object.freeze(
    candidateIds.map((id) => {
      let count = 0;
      let logLoss = 0;
      let brier = 0;
      let minimum = 1;
      let maximum = 0;
      let candidate = null;
      for (const fold of folds) {
        const result = fold[parameterKey].results.find(
          (entry) => entry.candidate.candidateId === id,
        );
        if (!result) {
          throw new Error(`pooling fold ${fold.validationDate} is missing ${id}.`);
        }
        candidate ??= result.candidate;
        count += result.validationObservationCount;
        logLoss += result.validationLogLoss * result.validationObservationCount;
        brier += result.validationBrierScore * result.validationObservationCount;
        minimum = Math.min(minimum, result.actualProbabilityMinimum);
        maximum = Math.max(maximum, result.actualProbabilityMaximum);
      }
      return Object.freeze({
        candidate,
        validationObservationCount: count,
        validationLogLoss: logLoss / count,
        validationBrierScore: brier / count,
        actualProbabilityMinimum: minimum,
        actualProbabilityMaximum: maximum,
      });
    }),
  );
}

export function evaluateM8CategoricalPoolingWalkForwardFromObservations({
  categories: rawCategories,
  fitObservations: rawFitObservations,
  validationObservations: rawValidationObservations,
  fixedParameters,
}) {
  const categories = validateCategories(rawCategories, 'categories');
  const fitObservations = array(rawFitObservations, 'fitObservations');
  const validationObservations = array(
    rawValidationObservations,
    'validationObservations',
  );
  const fixed = object(fixedParameters, 'fixedParameters');
  const dates = [...new Set(validationObservations.map((row) => row.observedDate))].sort();
  if (dates.length < 2) {
    throw new Error('pooling walk-forward requires at least two validation dates.');
  }
  const training = [...fitObservations];
  const folds = [];
  for (const validationDate of dates) {
    if (training.some((row) => row.observedDate >= validationDate)) {
      throw new Error(`pooling fold ${validationDate} contains future training rows.`);
    }
    const foldValidation = validationObservations.filter(
      (row) => row.observedDate === validationDate,
    );
    const fold = {
      validationDate,
      trainingStartDate: training[0].observedDate,
      trainingEndDate: training.at(-1).observedDate,
      trainingObservationCount: training.length,
      validationObservationCount: foldValidation.length,
    };
    for (const definition of PARAMETER_DEFINITIONS) {
      const fixedParameter = object(
        fixed[definition.key],
        `fixedParameters.${definition.key}`,
      );
      const finite = evaluateCategoricalPoolingPath({
        categories,
        fitObservations: Object.freeze([...training]),
        validationObservations: Object.freeze(foldValidation),
        identityKey: definition.identityKey,
        parameterId: definition.parameterId,
        candidates: finiteCandidates(fixedParameter),
      });
      fold[definition.key] = Object.freeze({
        results: Object.freeze([
          ...finite.results,
          leagueOnlyResult({
            categories,
            trainingObservations: training,
            validationObservations: foldValidation,
            parameterId: definition.parameterId,
          }),
        ]),
      });
    }
    folds.push(Object.freeze(fold));
    training.push(...foldValidation);
  }

  const parameters = {};
  for (const definition of PARAMETER_DEFINITIONS) {
    const fixedParameter = object(
      fixed[definition.key],
      `fixedParameters.${definition.key}`,
    );
    const fixedResults = validateCandidateResults(
      fixedParameter.results,
      `${definition.key} fixed results`,
    );
    const walkForwardResults = aggregateResults(folds, definition.key);
    const selection = selectM8CategoricalPoolingStableCandidate({
      fixedResults,
      walkForwardResults,
    });
    parameters[definition.key] = Object.freeze({
      parameterId: definition.parameterId,
      identityKey: definition.identityKey,
      fixedMinimumLogLossCandidateId:
        fixedParameter.selection?.selectedCandidate?.candidateId ?? null,
      fixedResults,
      walkForwardResults,
      ...selection,
    });
  }

  const validationCount = folds.reduce(
    (sum, fold) => sum + fold.validationObservationCount,
    0,
  );
  if (validationCount !== validationObservations.length) {
    throw new Error('pooling walk-forward did not conserve the validation cohort.');
  }
  return Object.freeze({
    folds: Object.freeze(folds),
    parameters: Object.freeze(parameters),
    allValidationObservationsScoredExactlyOnce: true,
  });
}

function artifactIdentity(value) {
  return {
    poolingWalkForwardVersion: value.poolingWalkForwardVersion,
    mathSpecVersion: value.mathSpecVersion,
    status: value.status,
    productionEnabled: value.productionEnabled,
    untouchedTestAccessed: value.untouchedTestAccessed,
    activeSeason: value.activeSeason,
    sourceDatasetSha256: value.sourceDatasetSha256,
    sourceDatasetFileSha256: value.sourceDatasetFileSha256,
    sourceFixedEvaluationSha256: value.sourceFixedEvaluationSha256,
    sourceFixedEvaluationFileSha256: value.sourceFixedEvaluationFileSha256,
    categories: value.categories,
    hitCategories: value.hitCategories,
    folds: value.folds,
    parameters: value.parameters,
    allValidationObservationsScoredExactlyOnce:
      value.allValidationObservationsScoredExactlyOnce,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

export function evaluateM8CategoricalPoolingWalkForward({
  rawDataset,
  datasetText,
  rawFixedEvaluation,
  fixedEvaluationText,
  canonicalCategories,
  hitCategories,
}) {
  if (typeof datasetText !== 'string' || datasetText.trim().length === 0) {
    throw new TypeError('datasetText must be a non-empty string.');
  }
  if (
    typeof fixedEvaluationText !== 'string' ||
    fixedEvaluationText.trim().length === 0
  ) {
    throw new TypeError('fixedEvaluationText must be a non-empty string.');
  }
  const dataset = object(rawDataset, 'resolved categorical dataset');
  const fixed = object(rawFixedEvaluation, 'fixed categorical evaluation');
  const expectedFixed = evaluateResolvedCategoricalModel({
    dataset,
    datasetText,
    canonicalCategories,
    hitCategories,
  });
  if (JSON.stringify(fixed) !== JSON.stringify(expectedFixed)) {
    throw new Error('fixed categorical evaluation drifted from deterministic re-evaluation.');
  }
  if (
    dataset.untouchedTestReservation?.rowsIncluded !== false ||
    Object.hasOwn(dataset.untouchedTestReservation ?? {}, 'rows') ||
    fixed.untouchedTestReservation?.rowsIncluded !== false ||
    Object.hasOwn(fixed.untouchedTestReservation ?? {}, 'rows')
  ) {
    throw new Error('pooling walk-forward must keep untouched-test rows sealed.');
  }
  const observations = extractObservations(dataset, fixed);
  const result = evaluateM8CategoricalPoolingWalkForwardFromObservations({
    categories: observations.categories,
    fitObservations: observations.fit,
    validationObservations: observations.validation,
    fixedParameters: fixed.poolingBoundary,
  });
  for (const definition of PARAMETER_DEFINITIONS) {
    if (result.parameters[definition.key].stableSelection !== true) {
      throw new Error(
        `${definition.key} pooling has no common fixed/walk-forward nondominated candidate.`,
      );
    }
  }
  const identity = {
    poolingWalkForwardVersion: 1,
    mathSpecVersion: '1.5',
    status: 'offline-categorical-pooling-walk-forward-candidate-selected',
    productionEnabled: false,
    untouchedTestAccessed: false,
    activeSeason: fixed.activeSeason,
    sourceDatasetSha256: fixed.sourceDatasetSha256,
    sourceDatasetFileSha256: sha256(datasetText),
    sourceFixedEvaluationSha256: fixed.evaluationSha256,
    sourceFixedEvaluationFileSha256: sha256(fixedEvaluationText),
    categories: observations.categories,
    hitCategories: Object.freeze([...hitCategories]),
    folds: result.folds,
    parameters: result.parameters,
    allValidationObservationsScoredExactlyOnce:
      result.allValidationObservationsScoredExactlyOnce,
    untouchedTestReservation: Object.freeze({
      ...fixed.untouchedTestReservation,
      rowsIncluded: false,
    }),
  };
  return Object.freeze({
    purpose:
      'Apply Canonical Math Specification Version 1.5 fixed/walk-forward proper-score nondominance and strongest-pooling selection to the current-season batter and pitcher-allowed categorical pooling families.',
    ...identity,
    poolingWalkForwardSha256: sha256(JSON.stringify(artifactIdentity(identity))),
  });
}

export function verifyM8CategoricalPoolingWalkForward(rawEvaluation) {
  const evaluation = object(rawEvaluation, 'categorical pooling walk-forward');
  if (
    evaluation.poolingWalkForwardVersion !== 1 ||
    evaluation.mathSpecVersion !== '1.5' ||
    evaluation.productionEnabled !== false ||
    evaluation.untouchedTestAccessed !== false ||
    evaluation.allValidationObservationsScoredExactlyOnce !== true
  ) {
    throw new Error('unsupported categorical pooling walk-forward contract.');
  }
  for (const definition of PARAMETER_DEFINITIONS) {
    const parameter = object(
      evaluation.parameters?.[definition.key],
      `parameters.${definition.key}`,
    );
    const selection = selectM8CategoricalPoolingStableCandidate({
      fixedResults: parameter.fixedResults,
      walkForwardResults: parameter.walkForwardResults,
    });
    for (const field of [
      'fixedNondominatedCandidateIds',
      'walkForwardNondominatedCandidateIds',
      'stableCandidateIds',
      'stableSelection',
      'selectedCandidateId',
    ]) {
      if (JSON.stringify(parameter[field]) !== JSON.stringify(selection[field])) {
        throw new Error(`${definition.key} ${field} is inconsistent with proper scores.`);
      }
    }
  }
  if (
    evaluation.untouchedTestReservation?.rowsIncluded !== false ||
    Object.hasOwn(evaluation.untouchedTestReservation ?? {}, 'rows')
  ) {
    throw new Error('categorical pooling walk-forward exposes untouched-test rows.');
  }
  if (
    evaluation.poolingWalkForwardSha256 !==
    sha256(JSON.stringify(artifactIdentity(evaluation)))
  ) {
    throw new Error('categorical pooling walk-forward SHA-256 is invalid.');
  }
  return evaluation;
}

export async function evaluateM8CategoricalPoolingWalkForwardFiles({
  datasetPath,
  fixedEvaluationPath,
  canonicalCategories,
  hitCategories,
}) {
  const [datasetText, fixedEvaluationText] = await Promise.all([
    readFile(string(datasetPath, 'datasetPath'), 'utf8'),
    readFile(string(fixedEvaluationPath, 'fixedEvaluationPath'), 'utf8'),
  ]);
  return evaluateM8CategoricalPoolingWalkForward({
    rawDataset: parseJson(datasetText, 'resolved categorical dataset'),
    datasetText,
    rawFixedEvaluation: parseJson(
      fixedEvaluationText,
      'fixed categorical evaluation',
    ),
    fixedEvaluationText,
    canonicalCategories,
    hitCategories,
  });
}
