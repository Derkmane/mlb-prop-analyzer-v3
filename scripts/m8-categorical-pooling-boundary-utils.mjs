import { readFile } from 'node:fs/promises';

import { evaluateM8CategoricalPoolingCandidates } from './m8-categorical-pooling-utils.mjs';
import { sha256 } from './provider-probe-utils.mjs';

const TOLERANCE = 1e-12;

export const M8_CATEGORICAL_POOLING_BOUNDARY_CANDIDATES = Object.freeze(
  [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096].map(
    (leagueEquivalentPa) =>
      Object.freeze({
        candidateId: `league-pa-${leagueEquivalentPa}`,
        leagueEquivalentPa,
      }),
  ),
);

const LEAGUE_ONLY_CANDIDATE = Object.freeze({
  candidateId: 'league-only-limit',
  kind: 'league-only-limit',
  leagueEquivalentPa: null,
});

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

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
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

function validateBoundaryDataset(rawDataset, sourceDatasetSha256) {
  const dataset = assertPlainObject(rawDataset, 'M8 recency dataset');
  if (dataset.datasetVersion !== 2) {
    throw new RangeError('source datasetVersion must equal 2.');
  }
  if (dataset.datasetSha256 !== sourceDatasetSha256) {
    throw new Error('boundary evaluation source dataset SHA-256 drifted.');
  }
  const untouched = assertPlainObject(
    dataset.untouchedTestReservation,
    'untouchedTestReservation',
  );
  if (untouched.rowsIncluded !== false || Object.hasOwn(untouched, 'rows')) {
    throw new Error(
      'untouched test rows must remain absent from categorical pooling boundary evaluation.',
    );
  }
  const validation = assertPlainObject(dataset.periods?.validation, 'periods.validation');
  const rows = assertArray(validation.rows, 'periods.validation.rows');
  const expectedRows = assertNonNegativeInteger(
    validation.rowCount,
    'periods.validation.rowCount',
  );
  if (rows.length !== expectedRows) {
    throw new Error('validation rowCount does not match validation rows.');
  }
  return Object.freeze({ dataset, validationRows: rows });
}

function classifiedValidationObservations(rows, categories) {
  const categorySet = new Set(categories);
  const observations = [];
  const seen = new Set();
  for (const [index, rawRow] of rows.entries()) {
    const row = assertPlainObject(rawRow, `validation rows[${index}]`);
    if (row.mappingStatus !== 'classified-terminal') continue;
    if (row.includedInOverallOutcomeModel !== true) {
      throw new Error('classified validation row must be overall-outcome eligible.');
    }
    const observationId = assertNonEmptyString(row.rowId, `validation rows[${index}].rowId`);
    if (seen.has(observationId)) {
      throw new Error(`duplicate validation observation identity: ${observationId}.`);
    }
    seen.add(observationId);
    const terminalCategory = assertNonEmptyString(
      row.terminalCategory,
      `${observationId}.terminalCategory`,
    );
    if (!categorySet.has(terminalCategory)) {
      throw new Error(
        `${observationId} contains unsupported terminal category: ${terminalCategory}.`,
      );
    }
    observations.push(Object.freeze({ observationId, terminalCategory }));
  }
  return Object.freeze(observations);
}

function exactLeagueOnlyResult(parameter, observations, categories) {
  if (observations.length !== parameter.validationObservationCount) {
    throw new Error(
      `${parameter.parameterId} league-only comparison did not use the finite-candidate validation cohort.`,
    );
  }
  const observationIdsSha256 = sha256(
    JSON.stringify(observations.map((observation) => observation.observationId)),
  );
  if (observationIdsSha256 !== parameter.validationObservationIdsSha256) {
    throw new Error(
      `${parameter.parameterId} league-only comparison observation identities drifted.`,
    );
  }

  let logLossSum = 0;
  let brierSum = 0;
  let actualProbabilityMinimum = 1;
  let actualProbabilityMaximum = 0;
  for (const observation of observations) {
    const actualProbability = parameter.leagueTarget[observation.terminalCategory];
    if (!(actualProbability > 0 && actualProbability <= 1)) {
      throw new Error(
        `${parameter.parameterId} league-only limit assigned a non-positive actual-category probability.`,
      );
    }
    logLossSum += -Math.log(actualProbability);
    actualProbabilityMinimum = Math.min(
      actualProbabilityMinimum,
      actualProbability,
    );
    actualProbabilityMaximum = Math.max(
      actualProbabilityMaximum,
      actualProbability,
    );
    for (const category of categories) {
      const target = category === observation.terminalCategory ? 1 : 0;
      brierSum += (parameter.leagueTarget[category] - target) ** 2;
    }
  }

  return Object.freeze({
    candidate: LEAGUE_ONLY_CANDIDATE,
    validationObservationCount: observations.length,
    validationObservationIdsSha256: observationIdsSha256,
    validationLogLoss: logLossSum / observations.length,
    validationBrierScore: brierSum / observations.length,
    actualProbabilityMinimum,
    actualProbabilityMaximum,
  });
}

