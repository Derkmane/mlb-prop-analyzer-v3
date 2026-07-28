import { readFile } from 'node:fs/promises';

import { poolCategoricalCountsOnce } from './m8-categorical-pooling-utils.mjs';
import { evaluateResolvedCategoricalModel } from './m8-resolved-categorical-model-evaluation-utils.mjs';
import { sha256 } from './provider-probe-utils.mjs';

const TOLERANCE = 1e-12;
const INCLUDED_PERIODS = Object.freeze(['fit', 'validation']);
const VALID_HANDS = new Set(['L', 'R']);
const EXACT_PRIOR_RANK = 1_000_000_000;

const LEAGUE_PLATOON_PRIORS = Object.freeze([
  ...[4, 16, 64, 256, 1024, 4096].map((leagueEquivalentPa) =>
    Object.freeze({
      priorId: `league-pa-${leagueEquivalentPa}`,
      leagueEquivalentPa,
      exactLeagueTarget: false,
    }),
  ),
  Object.freeze({
    priorId: 'league-only-target',
    leagueEquivalentPa: null,
    exactLeagueTarget: true,
  }),
]);

const PLAYER_SPLIT_PRIORS = Object.freeze([
  ...[4, 16, 64, 256, 1024, 4096].map((splitEquivalentPa) =>
    Object.freeze({
      priorId: `split-pa-${splitEquivalentPa}`,
      splitEquivalentPa,
      exactTargetOnly: false,
    }),
  ),
  Object.freeze({
    priorId: 'split-target-only',
    splitEquivalentPa: null,
    exactTargetOnly: true,
  }),
]);

const PLATOON_COEFFICIENTS = Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5]);

