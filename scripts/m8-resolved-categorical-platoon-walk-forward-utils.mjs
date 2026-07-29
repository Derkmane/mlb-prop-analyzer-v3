import { readFile } from 'node:fs/promises';

import { poolCategoricalCountsOnce } from './m8-categorical-pooling-utils.mjs';
import {
  applyPlatoonDeviation,
  evaluateResolvedCategoricalPlatoon,
} from './m8-resolved-categorical-platoon-utils.mjs';
import {
  M8_EXACT_RAW_LEAGUE_PLATOON_PRIOR_ID,
  M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES,
  interpretM8PlatoonBoundaryEvaluation,
} from './m8-resolved-categorical-platoon-boundary-utils.mjs';
import { sha256 } from './provider-probe-utils.mjs';

const TOLERANCE = 1e-12;
const VALID_HANDS = new Set(['L', 'R']);
const MATCHUP_KEYS = Object.freeze(['L-vs-L', 'L-vs-R', 'R-vs-L', 'R-vs-R']);

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
    'platoon walk-forward categorical probabilities',
  );
}

function matchupKey(batterSide, pitcherHand) {
  if (!VALID_HANDS.has(batterSide) || !VALID_HANDS.has(pitcherHand)) {
    throw new Error('platoon walk-forward requires normalized L/R handedness.');
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

function pooledIdentityEstimates({ observations, identityKey, categories, leagueTarget, strength }) {
  const counts = countsByIdentity(observations, identityKey, categories);
  const estimates = new Map();
  for (const [identity, identityCounts] of counts.entries()) {
    estimates.set(
      identity,
      poolCategoricalCountsOnce({
        categories,
        source: { kind: 'raw-current-season-categorical-counts', counts: identityCounts },
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
    source: { kind: 'raw-current-season-categorical-counts', counts: emptyCounts(categories) },
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
    source: { kind: 'raw-current-season-categorical-counts', counts: rawCounts },
    leagueTarget,
    leagueEquivalentPa: assertPositiveFinite(
      candidate.leaguePlatoonEquivalentPa,
      `${candidate.candidateId}.leaguePlatoonEquivalentPa`,
    ),
  }).probabilities;
}

function playerLeagueAdjustedTarget({ batterOverall, leagueMatchup, leagueTarget, categories }) {
  return normalizePositiveWeights(
    Object.fromEntries(
      categories.map((category) => [
        category,
        batterOverall[category] * (leagueMatchup[category] / leagueTarget[category]),
      ]),
    ),
    categories,
    'platoon walk-forward player overall plus league platoon target',
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
            pitcherAllowedCoefficient * (Math.log(pitcherVector[category]) - leagueLog),
        ];
      }),
    ),
    categories,
  );
}

