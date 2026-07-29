import { readFile } from 'node:fs/promises';

import { poolCategoricalCountsOnce } from './m8-categorical-pooling-utils.mjs';
import { applyPlatoonDeviation } from './m8-resolved-categorical-platoon-utils.mjs';
import {
  M8_EXACT_RAW_LEAGUE_PLATOON_PRIOR_ID,
} from './m8-resolved-categorical-platoon-boundary-utils.mjs';
import {
  evaluateFrozenPlatoonCandidateCohort,
  evaluateResolvedCategoricalPlatoonWalkForward,
} from './m8-resolved-categorical-platoon-walk-forward-utils.mjs';
import { sha256 } from './provider-probe-utils.mjs';

const TOLERANCE = 1e-12;
const VALID_HANDS = new Set(['L', 'R']);
const MATCHUP_KEYS = Object.freeze(['L-vs-L', 'L-vs-R', 'R-vs-L', 'R-vs-R']);
const WILSON_95_Z = 1.959963984540054;

export const M8_RARE_OUTCOME_FOCUS_CATEGORIES = Object.freeze([
  'HR',
  '3B',
  'IBB',
  'CATCHER_INTERFERENCE',
  'OTHER_PA',
]);

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

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  return value;
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function assertPositiveFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`);
  }
  return value;
}

function assertNonNegativeFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number.`);
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

function validateStringList(rawValues, label, minimumLength = 1) {
  const values = assertArray(rawValues, label).map((value, index) =>
    assertNonEmptyString(value, `${label}[${index}]`),
  );
  if (values.length < minimumLength || new Set(values).size !== values.length) {
    throw new Error(`${label} must contain at least ${minimumLength} unique values.`);
  }
  return Object.freeze(values);
}

function emptyCounts(categories) {
  return Object.fromEntries(categories.map((category) => [category, 0]));
}

function normalizePositiveWeights(rawWeights, categories, label) {
  let total = 0;
  const probabilities = {};
  for (const category of categories) {
    const value = rawWeights[category];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`${label}.${category} must be positive and finite.`);
    }
    probabilities[category] = value;
    total += value;
  }
  if (!(total > 0) || !Number.isFinite(total)) {
    throw new Error(`${label} has an invalid total.`);
  }
  for (const category of categories) probabilities[category] /= total;
  const normalizedTotal = Object.values(probabilities).reduce(
    (sum, value) => sum + value,
    0,
  );
  if (Math.abs(normalizedTotal - 1) > TOLERANCE) {
    throw new Error(`${label} does not sum to 1.`);
  }
  return Object.freeze(probabilities);
}

function distributionFromCounts(counts, categories, label) {
  const total = categories.reduce((sum, category) => sum + counts[category], 0);
  if (!(total > 0)) throw new Error(`${label} has no observations.`);
  return normalizePositiveWeights(
    Object.fromEntries(categories.map((category) => [category, counts[category] / total])),
    categories,
    label,
  );
}

function stableSoftmax(logScores, categories) {
  const maximum = Math.max(...categories.map((category) => logScores[category]));
  const weights = {};
  let total = 0;
  for (const category of categories) {
    const value = Math.exp(logScores[category] - maximum);
    weights[category] = value;
    total += value;
  }
  return normalizePositiveWeights(
    Object.fromEntries(categories.map((category) => [category, weights[category] / total])),
    categories,
    'rare-outcome categorical probabilities',
  );
}

function matchupKey(batterSide, pitcherHand) {
  if (!VALID_HANDS.has(batterSide) || !VALID_HANDS.has(pitcherHand)) {
    throw new Error('rare-outcome evaluation requires normalized L/R handedness.');
  }
  return `${batterSide}-vs-${pitcherHand}`;
}

function splitIdentity(batterId, key) {
  return `${batterId}|${key}`;
}

