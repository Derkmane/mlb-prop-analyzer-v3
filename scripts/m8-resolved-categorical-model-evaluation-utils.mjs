import { readFile } from 'node:fs/promises';

import {
  evaluateCategoricalPoolingPath,
} from './m8-categorical-pooling-utils.mjs';
import {
  M8_CATEGORICAL_POOLING_BOUNDARY_CANDIDATES,
} from './m8-categorical-pooling-boundary-utils.mjs';
import {
  DEFAULT_M8_COHERENT_MATCHUP_CANDIDATES,
  evaluateCoherentCategoricalMatchupCandidates,
} from './m8-coherent-categorical-matchup-utils.mjs';
import { sha256 } from './provider-probe-utils.mjs';
import { assertCurrentSeasonDate } from './m8-recency-weighting-utils.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const INCLUDED_PERIODS = Object.freeze(['fit', 'validation']);
const TOLERANCE = 1e-12;

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

function assertInteger(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be an integer.`);
  }
  return value;
}

function assertPositiveInteger(value, label) {
  const integer = assertInteger(value, label);
  if (integer <= 0) {
    throw new RangeError(`${label} must be positive.`);
  }
  return integer;
}

function assertNonNegativeInteger(value, label) {
  const integer = assertInteger(value, label);
  if (integer < 0) {
    throw new RangeError(`${label} must be non-negative.`);
  }
  return integer;
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

function validateUniqueStrings(rawValues, label) {
  const values = assertArray(rawValues, label).map((value, index) =>
    assertNonEmptyString(value, `${label}[${index}]`),
  );
  if (values.length < 2) {
    throw new RangeError(`${label} must contain at least two values.`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must contain unique values.`);
  }
  return Object.freeze(values);
}

function resolvedDatasetIdentity(dataset) {
  return {
    activeSeason: dataset.activeSeason,
    sourceDatasetSha256: dataset.sourceDatasetSha256,
    sourceDatasetFileSha256: dataset.sourceDatasetFileSha256,
    sourceResolutionSha256: dataset.sourceResolutionSha256,
    sourceResolutionFileSha256: dataset.sourceResolutionFileSha256,
    sourcePartitionSha256: dataset.sourcePartitionSha256,
    sourceEvidenceSetSha256: dataset.sourceEvidenceSetSha256,
    periods: dataset.periods,
    untouchedTestReservation: dataset.untouchedTestReservation,
  };
}

function emptyCounts(categories) {
  return Object.fromEntries(categories.map((category) => [category, 0]));
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}

function validatePeriod({
  rawPeriod,
  periodId,
  activeSeason,
  canonicalCategorySet,
  seenObservationIds,
}) {
  const period = assertPlainObject(rawPeriod, `periods.${periodId}`);
  const startDate = assertNonEmptyString(
    period.startDate,
    `periods.${periodId}.startDate`,
  );
  const endDate = assertNonEmptyString(
    period.endDate,
    `periods.${periodId}.endDate`,
  );
  assertCurrentSeasonDate(startDate, activeSeason, `periods.${periodId}.startDate`);
  assertCurrentSeasonDate(endDate, activeSeason, `periods.${periodId}.endDate`);
  if (startDate > endDate) {
    throw new Error(`${periodId} startDate must not follow endDate.`);
  }

  const rows = assertArray(period.rows, `periods.${periodId}.rows`);
  const rowCount = assertNonNegativeInteger(
    period.rowCount,
    `periods.${periodId}.rowCount`,
  );
  if (rows.length !== rowCount) {
    throw new Error(`${periodId} rowCount does not match rows.`);
  }

  const observations = [];
  const terminalCategoryCounts = {};
  for (const [index, rawRow] of rows.entries()) {
    const row = assertPlainObject(rawRow, `periods.${periodId}.rows[${index}]`);
    const rowId = assertNonEmptyString(
      row.rowId,
      `periods.${periodId}.rows[${index}].rowId`,
    );
    if (seenObservationIds.has(rowId)) {
      throw new Error(`duplicate fit-validation row identity: ${rowId}.`);
    }
    seenObservationIds.add(rowId);

    const observedDate = assertNonEmptyString(
      row.observedDate,
      `${rowId}.observedDate`,
    );
    assertCurrentSeasonDate(observedDate, activeSeason, `${rowId}.observedDate`);
    if (observedDate < startDate || observedDate > endDate) {
      throw new Error(`${rowId} lies outside its ${periodId} date window.`);
    }

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
    if (!canonicalCategorySet.has(terminalCategory)) {
      throw new Error(`${rowId} contains unsupported terminal category ${terminalCategory}.`);
    }
    const providerBatterId = assertPositiveInteger(
      row.providerBatterId,
      `${rowId}.providerBatterId`,
    );
    const providerPitcherId = assertPositiveInteger(
      row.providerPitcherId,
      `${rowId}.providerPitcherId`,
    );
    observations.push(
      Object.freeze({
        observationId: rowId,
        observedDate,
        providerBatterId,
        providerPitcherId,
        terminalCategory,
      }),
    );
    increment(terminalCategoryCounts, terminalCategory);
  }

  const classifiedTerminalCount = assertNonNegativeInteger(
    period.classifiedTerminalCount,
    `periods.${periodId}.classifiedTerminalCount`,
  );
  if (observations.length !== classifiedTerminalCount) {
    throw new Error(`${periodId} classifiedTerminalCount does not match usable rows.`);
  }

  return Object.freeze({
    startDate,
    endDate,
    sourceRowCount: rowCount,
    classifiedTerminalCount,
    terminalCategoryCounts: Object.freeze(terminalCategoryCounts),
    observations: Object.freeze(observations),
  });
}