export const DEFAULT_M8_PLATOON_CANDIDATES = Object.freeze([
  Object.freeze({
    candidateId: 'no-platoon',
    leaguePlatoonPriorId: null,
    leaguePlatoonEquivalentPa: null,
    leaguePlatoonExactTarget: true,
    playerSplitPriorId: null,
    playerSplitEquivalentPa: null,
    playerSplitExactTarget: true,
    platoonCoefficient: 0,
  }),
  ...LEAGUE_PLATOON_PRIORS.flatMap((leaguePrior) =>
    PLAYER_SPLIT_PRIORS.flatMap((splitPrior) =>
      PLATOON_COEFFICIENTS.map((platoonCoefficient) =>
        Object.freeze({
          candidateId: `${leaguePrior.priorId}-${splitPrior.priorId}-coefficient-${platoonCoefficient.toFixed(2)}`,
          leaguePlatoonPriorId: leaguePrior.priorId,
          leaguePlatoonEquivalentPa: leaguePrior.leagueEquivalentPa,
          leaguePlatoonExactTarget: leaguePrior.exactLeagueTarget,
          playerSplitPriorId: splitPrior.priorId,
          playerSplitEquivalentPa: splitPrior.splitEquivalentPa,
          playerSplitExactTarget: splitPrior.exactTargetOnly,
          platoonCoefficient,
        }),
      ),
    ),
  ),
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

function validateCandidates(rawCandidates) {
  const candidates = assertArray(rawCandidates, 'platoon candidates').map((raw, index) => {
    const candidate = assertPlainObject(raw, `platoon candidates[${index}]`);
    const candidateId = assertNonEmptyString(
      candidate.candidateId,
      `platoon candidates[${index}].candidateId`,
    );
    const platoonCoefficient = assertNonNegativeFinite(
      candidate.platoonCoefficient,
      `${candidateId}.platoonCoefficient`,
    );
    if (platoonCoefficient === 0) {
      if (candidateId !== 'no-platoon') {
        throw new Error('the zero-coefficient candidate must be named no-platoon.');
      }
      return Object.freeze({
        candidateId,
        leaguePlatoonPriorId: null,
        leaguePlatoonEquivalentPa: null,
        leaguePlatoonExactTarget: true,
        playerSplitPriorId: null,
        playerSplitEquivalentPa: null,
        playerSplitExactTarget: true,
        platoonCoefficient: 0,
      });
    }

    const leaguePlatoonExactTarget = candidate.leaguePlatoonExactTarget === true;
    const playerSplitExactTarget = candidate.playerSplitExactTarget === true;
    return Object.freeze({
      candidateId,
      leaguePlatoonPriorId: assertNonEmptyString(
        candidate.leaguePlatoonPriorId,
        `${candidateId}.leaguePlatoonPriorId`,
      ),
      leaguePlatoonEquivalentPa: leaguePlatoonExactTarget
        ? null
        : assertPositiveFinite(
            candidate.leaguePlatoonEquivalentPa,
            `${candidateId}.leaguePlatoonEquivalentPa`,
          ),
      leaguePlatoonExactTarget,
      playerSplitPriorId: assertNonEmptyString(
        candidate.playerSplitPriorId,
        `${candidateId}.playerSplitPriorId`,
      ),
      playerSplitEquivalentPa: playerSplitExactTarget
        ? null
        : assertPositiveFinite(
            candidate.playerSplitEquivalentPa,
            `${candidateId}.playerSplitEquivalentPa`,
          ),
      playerSplitExactTarget,
      platoonCoefficient,
    });
  });

  if (candidates.length < 2) {
    throw new Error('platoon evaluation requires a baseline and at least one alternative.');
  }
  if (new Set(candidates.map((candidate) => candidate.candidateId)).size !== candidates.length) {
    throw new Error('platoon candidateId values must be unique.');
  }
  if (candidates.filter((candidate) => candidate.candidateId === 'no-platoon').length !== 1) {
    throw new Error('platoon candidates must contain exactly one no-platoon baseline.');
  }
  return Object.freeze(candidates);
}

function emptyCounts(categories) {
  return Object.fromEntries(categories.map((category) => [category, 0]));
}

function normalizePositiveWeights(rawWeights, categories, label) {
  let total = 0;
  const weights = {};
  for (const category of categories) {
    const value = rawWeights[category];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error(`${label}.${category} must be positive and finite.`);
    }
    weights[category] = value;
    total += value;
  }
  if (!(total > 0) || !Number.isFinite(total)) {
    throw new Error(`${label} has an invalid total.`);
  }
  for (const category of categories) {
    weights[category] /= total;
  }
  const normalizedTotal = Object.values(weights).reduce(
    (sum, probability) => sum + probability,
    0,
  );
  if (Math.abs(normalizedTotal - 1) > TOLERANCE) {
    throw new Error(`${label} does not sum to 1.`);
  }
  return Object.freeze(weights);
}

function distributionFromCounts(counts, categories, label) {
  const total = categories.reduce((sum, category) => sum + counts[category], 0);
  if (total <= 0) {
    throw new Error(`${label} has no observations.`);
  }
  return normalizePositiveWeights(
    Object.fromEntries(categories.map((category) => [category, counts[category] / total])),
    categories,
    label,
  );
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
    throw new Error('categorical softmax denominator is invalid.');
  }
  return normalizePositiveWeights(
    Object.fromEntries(
      categories.map((category) => [category, exponentials[category] / denominator]),
    ),
    categories,
    'categorical softmax probabilities',
  );
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
  return Object.freeze(counts);
}

function matchupKey(batterSide, pitcherHand) {
  if (!VALID_HANDS.has(batterSide) || !VALID_HANDS.has(pitcherHand)) {
    throw new Error('platoon matchup requires normalized L/R batter side and pitcher hand.');
  }
  return `${batterSide}-vs-${pitcherHand}`;
}

