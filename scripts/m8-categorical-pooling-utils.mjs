import { readFile } from 'node:fs/promises';

import { sha256 } from './provider-probe-utils.mjs';
import { assertCurrentSeasonDate } from './m8-recency-weighting-utils.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const INCLUDED_PERIODS = Object.freeze(['fit', 'validation']);
const TOLERANCE = 1e-12;

export const DEFAULT_M8_CATEGORICAL_POOLING_CANDIDATES = Object.freeze(
  [1, 2, 4, 8, 16, 32, 64, 128, 256].map((leagueEquivalentPa) =>
    Object.freeze({
      candidateId: `league-pa-${leagueEquivalentPa}`,
      leagueEquivalentPa,
    }),
  ),
);

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

function assertInteger(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer.`);
  }
  return value;
}

function assertNonNegativeInteger(value, label) {
  const integer = assertInteger(value, label);
  if (integer < 0) {
    throw new RangeError(`${label} must be non-negative.`);
  }
  return integer;
}

function assertPositiveFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`);
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
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

function validateCategories(rawCategories) {
  const categories = assertArray(rawCategories, 'categories').map((category, index) =>
    assertNonEmptyString(category, `categories[${index}]`),
  );
  if (categories.length < 2) {
    throw new RangeError('categories must contain at least two outcomes.');
  }
  if (new Set(categories).size !== categories.length) {
    throw new Error('categories must be unique.');
  }
  return Object.freeze(categories);
}

function validateCandidateGrid(rawCandidates) {
  const candidates = assertArray(rawCandidates, 'candidates').map((raw, index) => {
    const candidate = assertPlainObject(raw, `candidates[${index}]`);
    return Object.freeze({
      candidateId: assertNonEmptyString(
        candidate.candidateId,
        `candidates[${index}].candidateId`,
      ),
      leagueEquivalentPa: assertPositiveFinite(
        candidate.leagueEquivalentPa,
        `candidates[${index}].leagueEquivalentPa`,
      ),
    });
  });
  if (candidates.length < 2) {
    throw new RangeError('candidates must contain at least two pooling hypotheses.');
  }
  if (new Set(candidates.map((candidate) => candidate.candidateId)).size !== candidates.length) {
    throw new Error('candidateId values must be unique.');
  }
  return Object.freeze(candidates);
}

function emptyCounts(categories) {
  return Object.fromEntries(categories.map((category) => [category, 0]));
}

function validateCounts(rawCounts, categories, label) {
  const counts = assertPlainObject(rawCounts, label);
  const categorySet = new Set(categories);
  for (const key of Object.keys(counts)) {
    if (!categorySet.has(key)) {
      throw new Error(`${label} contains unsupported category: ${key}.`);
    }
  }
  return Object.freeze(
    Object.fromEntries(
      categories.map((category) => [
        category,
        assertNonNegativeInteger(counts[category] ?? 0, `${label}.${category}`),
      ]),
    ),
  );
}

function validateDistribution(rawDistribution, categories, label) {
  const distribution = assertPlainObject(rawDistribution, label);
  const categorySet = new Set(categories);
  for (const key of Object.keys(distribution)) {
    if (!categorySet.has(key)) {
      throw new Error(`${label} contains unsupported category: ${key}.`);
    }
  }
  let total = 0;
  const normalized = {};
  for (const category of categories) {
    const probability = distribution[category];
    if (
      typeof probability !== 'number' ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      throw new RangeError(`${label}.${category} must be between 0 and 1.`);
    }
    normalized[category] = probability;
    total += probability;
  }
  if (Math.abs(total - 1) > TOLERANCE) {
    throw new Error(`${label} must sum to 1.`);
  }
  return Object.freeze(normalized);
}

function sumCounts(counts, categories) {
  return categories.reduce((sum, category) => sum + counts[category], 0);
}

function distributionFromCounts(counts, categories) {
  const total = sumCounts(counts, categories);
  if (total <= 0) {
    throw new Error('league current-season counts must contain at least one observation.');
  }
  return Object.freeze(
    Object.fromEntries(categories.map((category) => [category, counts[category] / total])),
  );
}

