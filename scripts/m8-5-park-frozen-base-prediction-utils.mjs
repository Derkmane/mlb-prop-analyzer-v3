import { createHash } from 'node:crypto';

import { poolCategoricalCountsOnce } from './m8-categorical-pooling-utils.mjs';
import { combineSinglePassCategoricalEffects } from './m8-coherent-categorical-matchup-utils.mjs';
import { evaluateResolvedCategoricalModel } from './m8-resolved-categorical-model-evaluation-utils.mjs';
import { applyPlatoonDeviation } from './m8-resolved-categorical-platoon-utils.mjs';
import {
  M8_EXACT_RAW_LEAGUE_PLATOON_PRIOR_ID,
  M8_EXACT_RAW_LEAGUE_PLATOON_SENTINEL_PA,
} from './m8-resolved-categorical-platoon-boundary-utils.mjs';
import { verifyM8BatterHitsCloseoutFreeze } from './m8-batter-hits-closeout-freeze-utils.mjs';

const TOLERANCE = 1e-12;
const VALID_HANDS = new Set(['L', 'R']);
const VALID_BATTER_HANDS = new Set(['L', 'R', 'S']);

export const M8_5_PARK_FROZEN_BASE_EXPECTED = Object.freeze({
  activeSeason: 2026,
  batterPooling: 256,
  pitcherPooling: 256,
  coherentCandidateId: 'batter-1.00-pitcher-0.75',
  batterCoefficient: 1,
  pitcherAllowedCoefficient: 0.75,
  platoonCandidateId:
    'league-raw-cell-limit-split-pa-1024-coefficient-0.75',
  leaguePlatoonPriorId: M8_EXACT_RAW_LEAGUE_PLATOON_PRIOR_ID,
  leaguePlatoonEquivalentPa: M8_EXACT_RAW_LEAGUE_PLATOON_SENTINEL_PA,
  playerSplitPriorId: 'split-pa-1024',
  playerSplitEquivalentPa: 1024,
  platoonCoefficient: 0.75,
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

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

function text(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be non-empty text.`);
  }
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function finiteNonNegative(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} must equal ${String(expected)}.`);
  }
}

function assertClose(actual, expected, label) {
  if (
    typeof actual !== 'number' ||
    typeof expected !== 'number' ||
    !Number.isFinite(actual) ||
    !Number.isFinite(expected) ||
    Math.abs(actual - expected) > TOLERANCE
  ) {
    throw new Error(`${label} parity failed: actual=${actual}, expected=${expected}.`);
  }
}

function uniqueStrings(raw, label, minimum = 1) {
  const values = array(raw, label).map((value, index) =>
    nonEmptyString(value, `${label}[${index}]`),
  );
  if (values.length < minimum || new Set(values).size !== values.length) {
    throw new Error(`${label} must contain at least ${minimum} unique values.`);
  }
  return Object.freeze(values);
}

function emptyCounts(categories) {
  return Object.fromEntries(categories.map((category) => [category, 0]));
}

function countsByIdentity(observations, key, categories) {
  const counts = new Map();
  for (const observation of observations) {
    const identity = observation[key];
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

function normalizePositive(raw, categories, label) {
  let total = 0;
  const result = {};
  for (const category of categories) {
    const value = raw[category];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`${label}.${category} must be positive and finite.`);
    }
    result[category] = value;
    total += value;
  }
  if (!(total > 0) || !Number.isFinite(total)) {
    throw new Error(`${label} total is invalid.`);
  }
  for (const category of categories) {
    result[category] /= total;
  }
  return Object.freeze(result);
}

function distributionFromCounts(counts, categories, label) {
  const total = categories.reduce((sum, category) => sum + counts[category], 0);
  if (total <= 0) {
    throw new Error(`${label} has no observations.`);
  }
  return normalizePositive(
    Object.fromEntries(
      categories.map((category) => [category, counts[category] / total]),
    ),
    categories,
    label,
  );
}