function splitIdentity(batterId, key) {
  return `${batterId}|${key}`;
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
    throw new Error(
      `${label} platoon eligibility must equal availability of both normalized L/R hands.`,
    );
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

function extractObservations(dataset, fixed) {
  const modeledCategories = validateStringList(
    fixed.canonicalVectorPolicy?.modeledCategories,
    'fixed modeledCategories',
    2,
  );
  const modeledCategorySet = new Set(modeledCategories);
  const periods = assertPlainObject(dataset.periods, 'dataset periods');
  const extracted = {};
  const seen = new Set();

  for (const periodId of INCLUDED_PERIODS) {
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
    if (
      overall.length !==
      assertNonNegativeInteger(
        period.classifiedTerminalCount,
        `${periodId}.classifiedTerminalCount`,
      )
    ) {
      throw new Error(`${periodId} classified terminal count drifted.`);
    }
    if (
      platoon.length !==
      assertNonNegativeInteger(
        period.platoonEligibleCount,
        `${periodId}.platoonEligibleCount`,
      )
    ) {
      throw new Error(`${periodId} platoon eligible count drifted.`);
    }
    extracted[periodId] = Object.freeze({
      overall: Object.freeze(overall),
      platoon: Object.freeze(platoon),
    });
  }

  return Object.freeze({
    modeledCategories,
    fitOverall: extracted.fit.overall,
    fitPlatoon: extracted.fit.platoon,
    validationOverall: extracted.validation.overall,
    validationPlatoon: extracted.validation.platoon,
  });
}

function validateFixedArtifact({
  dataset,
  datasetText,
  fixedEvaluation,
  fixedEvaluationText,
  canonicalCategories,
  hitCategories,
}) {
  const expected = evaluateResolvedCategoricalModel({
    dataset,
    datasetText,
    canonicalCategories,
    hitCategories,
  });
  const fixed = assertPlainObject(fixedEvaluation, 'fixed evaluation');
  if (
    fixed.evaluationVersion !== 1 ||
    fixed.evaluationSha256 !== expected.evaluationSha256 ||
    JSON.stringify(fixed) !== JSON.stringify(expected)
  ) {
    throw new Error('fixed evaluation drifted from deterministic re-evaluation.');
  }
  const parsedText = parseJson(fixedEvaluationText, 'fixed evaluation text');
  if (JSON.stringify(parsedText) !== JSON.stringify(fixed)) {
    throw new Error('fixed evaluation text does not match its artifact.');
  }
  if (
    fixed.coherentStatus !== 'coherent-matchup-evaluated' ||
    fixed.untouchedTestReservation?.rowsIncluded !== false ||
    Object.hasOwn(fixed.untouchedTestReservation ?? {}, 'rows')
  ) {
    throw new Error('fixed evaluation is incomplete or exposes untouched-test rows.');
  }
  return fixed;
}

function walkForwardIdentity(walkForward) {
  return {
    activeSeason: walkForward.activeSeason,
    sourceDatasetSha256: walkForward.sourceDatasetSha256,
    sourceDatasetFileSha256: walkForward.sourceDatasetFileSha256,
    sourceFixedEvaluationSha256: walkForward.sourceFixedEvaluationSha256,
    sourceFixedEvaluationFileSha256: walkForward.sourceFixedEvaluationFileSha256,
    canonicalCategories: walkForward.canonicalCategories,
    modeledCategories: walkForward.modeledCategories,
    structuralZeroCategories: walkForward.structuralZeroCategories,
    hitCategories: walkForward.hitCategories,
    poolingStrengths: walkForward.poolingStrengths,
    candidates: walkForward.candidates,
    folds: walkForward.folds,
    aggregateResults: walkForward.aggregateResults,
    aggregateSelection: walkForward.aggregateSelection,
    stability: walkForward.stability,
    untouchedTestReservation: walkForward.untouchedTestReservation,
  };
}

function validateWalkForwardArtifact({
  walkForwardEvaluation,
  walkForwardEvaluationText,
  dataset,
  fixed,
}) {
  const walkForward = assertPlainObject(walkForwardEvaluation, 'walk-forward evaluation');
  if (walkForward.walkForwardVersion !== 1) {
    throw new Error('walk-forward version must equal 1.');
  }
  if (
    walkForward.walkForwardSha256 !==
    sha256(JSON.stringify(walkForwardIdentity(walkForward)))
  ) {
    throw new Error('walk-forward internal SHA-256 is invalid.');
  }
  const parsedText = parseJson(walkForwardEvaluationText, 'walk-forward evaluation text');
  if (JSON.stringify(parsedText) !== JSON.stringify(walkForward)) {
    throw new Error('walk-forward evaluation text does not match its artifact.');
  }
  if (
    walkForward.sourceDatasetSha256 !== dataset.datasetSha256 ||
    walkForward.sourceFixedEvaluationSha256 !== fixed.evaluationSha256
  ) {
    throw new Error('walk-forward source identities drifted.');
  }
  if (
    walkForward.untouchedTestReservation?.rowsIncluded !== false ||
    Object.hasOwn(walkForward.untouchedTestReservation ?? {}, 'rows')
  ) {
    throw new Error('walk-forward evaluation must keep untouched-test rows sealed.');
  }

  const fixedCandidate = fixed.coherentMatchup?.selection?.selectedCandidate;
  const aggregateCandidate = walkForward.aggregateSelection?.selectedCandidate;
  if (
    !fixedCandidate ||
    !aggregateCandidate ||
    fixedCandidate.candidateId !== aggregateCandidate.candidateId
  ) {
    throw new Error(
      'fixed holdout and walk-forward must agree on the coherent batter-pitcher candidate before platoon fitting.',
    );
  }
  return walkForward;
}

function selectedBaseParameters(fixed, walkForward) {
  const selected = assertPlainObject(
    walkForward.aggregateSelection?.selectedCandidate,
    'walk-forward selected coherent candidate',
  );
  return Object.freeze({
    batterPooling: assertPositiveFinite(
      fixed.poolingBoundary?.batter?.selection?.selectedCandidate?.leagueEquivalentPa,
      'selected batter pooling strength',
    ),
    pitcherPooling: assertPositiveFinite(
      fixed.poolingBoundary?.pitcherAllowed?.selection?.selectedCandidate
        ?.leagueEquivalentPa,
      'selected pitcher pooling strength',
    ),
    batterCoefficient: assertNonNegativeFinite(
      selected.batterCoefficient,
      'selected batterCoefficient',
    ),
    pitcherAllowedCoefficient: assertNonNegativeFinite(
      selected.pitcherAllowedCoefficient,
      'selected pitcherAllowedCoefficient',
    ),
    selectedCandidateId: assertNonEmptyString(
      selected.candidateId,
      'selected coherent candidateId',
    ),
  });
}

function pooledIdentityEstimates({ observations, identityKey, categories, leagueTarget, strength }) {
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
    const identity = splitIdentity(
      observation.providerBatterId,
      observation.matchupKey,
    );
    const current = counts.get(identity) ?? emptyCounts(categories);
    current[observation.terminalCategory] += 1;
    counts.set(identity, current);
  }
  return counts;
}