function selectBoundaryCandidate(results) {
  const sorted = [...results].sort(
    (left, right) =>
      left.validationLogLoss - right.validationLogLoss ||
      left.candidate.candidateId.localeCompare(right.candidate.candidateId),
  );
  const best = sorted[0];
  const second = sorted[1];
  if (!best || !second) {
    throw new Error('pooling boundary evaluation requires at least two candidates.');
  }
  if (Math.abs(second.validationLogLoss - best.validationLogLoss) <= TOLERANCE) {
    return Object.freeze({
      status: 'ambiguous-validation-result',
      selectedCandidate: null,
    });
  }
  return Object.freeze({
    status:
      best.candidate.candidateId === 'league-only-limit'
        ? 'league-only-limit-selected'
        : 'finite-pooling-candidate-selected',
    selectedCandidate: best.candidate,
    validationLogLoss: best.validationLogLoss,
    validationBrierScore: best.validationBrierScore,
  });
}

function extendParameter(parameter, observations, categories) {
  const leagueOnlyResult = exactLeagueOnlyResult(
    parameter,
    observations,
    categories,
  );
  const results = Object.freeze([...parameter.results, leagueOnlyResult]);
  return Object.freeze({
    ...parameter,
    boundarySearchVersion: 1,
    exactLeagueOnlyLimitIncluded: true,
    results,
    selection: selectBoundaryCandidate(results),
  });
}

export async function evaluateM8CategoricalPoolingBoundary({
  datasetPath,
  categories,
}) {
  const inputPath = assertNonEmptyString(datasetPath, 'datasetPath');
  const validatedCategories = assertArray(categories, 'categories').map(
    (category, index) => assertNonEmptyString(category, `categories[${index}]`),
  );
  const finiteEvaluation = await evaluateM8CategoricalPoolingCandidates({
    datasetPath: inputPath,
    categories: validatedCategories,
    candidates: M8_CATEGORICAL_POOLING_BOUNDARY_CANDIDATES,
  });

  const datasetText = await readFile(inputPath, 'utf8');
  const { validationRows } = validateBoundaryDataset(
    parseJson(datasetText, 'M8 recency dataset'),
    finiteEvaluation.sourceDatasetSha256,
  );
  const observations = classifiedValidationObservations(
    validationRows,
    validatedCategories,
  );
  const batter = extendParameter(
    finiteEvaluation.batter,
    observations,
    validatedCategories,
  );
  const pitcherAllowed = extendParameter(
    finiteEvaluation.pitcherAllowed,
    observations,
    validatedCategories,
  );
  const evaluationIdentity = {
    activeSeason: finiteEvaluation.activeSeason,
    sourceDatasetSha256: finiteEvaluation.sourceDatasetSha256,
    sourceDatasetFileSha256: finiteEvaluation.sourceDatasetFileSha256,
    sourceFiniteEvaluationSha256: finiteEvaluation.evaluationSha256,
    categories: Object.freeze(validatedCategories),
    finiteCandidates: M8_CATEGORICAL_POOLING_BOUNDARY_CANDIDATES,
    exactLeagueOnlyCandidate: LEAGUE_ONLY_CANDIDATE,
    batter,
    pitcherAllowed,
    untouchedTestReservation: finiteEvaluation.untouchedTestReservation,
  };
  return Object.freeze({
    boundaryEvaluationVersion: 1,
    purpose:
      'Determine whether the single current-season categorical pooling optimum is finite or reaches the exact current-season league-only limit.',
    status: 'offline-pooling-boundary-evaluation-not-production-model',
    ...evaluationIdentity,
    boundaryEvaluationSha256: sha256(JSON.stringify(evaluationIdentity)),
  });
}
