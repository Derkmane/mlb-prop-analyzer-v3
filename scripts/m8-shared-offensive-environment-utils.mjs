import { createHash } from 'node:crypto';

import { verifyM8TeamOffensiveEnvironmentDataset } from './m8-team-offensive-environment-dataset-utils.mjs';

const PERIOD_IDS = Object.freeze(['fit', 'validation']);
const SIDES = Object.freeze(['away', 'home']);
const DEFAULT_SCENARIO_COUNTS = Object.freeze([1, 2, 3, 4]);
const MIN_SIGMA = 0.75;
const MAX_ITERATIONS = 500;
const CONVERGENCE_TOLERANCE = 1e-10;
const PROBABILITY_FLOOR = 1e-300;
const SQRT_TWO = Math.sqrt(2);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertObject(value, label) {
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

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
  return value;
}

function assertProbability(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${label} must be in [0, 1].`);
  }
  return value;
}

function logSumExp(values) {
  const maximum = Math.max(...values);
  if (!Number.isFinite(maximum)) return maximum;
  let sum = 0;
  for (const value of values) sum += Math.exp(value - maximum);
  return maximum + Math.log(sum);
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

function logDiscreteNormalPmf(count, mean, sigma) {
  const lower = (count - 0.5 - mean) / sigma;
  const upper = (count + 0.5 - mean) / sigma;
  const denominator = 1 - normalCdf((-0.5 - mean) / sigma);
  const probability = (normalCdf(upper) - normalCdf(lower)) / denominator;
  return Math.log(Math.max(probability, PROBABILITY_FLOOR));
}

function buildLogFactorials(maximum) {
  const values = new Array(maximum + 1).fill(0);
  for (let index = 2; index <= maximum; index += 1) {
    values[index] = values[index - 1] + Math.log(index);
  }
  return values;
}

function logBinomialPmf(successes, trials, probability, logFactorials) {
  if (successes < 0 || successes > trials) return Number.NEGATIVE_INFINITY;
  const p = Math.min(1 - 1e-12, Math.max(1e-12, probability));
  return (
    logFactorials[trials] -
    logFactorials[successes] -
    logFactorials[trials - successes] +
    successes * Math.log(p) +
    (trials - successes) * Math.log1p(-p)
  );
}

function pairPeriodRows(period, periodId) {
  const rows = assertArray(period.rows, `${periodId}.rows`);
  if (period.rowCount !== rows.length) {
    throw new Error(`${periodId}.rowCount does not match rows.`);
  }
  const byGameId = new Map();
  for (const row of rows) {
    const gameId = assertPositiveInteger(row.gameId, `${periodId} gameId`);
    const side = row.side;
    if (!SIDES.includes(side)) throw new Error(`${periodId} game ${gameId} has invalid side.`);
    assertPositiveInteger(row.teamPlateAppearances, `${periodId} game ${gameId} ${side} PA`);
    assertNonNegativeInteger(row.teamHits, `${periodId} game ${gameId} ${side} hits`);
    if (row.teamHits > row.teamPlateAppearances) {
      throw new Error(`${periodId} game ${gameId} ${side} hits exceed PA.`);
    }
    const pair = byGameId.get(gameId) ?? {};
    if (pair[side] !== undefined) {
      throw new Error(`${periodId} game ${gameId} has duplicate ${side} row.`);
    }
    pair[side] = row;
    byGameId.set(gameId, pair);
  }
  const games = [];
  for (const [gameId, pair] of byGameId) {
    if (pair.away === undefined || pair.home === undefined) {
      throw new Error(`${periodId} game ${gameId} does not contain both sides.`);
    }
    if (pair.away.observedDate !== pair.home.observedDate) {
      throw new Error(`${periodId} game ${gameId} side dates disagree.`);
    }
    games.push(
      Object.freeze({
        gameId,
        observedDate: pair.away.observedDate,
        awayPa: pair.away.teamPlateAppearances,
        awayHits: pair.away.teamHits,
        homePa: pair.home.teamPlateAppearances,
        homeHits: pair.home.teamHits,
      }),
    );
  }
  games.sort(
    (left, right) =>
      left.observedDate.localeCompare(right.observedDate) || left.gameId - right.gameId,
  );
  return Object.freeze(games);
}

function validateAndPairDataset(rawDataset) {
  const dataset = verifyM8TeamOffensiveEnvironmentDataset(rawDataset);
  if (
    dataset.untouchedTestReservation?.rowsIncluded !== false ||
    Object.hasOwn(dataset.untouchedTestReservation ?? {}, 'rows')
  ) {
    throw new Error('team environment dataset must keep untouched-test rows sealed.');
  }
  const periods = {};
  for (const periodId of PERIOD_IDS) {
    periods[periodId] = pairPeriodRows(
      assertObject(dataset.periods?.[periodId], `periods.${periodId}`),
      periodId,
    );
    if (periods[periodId].length === 0) {
      throw new Error(`${periodId} must contain paired games.`);
    }
  }
  const fitEnd = periods.fit.at(-1).observedDate;
  const validationStart = periods.validation[0].observedDate;
  if (fitEnd >= validationStart) {
    throw new Error('fit and validation periods must be chronological and non-overlapping.');
  }
  return Object.freeze({ dataset, periods });
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardize(values) {
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  const scale = Math.sqrt(variance) || 1;
  return values.map((value) => (value - average) / scale);
}

function initializationScores(games) {
  const totalPa = games.map((game) => game.awayPa + game.homePa);
  const totalHitRate = games.map(
    (game) => (game.awayHits + game.homeHits) / (game.awayPa + game.homePa),
  );
  const standardizedPa = standardize(totalPa);
  const standardizedRate = standardize(totalHitRate);
  return Object.freeze([
    Object.freeze({ id: 'total-pa', values: totalPa }),
    Object.freeze({ id: 'hit-rate', values: totalHitRate }),
    Object.freeze({
      id: 'combined-positive',
      values: standardizedPa.map((value, index) => value + standardizedRate[index]),
    }),
    Object.freeze({
      id: 'combined-opposed',
      values: standardizedPa.map((value, index) => value - standardizedRate[index]),
    }),
  ]);
}

function hardResponsibilities(games, scenarioCount, scoreValues) {
  if (scenarioCount === 1) return games.map(() => [1]);
  const order = games
    .map((game, index) => ({ index, gameId: game.gameId, score: scoreValues[index] }))
    .sort(
      (left, right) =>
        left.score - right.score || left.gameId - right.gameId || left.index - right.index,
    );
  const clusterByIndex = new Array(games.length);
  for (let rank = 0; rank < order.length; rank += 1) {
    clusterByIndex[order[rank].index] = Math.min(
      scenarioCount - 1,
      Math.floor((rank * scenarioCount) / order.length),
    );
  }
  return games.map((unused, index) =>
    Array.from({ length: scenarioCount }, (unusedScenario, scenarioIndex) =>
      scenarioIndex === clusterByIndex[index] ? 1 : 0,
    ),
  );
}

function parametersFromResponsibilities(games, responsibilities, scenarioCount) {
  const scenarios = [];
  for (let scenarioIndex = 0; scenarioIndex < scenarioCount; scenarioIndex += 1) {
    let weightTotal = 0;
    let awayPaTotal = 0;
    let homePaTotal = 0;
    let awayHitTotal = 0;
    let homeHitTotal = 0;
    for (let gameIndex = 0; gameIndex < games.length; gameIndex += 1) {
      const weight = responsibilities[gameIndex][scenarioIndex];
      const game = games[gameIndex];
      weightTotal += weight;
      awayPaTotal += weight * game.awayPa;
      homePaTotal += weight * game.homePa;
      awayHitTotal += weight * game.awayHits;
      homeHitTotal += weight * game.homeHits;
    }
    if (!(weightTotal > 0)) {
      throw new Error(`scenario ${scenarioIndex} has no responsibility mass.`);
    }
    const awayMeanPa = awayPaTotal / weightTotal;
    const homeMeanPa = homePaTotal / weightTotal;
    let awayVariance = 0;
    let homeVariance = 0;
    for (let gameIndex = 0; gameIndex < games.length; gameIndex += 1) {
      const weight = responsibilities[gameIndex][scenarioIndex];
      const game = games[gameIndex];
      awayVariance += weight * (game.awayPa - awayMeanPa) ** 2;
      homeVariance += weight * (game.homePa - homeMeanPa) ** 2;
    }
    scenarios.push({
      weight: (weightTotal + 1) / (games.length + scenarioCount),
      away: {
        meanPa: awayMeanPa,
        sigmaPa: Math.max(MIN_SIGMA, Math.sqrt(awayVariance / weightTotal)),
        hitProbability: (awayHitTotal + 0.5) / (awayPaTotal + 1),
      },
      home: {
        meanPa: homeMeanPa,
        sigmaPa: Math.max(MIN_SIGMA, Math.sqrt(homeVariance / weightTotal)),
        hitProbability: (homeHitTotal + 0.5) / (homePaTotal + 1),
      },
    });
  }
  const weightSum = scenarios.reduce((sum, scenario) => sum + scenario.weight, 0);
  for (const scenario of scenarios) scenario.weight /= weightSum;
  return scenarios;
}

function scenarioLogComponents(game, scenario, logFactorials) {
  const paLogProbability =
    logDiscreteNormalPmf(game.awayPa, scenario.away.meanPa, scenario.away.sigmaPa) +
    logDiscreteNormalPmf(game.homePa, scenario.home.meanPa, scenario.home.sigmaPa);
  const hitLogProbability =
    logBinomialPmf(
      game.awayHits,
      game.awayPa,
      scenario.away.hitProbability,
      logFactorials,
    ) +
    logBinomialPmf(
      game.homeHits,
      game.homePa,
      scenario.home.hitProbability,
      logFactorials,
    );
  return Object.freeze({ paLogProbability, hitLogProbability });
}

function expectationStep(games, scenarios, logFactorials) {
  const responsibilities = [];
  let logLikelihood = 0;
  for (const game of games) {
    const logWeights = scenarios.map((scenario) => {
      const components = scenarioLogComponents(game, scenario, logFactorials);
      return Math.log(scenario.weight) + components.paLogProbability + components.hitLogProbability;
    });
    const normalization = logSumExp(logWeights);
    logLikelihood += normalization;
    responsibilities.push(logWeights.map((value) => Math.exp(value - normalization)));
  }
  return Object.freeze({ responsibilities, logLikelihood });
}

function canonicalizeScenarios(scenarios) {
  return scenarios
    .map((scenario) => ({
      weight: scenario.weight,
      away: { ...scenario.away },
      home: { ...scenario.home },
    }))
    .sort((left, right) => {
      const leftPa = left.away.meanPa + left.home.meanPa;
      const rightPa = right.away.meanPa + right.home.meanPa;
      if (leftPa !== rightPa) return leftPa - rightPa;
      const leftRate = left.away.hitProbability + left.home.hitProbability;
      const rightRate = right.away.hitProbability + right.home.hitProbability;
      return leftRate - rightRate;
    });
}

function fitOneInitialization(games, scenarioCount, initialization, logFactorials) {
  let responsibilities = hardResponsibilities(games, scenarioCount, initialization.values);
  let scenarios = parametersFromResponsibilities(games, responsibilities, scenarioCount);
  let previousLogLikelihood = Number.NEGATIVE_INFINITY;
  let converged = false;
  let iterations = 0;
  for (iterations = 1; iterations <= MAX_ITERATIONS; iterations += 1) {
    const expectation = expectationStep(games, scenarios, logFactorials);
    responsibilities = expectation.responsibilities;
    scenarios = parametersFromResponsibilities(games, responsibilities, scenarioCount);
    const improvement = expectation.logLikelihood - previousLogLikelihood;
    if (
      Number.isFinite(previousLogLikelihood) &&
      Math.abs(improvement) <=
        CONVERGENCE_TOLERANCE * (1 + Math.abs(previousLogLikelihood))
    ) {
      converged = true;
      previousLogLikelihood = expectation.logLikelihood;
      break;
    }
    previousLogLikelihood = expectation.logLikelihood;
  }
  const finalScenarios = canonicalizeScenarios(scenarios);
  const finalExpectation = expectationStep(games, finalScenarios, logFactorials);
  return Object.freeze({
    initializationId: initialization.id,
    converged,
    iterations,
    fitLogLikelihood: finalExpectation.logLikelihood,
    scenarios: Object.freeze(
      finalScenarios.map((scenario) =>
        Object.freeze({
          weight: scenario.weight,
          away: Object.freeze({ ...scenario.away }),
          home: Object.freeze({ ...scenario.home }),
        }),
      ),
    ),
  });
}

function fitCandidate(games, scenarioCount, logFactorials) {
  const initializations = initializationScores(games);
  const fits = initializations.map((initialization) =>
    fitOneInitialization(games, scenarioCount, initialization, logFactorials),
  );
  fits.sort(
    (left, right) =>
      right.fitLogLikelihood - left.fitLogLikelihood ||
      left.initializationId.localeCompare(right.initializationId),
  );
  return fits[0];
}

function evaluateGames(games, scenarios, logFactorials) {
  let jointNegativeLogLikelihood = 0;
  let paNegativeLogLikelihood = 0;
  for (const game of games) {
    const paLogs = [];
    const jointLogs = [];
    for (const scenario of scenarios) {
      const components = scenarioLogComponents(game, scenario, logFactorials);
      const logWeight = Math.log(scenario.weight);
      paLogs.push(logWeight + components.paLogProbability);
      jointLogs.push(logWeight + components.paLogProbability + components.hitLogProbability);
    }
    const paLogLikelihood = logSumExp(paLogs);
    const jointLogLikelihood = logSumExp(jointLogs);
    paNegativeLogLikelihood -= paLogLikelihood;
    jointNegativeLogLikelihood -= jointLogLikelihood;
  }
  const gameCount = games.length;
  const jointLogLoss = jointNegativeLogLikelihood / gameCount;
  const paLogLoss = paNegativeLogLikelihood / gameCount;
  return Object.freeze({
    gameCount,
    jointLogLoss,
    paLogLoss,
    hitConditionalLogLoss: jointLogLoss - paLogLoss,
  });
}

function scenarioSummary(scenario, index) {
  return Object.freeze({
    scenarioIndex: index,
    weight: scenario.weight,
    expectedTotalPa: scenario.away.meanPa + scenario.home.meanPa,
    expectedTotalHits:
      scenario.away.meanPa * scenario.away.hitProbability +
      scenario.home.meanPa * scenario.home.hitProbability,
    away: Object.freeze({
      meanPa: scenario.away.meanPa,
      sigmaPa: scenario.away.sigmaPa,
      hitProbability: scenario.away.hitProbability,
      expectedHits: scenario.away.meanPa * scenario.away.hitProbability,
    }),
    home: Object.freeze({
      meanPa: scenario.home.meanPa,
      sigmaPa: scenario.home.sigmaPa,
      hitProbability: scenario.home.hitProbability,
      expectedHits: scenario.home.meanPa * scenario.home.hitProbability,
    }),
  });
}

function observedSummary(games) {
  const totalPa = games.map((game) => game.awayPa + game.homePa);
  const totalHits = games.map((game) => game.awayHits + game.homeHits);
  const totalHitRate = games.map((game, index) => totalHits[index] / totalPa[index]);
  function correlation(left, right) {
    const leftMean = mean(left);
    const rightMean = mean(right);
    let numerator = 0;
    let leftScale = 0;
    let rightScale = 0;
    for (let index = 0; index < left.length; index += 1) {
      const leftDifference = left[index] - leftMean;
      const rightDifference = right[index] - rightMean;
      numerator += leftDifference * rightDifference;
      leftScale += leftDifference ** 2;
      rightScale += rightDifference ** 2;
    }
    return leftScale === 0 || rightScale === 0
      ? 0
      : numerator / Math.sqrt(leftScale * rightScale);
  }
  return Object.freeze({
    gameCount: games.length,
    meanTotalPa: mean(totalPa),
    meanTotalHits: mean(totalHits),
    meanHitRate: mean(totalHitRate),
    correlationTotalPaToHitRate: correlation(totalPa, totalHitRate),
    correlationAwayToHomePa: correlation(
      games.map((game) => game.awayPa),
      games.map((game) => game.homePa),
    ),
    correlationAwayToHomeHitRate: correlation(
      games.map((game) => game.awayHits / game.awayPa),
      games.map((game) => game.homeHits / game.homePa),
    ),
  });
}

function evaluationIdentity(evaluation) {
  return {
    evaluationVersion: evaluation.evaluationVersion,
    purpose: evaluation.purpose,
    status: evaluation.status,
    activeSeason: evaluation.activeSeason,
    sourceDatasetSha256: evaluation.sourceDatasetSha256,
    sourceDatasetFileSha256: evaluation.sourceDatasetFileSha256,
    fitWindow: evaluation.fitWindow,
    validationWindow: evaluation.validationWindow,
    candidateScenarioCounts: evaluation.candidateScenarioCounts,
    observed: evaluation.observed,
    candidates: evaluation.candidates,
    selectedCandidate: evaluation.selectedCandidate,
    independenceBaseline: evaluation.independenceBaseline,
    bestSharedScenarioCandidate: evaluation.bestSharedScenarioCandidate,
    holdoutSupportsSharedScenarios: evaluation.holdoutSupportsSharedScenarios,
    untouchedTestReservation: evaluation.untouchedTestReservation,
    untouchedTestRowsRead: evaluation.untouchedTestRowsRead,
  };
}

export function evaluateM8SharedOffensiveEnvironment({
  dataset: rawDataset,
  sourceDatasetFileSha256,
  candidateScenarioCounts = DEFAULT_SCENARIO_COUNTS,
}) {
  const sourceFileSha = sourceDatasetFileSha256;
  if (typeof sourceFileSha !== 'string' || !/^[a-f0-9]{64}$/.test(sourceFileSha)) {
    throw new TypeError('sourceDatasetFileSha256 must be a lowercase SHA-256 digest.');
  }
  const { dataset, periods } = validateAndPairDataset(rawDataset);
  const scenarioCounts = [...new Set(assertArray(candidateScenarioCounts, 'candidateScenarioCounts'))]
    .map((value) => assertPositiveInteger(value, 'scenario count'))
    .sort((left, right) => left - right);
  if (!scenarioCounts.includes(1)) {
    throw new Error('candidateScenarioCounts must include the K=1 independence baseline.');
  }
  const maximumPa = Math.max(
    ...periods.fit.flatMap((game) => [game.awayPa, game.homePa]),
    ...periods.validation.flatMap((game) => [game.awayPa, game.homePa]),
  );
  const logFactorials = buildLogFactorials(maximumPa);
  const candidates = scenarioCounts.map((scenarioCount) => {
    const fitted = fitCandidate(periods.fit, scenarioCount, logFactorials);
    const fitMetrics = evaluateGames(periods.fit, fitted.scenarios, logFactorials);
    const validationMetrics = evaluateGames(periods.validation, fitted.scenarios, logFactorials);
    const scenarioWeightsSum = fitted.scenarios.reduce(
      (sum, scenario) => sum + scenario.weight,
      0,
    );
    if (Math.abs(scenarioWeightsSum - 1) > 1e-12) {
      throw new Error(`scenario weights for K=${scenarioCount} do not sum to one.`);
    }
    return Object.freeze({
      candidateId: `shared-environment-k${scenarioCount}`,
      scenarioCount,
      selectedInitialization: fitted.initializationId,
      converged: fitted.converged,
      iterations: fitted.iterations,
      fit: fitMetrics,
      validation: validationMetrics,
      scenarios: Object.freeze(fitted.scenarios.map(scenarioSummary)),
    });
  });
  const rankedCandidates = candidates
    .slice()
    .sort(
      (left, right) =>
        left.validation.jointLogLoss - right.validation.jointLogLoss ||
        left.scenarioCount - right.scenarioCount ||
        left.candidateId.localeCompare(right.candidateId),
    );
  const selectedCandidate = rankedCandidates[0];
  const independenceBaseline = candidates.find((candidate) => candidate.scenarioCount === 1);
  const bestSharedScenarioCandidate = rankedCandidates.find(
    (candidate) => candidate.scenarioCount > 1,
  );
  const holdoutSupportsSharedScenarios =
    selectedCandidate.scenarioCount > 1 &&
    selectedCandidate.validation.jointLogLoss < independenceBaseline.validation.jointLogLoss;
  const evaluation = {
    evaluationVersion: 1,
    purpose:
      'Chronologically evaluate whether one latent game-level offensive-environment scenario should jointly move away/home team plate-appearance distributions and hit probabilities, using K=1 as the no-shared-scenario benchmark.',
    status: 'benchmark-only-not-production-validated',
    activeSeason: dataset.activeSeason,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: sourceFileSha,
    fitWindow: Object.freeze({
      startDate: periods.fit[0].observedDate,
      endDate: periods.fit.at(-1).observedDate,
      gameCount: periods.fit.length,
    }),
    validationWindow: Object.freeze({
      startDate: periods.validation[0].observedDate,
      endDate: periods.validation.at(-1).observedDate,
      gameCount: periods.validation.length,
    }),
    candidateScenarioCounts: Object.freeze(scenarioCounts),
    observed: Object.freeze({
      fit: observedSummary(periods.fit),
      validation: observedSummary(periods.validation),
    }),
    candidates: Object.freeze(rankedCandidates),
    selectedCandidate,
    independenceBaseline,
    bestSharedScenarioCandidate,
    holdoutSupportsSharedScenarios,
    untouchedTestReservation: dataset.untouchedTestReservation,
    untouchedTestRowsRead: false,
  };
  return Object.freeze({
    ...evaluation,
    evaluationSha256: sha256(JSON.stringify(evaluationIdentity(evaluation))),
  });
}

export function verifyM8SharedOffensiveEnvironmentEvaluation(rawEvaluation) {
  const evaluation = assertObject(rawEvaluation, 'shared offensive-environment evaluation');
  if (evaluation.evaluationVersion !== 1) {
    throw new Error('unsupported shared offensive-environment evaluation version.');
  }
  if (
    evaluation.untouchedTestReservation?.rowsIncluded !== false ||
    evaluation.untouchedTestRowsRead !== false ||
    Object.hasOwn(evaluation.untouchedTestReservation ?? {}, 'rows')
  ) {
    throw new Error('shared offensive-environment evaluation must keep untouched-test rows sealed.');
  }
  const candidates = assertArray(evaluation.candidates, 'candidates');
  if (candidates.length === 0 || !candidates.some((candidate) => candidate.scenarioCount === 1)) {
    throw new Error('evaluation must contain a K=1 baseline.');
  }
  for (const candidate of candidates) {
    assertPositiveInteger(candidate.scenarioCount, `${candidate.candidateId}.scenarioCount`);
    assertFiniteNumber(
      candidate.validation.jointLogLoss,
      `${candidate.candidateId} validation log loss`,
    );
    const scenarios = assertArray(candidate.scenarios, `${candidate.candidateId}.scenarios`);
    if (scenarios.length !== candidate.scenarioCount) {
      throw new Error(`${candidate.candidateId} scenario count drifted.`);
    }
    const weightSum = scenarios.reduce(
      (sum, scenario) => sum + assertProbability(scenario.weight, 'scenario weight'),
      0,
    );
    if (Math.abs(weightSum - 1) > 1e-12) {
      throw new Error(`${candidate.candidateId} scenario weights do not sum to one.`);
    }
  }
  const expectedSha = sha256(JSON.stringify(evaluationIdentity(evaluation)));
  if (evaluation.evaluationSha256 !== expectedSha) {
    throw new Error('shared offensive-environment evaluation SHA-256 is invalid.');
  }
  return evaluation;
}