function leagueMatchupTarget({ candidate, rawCounts, categories, leagueTarget }) {
  if (candidate.leaguePlatoonExactTarget) return leagueTarget;
  return poolCategoricalCountsOnce({
    categories,
    source: {
      kind: 'raw-current-season-categorical-counts',
      counts: rawCounts ?? emptyCounts(categories),
    },
    leagueTarget,
    leagueEquivalentPa: candidate.leaguePlatoonEquivalentPa,
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
    'player overall plus league platoon target',
  );
}

function playerSplitEstimate({ candidate, rawCounts, target, categories }) {
  if (candidate.playerSplitExactTarget) return target;
  return poolCategoricalCountsOnce({
    categories,
    source: {
      kind: 'raw-current-season-categorical-counts',
      counts: rawCounts ?? emptyCounts(categories),
    },
    leagueTarget: target,
    leagueEquivalentPa: candidate.playerSplitEquivalentPa,
  }).probabilities;
}

export function applyPlatoonDeviation({
  categories: rawCategories,
  batterOverall,
  playerSplit,
  platoonCoefficient,
}) {
  const categories = validateStringList(rawCategories, 'categories', 2);
  const coefficient = assertNonNegativeFinite(
    platoonCoefficient,
    'platoonCoefficient',
  );
  if (coefficient === 0) return batterOverall;
  return stableSoftmax(
    Object.fromEntries(
      categories.map((category) => [
        category,
        Math.log(batterOverall[category]) +
          coefficient *
            (Math.log(playerSplit[category]) - Math.log(batterOverall[category])),
      ]),
    ),
    categories,
  );
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
            batterCoefficient *
              (Math.log(batterVector[category]) - leagueLog) +
            pitcherAllowedCoefficient *
              (Math.log(pitcherVector[category]) - leagueLog),
        ];
      }),
    ),
    categories,
  );
}

