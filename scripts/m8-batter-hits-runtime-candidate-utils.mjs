import { poolCategoricalCountsOnce } from './m8-categorical-pooling-utils.mjs';
import {
  terminalPaOutcomeProbabilities,
  verifyM8TerminalPaOutcomeArtifact,
} from './m8-terminal-pa-outcome-artifact-utils.mjs';
import { verifyM8SharedOffensiveEnvironmentV2 } from './m8-shared-offensive-environment-v2-utils.mjs';
import { verifyM8StarterRetentionArtifact } from './m8-starter-retention-artifact-utils.mjs';
import { sha256 } from './provider-probe-utils.mjs';

const HIT_CATEGORIES = new Set(['1B', '2B', '3B', 'HR']);
const VALID_HANDS = Object.freeze(['L', 'R']);
const ENVIRONMENT_COEFFICIENTS = Object.freeze([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]);
const TOLERANCE = 1e-12;
const PROBABILITY_FLOOR = 1e-300;
const SQRT_TWO = Math.sqrt(2);

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function string(value, label) {
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

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function probability(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be in [0,1].`);
  }
  return value;
}

function normalizeVector(values, label) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0) || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`${label} contains invalid probability mass.`);
  }
  const normalized = values.map((value) => value / total);
  if (Math.abs(normalized.reduce((sum, value) => sum + value, 0) - 1) > TOLERANCE) {
    throw new Error(`${label} does not sum to one.`);
  }
  return Object.freeze(normalized);
}

function normalizeObject(raw, categories, label) {
  const values = categories.map((category) => raw[category]);
  const normalized = normalizeVector(values, label);
  return Object.freeze(
    Object.fromEntries(categories.map((category, index) => [category, normalized[index]])),
  );
}

function stableSoftmax(logScores, categories) {
  const maximum = Math.max(...categories.map((category) => logScores[category]));
  return normalizeObject(
    Object.fromEntries(
      categories.map((category) => [category, Math.exp(logScores[category] - maximum)]),
    ),
    categories,
    'runtime categorical softmax',
  );
}

function logit(value) {
  const p = Math.min(1 - 1e-12, Math.max(1e-12, value));
  return Math.log(p / (1 - p));
}

function logistic(value) {
  if (value >= 0) {
    const exp = Math.exp(-value);
    return 1 / (1 + exp);
  }
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function erf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial =
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
    t;
  return sign * (1 - polynomial * Math.exp(-x * x));
}

function normalCdf(value) {
  return 0.5 * (1 + erf(value / SQRT_TWO));
}

function discreteNormalPmf(mean, sigma, maximum = 63) {
  if (!(mean > 0) || !(sigma >= 0)) throw new Error('scenario PA parameters are invalid.');
  if (sigma === 0) {
    const count = Math.max(0, Math.min(maximum, Math.round(mean)));
    const values = Array(maximum + 1).fill(0);
    values[count] = 1;
    return Object.freeze(values);
  }
  const values = Array(maximum + 1).fill(0);
  for (let count = 0; count < maximum; count += 1) {
    values[count] = Math.max(
      0,
      normalCdf((count + 0.5 - mean) / sigma) -
        normalCdf((count - 0.5 - mean) / sigma),
    );
  }
  values[maximum] = Math.max(0, 1 - normalCdf((maximum - 0.5 - mean) / sigma));
  return normalizeVector(values, 'discrete normal team PA PMF');
}

function slotCountPmf(teamPaPmf, lineupSlot, maximumTurns) {
  const mass = Array(maximumTurns + 1).fill(0);
  for (let teamPa = 0; teamPa < teamPaPmf.length; teamPa += 1) {
    const turns =
      teamPa < lineupSlot ? 0 : Math.floor((teamPa - lineupSlot) / 9) + 1;
    mass[Math.min(maximumTurns, turns)] += teamPaPmf[teamPa];
  }
  return normalizeVector(mass, 'batting-slot turn PMF');
}

function survivalFromPmf(pmf) {
  const survival = [];
  for (let count = 1; count < pmf.length; count += 1) {
    survival.push(pmf.slice(count).reduce((sum, value) => sum + value, 0));
  }
  return survival;
}

export function namedHitterOpportunityPmf({ teamPaPmf, lineupSlot, conditionalRetention }) {
  const retention = array(conditionalRetention, 'conditional retention').map((value, index) =>
    probability(value, `conditional retention ${index + 1}`),
  );
  if (retention.length === 0 || Math.abs(retention[0] - 1) > TOLERANCE) {
    throw new Error('conditional retention must start at one.');
  }
  const slotPmf = slotCountPmf(teamPaPmf, lineupSlot, retention.length);
  const slotSurvival = survivalFromPmf(slotPmf);
  let cumulativeRetention = 1;
  const namedSurvival = slotSurvival.map((value, index) => {
    cumulativeRetention *= retention[index];
    return value * cumulativeRetention;
  });
  const pmf = Array(namedSurvival.length + 1).fill(0);
  pmf[0] = 1 - (namedSurvival[0] ?? 0);
  for (let count = 1; count < namedSurvival.length; count += 1) {
    pmf[count] = namedSurvival[count - 1] - namedSurvival[count];
  }
  pmf[namedSurvival.length] = namedSurvival.at(-1) ?? 0;
  return normalizeVector(pmf, 'named hitter opportunity PMF');
}

function bernoulliCountPmf(probabilities) {
  let pmf = [1];
  for (const p of probabilities) {
    const next = Array(pmf.length + 1).fill(0);
    for (let hits = 0; hits < pmf.length; hits += 1) {
      next[hits] += pmf[hits] * (1 - p);
      next[hits + 1] += pmf[hits] * p;
    }
    pmf = next;
  }
  return normalizeVector(pmf, 'Poisson-binomial hit PMF');
}

function mixOverOpportunityCount(countPmf, perOpportunityProbabilities) {
  const maximum = countPmf.length - 1;
  if (perOpportunityProbabilities.length < maximum) {
    throw new Error('one hit probability is required for every supported opportunity.');
  }
  const output = Array(maximum + 1).fill(0);
  for (let count = 0; count <= maximum; count += 1) {
    const conditional = bernoulliCountPmf(perOpportunityProbabilities.slice(0, count));
    for (let hits = 0; hits < conditional.length; hits += 1) {
      output[hits] += countPmf[count] * conditional[hits];
    }
  }
  return normalizeVector(output, 'opportunity-mixed hit PMF');
}

function starterSurvival(starterBfPmf, requiredTeamPaIndex) {
  if (requiredTeamPaIndex <= 0) return 1;
  return starterBfPmf
    .slice(requiredTeamPaIndex)
    .reduce((sum, value) => sum + value, 0);
}

function hitProbabilityFromVector(vector, hitCategories) {
  return hitCategories.reduce((sum, category) => sum + (vector[category] ?? 0), 0);
}

function playerAdjustedTarget(batterOverall, leagueMatchup, leagueTarget, categories) {
  return normalizeObject(
    Object.fromEntries(
      categories.map((category) => [
        category,
        batterOverall[category] * (leagueMatchup[category] / leagueTarget[category]),
      ]),
    ),
    categories,
    'runtime player platoon target',
  );
}

function platoonBatterVector(terminal, batterId, batterSide, pitcherHand) {
  const categories = terminal.categories;
  const batterKey = String(batterId);
  const overall = terminal.batterOverall[batterKey] ?? terminal.unseenBatter;
  if (
    terminal.selectedPlatoonCandidate.platoonCoefficient === 0 ||
    !VALID_HANDS.includes(batterSide) ||
    !VALID_HANDS.includes(pitcherHand)
  ) {
    return overall;
  }
  const matchup = `${batterSide}-vs-${pitcherHand}`;
  const splitKey = `${batterKey}|${matchup}`;
  const split =
    terminal.batterSplitByMatchup[splitKey] ??
    playerAdjustedTarget(
      overall,
      terminal.leaguePlatoonByMatchup[matchup],
      terminal.leagueTarget,
      categories,
    );
  const coefficient = terminal.selectedPlatoonCandidate.platoonCoefficient;
  return stableSoftmax(
    Object.fromEntries(
      categories.map((category) => [
        category,
        Math.log(overall[category]) +
          coefficient * (Math.log(split[category]) - Math.log(overall[category])),
      ]),
    ),
    categories,
  );
}

function coherentVector(terminal, batterVector, pitcherVector) {
  const categories = terminal.categories;
  return stableSoftmax(
    Object.fromEntries(
      categories.map((category) => {
        const leagueLog = Math.log(terminal.leagueTarget[category]);
        return [
          category,
          leagueLog +
            terminal.baseParameters.batterCoefficient *
              (Math.log(batterVector[category]) - leagueLog) +
            terminal.baseParameters.pitcherAllowedCoefficient *
              (Math.log(pitcherVector[category]) - leagueLog),
        ];
      }),
    ),
    categories,
  );
}

export function buildGenericBullpenModel({ terminalArtifact: rawTerminal, bullpenRows }) {
  const terminal = verifyM8TerminalPaOutcomeArtifact(rawTerminal);
  const categories = terminal.categories;
  const countsByHand = Object.fromEntries(
    VALID_HANDS.map((hand) => [hand, Object.fromEntries(categories.map((category) => [category, 0]))]),
  );
  const handCounts = { L: 0, R: 0 };
  for (const row of array(bullpenRows, 'bullpen rows')) {
    if (!VALID_HANDS.includes(row.pitcherHand)) continue;
    if (!categories.includes(row.terminalCategory)) continue;
    countsByHand[row.pitcherHand][row.terminalCategory] += 1;
    handCounts[row.pitcherHand] += 1;
  }
  if (handCounts.L + handCounts.R === 0) throw new Error('bullpen model has no usable current-season rows.');
  const byHand = {};
  for (const hand of VALID_HANDS) {
    byHand[hand] = poolCategoricalCountsOnce({
      categories,
      source: {
        kind: 'raw-current-season-categorical-counts',
        counts: countsByHand[hand],
      },
      leagueTarget: terminal.leagueTarget,
      leagueEquivalentPa: terminal.baseParameters.pitcherPooling,
    }).probabilities;
  }
  const total = handCounts.L + handCounts.R;
  return Object.freeze({
    modelVersion: 'm8-generic-bullpen-outcome-v1',
    countsByHand: Object.freeze({ L: Object.freeze(countsByHand.L), R: Object.freeze(countsByHand.R) }),
    handCounts: Object.freeze({ ...handCounts }),
    handWeights: Object.freeze({ L: handCounts.L / total, R: handCounts.R / total }),
    byHand: Object.freeze(byHand),
  });
}

function bullpenHitProbability({ terminal, bullpenModel, batterId, batterSide }) {
  let hitProbability = 0;
  for (const hand of VALID_HANDS) {
    const batterVector = platoonBatterVector(terminal, batterId, batterSide, hand);
    const vector = coherentVector(terminal, batterVector, bullpenModel.byHand[hand]);
    hitProbability +=
      bullpenModel.handWeights[hand] *
      hitProbabilityFromVector(vector, terminal.hitCategories);
  }
  return probability(hitProbability, 'generic bullpen hit probability');
}

function adjustForEnvironment(baseProbability, scenarioProbability, baselineProbability, coefficient) {
  if (coefficient === 0) return baseProbability;
  return probability(
    logistic(
      logit(baseProbability) +
        coefficient * (logit(scenarioProbability) - logit(baselineProbability)),
    ),
    'environment-adjusted hit probability',
  );
}

function scenarioSideState(scenario, side) {
  return object(scenario[side], `${side} scenario state`);
}

export function predictM8BatterHitsDistribution({
  sharedEnvironmentArtifact: rawShared,
  starterRetentionArtifact: rawRetention,
  terminalOutcomeArtifact: rawTerminal,
  bullpenModel,
  environmentCoefficient,
  observation,
}) {
  const shared = verifyM8SharedOffensiveEnvironmentV2(rawShared);
  const retention = verifyM8StarterRetentionArtifact(rawRetention);
  const terminal = verifyM8TerminalPaOutcomeArtifact(rawTerminal);
  const side = string(observation.side, 'observation side');
  const lineupSlot = positiveInteger(observation.lineupSlot, 'lineup slot');
  const batterId = positiveInteger(observation.batterId, 'batter id');
  const starterPitcherId = positiveInteger(observation.starterPitcherId, 'starter pitcher id');
  const batterSide = string(observation.batterSide, 'batter side');
  const starterPitcherHand = string(observation.starterPitcherHand, 'starter pitcher hand');
  const retentionCurve = retention.conditionalRetentionByGroup[`slot:${lineupSlot}`];
  if (!retentionCurve) throw new Error(`starter retention is missing lineup slot ${lineupSlot}.`);
  const starterVector = terminalPaOutcomeProbabilities({
    artifact: terminal,
    batterId,
    pitcherId: starterPitcherId,
    batterSide,
    pitcherHand: starterPitcherHand,
  });
  const starterBaseHit = hitProbabilityFromVector(starterVector, terminal.hitCategories);
  const bullpenBaseHit = bullpenHitProbability({ terminal, bullpenModel, batterId, batterSide });
  const baselineEnvironmentHit = shared.scenarios.reduce(
    (sum, scenario) =>
      sum + scenario.weight * scenarioSideState(scenario, side).hitProbability,
    0,
  );
  const scenarioResults = [];
  let maximumHits = 0;
  for (const scenario of shared.scenarios) {
    const state = scenarioSideState(scenario, side);
    const teamPaPmf = discreteNormalPmf(state.meanPa, state.sigmaPa);
    const countPmf = namedHitterOpportunityPmf({
      teamPaPmf,
      lineupSlot,
      conditionalRetention: retentionCurve,
    });
    const starterBfPmf = shared.starterBullpenTransition.bySide[side];
    const perOpportunityHitProbabilities = [];
    for (let turn = 1; turn < countPmf.length; turn += 1) {
      const requiredTeamPaIndex = lineupSlot + 9 * (turn - 1);
      const starterProbability = starterSurvival(starterBfPmf, requiredTeamPaIndex);
      const starterHit = adjustForEnvironment(
        starterBaseHit,
        state.hitProbability,
        baselineEnvironmentHit,
        environmentCoefficient,
      );
      const bullpenHit = adjustForEnvironment(
        bullpenBaseHit,
        state.hitProbability,
        baselineEnvironmentHit,
        environmentCoefficient,
      );
      perOpportunityHitProbabilities.push(
        starterProbability * starterHit + (1 - starterProbability) * bullpenHit,
      );
    }
    const hitPmf = mixOverOpportunityCount(countPmf, perOpportunityHitProbabilities);
    maximumHits = Math.max(maximumHits, hitPmf.length - 1);
    scenarioResults.push(
      Object.freeze({
        scenarioIndex: scenario.scenarioIndex,
        weight: scenario.weight,
        opportunityCountPmf: countPmf,
        perOpportunityHitProbabilities: Object.freeze(perOpportunityHitProbabilities),
        hitPmf,
      }),
    );
  }
  const mixed = Array(maximumHits + 1).fill(0);
  for (const scenario of scenarioResults) {
    for (let hits = 0; hits < scenario.hitPmf.length; hits += 1) {
      mixed[hits] += scenario.weight * scenario.hitPmf[hits];
    }
  }
  return Object.freeze({
    statisticDistribution: normalizeVector(mixed, 'scenario-mixed Batter Hits PMF'),
    scenarios: Object.freeze(scenarioResults),
  });
}

function metricAccumulator() {
  return { count: 0, logLoss: 0, brier: 0, line05Brier: 0, line15Brier: 0, line25Brier: 0 };
}

function addMetrics(accumulator, pmf, actualHits) {
  accumulator.count += 1;
  accumulator.logLoss += -Math.log(Math.max(pmf[actualHits] ?? 0, PROBABILITY_FLOOR));
  for (let hits = 0; hits < pmf.length; hits += 1) {
    accumulator.brier += (pmf[hits] - (hits === actualHits ? 1 : 0)) ** 2;
  }
  for (const [line, key] of [
    [0.5, 'line05Brier'],
    [1.5, 'line15Brier'],
    [2.5, 'line25Brier'],
  ]) {
    const higher = pmf.slice(Math.floor(line) + 1).reduce((sum, value) => sum + value, 0);
    accumulator[key] += (higher - (actualHits > line ? 1 : 0)) ** 2;
  }
}

function finalizeMetrics(accumulator) {
  return Object.freeze({
    observationCount: accumulator.count,
    logLoss: accumulator.logLoss / accumulator.count,
    multiclassBrier: accumulator.brier / accumulator.count,
    higher05Brier: accumulator.line05Brier / accumulator.count,
    higher15Brier: accumulator.line15Brier / accumulator.count,
    higher25Brier: accumulator.line25Brier / accumulator.count,
  });
}

function candidateIdentity(value) {
  return {
    artifactVersion: value.artifactVersion,
    modelVersion: value.modelVersion,
    status: value.status,
    productionEnabled: value.productionEnabled,
    activeSeason: value.activeSeason,
    sourceSharedEnvironmentArtifactSha256: value.sourceSharedEnvironmentArtifactSha256,
    sourceStarterRetentionArtifactSha256: value.sourceStarterRetentionArtifactSha256,
    sourceTerminalOutcomeArtifactSha256: value.sourceTerminalOutcomeArtifactSha256,
    selectedEnvironmentCoefficient: value.selectedEnvironmentCoefficient,
    bullpenModel: value.bullpenModel,
    validationResults: value.validationResults,
    selectedValidationMetrics: value.selectedValidationMetrics,
    validationObservationIdsSha256: value.validationObservationIdsSha256,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

export function buildM8BatterHitsRuntimeCandidate({
  sharedEnvironmentArtifact: rawShared,
  starterRetentionArtifact: rawRetention,
  terminalOutcomeArtifact: rawTerminal,
  bullpenRows,
  validationObservations,
}) {
  const shared = verifyM8SharedOffensiveEnvironmentV2(rawShared);
  const retention = verifyM8StarterRetentionArtifact(rawRetention);
  const terminal = verifyM8TerminalPaOutcomeArtifact(rawTerminal);
  const bullpenModel = buildGenericBullpenModel({ terminalArtifact: terminal, bullpenRows });
  const observations = array(validationObservations, 'validation observations');
  if (observations.length === 0) throw new Error('runtime candidate requires validation observations.');
  const ids = observations.map((observation) => string(observation.observationId, 'observation id'));
  if (new Set(ids).size !== ids.length) throw new Error('validation observation IDs must be unique.');
  const validationResults = ENVIRONMENT_COEFFICIENTS.map((coefficient) => {
    const accumulator = metricAccumulator();
    for (const observation of observations) {
      const prediction = predictM8BatterHitsDistribution({
        sharedEnvironmentArtifact: shared,
        starterRetentionArtifact: retention,
        terminalOutcomeArtifact: terminal,
        bullpenModel,
        environmentCoefficient: coefficient,
        observation,
      });
      addMetrics(
        accumulator,
        prediction.statisticDistribution,
        nonNegativeInteger(observation.actualHits, 'actual hits'),
      );
    }
    return Object.freeze({ environmentCoefficient: coefficient, metrics: finalizeMetrics(accumulator) });
  });
  const ranked = [...validationResults].sort(
    (left, right) =>
      left.metrics.logLoss - right.metrics.logLoss ||
      left.metrics.multiclassBrier - right.metrics.multiclassBrier ||
      left.environmentCoefficient - right.environmentCoefficient,
  );
  const selected = ranked[0];
  const identity = {
    artifactVersion: 1,
    modelVersion: 'm8-batter-hits-runtime-candidate-v1',
    status: 'frozen-current-season-complete-candidate-awaiting-untouched-test',
    productionEnabled: false,
    activeSeason: shared.activeSeason,
    sourceSharedEnvironmentArtifactSha256: shared.artifactSha256,
    sourceStarterRetentionArtifactSha256: retention.artifactSha256,
    sourceTerminalOutcomeArtifactSha256: terminal.artifactSha256,
    selectedEnvironmentCoefficient: selected.environmentCoefficient,
    bullpenModel,
    validationResults: Object.freeze(validationResults),
    selectedValidationMetrics: selected.metrics,
    validationObservationIdsSha256: sha256(JSON.stringify(ids)),
    untouchedTestReservation: Object.freeze({ ...shared.untouchedTestReservation, rowsIncluded: false }),
  };
  return Object.freeze({
    purpose: 'Frozen complete M8 Batter Hits baseball-distribution candidate combining shared game scenarios, starter-to-bullpen workload, named-hitter retention, and coherent current-season terminal PA outcomes.',
    ...identity,
    artifactSha256: sha256(JSON.stringify(candidateIdentity(identity))),
  });
}

export function verifyM8BatterHitsRuntimeCandidate(rawCandidate) {
  const candidate = object(rawCandidate, 'Batter Hits runtime candidate');
  if (
    candidate.artifactVersion !== 1 ||
    candidate.modelVersion !== 'm8-batter-hits-runtime-candidate-v1' ||
    candidate.productionEnabled !== false
  ) {
    throw new Error('unsupported Batter Hits runtime candidate contract.');
  }
  if (candidate.untouchedTestReservation?.rowsIncluded !== false) {
    throw new Error('runtime candidate exposes untouched-test rows.');
  }
  const weights = object(candidate.bullpenModel?.handWeights, 'bullpen hand weights');
  if (Math.abs(weights.L + weights.R - 1) > TOLERANCE) {
    throw new Error('bullpen hand weights do not sum to one.');
  }
  if (candidate.artifactSha256 !== sha256(JSON.stringify(candidateIdentity(candidate)))) {
    throw new Error('Batter Hits runtime candidate SHA-256 is invalid.');
  }
  return candidate;
}

export function evaluateFrozenM8BatterHitsCandidate({
  candidate: rawCandidate,
  sharedEnvironmentArtifact,
  starterRetentionArtifact,
  terminalOutcomeArtifact,
  observations,
}) {
  const candidate = verifyM8BatterHitsRuntimeCandidate(rawCandidate);
  const accumulator = metricAccumulator();
  const ids = [];
  for (const observation of array(observations, 'test observations')) {
    ids.push(string(observation.observationId, 'test observation id'));
    const prediction = predictM8BatterHitsDistribution({
      sharedEnvironmentArtifact,
      starterRetentionArtifact,
      terminalOutcomeArtifact,
      bullpenModel: candidate.bullpenModel,
      environmentCoefficient: candidate.selectedEnvironmentCoefficient,
      observation,
    });
    addMetrics(accumulator, prediction.statisticDistribution, observation.actualHits);
  }
  return Object.freeze({
    metrics: finalizeMetrics(accumulator),
    observationIdsSha256: sha256(JSON.stringify(ids)),
  });
}