function pooledEstimates({ observations, identityKey, categories, leagueTarget, strength }) {
  const rawCounts = countsByIdentity(observations, identityKey, categories);
  const estimates = new Map();
  for (const [identity, counts] of rawCounts.entries()) {
    estimates.set(
      identity,
      poolCategoricalCountsOnce({
        categories,
        source: {
          kind: 'raw-current-season-categorical-counts',
          counts,
        },
        leagueTarget,
        leagueEquivalentPa: strength,
      }),
    );
  }
  const unseen = poolCategoricalCountsOnce({
    categories,
    source: {
      kind: 'raw-current-season-categorical-counts',
      counts: emptyCounts(categories),
    },
    leagueTarget,
    leagueEquivalentPa: strength,
  });
  return Object.freeze({ rawCounts, estimates, unseen });
}

function matchupKey(observation) {
  return `${observation.normalizedBatterSide}-vs-${observation.normalizedPitcherHand}`;
}

function splitKey(observation) {
  return `${observation.providerBatterId}|${matchupKey(observation)}`;
}

function countsByKey(observations, keyOf, categories) {
  const counts = new Map();
  for (const observation of observations) {
    const key = keyOf(observation);
    const current = counts.get(key) ?? emptyCounts(categories);
    current[observation.terminalCategory] += 1;
    counts.set(key, current);
  }
  return counts;
}

function wrappedEstimate(probabilities) {
  return Object.freeze({
    kind: 'single-pass-current-season-categorical-pooling',
    poolingPassCount: 1,
    probabilities,
  });
}

function canonicalProbabilities(modeledProbabilities, canonicalCategories) {
  return Object.freeze(
    Object.fromEntries(
      canonicalCategories.map((category) => [
        category,
        modeledProbabilities[category] ?? 0,
      ]),
    ),
  );
}

function scorePredictions(predictions, categories, hitCategories) {
  if (predictions.length === 0) {
    throw new Error('prediction scoring requires a non-empty cohort.');
  }
  const hitSet = new Set(hitCategories);
  let categoricalLogLoss = 0;
  let categoricalBrier = 0;
  let hitLogLoss = 0;
  let hitBrier = 0;
  for (const prediction of predictions) {
    const probabilities = prediction.probabilities;
    const actual = probabilities[prediction.terminalCategory];
    if (!(actual > 0 && actual <= 1)) {
      throw new Error(`${prediction.observationId} has invalid actual probability.`);
    }
    categoricalLogLoss += -Math.log(actual);
    for (const category of categories) {
      categoricalBrier +=
        (probabilities[category] -
          (category === prediction.terminalCategory ? 1 : 0)) ** 2;
    }
    const hitProbability = hitCategories.reduce(
      (sum, category) => sum + probabilities[category],
      0,
    );
    if (!(hitProbability > 0 && hitProbability < 1)) {
      throw new Error(`${prediction.observationId} has invalid Hit probability.`);
    }
    const hit = hitSet.has(prediction.terminalCategory) ? 1 : 0;
    hitLogLoss += hit === 1 ? -Math.log(hitProbability) : -Math.log(1 - hitProbability);
    hitBrier += (hitProbability - hit) ** 2;
  }
  const count = predictions.length;
  return Object.freeze({
    observationCount: count,
    categoricalLogLoss: categoricalLogLoss / count,
    categoricalBrierScore: categoricalBrier / count,
    hitLogLoss: hitLogLoss / count,
    hitBrierScore: hitBrier / count,
  });
}