function buildCandidateCaches({
  candidate,
  validationObservations,
  matchupCounts,
  splitCounts,
  batterEstimates,
  unseenBatter,
  categories,
  leagueTarget,
}) {
  const leagueByMatchup = new Map();
  const splitByIdentity = new Map();
  for (const observation of validationObservations) {
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
      const batterOverall =
        batterEstimates.get(observation.providerBatterId) ?? unseenBatter;
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
  }
  return Object.freeze({ splitByIdentity });
}

function evaluateCandidate({
  candidate,
  validationObservations,
  categories,
  hitCategories,
  leagueTarget,
  batterEstimates,
  pitcherEstimates,
  unseenBatter,
  unseenPitcher,
  matchupCounts,
  splitCounts,
  baseParameters,
  validationObservationIdsSha256,
}) {
  const hitSet = new Set(hitCategories);
  const caches =
    candidate.platoonCoefficient === 0
      ? null
      : buildCandidateCaches({
          candidate,
          validationObservations,
          matchupCounts,
          splitCounts,
          batterEstimates,
          unseenBatter,
          categories,
          leagueTarget,
        });

  let categoricalLogLoss = 0;
  let categoricalBrier = 0;
  let hitLogLoss = 0;
  let hitBrier = 0;
  let actualProbabilityMinimum = 1;
  let actualProbabilityMaximum = 0;
  let hitProbabilityMinimum = 1;
  let hitProbabilityMaximum = 0;

  for (const observation of validationObservations) {
    const batterOverall =
      batterEstimates.get(observation.providerBatterId) ?? unseenBatter;
    const pitcherVector =
      pitcherEstimates.get(observation.providerPitcherId) ?? unseenPitcher;
    const batterVector =
      candidate.platoonCoefficient === 0
        ? batterOverall
        : applyPlatoonDeviation({
            categories,
            batterOverall,
            playerSplit: caches.splitByIdentity.get(
              splitIdentity(observation.providerBatterId, observation.matchupKey),
            ),
            platoonCoefficient: candidate.platoonCoefficient,
          });
    const probabilities = coherentMatchup({
      categories,
      leagueTarget,
      batterVector,
      pitcherVector,
      batterCoefficient: baseParameters.batterCoefficient,
      pitcherAllowedCoefficient: baseParameters.pitcherAllowedCoefficient,
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
      throw new Error('platoon candidate produced an invalid Hit probability.');
    }
    const hit = hitSet.has(observation.terminalCategory) ? 1 : 0;
    hitLogLoss +=
      hit === 1 ? -Math.log(hitProbability) : -Math.log(1 - hitProbability);
    hitBrier += (hitProbability - hit) ** 2;
    hitProbabilityMinimum = Math.min(hitProbabilityMinimum, hitProbability);
    hitProbabilityMaximum = Math.max(hitProbabilityMaximum, hitProbability);
  }

  const count = validationObservations.length;
  return Object.freeze({
    candidate,
    validationObservationCount: count,
    validationObservationIdsSha256,
    validationCategoricalLogLoss: categoricalLogLoss / count,
    validationCategoricalBrierScore: categoricalBrier / count,
    validationHitLogLoss: hitLogLoss / count,
    validationHitBrierScore: hitBrier / count,
    actualProbabilityMinimum,
    actualProbabilityMaximum,
    hitProbabilityMinimum,
    hitProbabilityMaximum,
  });
}

function priorRank(exactTarget, finiteValue) {
  return exactTarget ? EXACT_PRIOR_RANK : finiteValue;
}

function rankResults(results) {
  return [...results].sort((left, right) => {
    const lossDifference =
      left.validationCategoricalLogLoss - right.validationCategoricalLogLoss;
    if (Math.abs(lossDifference) > TOLERANCE) return lossDifference;
    const coefficientDifference =
      left.candidate.platoonCoefficient - right.candidate.platoonCoefficient;
    if (coefficientDifference !== 0) return coefficientDifference;
    const splitDifference =
      priorRank(
        right.candidate.playerSplitExactTarget,
        right.candidate.playerSplitEquivalentPa,
      ) -
      priorRank(
        left.candidate.playerSplitExactTarget,
        left.candidate.playerSplitEquivalentPa,
      );
    if (splitDifference !== 0) return splitDifference;
    const leagueDifference =
      priorRank(
        right.candidate.leaguePlatoonExactTarget,
        right.candidate.leaguePlatoonEquivalentPa,
      ) -
      priorRank(
        left.candidate.leaguePlatoonExactTarget,
        left.candidate.leaguePlatoonEquivalentPa,
      );
    return leagueDifference || left.candidate.candidateId.localeCompare(right.candidate.candidateId);
  });
}

function selectCandidate(results) {
  const ranked = rankResults(results);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || !second) {
    throw new Error('platoon selection requires at least two candidates.');
  }
  if (
    Math.abs(
      second.validationCategoricalLogLoss - best.validationCategoricalLogLoss,
    ) <= TOLERANCE &&
    best.candidate.candidateId !== 'no-platoon'
  ) {
    return Object.freeze({
      status: 'ambiguous-validation-result',
      selectedCandidate: null,
    });
  }
  return Object.freeze({
    status:
      best.candidate.candidateId === 'no-platoon'
        ? 'no-platoon-baseline-selected'
        : 'platoon-candidate-selected',
    selectedCandidate: best.candidate,
    validationCategoricalLogLoss: best.validationCategoricalLogLoss,
    validationCategoricalBrierScore: best.validationCategoricalBrierScore,
    validationHitLogLoss: best.validationHitLogLoss,
    validationHitBrierScore: best.validationHitBrierScore,
  });
}