function validateResolvedDataset(rawDataset, datasetText, canonicalCategories) {
  const dataset = assertPlainObject(rawDataset, 'M8 resolved categorical dataset');
  if (dataset.datasetVersion !== 3) {
    throw new RangeError('source datasetVersion must equal 3.');
  }
  const activeSeason = assertPositiveInteger(dataset.activeSeason, 'activeSeason');
  assertSha256(dataset.sourceDatasetSha256, 'sourceDatasetSha256');
  assertSha256(dataset.sourceDatasetFileSha256, 'sourceDatasetFileSha256');
  assertSha256(dataset.sourceResolutionSha256, 'sourceResolutionSha256');
  assertSha256(dataset.sourceResolutionFileSha256, 'sourceResolutionFileSha256');
  assertSha256(dataset.sourcePartitionSha256, 'sourcePartitionSha256');
  assertSha256(dataset.sourceEvidenceSetSha256, 'sourceEvidenceSetSha256');
  const datasetSha256 = assertSha256(dataset.datasetSha256, 'datasetSha256');
  if (datasetSha256 !== sha256(JSON.stringify(resolvedDatasetIdentity(dataset)))) {
    throw new Error('resolved dataset internal SHA-256 does not match its identity.');
  }

  const untouched = assertPlainObject(
    dataset.untouchedTestReservation,
    'untouchedTestReservation',
  );
  if (untouched.rowsIncluded !== false || Object.hasOwn(untouched, 'rows')) {
    throw new Error('untouched test rows must remain absent from resolved model evaluation.');
  }

  const canonicalCategorySet = new Set(canonicalCategories);
  const periodsObject = assertPlainObject(dataset.periods, 'periods');
  const seenObservationIds = new Set();
  const periods = Object.fromEntries(
    INCLUDED_PERIODS.map((periodId) => [
      periodId,
      validatePeriod({
        rawPeriod: periodsObject[periodId],
        periodId,
        activeSeason,
        canonicalCategorySet,
        seenObservationIds,
      }),
    ]),
  );
  if (periods.fit.endDate >= periods.validation.startDate) {
    throw new Error('fit and validation periods must be strictly chronological and non-overlapping.');
  }

  const fitCounts = emptyCounts(canonicalCategories);
  const validationCounts = emptyCounts(canonicalCategories);
  for (const observation of periods.fit.observations) {
    fitCounts[observation.terminalCategory] += 1;
  }
  for (const observation of periods.validation.observations) {
    validationCounts[observation.terminalCategory] += 1;
  }

  const structuralZeroCategories = canonicalCategories.filter(
    (category) => fitCounts[category] === 0,
  );
  for (const category of structuralZeroCategories) {
    if (validationCounts[category] !== 0) {
      throw new Error(
        `validation category ${category} has no current-season fit support and cannot be assigned invented probability mass.`,
      );
    }
  }
  const modeledCategories = canonicalCategories.filter(
    (category) => fitCounts[category] > 0,
  );
  if (modeledCategories.length < 2) {
    throw new Error('resolved categorical evaluation requires at least two fit-supported categories.');
  }

  const totals = assertPlainObject(dataset.totals, 'totals');
  const includedRowCount = periods.fit.sourceRowCount + periods.validation.sourceRowCount;
  const classifiedTerminalCount =
    periods.fit.classifiedTerminalCount + periods.validation.classifiedTerminalCount;
  if (
    assertNonNegativeInteger(totals.includedRowCount, 'totals.includedRowCount') !==
    includedRowCount
  ) {
    throw new Error('resolved dataset total includedRowCount drifted from periods.');
  }
  if (
    assertNonNegativeInteger(
      totals.classifiedTerminalCount,
      'totals.classifiedTerminalCount',
    ) !== classifiedTerminalCount
  ) {
    throw new Error('resolved dataset total classifiedTerminalCount drifted from periods.');
  }

  return Object.freeze({
    activeSeason,
    datasetSha256,
    datasetFileSha256: sha256(datasetText),
    canonicalCategories,
    modeledCategories: Object.freeze(modeledCategories),
    structuralZeroCategories: Object.freeze(structuralZeroCategories),
    fitCounts: Object.freeze(fitCounts),
    validationCounts: Object.freeze(validationCounts),
    periods: Object.freeze(periods),
    untouchedTestReservation: Object.freeze({
      startDate: assertNonEmptyString(untouched.startDate, 'untouched startDate'),
      endDate: assertNonEmptyString(untouched.endDate, 'untouched endDate'),
      plateAppearanceCount: assertNonNegativeInteger(
        untouched.plateAppearanceCount,
        'untouched plateAppearanceCount',
      ),
      rowsIncluded: false,
    }),
  });
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
      best.candidate.candidateId === LEAGUE_ONLY_CANDIDATE.candidateId
        ? 'league-only-limit-selected'
        : 'finite-pooling-candidate-selected',
    selectedCandidate: best.candidate,
    validationLogLoss: best.validationLogLoss,
    validationBrierScore: best.validationBrierScore,
  });
}