export function poolCategoricalCountsOnce({
  categories: rawCategories,
  source: rawSource,
  leagueTarget: rawLeagueTarget,
  leagueEquivalentPa,
}) {
  const categories = validateCategories(rawCategories);
  const source = assertPlainObject(rawSource, 'source');
  if (source.kind !== 'raw-current-season-categorical-counts') {
    throw new Error(
      'single-pass pooling accepts only raw current-season categorical counts; pooled estimates cannot be pooled again.',
    );
  }
  if (Object.hasOwn(source, 'poolingPassCount')) {
    throw new Error('raw pooling source must not contain poolingPassCount.');
  }
  const counts = validateCounts(source.counts, categories, 'source.counts');
  const leagueTarget = validateDistribution(
    rawLeagueTarget,
    categories,
    'leagueTarget',
  );
  const priorWeight = assertPositiveFinite(
    leagueEquivalentPa,
    'leagueEquivalentPa',
  );
  const rawObservationCount = sumCounts(counts, categories);
  const denominator = rawObservationCount + priorWeight;
  const probabilities = Object.freeze(
    Object.fromEntries(
      categories.map((category) => [
        category,
        (counts[category] + priorWeight * leagueTarget[category]) / denominator,
      ]),
    ),
  );
  validateDistribution(probabilities, categories, 'pooled probabilities');

  return Object.freeze({
    kind: 'single-pass-current-season-categorical-pooling',
    poolingPassCount: 1,
    categories,
    rawObservationCount,
    leagueEquivalentPa: priorWeight,
    leagueTarget,
    rawCounts: counts,
    probabilities,
  });
}

function countsByIdentity(observations, identityKey, categories) {
  const result = new Map();
  for (const observation of observations) {
    const identity = observation[identityKey];
    const counts = result.get(identity) ?? emptyCounts(categories);
    counts[observation.terminalCategory] += 1;
    result.set(identity, counts);
  }
  return result;
}

function leagueCounts(observations, categories) {
  const counts = emptyCounts(categories);
  for (const observation of observations) {
    counts[observation.terminalCategory] += 1;
  }
  return Object.freeze(counts);
}

function selectCandidate(results) {
  const sorted = [...results].sort(
    (left, right) =>
      left.validationLogLoss - right.validationLogLoss ||
      left.candidate.leagueEquivalentPa - right.candidate.leagueEquivalentPa ||
      left.candidate.candidateId.localeCompare(right.candidate.candidateId),
  );
  const best = sorted[0];
  const second = sorted[1];
  if (
    !best ||
    !second ||
    Math.abs(second.validationLogLoss - best.validationLogLoss) <= TOLERANCE
  ) {
    return Object.freeze({
      status: 'ambiguous-validation-result',
      selectedCandidate: null,
    });
  }
  return Object.freeze({
    status: 'validation-candidate-selected',
    selectedCandidate: best.candidate,
    validationLogLoss: best.validationLogLoss,
    validationBrierScore: best.validationBrierScore,
  });
}