function boundaryFlags(selected, candidates) {
  if (!selected || selected.candidateId === 'no-platoon') {
    return Object.freeze({
      platoonCoefficientAtTestedMinimum: false,
      platoonCoefficientAtTestedMaximum: false,
      leaguePriorAtFiniteBoundary: false,
      playerSplitPriorAtFiniteBoundary: false,
    });
  }
  const alternatives = candidates.filter(
    (candidate) => candidate.candidateId !== 'no-platoon',
  );
  const coefficients = alternatives.map((candidate) => candidate.platoonCoefficient);
  const leagueFinite = alternatives
    .map((candidate) => candidate.leaguePlatoonEquivalentPa)
    .filter((value) => value !== null);
  const splitFinite = alternatives
    .map((candidate) => candidate.playerSplitEquivalentPa)
    .filter((value) => value !== null);
  return Object.freeze({
    platoonCoefficientAtTestedMinimum:
      selected.platoonCoefficient === Math.min(...coefficients),
    platoonCoefficientAtTestedMaximum:
      selected.platoonCoefficient === Math.max(...coefficients),
    leaguePriorAtFiniteBoundary:
      selected.leaguePlatoonEquivalentPa !== null &&
      (selected.leaguePlatoonEquivalentPa === Math.min(...leagueFinite) ||
        selected.leaguePlatoonEquivalentPa === Math.max(...leagueFinite)),
    playerSplitPriorAtFiniteBoundary:
      selected.playerSplitEquivalentPa !== null &&
      (selected.playerSplitEquivalentPa === Math.min(...splitFinite) ||
        selected.playerSplitEquivalentPa === Math.max(...splitFinite)),
  });
}

function matchupCountSummary(matchupCounts, categories) {
  return Object.freeze(
    Object.fromEntries(
      [...matchupCounts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, counts]) => [
          key,
          Object.freeze({
            observationCount: categories.reduce(
              (sum, category) => sum + counts[category],
              0,
            ),
            categoryCounts: Object.freeze({ ...counts }),
          }),
        ]),
    ),
  );
}