function validateObservation(raw, categories, label) {
  const row = object(raw, label);
  const terminalCategory = nonEmptyString(
    row.terminalCategory,
    `${label}.terminalCategory`,
  );
  if (!categories.includes(terminalCategory)) {
    throw new Error(`${label} contains unsupported category ${terminalCategory}.`);
  }
  const normalizedBatterSide = VALID_HANDS.has(row.normalizedBatterSide)
    ? row.normalizedBatterSide
    : null;
  const normalizedPitcherHand = VALID_HANDS.has(row.normalizedPitcherHand)
    ? row.normalizedPitcherHand
    : null;
  const platoonEligible = row.platoonEligible === true;
  if (platoonEligible !== (normalizedBatterSide !== null && normalizedPitcherHand !== null)) {
    throw new Error(`${label} platoon eligibility disagrees with normalized handedness.`);
  }
  const batterHand = VALID_BATTER_HANDS.has(row.batterHand) ? row.batterHand : null;
  return Object.freeze({
    observationId: nonEmptyString(row.observationId, `${label}.observationId`),
    observedDate: nonEmptyString(row.observedDate, `${label}.observedDate`),
    providerGameId: positiveInteger(row.providerGameId, `${label}.providerGameId`),
    providerBatterId: positiveInteger(
      row.providerBatterId,
      `${label}.providerBatterId`,
    ),
    providerPitcherId: positiveInteger(
      row.providerPitcherId,
      `${label}.providerPitcherId`,
    ),
    terminalCategory,
    batterHand,
    normalizedBatterSide,
    normalizedPitcherHand,
    platoonEligible,
  });
}