function leagueCounts(observations, categories) {
  const counts = emptyCounts(categories);
  for (const observation of observations) counts[observation.terminalCategory] += 1;
  return Object.freeze(counts);
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

function countsByMatchup(observations, categories) {
  const counts = new Map();
  for (const observation of observations) {
    const current = counts.get(observation.matchupKey) ?? emptyCounts(categories);
    current[observation.terminalCategory] += 1;
    counts.set(observation.matchupKey, current);
  }
  return counts;
}

function countsByBatterSplit(observations, categories) {
  const counts = new Map();
  for (const observation of observations) {
    const identity = splitIdentity(observation.providerBatterId, observation.matchupKey);
    const current = counts.get(identity) ?? emptyCounts(categories);
    current[observation.terminalCategory] += 1;
    counts.set(identity, current);
  }
  return counts;
}

function pooledIdentityEstimates({
  observations,
  identityKey,
  categories,
  leagueTarget,
  strength,
}) {
  const counts = countsByIdentity(observations, identityKey, categories);
  const estimates = new Map();
  for (const [identity, identityCounts] of counts.entries()) {
    estimates.set(
      identity,
      poolCategoricalCountsOnce({
        categories,
        source: {
          kind: 'raw-current-season-categorical-counts',
          counts: identityCounts,
        },
        leagueTarget,
        leagueEquivalentPa: strength,
      }).probabilities,
    );
  }
  return Object.freeze({ counts, estimates });
}

function unseenEstimate(categories, leagueTarget, strength) {
  return poolCategoricalCountsOnce({
    categories,
    source: {
      kind: 'raw-current-season-categorical-counts',
      counts: emptyCounts(categories),
    },
    leagueTarget,
    leagueEquivalentPa: strength,
  }).probabilities;
}

function assertRawMatchupSupport(matchupCounts, categories) {
  const support = {};
  for (const key of MATCHUP_KEYS) {
    const counts = matchupCounts.get(key);
    if (!counts) throw new Error(`raw league-platoon cell ${key} has no training observations.`);
    const zeroCategories = categories.filter((category) => counts[category] === 0);
    if (zeroCategories.length > 0) {
      throw new Error(
        `raw league-platoon cell ${key} has zero support for ${zeroCategories.join(', ')}.`,
      );
    }
    support[key] = Object.freeze({ ...counts });
  }
  return Object.freeze(support);
}

function leagueMatchupTarget({ candidate, rawCounts, categories, leagueTarget }) {
  if (candidate.leaguePlatoonExactTarget === true) return leagueTarget;
  return poolCategoricalCountsOnce({
    categories,
    source: {
      kind: 'raw-current-season-categorical-counts',
      counts: rawCounts,
    },
    leagueTarget,
    leagueEquivalentPa: assertPositiveFinite(
      candidate.leaguePlatoonEquivalentPa,
      `${candidate.candidateId}.leaguePlatoonEquivalentPa`,
    ),
  }).probabilities;
}

function playerLeagueAdjustedTarget({
  batterOverall,
  leagueMatchup,
  leagueTarget,
  categories,
}) {
  return normalizePositiveWeights(
    Object.fromEntries(
      categories.map((category) => [
        category,
        batterOverall[category] * (leagueMatchup[category] / leagueTarget[category]),
      ]),
    ),
    categories,
    'rare-outcome player overall plus league platoon target',
  );
}

function playerSplitEstimate({ candidate, rawCounts, target, categories }) {
  if (candidate.playerSplitExactTarget === true) return target;
  return poolCategoricalCountsOnce({
    categories,
    source: {
      kind: 'raw-current-season-categorical-counts',
      counts: rawCounts ?? emptyCounts(categories),
    },
    leagueTarget: target,
    leagueEquivalentPa: assertPositiveFinite(
      candidate.playerSplitEquivalentPa,
      `${candidate.candidateId}.playerSplitEquivalentPa`,
    ),
  }).probabilities;
}

function coherentMatchup({
  categories,
  leagueTarget,
  batterVector,
  pitcherVector,
  batterCoefficient,
  pitcherAllowedCoefficient,
}) {
  return stableSoftmax(
    Object.fromEntries(
      categories.map((category) => {
        const leagueLog = Math.log(leagueTarget[category]);
        return [
          category,
          leagueLog +
            batterCoefficient * (Math.log(batterVector[category]) - leagueLog) +
            pitcherAllowedCoefficient *
              (Math.log(pitcherVector[category]) - leagueLog),
        ];
      }),
    ),
    categories,
  );
}

function validateCandidate(rawCandidate, label) {
  const candidate = assertPlainObject(rawCandidate, label);
  const candidateId = assertNonEmptyString(candidate.candidateId, `${label}.candidateId`);
  const coefficient = assertNonNegativeFinite(
    candidate.platoonCoefficient,
    `${candidateId}.platoonCoefficient`,
  );
  if (coefficient === 0) {
    if (candidateId !== 'no-platoon') {
      throw new Error('zero platoon coefficient must use the no-platoon candidate.');
    }
    return candidate;
  }
  assertNonEmptyString(
    candidate.leaguePlatoonPriorId,
    `${candidateId}.leaguePlatoonPriorId`,
  );
  assertNonEmptyString(
    candidate.playerSplitPriorId,
    `${candidateId}.playerSplitPriorId`,
  );
  if (candidate.leaguePlatoonExactTarget !== true) {
    assertPositiveFinite(
      candidate.leaguePlatoonEquivalentPa,
      `${candidateId}.leaguePlatoonEquivalentPa`,
    );
  }
  if (candidate.playerSplitExactTarget !== true) {
    assertPositiveFinite(
      candidate.playerSplitEquivalentPa,
      `${candidateId}.playerSplitEquivalentPa`,
    );
  }
  return candidate;
}

function validateObservation(rawObservation, label, categories) {
  const observation = assertPlainObject(rawObservation, label);
  const terminalCategory = assertNonEmptyString(
    observation.terminalCategory,
    `${label}.terminalCategory`,
  );
  if (!categories.includes(terminalCategory)) {
    throw new Error(`${label} contains non-modeled category ${terminalCategory}.`);
  }
  const normalizedBatterSide = assertNonEmptyString(
    observation.normalizedBatterSide,
    `${label}.normalizedBatterSide`,
  );
  const normalizedPitcherHand = assertNonEmptyString(
    observation.normalizedPitcherHand,
    `${label}.normalizedPitcherHand`,
  );
  const expectedMatchupKey = matchupKey(normalizedBatterSide, normalizedPitcherHand);
  if (observation.matchupKey !== expectedMatchupKey) {
    throw new Error(`${label}.matchupKey drifted from normalized handedness.`);
  }
  return Object.freeze({
    observationId: assertNonEmptyString(
      observation.observationId,
      `${label}.observationId`,
    ),
    observedDate: assertNonEmptyString(
      observation.observedDate,
      `${label}.observedDate`,
    ),
    providerBatterId: assertPositiveInteger(
      observation.providerBatterId,
      `${label}.providerBatterId`,
    ),
    providerPitcherId: assertPositiveInteger(
      observation.providerPitcherId,
      `${label}.providerPitcherId`,
    ),
    terminalCategory,
    platoonEligible: true,
    normalizedBatterSide,
    normalizedPitcherHand,
    matchupKey: expectedMatchupKey,
  });
}

function metricsFromPredictions(predictions, categories, hitCategories, candidate, rawSupport) {
  const hitSet = new Set(hitCategories);
  let categoricalLogLoss = 0;
  let categoricalBrier = 0;
  let hitLogLoss = 0;
  let hitBrier = 0;
  let actualProbabilityMinimum = 1;
  let actualProbabilityMaximum = 0;
  let hitProbabilityMinimum = 1;
  let hitProbabilityMaximum = 0;

  for (const prediction of predictions) {
    const actualProbability = prediction.probabilities[prediction.terminalCategory];
    categoricalLogLoss += -Math.log(actualProbability);
    actualProbabilityMinimum = Math.min(actualProbabilityMinimum, actualProbability);
    actualProbabilityMaximum = Math.max(actualProbabilityMaximum, actualProbability);
    for (const category of categories) {
      const target = category === prediction.terminalCategory ? 1 : 0;
      categoricalBrier += (prediction.probabilities[category] - target) ** 2;
    }
    const hit = hitSet.has(prediction.terminalCategory) ? 1 : 0;
    hitLogLoss +=
      hit === 1
        ? -Math.log(prediction.hitProbability)
        : -Math.log(1 - prediction.hitProbability);
    hitBrier += (prediction.hitProbability - hit) ** 2;
    hitProbabilityMinimum = Math.min(
      hitProbabilityMinimum,
      prediction.hitProbability,
    );
    hitProbabilityMaximum = Math.max(
      hitProbabilityMaximum,
      prediction.hitProbability,
    );
  }

  const count = predictions.length;
  return Object.freeze({
    candidate,
    validationObservationCount: count,
    validationObservationIdsSha256: sha256(
      JSON.stringify(predictions.map((prediction) => prediction.observationId)),
    ),
    validationCategoricalLogLoss: categoricalLogLoss / count,
    validationCategoricalBrierScore: categoricalBrier / count,
    validationHitLogLoss: hitLogLoss / count,
    validationHitBrierScore: hitBrier / count,
    actualProbabilityMinimum,
    actualProbabilityMaximum,
    hitProbabilityMinimum,
    hitProbabilityMaximum,
    rawMatchupSupport: rawSupport,
  });
}

export function predictFrozenPlatoonCandidateCohort({
  categories: rawCategories,
  hitCategories: rawHitCategories,
  trainingOverall: rawTrainingOverall,
  trainingPlatoon: rawTrainingPlatoon,
  validationPlatoon: rawValidationPlatoon,
  baseParameters: rawBaseParameters,
  candidate: rawCandidate,
}) {
  const categories = validateStringList(rawCategories, 'categories', 2);
  const hitCategories = validateStringList(rawHitCategories, 'hitCategories', 1);
  const categorySet = new Set(categories);
  for (const category of hitCategories) {
    if (!categorySet.has(category)) throw new Error(`hit category ${category} is not modeled.`);
  }
  const trainingOverall = assertArray(rawTrainingOverall, 'trainingOverall');
  const trainingPlatoon = assertArray(rawTrainingPlatoon, 'trainingPlatoon');
  const validationPlatoon = assertArray(rawValidationPlatoon, 'validationPlatoon').map(
    (observation, index) =>
      validateObservation(observation, `validationPlatoon[${index}]`, categories),
  );
  if (
    trainingOverall.length === 0 ||
    trainingPlatoon.length === 0 ||
    validationPlatoon.length === 0
  ) {
    throw new Error('rare-outcome prediction cohorts must be non-empty.');
  }
  const baseParameters = assertPlainObject(rawBaseParameters, 'baseParameters');
  const candidate = validateCandidate(rawCandidate, 'candidate');
  const batterPooling = assertPositiveFinite(
    baseParameters.batterPooling,
    'baseParameters.batterPooling',
  );
  const pitcherPooling = assertPositiveFinite(
    baseParameters.pitcherPooling,
    'baseParameters.pitcherPooling',
  );
  const batterCoefficient = assertNonNegativeFinite(
    baseParameters.batterCoefficient,
    'baseParameters.batterCoefficient',
  );
  const pitcherAllowedCoefficient = assertNonNegativeFinite(
    baseParameters.pitcherAllowedCoefficient,
    'baseParameters.pitcherAllowedCoefficient',
  );

  const fitLeagueCounts = leagueCounts(trainingOverall, categories);
  const leagueTarget = distributionFromCounts(
    fitLeagueCounts,
    categories,
    'rare-outcome current-season league distribution',
  );
  const batter = pooledIdentityEstimates({
    observations: trainingOverall,
    identityKey: 'providerBatterId',
    categories,
    leagueTarget,
    strength: batterPooling,
  });
  const pitcher = pooledIdentityEstimates({
    observations: trainingOverall,
    identityKey: 'providerPitcherId',
    categories,
    leagueTarget,
    strength: pitcherPooling,
  });
  const unseenBatter = unseenEstimate(categories, leagueTarget, batterPooling);
  const unseenPitcher = unseenEstimate(categories, leagueTarget, pitcherPooling);
  const matchupCounts = countsByMatchup(trainingPlatoon, categories);
  const splitCounts = countsByBatterSplit(trainingPlatoon, categories);
  const rawSupport =
    candidate.leaguePlatoonPriorId === M8_EXACT_RAW_LEAGUE_PLATOON_PRIOR_ID
      ? assertRawMatchupSupport(matchupCounts, categories)
      : null;
  const leagueByMatchup = new Map();
  const splitByIdentity = new Map();

  const predictions = validationPlatoon.map((observation) => {
    const batterOverall =
      batter.estimates.get(observation.providerBatterId) ?? unseenBatter;
    const pitcherVector =
      pitcher.estimates.get(observation.providerPitcherId) ?? unseenPitcher;
    let batterVector = batterOverall;
    if (candidate.platoonCoefficient > 0) {
      if (!leagueByMatchup.has(observation.matchupKey)) {
        leagueByMatchup.set(
          observation.matchupKey,
          leagueMatchupTarget({
            candidate,
            rawCounts: matchupCounts.get(observation.matchupKey),
            categories,
            leagueTarget,
          }),
        );
      }
      const identity = splitIdentity(
        observation.providerBatterId,
        observation.matchupKey,
      );
      if (!splitByIdentity.has(identity)) {
        const target = playerLeagueAdjustedTarget({
          batterOverall,
          leagueMatchup: leagueByMatchup.get(observation.matchupKey),
          leagueTarget,
          categories,
        });
        splitByIdentity.set(
          identity,
          playerSplitEstimate({
            candidate,
            rawCounts: splitCounts.get(identity),
            target,
            categories,
          }),
        );
      }
      batterVector = applyPlatoonDeviation({
        categories,
        batterOverall,
        playerSplit: splitByIdentity.get(identity),
        platoonCoefficient: candidate.platoonCoefficient,
      });
    }

    const probabilities = coherentMatchup({
      categories,
      leagueTarget,
      batterVector,
      pitcherVector,
      batterCoefficient,
      pitcherAllowedCoefficient,
    });
    const hitProbability = hitCategories.reduce(
      (sum, category) => sum + probabilities[category],
      0,
    );
    if (!(hitProbability > 0 && hitProbability < 1)) {
      throw new Error('rare-outcome scorer produced an invalid Hit probability.');
    }
    return Object.freeze({
      observationId: observation.observationId,
      observedDate: observation.observedDate,
      terminalCategory: observation.terminalCategory,
      probabilities,
      hitProbability,
    });
  });

  return Object.freeze({
    predictions: Object.freeze(predictions),
    metrics: metricsFromPredictions(
      predictions,
      categories,
      hitCategories,
      candidate,
      rawSupport,
    ),
  });
}

function metricEquivalence(left, right, label) {
  const fields = [
    'validationCategoricalLogLoss',
    'validationCategoricalBrierScore',
    'validationHitLogLoss',
    'validationHitBrierScore',
    'actualProbabilityMinimum',
    'actualProbabilityMaximum',
    'hitProbabilityMinimum',
    'hitProbabilityMaximum',
  ];
  const differences = {};
  let maximumDifference = 0;
  if (
    left.validationObservationCount !== right.validationObservationCount ||
    left.validationObservationIdsSha256 !== right.validationObservationIdsSha256
  ) {
    throw new Error(`${label} cohort identity drifted.`);
  }
  for (const field of fields) {
    const difference = Math.abs(left[field] - right[field]);
    differences[field] = difference;
    maximumDifference = Math.max(maximumDifference, difference);
    if (difference > TOLERANCE) {
      throw new Error(`${label}.${field} drifted by ${difference}.`);
    }
  }
  return Object.freeze({
    differences: Object.freeze(differences),
    maximumDifference,
  });
}

export function wilsonScoreInterval95(successes, trials) {
  const successCount = assertNonNegativeInteger(successes, 'successes');
  const trialCount = assertNonNegativeInteger(trials, 'trials');
  if (successCount > trialCount) {
    throw new RangeError('successes must not exceed trials.');
  }
  if (trialCount === 0) return null;
  const p = successCount / trialCount;
  const z2 = WILSON_95_Z ** 2;
  const denominator = 1 + z2 / trialCount;
  const center = (p + z2 / (2 * trialCount)) / denominator;
  const halfWidth =
    (WILSON_95_Z /
      denominator) *
    Math.sqrt(
      (p * (1 - p)) / trialCount + z2 / (4 * trialCount ** 2),
    );
  return Object.freeze({
    confidenceLevel: 0.95,
    method: 'wilson-score',
    lower: Math.max(0, center - halfWidth),
    upper: Math.min(1, center + halfWidth),
    width: Math.min(1, center + halfWidth) - Math.max(0, center - halfWidth),
  });
}

function categoryEvidenceStatus({
  category,
  modeledCategorySet,
  fitOverallCount,
  validationObservedCount,
}) {
  if (!modeledCategorySet.has(category)) {
    return 'structural-zero-unobserved-not-production-validated';
  }
  if (fitOverallCount === 0) {
    return 'insufficient-zero-fit-support';
  }
  if (validationObservedCount === 0) {
    return 'insufficient-zero-validation-events';
  }
  return 'reported-with-current-season-uncertainty-no-hard-threshold';
}

export function summarizeCategoricalPredictions({
  canonicalCategories: rawCanonicalCategories,
  modeledCategories: rawModeledCategories,
  hitCategories: rawHitCategories,
  focusCategories: rawFocusCategories = M8_RARE_OUTCOME_FOCUS_CATEGORIES,
  fitOverall: rawFitOverall,
  fitPlatoon: rawFitPlatoon,
  predictions: rawPredictions,
}) {
  const canonicalCategories = validateStringList(
    rawCanonicalCategories,
    'canonicalCategories',
    2,
  );
  const modeledCategories = validateStringList(
    rawModeledCategories,
    'modeledCategories',
    2,
  );
  const hitCategories = validateStringList(rawHitCategories, 'hitCategories', 1);
  const focusCategories = validateStringList(
    rawFocusCategories,
    'focusCategories',
    1,
  );
  const canonicalSet = new Set(canonicalCategories);
  const modeledSet = new Set(modeledCategories);
  for (const category of modeledCategories) {
    if (!canonicalSet.has(category)) {
      throw new Error(`modeled category ${category} is not canonical.`);
    }
  }
  for (const category of [...hitCategories, ...focusCategories]) {
    if (!canonicalSet.has(category)) {
      throw new Error(`requested category ${category} is not canonical.`);
    }
  }
  const fitOverall = assertArray(rawFitOverall, 'fitOverall');
  const fitPlatoon = assertArray(rawFitPlatoon, 'fitPlatoon');
  const predictions = assertArray(rawPredictions, 'predictions');
  if (predictions.length === 0) {
    throw new Error('rare-outcome uncertainty requires predictions.');
  }

  const fitOverallCounts = emptyCounts(canonicalCategories);
  const fitPlatoonCounts = emptyCounts(canonicalCategories);
  for (const observation of fitOverall) {
    const category = assertNonEmptyString(
      observation.terminalCategory,
      'fitOverall terminalCategory',
    );
    if (!modeledSet.has(category)) {
      throw new Error(`fitOverall contains non-modeled category ${category}.`);
    }
    fitOverallCounts[category] += 1;
  }
  for (const observation of fitPlatoon) {
    const category = assertNonEmptyString(
      observation.terminalCategory,
      'fitPlatoon terminalCategory',
    );
    if (!modeledSet.has(category)) {
      throw new Error(`fitPlatoon contains non-modeled category ${category}.`);
    }
    fitPlatoonCounts[category] += 1;
  }

  const accumulators = Object.fromEntries(
    canonicalCategories.map((category) => [
      category,
      {
        observedCount: 0,
        expectedCount: 0,
        predictedCountVariance: 0,
        binaryLogLossTotal: 0,
        binaryBrierTotal: 0,
        observedClassLogLossTotal: 0,
        predictedMinimum: modeledSet.has(category) ? 1 : 0,
        predictedMaximum: 0,
      },
    ]),
  );
  let hitObservedCount = 0;
  let hitExpectedCount = 0;
  let hitVariance = 0;
  let hitLogLossTotal = 0;
  let hitBrierTotal = 0;
  let hitProbabilityMinimum = 1;
  let hitProbabilityMaximum = 0;
  const hitSet = new Set(hitCategories);

  for (const [index, rawPrediction] of predictions.entries()) {
    const prediction = assertPlainObject(rawPrediction, `predictions[${index}]`);
    const actual = assertNonEmptyString(
      prediction.terminalCategory,
      `predictions[${index}].terminalCategory`,
    );
    if (!modeledSet.has(actual)) {
      throw new Error(`prediction actual category ${actual} is not modeled.`);
    }
    const probabilities = assertPlainObject(
      prediction.probabilities,
      `predictions[${index}].probabilities`,
    );
    let probabilityTotal = 0;
    for (const category of modeledCategories) {
      const probability = probabilities[category];
      if (
        typeof probability !== 'number' ||
        !Number.isFinite(probability) ||
        probability <= 0 ||
        probability >= 1
      ) {
        throw new Error(
          `predictions[${index}].probabilities.${category} must lie strictly between 0 and 1.`,
        );
      }
      probabilityTotal += probability;
      const target = category === actual ? 1 : 0;
      const accumulator = accumulators[category];
      accumulator.expectedCount += probability;
      accumulator.predictedCountVariance += probability * (1 - probability);
      accumulator.binaryLogLossTotal +=
        target === 1 ? -Math.log(probability) : -Math.log(1 - probability);
      accumulator.binaryBrierTotal += (probability - target) ** 2;
      accumulator.predictedMinimum = Math.min(
        accumulator.predictedMinimum,
        probability,
      );
      accumulator.predictedMaximum = Math.max(
        accumulator.predictedMaximum,
        probability,
      );
    }
    if (Math.abs(probabilityTotal - 1) > TOLERANCE) {
      throw new Error(`prediction ${index} probabilities do not sum to 1.`);
    }
    accumulators[actual].observedCount += 1;
    accumulators[actual].observedClassLogLossTotal +=
      -Math.log(probabilities[actual]);

    const hitProbability = assertPositiveFinite(
      prediction.hitProbability,
      `predictions[${index}].hitProbability`,
    );
    if (!(hitProbability < 1)) {
      throw new Error(`predictions[${index}].hitProbability must be below 1.`);
    }
    const hit = hitSet.has(actual) ? 1 : 0;
    hitObservedCount += hit;
    hitExpectedCount += hitProbability;
    hitVariance += hitProbability * (1 - hitProbability);
    hitLogLossTotal +=
      hit === 1 ? -Math.log(hitProbability) : -Math.log(1 - hitProbability);
    hitBrierTotal += (hitProbability - hit) ** 2;
    hitProbabilityMinimum = Math.min(hitProbabilityMinimum, hitProbability);
    hitProbabilityMaximum = Math.max(hitProbabilityMaximum, hitProbability);
  }

  const validationCount = predictions.length;
  const categoryReports = {};
  for (const category of canonicalCategories) {
    const accumulator = accumulators[category];
    const modeled = modeledSet.has(category);
    if (!modeled) {
      if (
        fitOverallCounts[category] !== 0 ||
        fitPlatoonCounts[category] !== 0 ||
        accumulator.observedCount !== 0 ||
        accumulator.expectedCount !== 0
      ) {
        throw new Error(
          `structural-zero category ${category} contains observations or probability mass.`,
        );
      }
    }
    const observedRate = accumulator.observedCount / validationCount;
    const meanPredictedProbability = accumulator.expectedCount / validationCount;
    const interval = wilsonScoreInterval95(
      accumulator.observedCount,
      validationCount,
    );
    categoryReports[category] = Object.freeze({
      category,
      modeled,
      fitOverallCount: fitOverallCounts[category],
      fitPlatoonCount: fitPlatoonCounts[category],
      validationObservationCount: validationCount,
      validationObservedCount: accumulator.observedCount,
      validationObservedRate: observedRate,
      validationObservedRateWilson95: interval,
      validationExpectedCount: accumulator.expectedCount,
      meanPredictedProbability,
      calibrationGapObservedMinusPredicted:
        observedRate - meanPredictedProbability,
      intervalContainsMeanPrediction:
        interval === null
          ? null
          : meanPredictedProbability >= interval.lower &&
            meanPredictedProbability <= interval.upper,
      predictedCountVariance: accumulator.predictedCountVariance,
      standardizedCountResidual:
        accumulator.predictedCountVariance > 0
          ? (accumulator.observedCount - accumulator.expectedCount) /
            Math.sqrt(accumulator.predictedCountVariance)
          : null,
      oneVsRestLogLoss:
        accumulator.binaryLogLossTotal / validationCount,
      oneVsRestBrier: accumulator.binaryBrierTotal / validationCount,
      observedClassMeanCategoricalLogLoss:
        accumulator.observedCount > 0
          ? accumulator.observedClassLogLossTotal / accumulator.observedCount
          : null,
      categoricalLogLossContributionPerValidationObservation:
        accumulator.observedClassLogLossTotal / validationCount,
      predictedProbabilityMinimum: modeled
        ? accumulator.predictedMinimum
        : 0,
      predictedProbabilityMaximum: accumulator.predictedMaximum,
      evidenceStatus: categoryEvidenceStatus({
        category,
        modeledCategorySet: modeledSet,
        fitOverallCount: fitOverallCounts[category],
        validationObservedCount: accumulator.observedCount,
      }),
      automaticInsufficientEvidence:
        !modeled ||
        fitOverallCounts[category] === 0 ||
        accumulator.observedCount === 0,
    });
  }

  const observedTotal = Object.values(categoryReports).reduce(
    (sum, report) => sum + report.validationObservedCount,
    0,
  );
  const expectedTotal = Object.values(categoryReports).reduce(
    (sum, report) => sum + report.validationExpectedCount,
    0,
  );
  if (observedTotal !== validationCount) {
    throw new Error('category observed counts do not conserve validation rows.');
  }
  if (Math.abs(expectedTotal - validationCount) > TOLERANCE * validationCount) {
    throw new Error('category expected counts do not conserve probability mass.');
  }

  const hitObservedRate = hitObservedCount / validationCount;
  const hitPredictedRate = hitExpectedCount / validationCount;
  const hitInterval = wilsonScoreInterval95(hitObservedCount, validationCount);
  const hitSummary = Object.freeze({
    validationObservationCount: validationCount,
    validationObservedCount: hitObservedCount,
    validationObservedRate: hitObservedRate,
    validationObservedRateWilson95: hitInterval,
    validationExpectedCount: hitExpectedCount,
    meanPredictedProbability: hitPredictedRate,
    calibrationGapObservedMinusPredicted:
      hitObservedRate - hitPredictedRate,
    intervalContainsMeanPrediction:
      hitPredictedRate >= hitInterval.lower && hitPredictedRate <= hitInterval.upper,
    predictedCountVariance: hitVariance,
    standardizedCountResidual:
      hitVariance > 0
        ? (hitObservedCount - hitExpectedCount) / Math.sqrt(hitVariance)
        : null,
    binaryLogLoss: hitLogLossTotal / validationCount,
    binaryBrier: hitBrierTotal / validationCount,
    predictedProbabilityMinimum: hitProbabilityMinimum,
    predictedProbabilityMaximum: hitProbabilityMaximum,
  });

  const focusReports = Object.freeze(
    Object.fromEntries(
      focusCategories.map((category) => [category, categoryReports[category]]),
    ),
  );
  const automaticInsufficientCategories = Object.freeze(
    canonicalCategories.filter(
      (category) => categoryReports[category].automaticInsufficientEvidence,
    ),
  );

  return Object.freeze({
    validationObservationCount: validationCount,
    canonicalCategories,
    modeledCategories,
    structuralZeroCategories: Object.freeze(
      canonicalCategories.filter((category) => !modeledSet.has(category)),
    ),
    focusCategories,
    categoryReports: Object.freeze(categoryReports),
    focusReports,
    hitSummary,
    conservation: Object.freeze({
      observedCountTotal: observedTotal,
      expectedCountTotal: expectedTotal,
      expectedMinusObserved: expectedTotal - observedTotal,
    }),
    evidenceDecision: Object.freeze({
      hardSampleThresholdApplied: false,
      priorSeasonRowsUsed: false,
      automaticInsufficientCategories,
      nonzeroCategoriesCarryReportedUncertaintyWithoutInventedCutoff: true,
      productionValidated: false,
      remainingGate:
        'Category and Hit probabilities still require approved calibration, probability-bucket reporting, and the untouched latest-current-season test before production ranking.',
    }),
  });
}

function sourceObservation(rawRow, periodId, index, modeledCategorySet) {
  const label = `periods.${periodId}.rows[${index}]`;
  const row = assertPlainObject(rawRow, label);
  if (row.mappingStatus !== 'classified-terminal') return null;
  if (row.includedInOverallOutcomeModel !== true) {
    throw new Error(`${label} classified terminal row must be overall eligible.`);
  }
  const terminalCategory = assertNonEmptyString(
    row.terminalCategory,
    `${label}.terminalCategory`,
  );
  if (!modeledCategorySet.has(terminalCategory)) {
    throw new Error(`${label} contains a non-modeled terminal category.`);
  }
  const batterSide = VALID_HANDS.has(row.normalizedBatterSide)
    ? row.normalizedBatterSide
    : null;
  const pitcherHand = VALID_HANDS.has(row.normalizedPitcherHand)
    ? row.normalizedPitcherHand
    : null;
  const handednessUsable = batterSide !== null && pitcherHand !== null;
  const platoonEligible = row.includedInPlatoonModel === true;
  if (platoonEligible !== handednessUsable) {
    throw new Error(`${label} platoon eligibility drifted from normalized handedness.`);
  }
  return Object.freeze({
    observationId: assertNonEmptyString(row.rowId, `${label}.rowId`),
    observedDate: assertNonEmptyString(row.observedDate, `${label}.observedDate`),
    providerBatterId: assertPositiveInteger(
      row.providerBatterId,
      `${label}.providerBatterId`,
    ),
    providerPitcherId: assertPositiveInteger(
      row.providerPitcherId,
      `${label}.providerPitcherId`,
    ),
    terminalCategory,
    platoonEligible,
    normalizedBatterSide: batterSide,
    normalizedPitcherHand: pitcherHand,
    matchupKey: platoonEligible ? matchupKey(batterSide, pitcherHand) : null,
  });
}

function extractObservations(dataset, modeledCategories) {
  const modeledCategorySet = new Set(modeledCategories);
  const periods = assertPlainObject(dataset.periods, 'dataset periods');
  const extracted = {};
  const seen = new Set();
  for (const periodId of ['fit', 'validation']) {
    const period = assertPlainObject(periods[periodId], `periods.${periodId}`);
    const rows = assertArray(period.rows, `periods.${periodId}.rows`);
    const overall = [];
    const platoon = [];
    for (const [index, row] of rows.entries()) {
      const observation = sourceObservation(
        row,
        periodId,
        index,
        modeledCategorySet,
      );
      if (observation === null) continue;
      if (seen.has(observation.observationId)) {
        throw new Error(`duplicate fit-validation observation ${observation.observationId}.`);
      }
      seen.add(observation.observationId);
      overall.push(observation);
      if (observation.platoonEligible) platoon.push(observation);
    }
    if (overall.length !== period.classifiedTerminalCount) {
      throw new Error(`${periodId} classified terminal count drifted.`);
    }
    if (platoon.length !== period.platoonEligibleCount) {
      throw new Error(`${periodId} platoon eligible count drifted.`);
    }
    extracted[periodId] = Object.freeze({
      overall: Object.freeze(overall),
      platoon: Object.freeze(platoon),
    });
  }
  return Object.freeze({
    fitOverall: extracted.fit.overall,
    fitPlatoon: extracted.fit.platoon,
    validationOverall: extracted.validation.overall,
    validationPlatoon: extracted.validation.platoon,
  });
}

function validateWalkForwardArtifact(actual, expected, actualText) {
  const artifact = assertPlainObject(actual, 'platoon walk-forward artifact');
  if (
    artifact.platoonWalkForwardSha256 !== expected.platoonWalkForwardSha256 ||
    JSON.stringify(artifact) !== JSON.stringify(expected)
  ) {
    throw new Error(
      'platoon walk-forward artifact drifted from deterministic re-evaluation.',
    );
  }
  const parsedText = parseJson(actualText, 'platoon walk-forward text');
  if (JSON.stringify(parsedText) !== JSON.stringify(artifact)) {
    throw new Error('platoon walk-forward text does not match its artifact.');
  }
  if (
    artifact.untouchedTestReservation?.rowsIncluded !== false ||
    Object.hasOwn(artifact.untouchedTestReservation ?? {}, 'rows')
  ) {
    throw new Error('rare-outcome evaluation must keep untouched-test rows sealed.');
  }
  return artifact;
}

function maximumEquivalenceDifference(equivalences) {
  return Math.max(
    0,
    ...equivalences.map((equivalence) => equivalence.maximumDifference),
  );
}

export function evaluateResolvedCategoricalRareOutcomeUncertainty({
  dataset,
  datasetText,
  fixedEvaluation,
  fixedEvaluationText,
  coherentWalkForward,
  coherentWalkForwardText,
  boundaryEvaluation,
  boundaryEvaluationText,
  platoonWalkForward,
  platoonWalkForwardText,
  canonicalCategories: rawCanonicalCategories,
  hitCategories: rawHitCategories,
  focusCategories: rawFocusCategories = M8_RARE_OUTCOME_FOCUS_CATEGORIES,
}) {
  const canonicalCategories = validateStringList(
    rawCanonicalCategories,
    'canonicalCategories',
    2,
  );
  const hitCategories = validateStringList(rawHitCategories, 'hitCategories', 1);
  const focusCategories = validateStringList(
    rawFocusCategories,
    'focusCategories',
    1,
  );
  const sourceText = assertNonEmptyString(datasetText, 'datasetText');
  const fixedText = assertNonEmptyString(
    fixedEvaluationText,
    'fixedEvaluationText',
  );
  const coherentText = assertNonEmptyString(
    coherentWalkForwardText,
    'coherentWalkForwardText',
  );
  const boundaryText = assertNonEmptyString(
    boundaryEvaluationText,
    'boundaryEvaluationText',
  );
  const platoonWalkForwardSourceText = assertNonEmptyString(
    platoonWalkForwardText,
    'platoonWalkForwardText',
  );

  const expectedWalkForward = evaluateResolvedCategoricalPlatoonWalkForward({
    dataset,
    datasetText: sourceText,
    fixedEvaluation,
    fixedEvaluationText: fixedText,
    coherentWalkForward,
    coherentWalkForwardText: coherentText,
    boundaryEvaluation,
    boundaryEvaluationText: boundaryText,
    canonicalCategories,
    hitCategories,
  });
  const verifiedWalkForward = validateWalkForwardArtifact(
    platoonWalkForward,
    expectedWalkForward,
    platoonWalkForwardSourceText,
  );
  const modeledCategories = validateStringList(
    verifiedWalkForward.modeledCategories,
    'platoon walk-forward modeledCategories',
    2,
  );
  const observations = extractObservations(dataset, modeledCategories);
  const candidate = validateCandidate(
    verifiedWalkForward.frozenCandidate,
    'platoon walk-forward frozenCandidate',
  );
  const baseParameters = assertPlainObject(
    verifiedWalkForward.baseParameters,
    'platoon walk-forward baseParameters',
  );
  const validationDates = [
    ...new Set(
      observations.validationPlatoon.map(
        (observation) => observation.observedDate,
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const trainingOverall = [...observations.fitOverall];
  const trainingPlatoon = [...observations.fitPlatoon];
  const allPredictions = [];
  const foldEquivalences = [];

  for (const [index, validationDate] of validationDates.entries()) {
    const foldValidation = observations.validationPlatoon.filter(
      (observation) => observation.observedDate === validationDate,
    );
    const predicted = predictFrozenPlatoonCandidateCohort({
      categories: modeledCategories,
      hitCategories,
      trainingOverall: Object.freeze([...trainingOverall]),
      trainingPlatoon: Object.freeze([...trainingPlatoon]),
      validationPlatoon: Object.freeze(foldValidation),
      baseParameters,
      candidate,
    });
    const verifiedAggregate = evaluateFrozenPlatoonCandidateCohort({
      categories: modeledCategories,
      hitCategories,
      trainingOverall: Object.freeze([...trainingOverall]),
      trainingPlatoon: Object.freeze([...trainingPlatoon]),
      validationPlatoon: Object.freeze(foldValidation),
      baseParameters,
      candidate,
    });
    const equivalence = metricEquivalence(
      predicted.metrics,
      verifiedAggregate,
      `rare-outcome fold ${validationDate}`,
    );
    const sourceFold = verifiedWalkForward.folds[index];
    if (
      sourceFold?.validationDate !== validationDate ||
      sourceFold.selected.validationObservationIdsSha256 !==
        predicted.metrics.validationObservationIdsSha256
    ) {
      throw new Error(`rare-outcome fold ${validationDate} drifted from source artifact.`);
    }
    metricEquivalence(
      predicted.metrics,
      sourceFold.selected,
      `rare-outcome source fold ${validationDate}`,
    );
    foldEquivalences.push(
      Object.freeze({
        foldNumber: index + 1,
        validationDate,
        validationObservationCount: foldValidation.length,
        ...equivalence,
      }),
    );
    allPredictions.push(...predicted.predictions);
    const dateOverall = observations.validationOverall.filter(
      (observation) => observation.observedDate === validationDate,
    );
    trainingOverall.push(...dateOverall);
    trainingPlatoon.push(...foldValidation);
  }

  if (allPredictions.length !== observations.validationPlatoon.length) {
    throw new Error('rare-outcome walk-forward predictions did not conserve validation rows.');
  }
  const summary = summarizeCategoricalPredictions({
    canonicalCategories,
    modeledCategories,
    hitCategories,
    focusCategories,
    fitOverall: observations.fitOverall,
    fitPlatoon: observations.fitPlatoon,
    predictions: allPredictions,
  });
  const identity = {
    activeSeason: verifiedWalkForward.activeSeason,
    sourceDatasetSha256: verifiedWalkForward.sourceDatasetSha256,
    sourceDatasetFileSha256: verifiedWalkForward.sourceDatasetFileSha256,
    sourceFixedEvaluationSha256:
      verifiedWalkForward.sourceFixedEvaluationSha256,
    sourceCoherentWalkForwardSha256:
      verifiedWalkForward.sourceCoherentWalkForwardSha256,
    sourcePlatoonBoundarySha256:
      verifiedWalkForward.sourcePlatoonBoundarySha256,
    sourcePlatoonWalkForwardSha256:
      verifiedWalkForward.platoonWalkForwardSha256,
    sourcePlatoonWalkForwardFileSha256: sha256(
      platoonWalkForwardSourceText,
    ),
    canonicalCategories,
    modeledCategories,
    structuralZeroCategories:
      verifiedWalkForward.structuralZeroCategories,
    hitCategories,
    focusCategories,
    frozenCandidate: candidate,
    baseParameters,
    cohorts: Object.freeze({
      fitOverallObservationCount: observations.fitOverall.length,
      fitPlatoonObservationCount: observations.fitPlatoon.length,
      validationOverallObservationCount: observations.validationOverall.length,
      validationPlatoonObservationCount:
        observations.validationPlatoon.length,
      validationDateCount: validationDates.length,
      validationObservationIdsSha256: sha256(
        JSON.stringify(
          allPredictions.map((prediction) => prediction.observationId),
        ),
      ),
    }),
    scorerEquivalence: Object.freeze({
      tolerance: TOLERANCE,
      foldEquivalences: Object.freeze(foldEquivalences),
      maximumDifference: maximumEquivalenceDifference(foldEquivalences),
    }),
    uncertaintyMethod: Object.freeze({
      observedRateInterval: '95% Wilson score interval',
      expectedCountVariance:
        'sum p_i(1-p_i) for one-vs-rest category indicators under the stated conditional model',
      standardizedCountResidual:
        '(observed count - expected count) / sqrt(sum p_i(1-p_i))',
      hardSampleThresholdApplied: false,
      priorSeasonEvidenceAllowed: false,
    }),
    summary,
    untouchedTestReservation:
      verifiedWalkForward.untouchedTestReservation,
  };
  return Object.freeze({
    rareOutcomeUncertaintyVersion: 1,
    purpose:
      'Report current-season sample support, deterministic uncertainty intervals, and category-level validation reliability for the frozen coherent categorical model without changing fitted probabilities or accessing the untouched test period.',
    status:
      'offline-resolved-categorical-rare-outcome-uncertainty-not-production-model',
    ...identity,
    rareOutcomeUncertaintySha256: sha256(JSON.stringify(identity)),
  });
}

export async function evaluateM8ResolvedCategoricalRareOutcomeUncertainty({
  datasetPath,
  fixedEvaluationPath,
  coherentWalkForwardPath,
  boundaryEvaluationPath,
  platoonWalkForwardPath,
  canonicalCategories,
  hitCategories,
  focusCategories = M8_RARE_OUTCOME_FOCUS_CATEGORIES,
}) {
  const [
    datasetText,
    fixedEvaluationText,
    coherentWalkForwardText,
    boundaryEvaluationText,
    platoonWalkForwardText,
  ] = await Promise.all([
    readFile(assertNonEmptyString(datasetPath, 'datasetPath'), 'utf8'),
    readFile(
      assertNonEmptyString(fixedEvaluationPath, 'fixedEvaluationPath'),
      'utf8',
    ),
    readFile(
      assertNonEmptyString(coherentWalkForwardPath, 'coherentWalkForwardPath'),
      'utf8',
    ),
    readFile(
      assertNonEmptyString(boundaryEvaluationPath, 'boundaryEvaluationPath'),
      'utf8',
    ),
    readFile(
      assertNonEmptyString(platoonWalkForwardPath, 'platoonWalkForwardPath'),
      'utf8',
    ),
  ]);
  return evaluateResolvedCategoricalRareOutcomeUncertainty({
    dataset: parseJson(datasetText, 'resolved categorical dataset'),
    datasetText,
    fixedEvaluation: parseJson(
      fixedEvaluationText,
      'fixed categorical evaluation',
    ),
    fixedEvaluationText,
    coherentWalkForward: parseJson(
      coherentWalkForwardText,
      'coherent categorical walk-forward',
    ),
    coherentWalkForwardText,
    boundaryEvaluation: parseJson(
      boundaryEvaluationText,
      'platoon boundary evaluation',
    ),
    boundaryEvaluationText,
    platoonWalkForward: parseJson(
      platoonWalkForwardText,
      'platoon walk-forward evaluation',
    ),
    platoonWalkForwardText,
    canonicalCategories,
    hitCategories,
    focusCategories,
  });
}