export function evaluateResolvedCategoricalPlatoon({
  dataset,
  datasetText,
  fixedEvaluation,
  fixedEvaluationText,
  walkForwardEvaluation,
  walkForwardEvaluationText,
  canonicalCategories: rawCanonicalCategories,
  hitCategories: rawHitCategories,
  candidates: rawCandidates = DEFAULT_M8_PLATOON_CANDIDATES,
}) {
  const sourceText = assertNonEmptyString(datasetText, 'datasetText');
  const fixedText = assertNonEmptyString(fixedEvaluationText, 'fixedEvaluationText');
  const walkForwardText = assertNonEmptyString(
    walkForwardEvaluationText,
    'walkForwardEvaluationText',
  );
  const canonicalCategories = validateStringList(
    rawCanonicalCategories,
    'canonicalCategories',
    2,
  );
  const hitCategories = validateStringList(rawHitCategories, 'hitCategories', 1);
  const canonicalSet = new Set(canonicalCategories);
  for (const category of hitCategories) {
    if (!canonicalSet.has(category)) {
      throw new Error(`hit category ${category} is not canonical.`);
    }
  }
  const candidates = validateCandidates(rawCandidates);

  const fixed = validateFixedArtifact({
    dataset,
    datasetText: sourceText,
    fixedEvaluation,
    fixedEvaluationText: fixedText,
    canonicalCategories,
    hitCategories,
  });
  const walkForward = validateWalkForwardArtifact({
    walkForwardEvaluation,
    walkForwardEvaluationText: walkForwardText,
    dataset,
    fixed,
  });
  const observations = extractObservations(dataset, fixed);
  if (observations.fitPlatoon.length === 0 || observations.validationPlatoon.length === 0) {
    throw new Error('platoon evaluation requires non-empty fit and validation cohorts.');
  }

  const baseParameters = selectedBaseParameters(fixed, walkForward);
  const categories = observations.modeledCategories;
  const fitLeagueCounts = leagueCounts(observations.fitOverall, categories);
  const leagueTarget = distributionFromCounts(
    fitLeagueCounts,
    categories,
    'fit current-season league distribution',
  );
  const batter = pooledIdentityEstimates({
    observations: observations.fitOverall,
    identityKey: 'providerBatterId',
    categories,
    leagueTarget,
    strength: baseParameters.batterPooling,
  });
  const pitcher = pooledIdentityEstimates({
    observations: observations.fitOverall,
    identityKey: 'providerPitcherId',
    categories,
    leagueTarget,
    strength: baseParameters.pitcherPooling,
  });
  const unseenBatter = unseenEstimate(
    categories,
    leagueTarget,
    baseParameters.batterPooling,
  );
  const unseenPitcher = unseenEstimate(
    categories,
    leagueTarget,
    baseParameters.pitcherPooling,
  );
  const matchupCounts = countsByMatchup(observations.fitPlatoon, categories);
  const splitCounts = countsByBatterSplit(observations.fitPlatoon, categories);
  const validationObservationIdsSha256 = sha256(
    JSON.stringify(
      observations.validationPlatoon.map((observation) => observation.observationId),
    ),
  );

  const results = Object.freeze(
    candidates.map((candidate) =>
      evaluateCandidate({
        candidate,
        validationObservations: observations.validationPlatoon,
        categories,
        hitCategories,
        leagueTarget,
        batterEstimates: batter.estimates,
        pitcherEstimates: pitcher.estimates,
        unseenBatter,
        unseenPitcher,
        matchupCounts,
        splitCounts,
        baseParameters,
        validationObservationIdsSha256,
      }),
    ),
  );
  if (
    results.some(
      (result) =>
        result.validationObservationCount !== observations.validationPlatoon.length ||
        result.validationObservationIdsSha256 !== validationObservationIdsSha256,
    )
  ) {
    throw new Error('platoon candidates did not use one identical validation cohort.');
  }

  const selection = selectCandidate(results);
  const baseline = results.find(
    (result) => result.candidate.candidateId === 'no-platoon',
  );
  if (!baseline) throw new Error('no-platoon baseline result is missing.');
  const selectedResult = selection.selectedCandidate
    ? results.find(
        (result) =>
          result.candidate.candidateId === selection.selectedCandidate.candidateId,
      )
    : null;
  const improvement = Object.freeze({
    categoricalLogLoss:
      selectedResult === null
        ? null
        : baseline.validationCategoricalLogLoss -
          selectedResult.validationCategoricalLogLoss,
    categoricalBrier:
      selectedResult === null
        ? null
        : baseline.validationCategoricalBrierScore -
          selectedResult.validationCategoricalBrierScore,
    hitLogLoss:
      selectedResult === null
        ? null
        : baseline.validationHitLogLoss - selectedResult.validationHitLogLoss,
    hitBrier:
      selectedResult === null
        ? null
        : baseline.validationHitBrierScore - selectedResult.validationHitBrierScore,
  });

  const identity = {
    activeSeason: fixed.activeSeason,
    sourceDatasetSha256: fixed.sourceDatasetSha256,
    sourceDatasetFileSha256: fixed.sourceDatasetFileSha256,
    sourceFixedEvaluationSha256: fixed.evaluationSha256,
    sourceFixedEvaluationFileSha256: sha256(fixedText),
    sourceWalkForwardSha256: walkForward.walkForwardSha256,
    sourceWalkForwardFileSha256: sha256(walkForwardText),
    canonicalCategories,
    modeledCategories: categories,
    structuralZeroCategories: fixed.canonicalVectorPolicy.structuralZeroCategories,
    hitCategories,
    baseParameters,
    platoonModel: Object.freeze({
      modelFamily: 'current-season-batter-platoon-log-ratio-interaction',
      leaguePlatoonTarget:
        'current-season matchup-cell categorical distribution pooled toward the current-season league distribution',
      playerSplitTarget:
        'player current-season overall pooled talent combined with the current-season league platoon effect',
      playerSplitPooling:
        'raw current-season batter matchup-cell counts pooled once toward the player-overall-plus-league-platoon target',
      application:
        'replace the batter vector through a log-ratio platoon deviation before the existing coherent batter-pitcher softmax',
      doubleShrinkageAllowed: false,
      priorSeasonRowsAllowed: false,
      hardSampleCutoffAllowed: false,
    }),
    cohorts: Object.freeze({
      fitOverallObservationCount: observations.fitOverall.length,
      fitPlatoonObservationCount: observations.fitPlatoon.length,
      fitPlatoonExcludedCount:
        observations.fitOverall.length - observations.fitPlatoon.length,
      validationOverallObservationCount: observations.validationOverall.length,
      validationPlatoonObservationCount: observations.validationPlatoon.length,
      validationPlatoonExcludedCount:
        observations.validationOverall.length - observations.validationPlatoon.length,
      validationObservationIdsSha256,
      uniqueFitBatterCount: batter.counts.size,
      uniqueFitPitcherCount: pitcher.counts.size,
      uniqueFitBatterSplitCount: splitCounts.size,
      matchupCounts: matchupCountSummary(matchupCounts, categories),
    }),
    candidates,
    results,
    baseline,
    selection,
    improvementVersusNoPlatoon: improvement,
    selectedBoundaryFlags: boundaryFlags(selection.selectedCandidate, candidates),
    untouchedTestReservation: fixed.untouchedTestReservation,
  };
  return Object.freeze({
    platoonEvaluationVersion: 1,
    purpose:
      'Fit and validate a continuous current-season batter platoon interaction on top of the verified coherent categorical batter-pitcher model without double-counting overall batter talent.',
    status: 'offline-resolved-categorical-platoon-evaluation-not-production-model',
    ...identity,
    platoonEvaluationSha256: sha256(JSON.stringify(identity)),
  });
}