export function buildM8_5ParkFrozenBasePredictions(rawInput) {
  const input = object(rawInput, 'frozen base prediction input');
  const expectedKeys = [
    'fitObservations',
    'validationObservations',
    'modeledCategories',
    'canonicalCategories',
    'hitCategories',
    'baseParameters',
    'platoonCandidate',
  ];
  const actualKeys = Object.keys(input).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify([...expectedKeys].sort())) {
    throw new Error(
      'frozen base prediction input contains missing or unsupported fields; selected side and direct probability adjustments are prohibited.',
    );
  }
  const {
    fitObservations: rawFitObservations,
    validationObservations: rawValidationObservations,
    modeledCategories: rawModeledCategories,
    canonicalCategories: rawCanonicalCategories,
    hitCategories: rawHitCategories,
    baseParameters,
    platoonCandidate,
  } = input;
  const modeledCategories = uniqueStrings(
    rawModeledCategories,
    'modeledCategories',
    2,
  );
  const canonicalCategories = uniqueStrings(
    rawCanonicalCategories,
    'canonicalCategories',
    2,
  );
  const hitCategories = uniqueStrings(rawHitCategories, 'hitCategories', 1);
  for (const category of modeledCategories) {
    if (!canonicalCategories.includes(category)) {
      throw new Error(`modeled category ${category} is not canonical.`);
    }
  }
  for (const category of hitCategories) {
    if (!modeledCategories.includes(category)) {
      throw new Error(`Hit category ${category} is not modeled.`);
    }
  }
  const fitObservations = array(rawFitObservations, 'fitObservations').map(
    (row, index) => validateObservation(row, modeledCategories, `fitObservations[${index}]`),
  );
  const validationObservations = array(
    rawValidationObservations,
    'validationObservations',
  ).map((row, index) =>
    validateObservation(row, modeledCategories, `validationObservations[${index}]`),
  );
  if (fitObservations.length === 0 || validationObservations.length === 0) {
    throw new Error('fit and validation observations must both be non-empty.');
  }
  const allIds = [...fitObservations, ...validationObservations].map(
    (observation) => observation.observationId,
  );
  if (new Set(allIds).size !== allIds.length) {
    throw new Error('fit-validation observation identities must be unique.');
  }

  const parameters = object(baseParameters, 'baseParameters');
  const batterPooling = finiteNonNegative(
    parameters.batterPooling,
    'baseParameters.batterPooling',
  );
  const pitcherPooling = finiteNonNegative(
    parameters.pitcherPooling,
    'baseParameters.pitcherPooling',
  );
  const batterCoefficient = finiteNonNegative(
    parameters.batterCoefficient,
    'baseParameters.batterCoefficient',
  );
  const pitcherAllowedCoefficient = finiteNonNegative(
    parameters.pitcherAllowedCoefficient,
    'baseParameters.pitcherAllowedCoefficient',
  );
  if (!(batterPooling > 0) || !(pitcherPooling > 0)) {
    throw new Error('base pooling strengths must be positive.');
  }

  const candidate = object(platoonCandidate, 'platoonCandidate');
  assertEqual(
    candidate.leaguePlatoonPriorId,
    M8_EXACT_RAW_LEAGUE_PLATOON_PRIOR_ID,
    'platoonCandidate.leaguePlatoonPriorId',
  );
  assertEqual(
    candidate.leaguePlatoonEquivalentPa,
    M8_EXACT_RAW_LEAGUE_PLATOON_SENTINEL_PA,
    'platoonCandidate.leaguePlatoonEquivalentPa',
  );
  assertEqual(
    candidate.playerSplitPriorId,
    M8_5_PARK_FROZEN_BASE_EXPECTED.playerSplitPriorId,
    'platoonCandidate.playerSplitPriorId',
  );
  const playerSplitEquivalentPa = finiteNonNegative(
    candidate.playerSplitEquivalentPa,
    'platoonCandidate.playerSplitEquivalentPa',
  );
  const platoonCoefficient = finiteNonNegative(
    candidate.platoonCoefficient,
    'platoonCandidate.platoonCoefficient',
  );

  const leagueTarget = distributionFromCounts(
    leagueCounts(fitObservations, modeledCategories),
    modeledCategories,
    'fit league target',
  );
  const batter = pooledEstimates({
    observations: fitObservations,
    identityKey: 'providerBatterId',
    categories: modeledCategories,
    leagueTarget,
    strength: batterPooling,
  });
  const pitcher = pooledEstimates({
    observations: fitObservations,
    identityKey: 'providerPitcherId',
    categories: modeledCategories,
    leagueTarget,
    strength: pitcherPooling,
  });
  const fitPlatoon = fitObservations.filter((observation) => observation.platoonEligible);
  const matchupCounts = countsByKey(fitPlatoon, matchupKey, modeledCategories);
  const splitCounts = countsByKey(fitPlatoon, splitKey, modeledCategories);
  const matchupTargets = new Map();
  const playerSplitEstimates = new Map();

  function coherentFor(observation, batterEstimate) {
    const pitcherEstimate =
      pitcher.estimates.get(observation.providerPitcherId) ?? pitcher.unseen;
    return combineSinglePassCategoricalEffects({
      categories: modeledCategories,
      leagueTarget,
      batterEstimate,
      pitcherAllowedEstimate: pitcherEstimate,
      batterCoefficient,
      pitcherAllowedCoefficient,
    }).probabilities;
  }

  function selectedBatterEstimate(observation, batterOverall) {
    if (!observation.platoonEligible) return batterOverall;
    const key = matchupKey(observation);
    if (!matchupTargets.has(key)) {
      const rawCounts = matchupCounts.get(key);
      if (!rawCounts) {
        throw new Error(`fit evidence lacks raw matchup cell ${key}.`);
      }
      matchupTargets.set(
        key,
        distributionFromCounts(
          rawCounts,
          modeledCategories,
          `raw matchup target ${key}`,
        ),
      );
    }
    const identity = splitKey(observation);
    if (!playerSplitEstimates.has(identity)) {
      const leagueMatchup = matchupTargets.get(key);
      const target = normalizePositive(
        Object.fromEntries(
          modeledCategories.map((category) => [
            category,
            batterOverall.probabilities[category] *
              (leagueMatchup[category] / leagueTarget[category]),
          ]),
        ),
        modeledCategories,
        `player matchup target ${identity}`,
      );
      playerSplitEstimates.set(
        identity,
        poolCategoricalCountsOnce({
          categories: modeledCategories,
          source: {
            kind: 'raw-current-season-categorical-counts',
            counts: splitCounts.get(identity) ?? emptyCounts(modeledCategories),
          },
          leagueTarget: target,
          leagueEquivalentPa: playerSplitEquivalentPa,
        }).probabilities,
      );
    }
    return wrappedEstimate(
      applyPlatoonDeviation({
        categories: modeledCategories,
        batterOverall: batterOverall.probabilities,
        playerSplit: playerSplitEstimates.get(identity),
        platoonCoefficient,
      }),
    );
  }

  const predictions = Object.freeze(
    validationObservations.map((observation) => {
      const batterOverall =
        batter.estimates.get(observation.providerBatterId) ?? batter.unseen;
      const coherent = coherentFor(observation, batterOverall);
      const selected = coherentFor(
        observation,
        selectedBatterEstimate(observation, batterOverall),
      );
      return Object.freeze({
        observationId: observation.observationId,
        observedDate: observation.observedDate,
        providerGameId: observation.providerGameId,
        providerBatterId: observation.providerBatterId,
        providerPitcherId: observation.providerPitcherId,
        terminalCategory: observation.terminalCategory,
        batterHand: observation.batterHand,
        platoonEligible: observation.platoonEligible,
        coherentProbabilities: canonicalProbabilities(coherent, canonicalCategories),
        baseProbabilities: canonicalProbabilities(selected, canonicalCategories),
      });
    }),
  );
  const coherentScoringRows = predictions.map((prediction) => ({
    ...prediction,
    probabilities: prediction.coherentProbabilities,
  }));
  const platoonScoringRows = predictions
    .filter((prediction) => prediction.platoonEligible)
    .map((prediction) => ({
      ...prediction,
      probabilities: prediction.baseProbabilities,
    }));
  const finalScoringRows = predictions.map((prediction) => ({
    ...prediction,
    probabilities: prediction.baseProbabilities,
  }));

  return Object.freeze({
    modeledCategories,
    canonicalCategories,
    hitCategories,
    leagueTarget,
    fitObservationCount: fitObservations.length,
    fitPlatoonObservationCount: fitPlatoon.length,
    validationObservationCount: validationObservations.length,
    validationPlatoonObservationCount: platoonScoringRows.length,
    coherentMetrics: scorePredictions(
      coherentScoringRows,
      canonicalCategories,
      hitCategories,
    ),
    platoonMetrics: scorePredictions(
      platoonScoringRows,
      canonicalCategories,
      hitCategories,
    ),
    finalBaseMetrics: scorePredictions(
      finalScoringRows,
      canonicalCategories,
      hitCategories,
    ),
    predictions,
    predictionSha256: sha256(JSON.stringify(predictions)),
  });
}