export function evaluateCategoricalPoolingPath({
  categories: rawCategories,
  fitObservations: rawFitObservations,
  validationObservations: rawValidationObservations,
  identityKey,
  parameterId,
  candidates: rawCandidates = DEFAULT_M8_CATEGORICAL_POOLING_CANDIDATES,
}) {
  const categories = validateCategories(rawCategories);
  const candidates = validateCandidateGrid(rawCandidates);
  const fitObservations = assertArray(rawFitObservations, 'fitObservations');
  const validationObservations = assertArray(
    rawValidationObservations,
    'validationObservations',
  );
  const key = assertNonEmptyString(identityKey, 'identityKey');
  const parameter = assertNonEmptyString(parameterId, 'parameterId');
  if (fitObservations.length === 0 || validationObservations.length === 0) {
    throw new Error('fit and validation observations must both be non-empty.');
  }

  const leagueCurrentSeasonCounts = leagueCounts(fitObservations, categories);
  const leagueTarget = distributionFromCounts(leagueCurrentSeasonCounts, categories);
  const identityCounts = countsByIdentity(fitObservations, key, categories);
  for (const observation of validationObservations) {
    if (leagueCurrentSeasonCounts[observation.terminalCategory] === 0) {
      throw new Error(
        `validation category ${observation.terminalCategory} has no current-season fit support.`,
      );
    }
  }

  const validationObservationIdsSha256 = sha256(
    JSON.stringify(validationObservations.map((observation) => observation.observationId)),
  );
  const unseenValidationIdentities = new Set(
    validationObservations
      .filter((observation) => !identityCounts.has(observation[key]))
      .map((observation) => observation[key]),
  );

  const results = Object.freeze(
    candidates.map((candidate) => {
      let logLossSum = 0;
      let brierSum = 0;
      let actualProbabilityMinimum = 1;
      let actualProbabilityMaximum = 0;
      const pooledByIdentity = new Map();

      for (const observation of validationObservations) {
        const identity = observation[key];
        let pooled = pooledByIdentity.get(identity);
        if (!pooled) {
          pooled = poolCategoricalCountsOnce({
            categories,
            source: {
              kind: 'raw-current-season-categorical-counts',
              counts: identityCounts.get(identity) ?? emptyCounts(categories),
            },
            leagueTarget,
            leagueEquivalentPa: candidate.leagueEquivalentPa,
          });
          pooledByIdentity.set(identity, pooled);
        }
        const actualProbability = pooled.probabilities[observation.terminalCategory];
        if (!(actualProbability > 0 && actualProbability <= 1)) {
          throw new Error(
            `${parameter} candidate ${candidate.candidateId} assigned a non-positive actual-category probability.`,
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
          brierSum += (pooled.probabilities[category] - target) ** 2;
        }
      }

      const validationObservationCount = validationObservations.length;
      return Object.freeze({
        candidate,
        validationObservationCount,
        validationObservationIdsSha256,
        validationLogLoss: logLossSum / validationObservationCount,
        validationBrierScore: brierSum / validationObservationCount,
        actualProbabilityMinimum,
        actualProbabilityMaximum,
      });
    }),
  );

  if (
    results.some(
      (result) =>
        result.validationObservationCount !== validationObservations.length ||
        result.validationObservationIdsSha256 !== validationObservationIdsSha256,
    )
  ) {
    throw new Error('pooling candidates did not use one identical validation cohort.');
  }

  return Object.freeze({
    parameterId: parameter,
    identityKey: key,
    pathVersion: 1,
    poolingMethod: 'single-pass-current-season-league-target-categorical-pooling',
    poolingFormula:
      'p_hat[i,c] = (n[i,c] + leagueEquivalentPa * leagueRate[c]) / (N[i] + leagueEquivalentPa)',
    poolingPassCount: 1,
    secondShrinkageAllowed: false,
    fitObservationCount: fitObservations.length,
    validationObservationCount: validationObservations.length,
    validationObservationIdsSha256,
    uniqueFitIdentityCount: identityCounts.size,
    unseenValidationIdentityCount: unseenValidationIdentities.size,
    leagueCurrentSeasonCounts,
    leagueTarget,
    candidates,
    results,
    selection: selectCandidate(results),
  });
}

function datasetIdentity(dataset) {
  return {
    activeSeason: dataset.activeSeason,
    sourcePartitionSha256: dataset.sourcePartitionSha256,
    sourceEvidenceSetSha256: dataset.sourceEvidenceSetSha256,
    periods: dataset.periods,
    untouchedTestReservation: dataset.untouchedTestReservation,
  };
}

function validateDatasetPeriod(rawPeriod, periodId, activeSeason, categories) {
  const period = assertPlainObject(rawPeriod, `periods.${periodId}`);
  const rows = assertArray(period.rows, `periods.${periodId}.rows`);
  const rowCount = assertNonNegativeInteger(
    period.rowCount,
    `periods.${periodId}.rowCount`,
  );
  if (rows.length !== rowCount) {
    throw new Error(`${periodId} rowCount does not match rows.`);
  }
  const categorySet = new Set(categories);
  const observations = [];
  const seen = new Set();
  for (const [index, rawRow] of rows.entries()) {
    const row = assertPlainObject(rawRow, `periods.${periodId}.rows[${index}]`);
    const rowId = assertNonEmptyString(
      row.rowId,
      `periods.${periodId}.rows[${index}].rowId`,
    );
    if (seen.has(rowId)) {
      throw new Error(`${periodId} contains duplicate rowId: ${rowId}.`);
    }
    seen.add(rowId);
    const observedDate = assertNonEmptyString(
      row.observedDate,
      `periods.${periodId}.rows[${index}].observedDate`,
    );
    assertCurrentSeasonDate(
      observedDate,
      activeSeason,
      `periods.${periodId}.rows[${index}].observedDate`,
    );
    if (row.mappingStatus !== 'classified-terminal') {
      continue;
    }
    if (row.includedInOverallOutcomeModel !== true) {
      throw new Error(`${rowId} classified terminal row must be overall eligible.`);
    }
    const terminalCategory = assertNonEmptyString(
      row.terminalCategory,
      `${rowId}.terminalCategory`,
    );
    if (!categorySet.has(terminalCategory)) {
      throw new Error(`${rowId} contains unsupported terminal category: ${terminalCategory}.`);
    }
    observations.push(
      Object.freeze({
        observationId: rowId,
        observedDate,
        providerBatterId: assertInteger(row.providerBatterId, `${rowId}.providerBatterId`),
        providerPitcherId: assertInteger(
          row.providerPitcherId,
          `${rowId}.providerPitcherId`,
        ),
        terminalCategory,
      }),
    );
  }
  const expectedClassified = assertNonNegativeInteger(
    period.classifiedTerminalCount,
    `periods.${periodId}.classifiedTerminalCount`,
  );
  if (observations.length !== expectedClassified) {
    throw new Error(`${periodId} classifiedTerminalCount does not match usable rows.`);
  }
  return Object.freeze({
    startDate: assertNonEmptyString(period.startDate, `periods.${periodId}.startDate`),
    endDate: assertNonEmptyString(period.endDate, `periods.${periodId}.endDate`),
    sourceRowCount: rowCount,
    observations: Object.freeze(observations),
  });
}

function validateRecencyDataset(rawDataset, datasetText, categories) {
  const dataset = assertPlainObject(rawDataset, 'M8 recency dataset');
  if (dataset.datasetVersion !== 2) {
    throw new RangeError('source datasetVersion must equal 2.');
  }
  const activeSeason = assertInteger(dataset.activeSeason, 'activeSeason');
  assertSha256(dataset.sourcePartitionSha256, 'sourcePartitionSha256');
  assertSha256(dataset.sourceEvidenceSetSha256, 'sourceEvidenceSetSha256');
  const internalSha = assertSha256(dataset.datasetSha256, 'datasetSha256');
  if (internalSha !== sha256(JSON.stringify(datasetIdentity(dataset)))) {
    throw new Error('source dataset internal SHA-256 does not match its identity.');
  }
  const untouchedTest = assertPlainObject(
    dataset.untouchedTestReservation,
    'untouchedTestReservation',
  );
  if (untouchedTest.rowsIncluded !== false || Object.hasOwn(untouchedTest, 'rows')) {
    throw new Error('untouched test rows must remain absent from categorical pooling evaluation.');
  }
  const periods = assertPlainObject(dataset.periods, 'periods');
  const validatedPeriods = Object.fromEntries(
    INCLUDED_PERIODS.map((periodId) => [
      periodId,
      validateDatasetPeriod(periods[periodId], periodId, activeSeason, categories),
    ]),
  );
  return Object.freeze({
    activeSeason,
    datasetSha256: internalSha,
    datasetFileSha256: sha256(datasetText),
    periods: Object.freeze(validatedPeriods),
    untouchedTestReservation: Object.freeze({
      startDate: assertNonEmptyString(untouchedTest.startDate, 'untouchedTestReservation.startDate'),
      endDate: assertNonEmptyString(untouchedTest.endDate, 'untouchedTestReservation.endDate'),
      plateAppearanceCount: assertNonNegativeInteger(
        untouchedTest.plateAppearanceCount,
        'untouchedTestReservation.plateAppearanceCount',
      ),
      rowsIncluded: false,
    }),
  });
}

export async function evaluateM8CategoricalPoolingCandidates({
  datasetPath,
  categories: rawCategories,
  candidates = DEFAULT_M8_CATEGORICAL_POOLING_CANDIDATES,
}) {
  const inputPath = assertNonEmptyString(datasetPath, 'datasetPath');
  const categories = validateCategories(rawCategories);
  const datasetText = await readFile(inputPath, 'utf8');
  const dataset = validateRecencyDataset(
    parseJson(datasetText, 'M8 recency dataset'),
    datasetText,
    categories,
  );
  const batter = evaluateCategoricalPoolingPath({
    categories,
    fitObservations: dataset.periods.fit.observations,
    validationObservations: dataset.periods.validation.observations,
    identityKey: 'providerBatterId',
    parameterId: 'batter-terminal-category-vector',
    candidates,
  });
  const pitcherAllowed = evaluateCategoricalPoolingPath({
    categories,
    fitObservations: dataset.periods.fit.observations,
    validationObservations: dataset.periods.validation.observations,
    identityKey: 'providerPitcherId',
    parameterId: 'pitcher-allowed-terminal-category-vector',
    candidates,
  });
  const evaluationIdentity = {
    activeSeason: dataset.activeSeason,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: dataset.datasetFileSha256,
    categories,
    candidates,
    batter,
    pitcherAllowed,
    untouchedTestReservation: dataset.untouchedTestReservation,
  };
  return Object.freeze({
    evaluationVersion: 1,
    purpose:
      'Evaluate one single-pass current-season league-target categorical pooling path separately for batter and pitcher-allowed parameter vectors using later validation data.',
    status: 'offline-pooling-path-evaluation-not-production-model',
    ...evaluationIdentity,
    evaluationSha256: sha256(JSON.stringify(evaluationIdentity)),
  });
}
