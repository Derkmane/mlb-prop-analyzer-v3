import { readFile } from 'node:fs/promises';

import { poolCategoricalCountsOnce } from './m8-categorical-pooling-utils.mjs';
import { sha256 } from './provider-probe-utils.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TOLERANCE = 1e-12;
const INCLUDED_PERIODS = Object.freeze(['fit', 'validation']);

const DEFAULT_EFFECT_COEFFICIENTS = Object.freeze([
  0,
  0.25,
  0.5,
  0.75,
  1,
  1.25,
  1.5,
]);

export const DEFAULT_M8_COHERENT_MATCHUP_CANDIDATES = Object.freeze(
  DEFAULT_EFFECT_COEFFICIENTS.flatMap((batterCoefficient) =>
    DEFAULT_EFFECT_COEFFICIENTS.map((pitcherAllowedCoefficient) =>
      Object.freeze({
        candidateId: `batter-${batterCoefficient.toFixed(2)}-pitcher-${pitcherAllowedCoefficient.toFixed(2)}`,
        batterCoefficient,
        pitcherAllowedCoefficient,
      }),
    ),
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

function assertNonNegativeFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number.`);
  }
  return value;
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

function validateStrictDistribution(rawDistribution, categories, label) {
  const distribution = assertPlainObject(rawDistribution, label);
  const categorySet = new Set(categories);
  for (const key of Object.keys(distribution)) {
    if (!categorySet.has(key)) {
      throw new Error(`${label} contains unsupported category: ${key}.`);
    }
  }
  let total = 0;
  const result = {};
  for (const category of categories) {
    const probability = distribution[category];
    if (
      typeof probability !== 'number' ||
      !Number.isFinite(probability) ||
      probability <= 0 ||
      probability >= 1
    ) {
      throw new RangeError(`${label}.${category} must be strictly between 0 and 1.`);
    }
    result[category] = probability;
    total += probability;
  }
  if (Math.abs(total - 1) > TOLERANCE) {
    throw new Error(`${label} must sum to 1.`);
  }
  return Object.freeze(result);
}

function validateSinglePassEstimate(rawEstimate, categories, label) {
  const estimate = assertPlainObject(rawEstimate, label);
  if (
    estimate.kind !== 'single-pass-current-season-categorical-pooling' ||
    estimate.poolingPassCount !== 1
  ) {
    throw new Error(
      `${label} must be the direct output of exactly one current-season categorical pooling pass.`,
    );
  }
  return Object.freeze({
    kind: estimate.kind,
    poolingPassCount: 1,
    probabilities: validateStrictDistribution(
      estimate.probabilities,
      categories,
      `${label}.probabilities`,
    ),
  });
}

function validateCandidateGrid(rawCandidates) {
  const candidates = assertArray(rawCandidates, 'candidates').map((raw, index) => {
    const candidate = assertPlainObject(raw, `candidates[${index}]`);
    return Object.freeze({
      candidateId: assertNonEmptyString(
        candidate.candidateId,
        `candidates[${index}].candidateId`,
      ),
      batterCoefficient: assertNonNegativeFinite(
        candidate.batterCoefficient,
        `candidates[${index}].batterCoefficient`,
      ),
      pitcherAllowedCoefficient: assertNonNegativeFinite(
        candidate.pitcherAllowedCoefficient,
        `candidates[${index}].pitcherAllowedCoefficient`,
      ),
    });
  });
  if (candidates.length < 2) {
    throw new RangeError('candidates must contain at least two matchup hypotheses.');
  }
  if (new Set(candidates.map((candidate) => candidate.candidateId)).size !== candidates.length) {
    throw new Error('candidateId values must be unique.');
  }
  return Object.freeze(candidates);
}

function stableSoftmax(logScores, categories) {
  const maximum = Math.max(...categories.map((category) => logScores[category]));
  let denominator = 0;
  const exponentials = {};
  for (const category of categories) {
    const value = Math.exp(logScores[category] - maximum);
    exponentials[category] = value;
    denominator += value;
  }
  if (!(denominator > 0) || !Number.isFinite(denominator)) {
    throw new Error('coherent categorical softmax denominator is invalid.');
  }
  const probabilities = Object.freeze(
    Object.fromEntries(
      categories.map((category) => [category, exponentials[category] / denominator]),
    ),
  );
  let total = 0;
  for (const probability of Object.values(probabilities)) {
    if (!(probability > 0 && probability < 1)) {
      throw new Error('coherent categorical softmax produced an invalid probability.');
    }
    total += probability;
  }
  if (Math.abs(total - 1) > TOLERANCE) {
    throw new Error('coherent categorical softmax probabilities do not sum to 1.');
  }
  return probabilities;
}

export function combineSinglePassCategoricalEffects({
  categories: rawCategories,
  leagueTarget: rawLeagueTarget,
  batterEstimate: rawBatterEstimate,
  pitcherAllowedEstimate: rawPitcherAllowedEstimate,
  batterCoefficient,
  pitcherAllowedCoefficient,
}) {
  const categories = validateCategories(rawCategories);
  const leagueTarget = validateStrictDistribution(
    rawLeagueTarget,
    categories,
    'leagueTarget',
  );
  const batterEstimate = validateSinglePassEstimate(
    rawBatterEstimate,
    categories,
    'batterEstimate',
  );
  const pitcherAllowedEstimate = validateSinglePassEstimate(
    rawPitcherAllowedEstimate,
    categories,
    'pitcherAllowedEstimate',
  );
  const batterWeight = assertNonNegativeFinite(
    batterCoefficient,
    'batterCoefficient',
  );
  const pitcherWeight = assertNonNegativeFinite(
    pitcherAllowedCoefficient,
    'pitcherAllowedCoefficient',
  );

  const logScores = {};
  for (const category of categories) {
    const leagueLog = Math.log(leagueTarget[category]);
    const batterDeviation =
      Math.log(batterEstimate.probabilities[category]) - leagueLog;
    const pitcherDeviation =
      Math.log(pitcherAllowedEstimate.probabilities[category]) - leagueLog;
    logScores[category] =
      leagueLog + batterWeight * batterDeviation + pitcherWeight * pitcherDeviation;
  }

  return Object.freeze({
    kind: 'coherent-current-season-categorical-matchup',
    matchupModelVersion: 1,
    formula:
      'softmax(log(league[c]) + batterCoefficient*log(batter[c]/league[c]) + pitcherAllowedCoefficient*log(pitcherAllowed[c]/league[c]))',
    poolingPassCountPerParameter: 1,
    secondShrinkageAllowed: false,
    batterCoefficient: batterWeight,
    pitcherAllowedCoefficient: pitcherWeight,
    probabilities: stableSoftmax(logScores, categories),
  });
}

function emptyCounts(categories) {
  return Object.fromEntries(categories.map((category) => [category, 0]));
}

function countsByIdentity(observations, identityKey, categories) {
  const counts = new Map();
  for (const observation of observations) {
    const identity = observation[identityKey];
    const current = counts.get(identity) ?? emptyCounts(categories);
    current[observation.terminalCategory] += 1;
    counts.set(identity, current);
  }
  return counts;
}

function leagueCounts(observations, categories) {
  const counts = emptyCounts(categories);
  for (const observation of observations) {
    counts[observation.terminalCategory] += 1;
  }
  return counts;
}

function distributionFromCounts(counts, categories) {
  const total = categories.reduce((sum, category) => sum + counts[category], 0);
  if (total <= 0) {
    throw new Error('fit observations must contain at least one terminal outcome.');
  }
  const result = Object.freeze(
    Object.fromEntries(categories.map((category) => [category, counts[category] / total])),
  );
  return validateStrictDistribution(result, categories, 'current-season league target');
}

function pooledByIdentity({
  identityCounts,
  categories,
  leagueTarget,
  leagueEquivalentPa,
}) {
  const result = new Map();
  for (const [identity, counts] of identityCounts.entries()) {
    result.set(
      identity,
      poolCategoricalCountsOnce({
        categories,
        source: {
          kind: 'raw-current-season-categorical-counts',
          counts,
        },
        leagueTarget,
        leagueEquivalentPa,
      }),
    );
  }
  return result;
}

function unseenEstimate(categories, leagueTarget, leagueEquivalentPa) {
  return poolCategoricalCountsOnce({
    categories,
    source: {
      kind: 'raw-current-season-categorical-counts',
      counts: emptyCounts(categories),
    },
    leagueTarget,
    leagueEquivalentPa,
  });
}

function selectCandidate(results) {
  const sorted = [...results].sort(
    (left, right) =>
      left.validationCategoricalLogLoss - right.validationCategoricalLogLoss ||
      left.candidate.batterCoefficient + left.candidate.pitcherAllowedCoefficient -
        (right.candidate.batterCoefficient + right.candidate.pitcherAllowedCoefficient) ||
      left.candidate.candidateId.localeCompare(right.candidate.candidateId),
  );
  const best = sorted[0];
  const second = sorted[1];
  if (!best || !second) {
    throw new Error('coherent matchup evaluation requires at least two candidates.');
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

export function evaluateCoherentCategoricalMatchupCandidates({
  categories: rawCategories,
  hitCategories: rawHitCategories,
  fitObservations: rawFitObservations,
  validationObservations: rawValidationObservations,
  batterLeagueEquivalentPa,
  pitcherAllowedLeagueEquivalentPa,
  candidates: rawCandidates = DEFAULT_M8_COHERENT_MATCHUP_CANDIDATES,
}) {
  const categories = validateCategories(rawCategories);
  const categorySet = new Set(categories);
  const hitCategories = Object.freeze(
    assertArray(rawHitCategories, 'hitCategories').map((category, index) => {
      const value = assertNonEmptyString(category, `hitCategories[${index}]`);
      if (!categorySet.has(value)) {
        throw new Error(`hitCategories contains unsupported category: ${value}.`);
      }
      return value;
    }),
  );
  if (hitCategories.length === 0 || new Set(hitCategories).size !== hitCategories.length) {
    throw new Error('hitCategories must contain at least one unique category.');
  }
  const fitObservations = assertArray(rawFitObservations, 'fitObservations');
  const validationObservations = assertArray(
    rawValidationObservations,
    'validationObservations',
  );
  if (fitObservations.length === 0 || validationObservations.length === 0) {
    throw new Error('fit and validation observations must both be non-empty.');
  }
  const candidates = validateCandidateGrid(rawCandidates);
  const batterStrength = assertPositiveFinite(
    batterLeagueEquivalentPa,
    'batterLeagueEquivalentPa',
  );
  const pitcherStrength = assertPositiveFinite(
    pitcherAllowedLeagueEquivalentPa,
    'pitcherAllowedLeagueEquivalentPa',
  );

  const leagueCurrentSeasonCounts = leagueCounts(fitObservations, categories);
  for (const category of categories) {
    if (leagueCurrentSeasonCounts[category] <= 0) {
      throw new Error(`fit observations have no support for category ${category}.`);
    }
  }
  const leagueTarget = distributionFromCounts(leagueCurrentSeasonCounts, categories);
  const batterCounts = countsByIdentity(
    fitObservations,
    'providerBatterId',
    categories,
  );
  const pitcherCounts = countsByIdentity(
    fitObservations,
    'providerPitcherId',
    categories,
  );
  const batterEstimates = pooledByIdentity({
    identityCounts: batterCounts,
    categories,
    leagueTarget,
    leagueEquivalentPa: batterStrength,
  });
  const pitcherEstimates = pooledByIdentity({
    identityCounts: pitcherCounts,
    categories,
    leagueTarget,
    leagueEquivalentPa: pitcherStrength,
  });
  const unseenBatterEstimate = unseenEstimate(
    categories,
    leagueTarget,
    batterStrength,
  );
  const unseenPitcherEstimate = unseenEstimate(
    categories,
    leagueTarget,
    pitcherStrength,
  );

  const validationObservationIds = validationObservations.map((observation) =>
    assertNonEmptyString(observation.observationId, 'validation observationId'),
  );
  if (new Set(validationObservationIds).size !== validationObservationIds.length) {
    throw new Error('validation observation identities must be unique.');
  }
  const validationObservationIdsSha256 = sha256(
    JSON.stringify(validationObservationIds),
  );
  const hitCategorySet = new Set(hitCategories);

  const results = Object.freeze(
    candidates.map((candidate) => {
      let categoricalLogLossSum = 0;
      let categoricalBrierSum = 0;
      let hitLogLossSum = 0;
      let hitBrierSum = 0;
      let actualProbabilityMinimum = 1;
      let actualProbabilityMaximum = 0;
      let hitProbabilityMinimum = 1;
      let hitProbabilityMaximum = 0;

      for (const observation of validationObservations) {
        if (!categorySet.has(observation.terminalCategory)) {
          throw new Error(
            `validation contains unsupported terminal category: ${observation.terminalCategory}.`,
          );
        }
        const batterEstimate =
          batterEstimates.get(observation.providerBatterId) ?? unseenBatterEstimate;
        const pitcherEstimate =
          pitcherEstimates.get(observation.providerPitcherId) ?? unseenPitcherEstimate;
        const matchup = combineSinglePassCategoricalEffects({
          categories,
          leagueTarget,
          batterEstimate,
          pitcherAllowedEstimate: pitcherEstimate,
          batterCoefficient: candidate.batterCoefficient,
          pitcherAllowedCoefficient: candidate.pitcherAllowedCoefficient,
        });
        const actualProbability = matchup.probabilities[observation.terminalCategory];
        categoricalLogLossSum += -Math.log(actualProbability);
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
          categoricalBrierSum += (matchup.probabilities[category] - target) ** 2;
        }

        const hitProbability = hitCategories.reduce(
          (sum, category) => sum + matchup.probabilities[category],
          0,
        );
        if (!(hitProbability > 0 && hitProbability < 1)) {
          throw new Error('coherent matchup produced an invalid Hit probability.');
        }
        const hit = hitCategorySet.has(observation.terminalCategory) ? 1 : 0;
        hitLogLossSum +=
          hit === 1 ? -Math.log(hitProbability) : -Math.log(1 - hitProbability);
        hitBrierSum += (hitProbability - hit) ** 2;
        hitProbabilityMinimum = Math.min(hitProbabilityMinimum, hitProbability);
        hitProbabilityMaximum = Math.max(hitProbabilityMaximum, hitProbability);
      }

      const count = validationObservations.length;
      return Object.freeze({
        candidate,
        validationObservationCount: count,
        validationObservationIdsSha256,
        validationCategoricalLogLoss: categoricalLogLossSum / count,
        validationCategoricalBrierScore: categoricalBrierSum / count,
        validationHitLogLoss: hitLogLossSum / count,
        validationHitBrierScore: hitBrierSum / count,
        actualProbabilityMinimum,
        actualProbabilityMaximum,
        hitProbabilityMinimum,
        hitProbabilityMaximum,
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
    throw new Error('matchup candidates did not use one identical validation cohort.');
  }

  return Object.freeze({
    matchupPathVersion: 1,
    modelFamily: 'coherent-softmax-categorical-log-ratio-matchup',
    fittingMethod:
      'grid-select nonnegative global batter and pitcher-allowed log-ratio coefficients by later-validation categorical log loss',
    regularization:
      'one prior single-pass current-season categorical pooling pass per batter and pitcher parameter; no additional player shrinkage',
    rareOutcomeTreatment:
      'positive current-season league-target pseudo-count support from the selected single pooling pass',
    poolingPassCountPerParameter: 1,
    secondShrinkageAllowed: false,
    fitObservationCount: fitObservations.length,
    validationObservationCount: validationObservations.length,
    validationObservationIdsSha256,
    uniqueFitBatterCount: batterCounts.size,
    uniqueFitPitcherCount: pitcherCounts.size,
    unseenValidationBatterCount: new Set(
      validationObservations
        .filter((observation) => !batterCounts.has(observation.providerBatterId))
        .map((observation) => observation.providerBatterId),
    ).size,
    unseenValidationPitcherCount: new Set(
      validationObservations
        .filter((observation) => !pitcherCounts.has(observation.providerPitcherId))
        .map((observation) => observation.providerPitcherId),
    ).size,
    categories,
    hitCategories,
    leagueCurrentSeasonCounts: Object.freeze(leagueCurrentSeasonCounts),
    leagueTarget,
    batterLeagueEquivalentPa: batterStrength,
    pitcherAllowedLeagueEquivalentPa: pitcherStrength,
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

function validateDatasetPeriod(rawPeriod, periodId, categories) {
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
    if (row.mappingStatus !== 'classified-terminal') continue;
    if (row.includedInOverallOutcomeModel !== true) {
      throw new Error('classified terminal row must be overall-outcome eligible.');
    }
    const observationId = assertNonEmptyString(
      row.rowId,
      `periods.${periodId}.rows[${index}].rowId`,
    );
    if (seen.has(observationId)) {
      throw new Error(`${periodId} contains duplicate observationId: ${observationId}.`);
    }
    seen.add(observationId);
    const terminalCategory = assertNonEmptyString(
      row.terminalCategory,
      `${observationId}.terminalCategory`,
    );
    if (!categorySet.has(terminalCategory)) {
      throw new Error(`${observationId} contains unsupported terminal category.`);
    }
    observations.push(
      Object.freeze({
        observationId,
        providerBatterId: assertInteger(
          row.providerBatterId,
          `${observationId}.providerBatterId`,
        ),
        providerPitcherId: assertInteger(
          row.providerPitcherId,
          `${observationId}.providerPitcherId`,
        ),
        terminalCategory,
      }),
    );
  }
  if (
    observations.length !==
    assertNonNegativeInteger(
      period.classifiedTerminalCount,
      `periods.${periodId}.classifiedTerminalCount`,
    )
  ) {
    throw new Error(`${periodId} classifiedTerminalCount does not match usable rows.`);
  }
  return Object.freeze(observations);
}

function validateBoundarySelection(parameter, label) {
  const value = assertPlainObject(parameter, label);
  if (
    value.poolingPassCount !== 1 ||
    value.secondShrinkageAllowed !== false ||
    value.selection?.status !== 'finite-pooling-candidate-selected'
  ) {
    throw new Error(`${label} must contain one selected finite single-pass pooling path.`);
  }
  return assertPositiveFinite(
    value.selection.selectedCandidate?.leagueEquivalentPa,
    `${label}.selected leagueEquivalentPa`,
  );
}

function validateInputs(dataset, datasetText, boundary, boundaryText, categories) {
  const sourceDataset = assertPlainObject(dataset, 'M8 recency dataset');
  if (sourceDataset.datasetVersion !== 2) {
    throw new RangeError('source datasetVersion must equal 2.');
  }
  const datasetSha256 = assertSha256(sourceDataset.datasetSha256, 'datasetSha256');
  if (datasetSha256 !== sha256(JSON.stringify(datasetIdentity(sourceDataset)))) {
    throw new Error('source dataset internal SHA-256 does not match its identity.');
  }
  const untouched = assertPlainObject(
    sourceDataset.untouchedTestReservation,
    'untouchedTestReservation',
  );
  if (untouched.rowsIncluded !== false || Object.hasOwn(untouched, 'rows')) {
    throw new Error('untouched test rows must remain absent from matchup evaluation.');
  }

  const boundaryEvaluation = assertPlainObject(
    boundary,
    'categorical pooling boundary evaluation',
  );
  if (boundaryEvaluation.boundaryEvaluationVersion !== 1) {
    throw new RangeError('boundaryEvaluationVersion must equal 1.');
  }
  if (boundaryEvaluation.sourceDatasetSha256 !== datasetSha256) {
    throw new Error('pooling boundary source dataset SHA-256 drifted.');
  }
  const boundaryEvaluationSha256 = assertSha256(
    boundaryEvaluation.boundaryEvaluationSha256,
    'boundaryEvaluationSha256',
  );
  const expectedBoundaryIdentity = {
    activeSeason: boundaryEvaluation.activeSeason,
    sourceDatasetSha256: boundaryEvaluation.sourceDatasetSha256,
    sourceDatasetFileSha256: boundaryEvaluation.sourceDatasetFileSha256,
    sourceFiniteEvaluationSha256: boundaryEvaluation.sourceFiniteEvaluationSha256,
    categories: boundaryEvaluation.categories,
    finiteCandidates: boundaryEvaluation.finiteCandidates,
    exactLeagueOnlyCandidate: boundaryEvaluation.exactLeagueOnlyCandidate,
    batter: boundaryEvaluation.batter,
    pitcherAllowed: boundaryEvaluation.pitcherAllowed,
    untouchedTestReservation: boundaryEvaluation.untouchedTestReservation,
  };
  if (boundaryEvaluationSha256 !== sha256(JSON.stringify(expectedBoundaryIdentity))) {
    throw new Error('pooling boundary internal SHA-256 does not match its identity.');
  }
  if (JSON.stringify(boundaryEvaluation.categories) !== JSON.stringify(categories)) {
    throw new Error('pooling boundary categories drifted from matchup categories.');
  }
  if (
    boundaryEvaluation.untouchedTestReservation?.rowsIncluded !== false ||
    Object.hasOwn(boundaryEvaluation.untouchedTestReservation ?? {}, 'rows')
  ) {
    throw new Error('pooling boundary must keep untouched test rows sealed.');
  }

  const periods = assertPlainObject(sourceDataset.periods, 'periods');
  const validatedPeriods = Object.fromEntries(
    INCLUDED_PERIODS.map((periodId) => [
      periodId,
      validateDatasetPeriod(periods[periodId], periodId, categories),
    ]),
  );

  return Object.freeze({
    activeSeason: assertInteger(sourceDataset.activeSeason, 'activeSeason'),
    datasetSha256,
    datasetFileSha256: sha256(datasetText),
    boundaryEvaluationSha256,
    boundaryFileSha256: sha256(boundaryText),
    fitObservations: validatedPeriods.fit,
    validationObservations: validatedPeriods.validation,
    batterLeagueEquivalentPa: validateBoundarySelection(
      boundaryEvaluation.batter,
      'boundary batter',
    ),
    pitcherAllowedLeagueEquivalentPa: validateBoundarySelection(
      boundaryEvaluation.pitcherAllowed,
      'boundary pitcherAllowed',
    ),
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

export async function evaluateM8CoherentCategoricalMatchup({
  datasetPath,
  poolingBoundaryPath,
  categories: rawCategories,
  hitCategories: rawHitCategories,
  candidates = DEFAULT_M8_COHERENT_MATCHUP_CANDIDATES,
}) {
  const categories = validateCategories(rawCategories);
  const datasetText = await readFile(
    assertNonEmptyString(datasetPath, 'datasetPath'),
    'utf8',
  );
  const boundaryText = await readFile(
    assertNonEmptyString(poolingBoundaryPath, 'poolingBoundaryPath'),
    'utf8',
  );
  const inputs = validateInputs(
    parseJson(datasetText, 'M8 recency dataset'),
    datasetText,
    parseJson(boundaryText, 'categorical pooling boundary evaluation'),
    boundaryText,
    categories,
  );
  const matchup = evaluateCoherentCategoricalMatchupCandidates({
    categories,
    hitCategories: rawHitCategories,
    fitObservations: inputs.fitObservations,
    validationObservations: inputs.validationObservations,
    batterLeagueEquivalentPa: inputs.batterLeagueEquivalentPa,
    pitcherAllowedLeagueEquivalentPa: inputs.pitcherAllowedLeagueEquivalentPa,
    candidates,
  });
  const evaluationIdentity = {
    activeSeason: inputs.activeSeason,
    sourceDatasetSha256: inputs.datasetSha256,
    sourceDatasetFileSha256: inputs.datasetFileSha256,
    sourcePoolingBoundarySha256: inputs.boundaryEvaluationSha256,
    sourcePoolingBoundaryFileSha256: inputs.boundaryFileSha256,
    categories,
    matchup,
    untouchedTestReservation: inputs.untouchedTestReservation,
  };
  return Object.freeze({
    coherentMatchupEvaluationVersion: 1,
    purpose:
      'Select a coherent current-season batter and pitcher-allowed categorical matchup combination using one softmax-normalized terminal-outcome vector and later validation data.',
    status: 'offline-coherent-matchup-evaluation-not-production-model',
    ...evaluationIdentity,
    coherentMatchupEvaluationSha256: sha256(JSON.stringify(evaluationIdentity)),
  });
}