export async function evaluateM8ResolvedCategoricalPlatoon({
  datasetPath,
  fixedEvaluationPath,
  walkForwardEvaluationPath,
  canonicalCategories,
  hitCategories,
  candidates = DEFAULT_M8_PLATOON_CANDIDATES,
}) {
  const [datasetText, fixedEvaluationText, walkForwardEvaluationText] =
    await Promise.all([
      readFile(assertNonEmptyString(datasetPath, 'datasetPath'), 'utf8'),
      readFile(
        assertNonEmptyString(fixedEvaluationPath, 'fixedEvaluationPath'),
        'utf8',
      ),
      readFile(
        assertNonEmptyString(
          walkForwardEvaluationPath,
          'walkForwardEvaluationPath',
        ),
        'utf8',
      ),
    ]);
  return evaluateResolvedCategoricalPlatoon({
    dataset: parseJson(datasetText, 'resolved categorical dataset'),
    datasetText,
    fixedEvaluation: parseJson(fixedEvaluationText, 'fixed categorical evaluation'),
    fixedEvaluationText,
    walkForwardEvaluation: parseJson(
      walkForwardEvaluationText,
      'categorical walk-forward evaluation',
    ),
    walkForwardEvaluationText,
    canonicalCategories,
    hitCategories,
    candidates,
  });
}