function sourceHash(value) {
  return sha256(JSON.stringify(value));
}

function findComponent(freeze, componentId) {
  return object(
    object(freeze.fittedComponents, 'freeze.fittedComponents')[componentId],
    `freeze.fittedComponents.${componentId}`,
  );
}

function assertFrozenSource(component, phase, value, label) {
  const evidence = object(component[phase], `${label}.${phase}`);
  assertEqual(sourceHash(value), evidence.sourceSha256, `${label}.${phase}.sourceSha256`);
}

function parseDatasetObservations(dataset, modeledCategories) {
  const periods = object(dataset.periods, 'dataset.periods');
  const result = {};
  const seen = new Set();
  for (const periodId of ['fit', 'validation']) {
    const rows = array(object(periods[periodId], `dataset.periods.${periodId}`).rows, `${periodId}.rows`);
    const observations = [];
    for (const [index, rawRow] of rows.entries()) {
      const row = object(rawRow, `${periodId}.rows[${index}]`);
      if (row.mappingStatus !== 'classified-terminal') continue;
      if (row.includedInOverallOutcomeModel !== true) {
        throw new Error(`${periodId}.rows[${index}] classified row is not overall eligible.`);
      }
      const observationId = nonEmptyString(row.rowId, `${periodId}.rows[${index}].rowId`);
      if (seen.has(observationId)) {
        throw new Error(`duplicate observation ${observationId}.`);
      }
      seen.add(observationId);
      const normalizedBatterSide = VALID_HANDS.has(row.normalizedBatterSide)
        ? row.normalizedBatterSide
        : null;
      const normalizedPitcherHand = VALID_HANDS.has(row.normalizedPitcherHand)
        ? row.normalizedPitcherHand
        : null;
      const platoonEligible = row.includedInPlatoonModel === true;
      if (platoonEligible !== (normalizedBatterSide !== null && normalizedPitcherHand !== null)) {
        throw new Error(`${observationId} platoon eligibility drifted.`);
      }
      const rawBatterHand = VALID_BATTER_HANDS.has(row.rawBatterSide)
        ? row.rawBatterSide
        : normalizedBatterSide;
      observations.push(
        Object.freeze({
          observationId,
          observedDate: nonEmptyString(row.observedDate, `${observationId}.observedDate`),
          providerGameId: positiveInteger(row.providerGameId, `${observationId}.providerGameId`),
          providerBatterId: positiveInteger(
            row.providerBatterId,
            `${observationId}.providerBatterId`,
          ),
          providerPitcherId: positiveInteger(
            row.providerPitcherId,
            `${observationId}.providerPitcherId`,
          ),
          terminalCategory: nonEmptyString(
            row.terminalCategory,
            `${observationId}.terminalCategory`,
          ),
          batterHand: VALID_BATTER_HANDS.has(rawBatterHand) ? rawBatterHand : null,
          normalizedBatterSide,
          normalizedPitcherHand,
          platoonEligible,
        }),
      );
    }
    result[periodId] = Object.freeze(observations);
  }
  return Object.freeze(result);
}