function validateCandidate(rawCandidate, label) {
  const candidate = assertPlainObject(rawCandidate, label);
  const candidateId = assertNonEmptyString(candidate.candidateId, `${label}.candidateId`);
  const platoonCoefficient = assertNonNegativeFinite(
    candidate.platoonCoefficient,
    `${candidateId}.platoonCoefficient`,
  );
  if (platoonCoefficient === 0) {
    if (candidateId !== 'no-platoon') {
      throw new Error('zero platoon coefficient must use the no-platoon candidate.');
    }
    return candidate;
  }
  assertNonEmptyString(candidate.leaguePlatoonPriorId, `${candidateId}.leaguePlatoonPriorId`);
  assertNonEmptyString(candidate.playerSplitPriorId, `${candidateId}.playerSplitPriorId`);
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

export function evaluateFrozenPlatoonCandidateCohort({
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
  const validationPlatoon = assertArray(rawValidationPlatoon, 'validationPlatoon');
  if (trainingOverall.length === 0 || trainingPlatoon.length === 0 || validationPlatoon.length === 0) {
    throw new Error('platoon walk-forward cohorts must be non-empty.');
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
    'platoon walk-forward current-season league distribution',
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
  const hitSet = new Set(hitCategories);
  let categoricalLogLoss = 0;
  let categoricalBrier = 0;
  let hitLogLoss = 0;
  let hitBrier = 0;
  let actualProbabilityMinimum = 1;
  let actualProbabilityMaximum = 0;
  let hitProbabilityMinimum = 1;
  let hitProbabilityMaximum = 0;

  for (const observation of validationPlatoon) {
    const batterOverall = batter.estimates.get(observation.providerBatterId) ?? unseenBatter;
    const pitcherVector = pitcher.estimates.get(observation.providerPitcherId) ?? unseenPitcher;
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
      const identity = splitIdentity(observation.providerBatterId, observation.matchupKey);
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
    const actualProbability = probabilities[observation.terminalCategory];
    categoricalLogLoss += -Math.log(actualProbability);
    actualProbabilityMinimum = Math.min(actualProbabilityMinimum, actualProbability);
    actualProbabilityMaximum = Math.max(actualProbabilityMaximum, actualProbability);
    for (const category of categories) {
      const target = category === observation.terminalCategory ? 1 : 0;
      categoricalBrier += (probabilities[category] - target) ** 2;
    }
    const hitProbability = hitCategories.reduce(
      (sum, category) => sum + probabilities[category],
      0,
    );
    if (!(hitProbability > 0 && hitProbability < 1)) {
      throw new Error('platoon walk-forward produced an invalid Hit probability.');
    }
    const hit = hitSet.has(observation.terminalCategory) ? 1 : 0;
    hitLogLoss += hit === 1 ? -Math.log(hitProbability) : -Math.log(1 - hitProbability);
    hitBrier += (hitProbability - hit) ** 2;
    hitProbabilityMinimum = Math.min(hitProbabilityMinimum, hitProbability);
    hitProbabilityMaximum = Math.max(hitProbabilityMaximum, hitProbability);
  }

  const count = validationPlatoon.length;
  return Object.freeze({
    candidate,
    validationObservationCount: count,
    validationObservationIdsSha256: sha256(
      JSON.stringify(validationPlatoon.map((observation) => observation.observationId)),
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

function sourceObservation(rawRow, periodId, index, modeledCategorySet) {
  const label = `periods.${periodId}.rows[${index}]`;
  const row = assertPlainObject(rawRow, label);
  if (row.mappingStatus !== 'classified-terminal') return null;
  if (row.includedInOverallOutcomeModel !== true) {
    throw new Error(`${label} classified terminal row must be overall eligible.`);
  }
  const terminalCategory = assertNonEmptyString(row.terminalCategory, `${label}.terminalCategory`);
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
    providerBatterId: assertPositiveInteger(row.providerBatterId, `${label}.providerBatterId`),
    providerPitcherId: assertPositiveInteger(row.providerPitcherId, `${label}.providerPitcherId`),
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
      const observation = sourceObservation(row, periodId, index, modeledCategorySet);
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

function metricDifference(left, right) {
  return Math.abs(left - right);
}

function assertMetricEquivalence(actual, expected, label) {
  const fields = [
    'validationCategoricalLogLoss',
    'validationCategoricalBrierScore',
    'validationHitLogLoss',
    'validationHitBrierScore',
  ];
  const differences = {};
  for (const field of fields) {
    differences[field] = metricDifference(actual[field], expected[field]);
    if (differences[field] > TOLERANCE) {
      throw new Error(`${label}.${field} drifted by ${differences[field]}.`);
    }
  }
  return Object.freeze(differences);
}

function aggregateFoldMetric(folds, key, resultKey) {
  let total = 0;
  let count = 0;
  for (const fold of folds) {
    const result = fold[key];
    total += result[resultKey] * result.validationObservationCount;
    count += result.validationObservationCount;
  }
  return total / count;
}

function aggregateFoldResults(folds, key) {
  const observationCount = folds.reduce(
    (sum, fold) => sum + fold[key].validationObservationCount,
    0,
  );
  return Object.freeze({
    candidate: folds[0][key].candidate,
    validationObservationCount: observationCount,
    validationCategoricalLogLoss: aggregateFoldMetric(
      folds,
      key,
      'validationCategoricalLogLoss',
    ),
    validationCategoricalBrierScore: aggregateFoldMetric(
      folds,
      key,
      'validationCategoricalBrierScore',
    ),
    validationHitLogLoss: aggregateFoldMetric(folds, key, 'validationHitLogLoss'),
    validationHitBrierScore: aggregateFoldMetric(folds, key, 'validationHitBrierScore'),
    actualProbabilityMinimum: Math.min(
      ...folds.map((fold) => fold[key].actualProbabilityMinimum),
    ),
    actualProbabilityMaximum: Math.max(
      ...folds.map((fold) => fold[key].actualProbabilityMaximum),
    ),
    hitProbabilityMinimum: Math.min(...folds.map((fold) => fold[key].hitProbabilityMinimum)),
    hitProbabilityMaximum: Math.max(...folds.map((fold) => fold[key].hitProbabilityMaximum)),
  });
}

function validateSourceArtifacts({
  dataset,
  datasetText,
  fixedEvaluation,
  fixedEvaluationText,
  coherentWalkForward,
  coherentWalkForwardText,
  boundaryEvaluation,
  boundaryEvaluationText,
  canonicalCategories,
  hitCategories,
}) {
  const expectedBoundary = evaluateResolvedCategoricalPlatoon({
    dataset,
    datasetText,
    fixedEvaluation,
    fixedEvaluationText,
    walkForwardEvaluation: coherentWalkForward,
    walkForwardEvaluationText: coherentWalkForwardText,
    canonicalCategories,
    hitCategories,
    candidates: M8_EXTENDED_PLATOON_BOUNDARY_CANDIDATES,
  });
  const boundary = assertPlainObject(boundaryEvaluation, 'platoon boundary evaluation');
  if (
    boundary.platoonEvaluationSha256 !== expectedBoundary.platoonEvaluationSha256 ||
    JSON.stringify(boundary) !== JSON.stringify(expectedBoundary)
  ) {
    throw new Error('platoon boundary evaluation drifted from deterministic re-evaluation.');
  }
  const parsedBoundaryText = parseJson(boundaryEvaluationText, 'platoon boundary text');
  if (JSON.stringify(parsedBoundaryText) !== JSON.stringify(boundary)) {
    throw new Error('platoon boundary text does not match its artifact.');
  }
  const interpretation = interpretM8PlatoonBoundaryEvaluation(boundary);
  if (
    interpretation.exactRawLeagueCellSelected !== true ||
    interpretation.exactRawLeagueCellSupportValid !== true ||
    interpretation.leaguePriorRequiresFurtherExtension !== false
  ) {
    throw new Error('platoon boundary has not frozen a supported exact raw-cell candidate.');
  }
  if (
    boundary.untouchedTestReservation?.rowsIncluded !== false ||
    Object.hasOwn(boundary.untouchedTestReservation ?? {}, 'rows')
  ) {
    throw new Error('platoon boundary must keep untouched-test rows sealed.');
  }
  return Object.freeze({ boundary, interpretation });
}

export function evaluateResolvedCategoricalPlatoonWalkForward({
  dataset,
  datasetText,
  fixedEvaluation,
  fixedEvaluationText,
  coherentWalkForward,
  coherentWalkForwardText,
  boundaryEvaluation,
  boundaryEvaluationText,
  canonicalCategories: rawCanonicalCategories,
  hitCategories: rawHitCategories,
}) {
  const sourceText = assertNonEmptyString(datasetText, 'datasetText');
  const fixedText = assertNonEmptyString(fixedEvaluationText, 'fixedEvaluationText');
  const coherentText = assertNonEmptyString(
    coherentWalkForwardText,
    'coherentWalkForwardText',
  );
  const boundaryText = assertNonEmptyString(
    boundaryEvaluationText,
    'boundaryEvaluationText',
  );
  const canonicalCategories = validateStringList(
    rawCanonicalCategories,
    'canonicalCategories',
    2,
  );
  const hitCategories = validateStringList(rawHitCategories, 'hitCategories', 1);
  const { boundary, interpretation } = validateSourceArtifacts({
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

  const modeledCategories = validateStringList(
    boundary.modeledCategories,
    'boundary modeledCategories',
    2,
  );
  const observations = extractObservations(dataset, modeledCategories);
  const selectedCandidate = validateCandidate(
    boundary.selection?.selectedCandidate,
    'boundary selected candidate',
  );
  const baselineCandidate = validateCandidate(
    boundary.baseline?.candidate,
    'boundary baseline candidate',
  );
  if (
    selectedCandidate.leaguePlatoonPriorId !==
      M8_EXACT_RAW_LEAGUE_PLATOON_PRIOR_ID ||
    baselineCandidate.candidateId !== 'no-platoon'
  ) {
    throw new Error('platoon walk-forward requires the frozen raw-cell candidate and no-platoon baseline.');
  }
  const baseParameters = assertPlainObject(boundary.baseParameters, 'boundary baseParameters');

  const fullSelected = evaluateFrozenPlatoonCandidateCohort({
    categories: modeledCategories,
    hitCategories,
    trainingOverall: observations.fitOverall,
    trainingPlatoon: observations.fitPlatoon,
    validationPlatoon: observations.validationPlatoon,
    baseParameters,
    candidate: selectedCandidate,
  });
  const fullBaseline = evaluateFrozenPlatoonCandidateCohort({
    categories: modeledCategories,
    hitCategories,
    trainingOverall: observations.fitOverall,
    trainingPlatoon: observations.fitPlatoon,
    validationPlatoon: observations.validationPlatoon,
    baseParameters,
    candidate: baselineCandidate,
  });
  const selectedBoundaryResult = boundary.results.find(
    (result) => result.candidate.candidateId === selectedCandidate.candidateId,
  );
  if (!selectedBoundaryResult) throw new Error('selected boundary result is missing.');
  const fullValidationEquivalence = Object.freeze({
    selected: assertMetricEquivalence(
      fullSelected,
      selectedBoundaryResult,
      'selected full-validation equivalence',
    ),
    baseline: assertMetricEquivalence(
      fullBaseline,
      boundary.baseline,
      'baseline full-validation equivalence',
    ),
  });

  const dates = [
    ...new Set(observations.validationPlatoon.map((observation) => observation.observedDate)),
  ].sort((left, right) => left.localeCompare(right));
  if (dates.length < 2) throw new Error('platoon walk-forward requires at least two dates.');
  const trainingOverall = [...observations.fitOverall];
  const trainingPlatoon = [...observations.fitPlatoon];
  const folds = [];

  for (const [index, validationDate] of dates.entries()) {
    if (
      trainingOverall.some((observation) => observation.observedDate >= validationDate)
    ) {
      throw new Error(`platoon fold ${validationDate} contains future training rows.`);
    }
    const foldValidation = observations.validationPlatoon.filter(
      (observation) => observation.observedDate === validationDate,
    );
    const selected = evaluateFrozenPlatoonCandidateCohort({
      categories: modeledCategories,
      hitCategories,
      trainingOverall: Object.freeze([...trainingOverall]),
      trainingPlatoon: Object.freeze([...trainingPlatoon]),
      validationPlatoon: Object.freeze(foldValidation),
      baseParameters,
      candidate: selectedCandidate,
    });
    const baseline = evaluateFrozenPlatoonCandidateCohort({
      categories: modeledCategories,
      hitCategories,
      trainingOverall: Object.freeze([...trainingOverall]),
      trainingPlatoon: Object.freeze([...trainingPlatoon]),
      validationPlatoon: Object.freeze(foldValidation),
      baseParameters,
      candidate: baselineCandidate,
    });
    if (
      selected.validationObservationIdsSha256 !== baseline.validationObservationIdsSha256
    ) {
      throw new Error(`platoon fold ${validationDate} candidate cohorts differ.`);
    }
    folds.push(
      Object.freeze({
        foldNumber: index + 1,
        validationDate,
        trainingStartDate: trainingOverall[0].observedDate,
        trainingEndDate: trainingOverall.at(-1).observedDate,
        trainingOverallObservationCount: trainingOverall.length,
        trainingPlatoonObservationCount: trainingPlatoon.length,
        validationObservationCount: foldValidation.length,
        validationObservationIdsSha256: selected.validationObservationIdsSha256,
        selected,
        baseline,
        improvement: Object.freeze({
          categoricalLogLoss:
            baseline.validationCategoricalLogLoss - selected.validationCategoricalLogLoss,
          categoricalBrier:
            baseline.validationCategoricalBrierScore -
            selected.validationCategoricalBrierScore,
          hitLogLoss: baseline.validationHitLogLoss - selected.validationHitLogLoss,
          hitBrier: baseline.validationHitBrierScore - selected.validationHitBrierScore,
        }),
      }),
    );
    const dateOverall = observations.validationOverall.filter(
      (observation) => observation.observedDate === validationDate,
    );
    trainingOverall.push(...dateOverall);
    trainingPlatoon.push(...foldValidation);
  }

  const aggregateSelected = aggregateFoldResults(folds, 'selected');
  const aggregateBaseline = aggregateFoldResults(folds, 'baseline');
  if (
    aggregateSelected.validationObservationCount !== observations.validationPlatoon.length ||
    aggregateBaseline.validationObservationCount !== observations.validationPlatoon.length
  ) {
    throw new Error('platoon walk-forward did not conserve the validation cohort.');
  }
  const stability = Object.freeze({
    selectedBeatsBaselineCategoricalFoldCount: folds.filter(
      (fold) => fold.improvement.categoricalLogLoss > 0,
    ).length,
    selectedBeatsBaselineHitFoldCount: folds.filter(
      (fold) => fold.improvement.hitLogLoss > 0,
    ).length,
    selectedBeatsBaselineBothFoldCount: folds.filter(
      (fold) =>
        fold.improvement.categoricalLogLoss > 0 && fold.improvement.hitLogLoss > 0,
    ).length,
    categoricalImprovementMinimum: Math.min(
      ...folds.map((fold) => fold.improvement.categoricalLogLoss),
    ),
    categoricalImprovementMaximum: Math.max(
      ...folds.map((fold) => fold.improvement.categoricalLogLoss),
    ),
    hitImprovementMinimum: Math.min(...folds.map((fold) => fold.improvement.hitLogLoss)),
    hitImprovementMaximum: Math.max(...folds.map((fold) => fold.improvement.hitLogLoss)),
  });
  const aggregateImprovement = Object.freeze({
    categoricalLogLoss:
      aggregateBaseline.validationCategoricalLogLoss -
      aggregateSelected.validationCategoricalLogLoss,
    categoricalBrier:
      aggregateBaseline.validationCategoricalBrierScore -
      aggregateSelected.validationCategoricalBrierScore,
    hitLogLoss:
      aggregateBaseline.validationHitLogLoss - aggregateSelected.validationHitLogLoss,
    hitBrier:
      aggregateBaseline.validationHitBrierScore -
      aggregateSelected.validationHitBrierScore,
  });

  const identity = {
    activeSeason: boundary.activeSeason,
    sourceDatasetSha256: boundary.sourceDatasetSha256,
    sourceDatasetFileSha256: boundary.sourceDatasetFileSha256,
    sourceFixedEvaluationSha256: boundary.sourceFixedEvaluationSha256,
    sourceFixedEvaluationFileSha256: boundary.sourceFixedEvaluationFileSha256,
    sourceCoherentWalkForwardSha256: boundary.sourceWalkForwardSha256,
    sourceCoherentWalkForwardFileSha256: boundary.sourceWalkForwardFileSha256,
    sourcePlatoonBoundarySha256: boundary.platoonEvaluationSha256,
    sourcePlatoonBoundaryFileSha256: sha256(boundaryText),
    canonicalCategories,
    modeledCategories,
    structuralZeroCategories: boundary.structuralZeroCategories,
    hitCategories,
    baseParameters,
    frozenCandidate: selectedCandidate,
    baselineCandidate,
    boundaryInterpretation: interpretation,
    fullValidationEquivalence,
    folds: Object.freeze(folds),
    aggregateSelected,
    aggregateBaseline,
    aggregateImprovement,
    stability,
    untouchedTestReservation: boundary.untouchedTestReservation,
  };
  return Object.freeze({
    platoonWalkForwardVersion: 1,
    purpose:
      'Chronologically validate the frozen current-season exact raw league-platoon cell, player split pooling, and interaction coefficient against the identical no-platoon baseline through expanding daily folds.',
    status: 'offline-resolved-categorical-platoon-walk-forward-not-production-model',
    ...identity,
    platoonWalkForwardSha256: sha256(JSON.stringify(identity)),
  });
}

export async function evaluateM8ResolvedCategoricalPlatoonWalkForward({
  datasetPath,
  fixedEvaluationPath,
  coherentWalkForwardPath,
  boundaryEvaluationPath,
  canonicalCategories,
  hitCategories,
}) {
  const [datasetText, fixedEvaluationText, coherentWalkForwardText, boundaryEvaluationText] =
    await Promise.all([
      readFile(assertNonEmptyString(datasetPath, 'datasetPath'), 'utf8'),
      readFile(assertNonEmptyString(fixedEvaluationPath, 'fixedEvaluationPath'), 'utf8'),
      readFile(assertNonEmptyString(coherentWalkForwardPath, 'coherentWalkForwardPath'), 'utf8'),
      readFile(assertNonEmptyString(boundaryEvaluationPath, 'boundaryEvaluationPath'), 'utf8'),
    ]);
  return evaluateResolvedCategoricalPlatoonWalkForward({
    dataset: parseJson(datasetText, 'resolved categorical dataset'),
    datasetText,
    fixedEvaluation: parseJson(fixedEvaluationText, 'fixed categorical evaluation'),
    fixedEvaluationText,
    coherentWalkForward: parseJson(
      coherentWalkForwardText,
      'coherent categorical walk-forward',
    ),
    coherentWalkForwardText,
    boundaryEvaluation: parseJson(boundaryEvaluationText, 'platoon boundary evaluation'),
    boundaryEvaluationText,
    canonicalCategories,
    hitCategories,
  });
}