function extendBoundary(parameter, observations, categories) {
  const leagueOnlyResult = exactLeagueOnlyResult(parameter, observations, categories);
  const results = Object.freeze([...parameter.results, leagueOnlyResult]);
  return Object.freeze({
    ...parameter,
    boundarySearchVersion: 1,
    exactLeagueOnlyLimitIncluded: true,
    results,
    selection: selectBoundaryCandidate(results),
  });
}

function buildCanonicalTarget({ canonicalCategories, modeledTarget }) {
  return Object.freeze(
    Object.fromEntries(
      canonicalCategories.map((category) => [category, modeledTarget[category] ?? 0]),
    ),
  );
}

function selectedFiniteStrength(parameter, label) {
  if (parameter.selection.status !== 'finite-pooling-candidate-selected') {
    return null;
  }
  const strength = parameter.selection.selectedCandidate?.leagueEquivalentPa;
  if (typeof strength !== 'number' || !Number.isFinite(strength) || strength <= 0) {
    throw new Error(`${label} finite selection has an invalid pooling strength.`);
  }
  return strength;
}

export function evaluateResolvedCategoricalModel({
  dataset: rawDataset,
  datasetText,
  canonicalCategories: rawCanonicalCategories,
  hitCategories: rawHitCategories,
  poolingCandidates = M8_CATEGORICAL_POOLING_BOUNDARY_CANDIDATES,
  matchupCandidates = DEFAULT_M8_COHERENT_MATCHUP_CANDIDATES,
}) {
  const canonicalCategories = validateUniqueStrings(
    rawCanonicalCategories,
    'canonicalCategories',
  );
  const hitCategories = Object.freeze(
    assertArray(rawHitCategories, 'hitCategories').map((category, index) => {
      const value = assertNonEmptyString(category, `hitCategories[${index}]`);
      if (!canonicalCategories.includes(value)) {
        throw new Error(`hitCategories contains non-canonical category ${value}.`);
      }
      return value;
    }),
  );
  if (hitCategories.length === 0 || new Set(hitCategories).size !== hitCategories.length) {
    throw new Error('hitCategories must contain at least one unique category.');
  }

  const sourceText = assertNonEmptyString(datasetText, 'datasetText');
  const dataset = validateResolvedDataset(
    rawDataset,
    sourceText,
    canonicalCategories,
  );
  for (const hitCategory of hitCategories) {
    if (dataset.structuralZeroCategories.includes(hitCategory)) {
      throw new Error(`hit category ${hitCategory} has no current-season fit support.`);
    }
  }

  const batterFinite = evaluateCategoricalPoolingPath({
    categories: dataset.modeledCategories,
    fitObservations: dataset.periods.fit.observations,
    validationObservations: dataset.periods.validation.observations,
    identityKey: 'providerBatterId',
    parameterId: 'batter-terminal-category-vector',
    candidates: poolingCandidates,
  });
  const pitcherFinite = evaluateCategoricalPoolingPath({
    categories: dataset.modeledCategories,
    fitObservations: dataset.periods.fit.observations,
    validationObservations: dataset.periods.validation.observations,
    identityKey: 'providerPitcherId',
    parameterId: 'pitcher-allowed-terminal-category-vector',
    candidates: poolingCandidates,
  });
  const batter = extendBoundary(
    batterFinite,
    dataset.periods.validation.observations,
    dataset.modeledCategories,
  );
  const pitcherAllowed = extendBoundary(
    pitcherFinite,
    dataset.periods.validation.observations,
    dataset.modeledCategories,
  );

  const boundaryIdentity = {
    boundaryEvaluationVersion: 2,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: dataset.datasetFileSha256,
    canonicalCategories,
    modeledCategories: dataset.modeledCategories,
    structuralZeroCategories: dataset.structuralZeroCategories,
    finiteCandidates: poolingCandidates,
    exactLeagueOnlyCandidate: LEAGUE_ONLY_CANDIDATE,
    batter,
    pitcherAllowed,
    untouchedTestReservation: dataset.untouchedTestReservation,
  };
  const boundary = Object.freeze({
    ...boundaryIdentity,
    boundaryEvaluationSha256: sha256(JSON.stringify(boundaryIdentity)),
  });

  const batterStrength = selectedFiniteStrength(batter, 'batter');
  const pitcherStrength = selectedFiniteStrength(pitcherAllowed, 'pitcherAllowed');
  let coherentMatchup = null;
  let coherentStatus = 'pooling-boundary-not-finite';
  if (batterStrength !== null && pitcherStrength !== null) {
    coherentMatchup = evaluateCoherentCategoricalMatchupCandidates({
      categories: dataset.modeledCategories,
      hitCategories,
      fitObservations: dataset.periods.fit.observations,
      validationObservations: dataset.periods.validation.observations,
      batterLeagueEquivalentPa: batterStrength,
      pitcherAllowedLeagueEquivalentPa: pitcherStrength,
      candidates: matchupCandidates,
    });
    coherentStatus = 'coherent-matchup-evaluated';
  }

  const representativeModeledTarget = batter.leagueTarget;
  const canonicalLeagueTarget = buildCanonicalTarget({
    canonicalCategories,
    modeledTarget: representativeModeledTarget,
  });
  const targetTotal = Object.values(canonicalLeagueTarget).reduce(
    (sum, probability) => sum + probability,
    0,
  );
  if (Math.abs(targetTotal - 1) > TOLERANCE) {
    throw new Error('canonical league target must sum to 1 including structural zeros.');
  }

  const evaluationIdentity = {
    activeSeason: dataset.activeSeason,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: dataset.datasetFileSha256,
    canonicalVectorPolicy: Object.freeze({
      canonicalCategories,
      modeledCategories: dataset.modeledCategories,
      structuralZeroCategories: dataset.structuralZeroCategories,
      structuralZeroRule:
        'A canonical category with zero fit support and zero validation observations receives exact zero mass; no pseudo-count or descriptive fallback is invented.',
      validationZeroSupportRule:
        'Any validation observation in a zero-fit-support category fails closed.',
      canonicalLeagueCurrentSeasonCounts: dataset.fitCounts,
      canonicalValidationCounts: dataset.validationCounts,
      canonicalLeagueTarget,
    }),
    poolingBoundary: boundary,
    coherentStatus,
    coherentMatchup,
    untouchedTestReservation: dataset.untouchedTestReservation,
  };
  return Object.freeze({
    evaluationVersion: 1,
    purpose:
      'Evaluate the existing single-pass pooling and coherent categorical matchup mathematics on the resolved current-season dataset while retaining zero-support canonical categories explicitly with zero mass.',
    status: 'offline-resolved-categorical-model-evaluation-not-production-model',
    ...evaluationIdentity,
    evaluationSha256: sha256(JSON.stringify(evaluationIdentity)),
  });
}

export async function evaluateM8ResolvedCategoricalModel({
  datasetPath,
  canonicalCategories,
  hitCategories,
  poolingCandidates = M8_CATEGORICAL_POOLING_BOUNDARY_CANDIDATES,
  matchupCandidates = DEFAULT_M8_COHERENT_MATCHUP_CANDIDATES,
}) {
  const inputPath = assertNonEmptyString(datasetPath, 'datasetPath');
  const datasetText = await readFile(inputPath, 'utf8');
  return evaluateResolvedCategoricalModel({
    dataset: parseJson(datasetText, 'M8 resolved categorical dataset'),
    datasetText,
    canonicalCategories,
    hitCategories,
    poolingCandidates,
    matchupCandidates,
  });
}