function selectedResult(results, candidateId, label) {
  const result = array(results, `${label}.results`).find(
    (entry) => entry?.candidate?.candidateId === candidateId,
  );
  if (!result) {
    throw new Error(`${label} is missing selected candidate ${candidateId}.`);
  }
  return result;
}

export function verifyAndBuildM8_5ParkFrozenBasePredictions(rawInput) {
  const input = object(rawInput, 'frozen base parity input');
  const expectedKeys = [
    'dataset',
    'datasetText',
    'fixedEvaluation',
    'fixedEvaluationText',
    'platoonEvaluation',
    'platoonEvaluationText',
    'platoonWalkForwardEvaluation',
    'closeoutFreeze',
    'closeoutFreezeText',
    'canonicalCategories',
    'hitCategories',
  ];
  const actualKeys = Object.keys(input).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify([...expectedKeys].sort())) {
    throw new Error(
      'frozen base parity input contains missing or unsupported fields; selected side and direct probability adjustments are prohibited.',
    );
  }
  const {
    dataset,
    datasetText,
    fixedEvaluation,
    fixedEvaluationText,
    platoonEvaluation,
    platoonEvaluationText,
    platoonWalkForwardEvaluation,
    closeoutFreeze,
    closeoutFreezeText,
    canonicalCategories,
    hitCategories,
  } = input;
  text(datasetText, 'datasetText');
  text(fixedEvaluationText, 'fixedEvaluationText');
  text(platoonEvaluationText, 'platoonEvaluationText');
  text(closeoutFreezeText, 'closeoutFreezeText');
  const freeze = verifyM8BatterHitsCloseoutFreeze(closeoutFreeze);
  assertEqual(freeze.activeSeason, 2026, 'freeze.activeSeason');
  if (freeze.untouchedTestAccessed !== false || freeze.untouchedTestReservation?.rowsIncluded !== false) {
    throw new Error('frozen M8 source exposes untouched-test rows.');
  }

  const coherentComponent = findComponent(freeze, 'coherentMatchup');
  const platoonComponent = findComponent(freeze, 'platoon');
  assertEqual(
    coherentComponent.candidateId,
    M8_5_PARK_FROZEN_BASE_EXPECTED.coherentCandidateId,
    'frozen coherent candidate',
  );
  assertEqual(
    platoonComponent.candidateId,
    M8_5_PARK_FROZEN_BASE_EXPECTED.platoonCandidateId,
    'frozen platoon candidate',
  );
  assertFrozenSource(
    coherentComponent,
    'fixedValidation',
    fixedEvaluation,
    'coherent component',
  );
  assertFrozenSource(
    platoonComponent,
    'fixedValidation',
    platoonEvaluation,
    'platoon component',
  );
  assertFrozenSource(
    platoonComponent,
    'walkForward',
    platoonWalkForwardEvaluation,
    'platoon component',
  );

  const expectedFixed = evaluateResolvedCategoricalModel({
    dataset,
    datasetText,
    canonicalCategories,
    hitCategories,
  });
  if (JSON.stringify(expectedFixed) !== JSON.stringify(fixedEvaluation)) {
    throw new Error('fixed categorical evaluation drifted from deterministic re-evaluation.');
  }
  const fixed = object(fixedEvaluation, 'fixedEvaluation');
  const platoon = object(platoonEvaluation, 'platoonEvaluation');
  assertEqual(
    platoon.sourceDatasetSha256,
    fixed.sourceDatasetSha256,
    'platoon source dataset',
  );
  assertEqual(
    platoon.sourceFixedEvaluationSha256,
    fixed.evaluationSha256,
    'platoon source fixed evaluation',
  );
  assertEqual(
    platoon.sourceWalkForwardSha256,
    object(platoonWalkForwardEvaluation, 'platoonWalkForwardEvaluation')
      .walkForwardSha256,
    'platoon source walk-forward evaluation',
  );
  if (
    platoon.untouchedTestReservation?.rowsIncluded !== false ||
    Object.hasOwn(platoon.untouchedTestReservation ?? {}, 'rows')
  ) {
    throw new Error('platoon evaluation exposes untouched-test rows.');
  }

  const selectedCoherent = object(
    fixed.coherentMatchup?.selection?.selectedCandidate,
    'fixed coherent selected candidate',
  );
  assertEqual(
    selectedCoherent.candidateId,
    M8_5_PARK_FROZEN_BASE_EXPECTED.coherentCandidateId,
    'fixed coherent candidateId',
  );
  const selectedPlatoon = object(
    platoon.selection?.selectedCandidate,
    'platoon selected candidate',
  );
  assertEqual(
    selectedPlatoon.candidateId,
    M8_5_PARK_FROZEN_BASE_EXPECTED.platoonCandidateId,
    'platoon selected candidateId',
  );

  const baseParameters = object(platoon.baseParameters, 'platoon.baseParameters');
  for (const [key, expected] of [
    ['batterPooling', M8_5_PARK_FROZEN_BASE_EXPECTED.batterPooling],
    ['pitcherPooling', M8_5_PARK_FROZEN_BASE_EXPECTED.pitcherPooling],
    ['batterCoefficient', M8_5_PARK_FROZEN_BASE_EXPECTED.batterCoefficient],
    [
      'pitcherAllowedCoefficient',
      M8_5_PARK_FROZEN_BASE_EXPECTED.pitcherAllowedCoefficient,
    ],
  ]) {
    assertEqual(baseParameters[key], expected, `platoon.baseParameters.${key}`);
  }
  for (const [key, expected] of [
    ['leaguePlatoonPriorId', M8_5_PARK_FROZEN_BASE_EXPECTED.leaguePlatoonPriorId],
    [
      'leaguePlatoonEquivalentPa',
      M8_5_PARK_FROZEN_BASE_EXPECTED.leaguePlatoonEquivalentPa,
    ],
    ['playerSplitPriorId', M8_5_PARK_FROZEN_BASE_EXPECTED.playerSplitPriorId],
    [
      'playerSplitEquivalentPa',
      M8_5_PARK_FROZEN_BASE_EXPECTED.playerSplitEquivalentPa,
    ],
    ['platoonCoefficient', M8_5_PARK_FROZEN_BASE_EXPECTED.platoonCoefficient],
  ]) {
    assertEqual(selectedPlatoon[key], expected, `selectedPlatoon.${key}`);
  }

  const modeledCategories = uniqueStrings(
    fixed.canonicalVectorPolicy?.modeledCategories,
    'fixed modeledCategories',
    2,
  );
  const observations = parseDatasetObservations(dataset, modeledCategories);
  const built = buildM8_5ParkFrozenBasePredictions({
    fitObservations: observations.fit,
    validationObservations: observations.validation,
    modeledCategories,
    canonicalCategories,
    hitCategories,
    baseParameters,
    platoonCandidate: selectedPlatoon,
  });

  const coherentResult = selectedResult(
    fixed.coherentMatchup?.results,
    M8_5_PARK_FROZEN_BASE_EXPECTED.coherentCandidateId,
    'fixed coherent evaluation',
  );
  assertClose(
    built.coherentMetrics.categoricalLogLoss,
    coherentResult.validationCategoricalLogLoss,
    'coherent categorical log loss',
  );
  assertClose(
    built.coherentMetrics.categoricalBrierScore,
    coherentResult.validationCategoricalBrierScore,
    'coherent categorical Brier',
  );
  assertClose(
    built.coherentMetrics.hitLogLoss,
    coherentResult.validationHitLogLoss,
    'coherent Hit log loss',
  );
  assertClose(
    built.coherentMetrics.hitBrierScore,
    coherentResult.validationHitBrierScore,
    'coherent Hit Brier',
  );

  const platoonResult = selectedResult(
    platoon.results,
    M8_5_PARK_FROZEN_BASE_EXPECTED.platoonCandidateId,
    'platoon evaluation',
  );
  assertClose(
    built.platoonMetrics.categoricalLogLoss,
    platoonResult.validationCategoricalLogLoss,
    'platoon categorical log loss',
  );
  assertClose(
    built.platoonMetrics.categoricalBrierScore,
    platoonResult.validationCategoricalBrierScore,
    'platoon categorical Brier',
  );
  assertClose(
    built.platoonMetrics.hitLogLoss,
    platoonResult.validationHitLogLoss,
    'platoon Hit log loss',
  );
  assertClose(
    built.platoonMetrics.hitBrierScore,
    platoonResult.validationHitBrierScore,
    'platoon Hit Brier',
  );

  const identity = {
    parityVersion: 1,
    activeSeason: 2026,
    sourceDatasetSha256: fixed.sourceDatasetSha256,
    sourceFixedEvaluationSha256: fixed.evaluationSha256,
    sourcePlatoonEvaluationSha256: platoon.platoonEvaluationSha256,
    sourcePlatoonWalkForwardSha256:
      platoonWalkForwardEvaluation.walkForwardSha256,
    sourceCloseoutFreezeSha256: freeze.artifactSha256,
    coherentCandidateId: coherentComponent.candidateId,
    platoonCandidateId: platoonComponent.candidateId,
    coherentMetrics: built.coherentMetrics,
    platoonMetrics: built.platoonMetrics,
    finalBaseMetrics: built.finalBaseMetrics,
    predictionSha256: built.predictionSha256,
    productionEnabled: false,
    rankingEnabled: false,
    selectedSideInputUsed: false,
    directProbabilityAdjustmentUsed: false,
    untouchedTestRowsAccessed: false,
  };
  return Object.freeze({
    ...identity,
    paritySha256: sha256(JSON.stringify(identity)),
    predictions: built.predictions,
  });
}
