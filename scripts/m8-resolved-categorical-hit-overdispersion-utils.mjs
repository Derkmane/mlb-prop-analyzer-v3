import { readFile } from 'node:fs/promises';

import {
  evaluateResolvedCategoricalRareCategoryReliability,
} from './m8-resolved-categorical-rare-category-reliability-utils.mjs';
import {
  predictFrozenPlatoonCandidateCohort,
  wilsonScoreInterval95,
} from './m8-resolved-categorical-rare-outcome-uncertainty-utils.mjs';
import { sha256 } from './provider-probe-utils.mjs';

const TOLERANCE = 1e-12;
const VALID_HANDS = new Set(['L', 'R']);

export const M8_HIT_OVERDISPERSION_HALF_LINES = Object.freeze([
  0.5,
  1.5,
  2.5,
  3.5,
]);

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
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

function assertFiniteProbability(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new RangeError(`${label} must lie strictly between 0 and 1.`);
  }
  return value;
}

function assertHalfLine(value, label) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    Math.abs(value * 2 - Math.round(value * 2)) > TOLERANCE ||
    Number.isInteger(value)
  ) {
    throw new RangeError(`${label} must be a non-negative half-integer line.`);
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

export function preserveValidatedArtifactText(
  value,
  label,
) {
  assertNonEmptyString(value, label);
  return value;
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

function matchupKey(batterSide, pitcherHand) {
  if (!VALID_HANDS.has(batterSide) || !VALID_HANDS.has(pitcherHand)) {
    throw new Error('Hit overdispersion requires normalized L/R handedness.');
  }
  return `${batterSide}-vs-${pitcherHand}`;
}

function batterGameKey(observation) {
  return `${observation.observedDate}:${observation.providerGameId}:${observation.providerBatterId}`;
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
    providerGameId: assertPositiveInteger(
      row.providerGameId,
      `${label}.providerGameId`,
    ),
    providerPaNumber: assertPositiveInteger(
      row.providerPaNumber,
      `${label}.providerPaNumber`,
    ),
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

function metricDifference(actual, expected, label) {
  const fields = [
    'validationObservationCount',
    'validationCategoricalLogLoss',
    'validationCategoricalBrierScore',
    'validationHitLogLoss',
    'validationHitBrierScore',
  ];
  const differences = {};
  let maximumDifference = 0;
  for (const field of fields) {
    const difference = Math.abs(actual[field] - expected[field]);
    differences[field] = difference;
    maximumDifference = Math.max(maximumDifference, difference);
    if (difference > TOLERANCE) {
      throw new Error(`${label}.${field} drifted by ${difference}.`);
    }
  }
  if (
    actual.validationObservationIdsSha256 !==
    expected.validationObservationIdsSha256
  ) {
    throw new Error(`${label} observation identity drifted.`);
  }
  return Object.freeze({
    differences: Object.freeze(differences),
    maximumDifference,
  });
}

function validateRareCategoryReliabilityArtifact(actual, expected, actualText) {
  const artifact = assertPlainObject(actual, 'rare-category reliability artifact');
  if (
    artifact.rareCategoryReliabilitySha256 !==
      expected.rareCategoryReliabilitySha256 ||
    JSON.stringify(artifact) !== JSON.stringify(expected)
  ) {
    throw new Error(
      'rare-category reliability artifact drifted from deterministic re-evaluation.',
    );
  }
  const parsedText = parseJson(actualText, 'rare-category reliability text');
  if (JSON.stringify(parsedText) !== JSON.stringify(artifact)) {
    throw new Error('rare-category reliability text does not match its artifact.');
  }
  if (
    artifact.untouchedTestReservation?.rowsIncluded !== false ||
    Object.hasOwn(artifact.untouchedTestReservation ?? {}, 'rows')
  ) {
    throw new Error('Hit overdispersion must keep untouched-test rows sealed.');
  }
  return artifact;
}

function rebuildWalkForwardHitPredictions({
  dataset,
  rareCategoryArtifact,
  platoonWalkForward,
  hitCategories,
}) {
  const modeledCategories = validateStringList(
    rareCategoryArtifact.modeledCategories,
    'rare-category modeledCategories',
    2,
  );
  const observations = extractObservations(dataset, modeledCategories);
  const hitSet = new Set(hitCategories);
  const validationDates = [
    ...new Set(
      observations.validationPlatoon.map(
        (observation) => observation.observedDate,
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const trainingOverall = [...observations.fitOverall];
  const trainingPlatoon = [...observations.fitPlatoon];
  const predictions = [];
  const foldEquivalences = [];

  for (const [index, validationDate] of validationDates.entries()) {
    if (
      trainingOverall.some((observation) => observation.observedDate >= validationDate)
    ) {
      throw new Error(
        `Hit overdispersion fold ${validationDate} contains future training rows.`,
      );
    }
    const foldValidation = observations.validationPlatoon.filter(
      (observation) => observation.observedDate === validationDate,
    );
    const predicted = predictFrozenPlatoonCandidateCohort({
      categories: modeledCategories,
      hitCategories,
      trainingOverall: Object.freeze([...trainingOverall]),
      trainingPlatoon: Object.freeze([...trainingPlatoon]),
      validationPlatoon: Object.freeze(foldValidation),
      baseParameters: rareCategoryArtifact.baseParameters,
      candidate: rareCategoryArtifact.frozenCandidate,
    });
    const sourceFold = platoonWalkForward.folds[index];
    if (sourceFold?.validationDate !== validationDate) {
      throw new Error(`Hit overdispersion source fold ${validationDate} is missing.`);
    }
    foldEquivalences.push(
      Object.freeze({
        foldNumber: index + 1,
        validationDate,
        ...metricDifference(
          predicted.metrics,
          sourceFold.selected,
          `Hit overdispersion fold ${validationDate}`,
        ),
      }),
    );
    if (predicted.predictions.length !== foldValidation.length) {
      throw new Error(`Hit overdispersion fold ${validationDate} did not conserve rows.`);
    }
    for (const [predictionIndex, prediction] of predicted.predictions.entries()) {
      const observation = foldValidation[predictionIndex];
      if (prediction.observationId !== observation.observationId) {
        throw new Error(
          `Hit overdispersion fold ${validationDate} prediction order drifted.`,
        );
      }
      predictions.push(
        Object.freeze({
          observationId: prediction.observationId,
          observedDate: prediction.observedDate,
          providerGameId: observation.providerGameId,
          providerPaNumber: observation.providerPaNumber,
          providerBatterId: observation.providerBatterId,
          terminalCategory: prediction.terminalCategory,
          hitProbability: prediction.hitProbability,
          hit: hitSet.has(prediction.terminalCategory) ? 1 : 0,
        }),
      );
    }
    const dateOverall = observations.validationOverall.filter(
      (observation) => observation.observedDate === validationDate,
    );
    trainingOverall.push(...dateOverall);
    trainingPlatoon.push(...foldValidation);
  }

  if (predictions.length !== observations.validationPlatoon.length) {
    throw new Error('Hit overdispersion walk-forward did not conserve validation rows.');
  }
  const observationIdsSha256 = sha256(
    JSON.stringify(predictions.map((prediction) => prediction.observationId)),
  );
  if (
    observationIdsSha256 !==
    rareCategoryArtifact.cohorts.validationObservationIdsSha256
  ) {
    throw new Error(
      'Hit overdispersion observation identities drifted from reliability artifact.',
    );
  }
  return Object.freeze({
    modeledCategories,
    observations,
    validationDates: Object.freeze(validationDates),
    predictions: Object.freeze(predictions),
    observationIdsSha256,
    foldEquivalences: Object.freeze(foldEquivalences),
    maximumFoldEquivalenceDifference: Math.max(
      0,
      ...foldEquivalences.map((fold) => fold.maximumDifference),
    ),
  });
}

function aggregateHitMetrics(predictions) {
  let observed = 0;
  let expected = 0;
  let logLoss = 0;
  let brier = 0;
  let minimum = 1;
  let maximum = 0;
  for (const prediction of predictions) {
    const probability = assertFiniteProbability(
      prediction.hitProbability,
      `${prediction.observationId}.hitProbability`,
    );
    observed += prediction.hit;
    expected += probability;
    logLoss +=
      prediction.hit === 1 ? -Math.log(probability) : -Math.log(1 - probability);
    brier += (probability - prediction.hit) ** 2;
    minimum = Math.min(minimum, probability);
    maximum = Math.max(maximum, probability);
  }
  const count = predictions.length;
  return Object.freeze({
    validationObservationCount: count,
    validationObservedCount: observed,
    validationObservedRate: observed / count,
    validationExpectedCount: expected,
    meanPredictedProbability: expected / count,
    calibrationGapObservedMinusPredicted: observed / count - expected / count,
    binaryLogLoss: logLoss / count,
    binaryBrier: brier / count,
    predictedProbabilityMinimum: minimum,
    predictedProbabilityMaximum: maximum,
  });
}

function assertSourceHitSummaryEquivalence(actual, source) {
  const expected = assertPlainObject(source, 'source Hit summary');
  const fields = [
    'validationObservationCount',
    'validationObservedCount',
    'validationObservedRate',
    'validationExpectedCount',
    'meanPredictedProbability',
    'calibrationGapObservedMinusPredicted',
    'binaryLogLoss',
    'binaryBrier',
    'predictedProbabilityMinimum',
    'predictedProbabilityMaximum',
  ];
  const differences = {};
  let maximumDifference = 0;
  for (const field of fields) {
    const difference = Math.abs(actual[field] - expected[field]);
    differences[field] = difference;
    maximumDifference = Math.max(maximumDifference, difference);
    if (difference > TOLERANCE) {
      throw new Error(`source Hit summary ${field} drifted by ${difference}.`);
    }
  }
  return Object.freeze({
    tolerance: TOLERANCE,
    differences: Object.freeze(differences),
    maximumDifference,
  });
}

export function poissonBinomialDistribution(rawProbabilities) {
  const probabilities = assertArray(rawProbabilities, 'probabilities').map(
    (probability, index) =>
      assertFiniteProbability(probability, `probabilities[${index}]`),
  );
  if (probabilities.length === 0) {
    throw new Error('Poisson-binomial distribution requires at least one probability.');
  }
  const pmf = Array.from({ length: probabilities.length + 1 }, () => 0);
  pmf[0] = 1;
  let processed = 0;
  for (const probability of probabilities) {
    processed += 1;
    for (let hits = processed; hits >= 0; hits -= 1) {
      const stay = (pmf[hits] ?? 0) * (1 - probability);
      const arrive = hits > 0 ? pmf[hits - 1] * probability : 0;
      pmf[hits] = stay + arrive;
    }
  }
  const total = pmf.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > TOLERANCE) {
    throw new Error(`Poisson-binomial probability mass drifted by ${Math.abs(total - 1)}.`);
  }
  return Object.freeze(pmf);
}

function normalizeGame(rawGame, index) {
  const game = assertPlainObject(rawGame, `games[${index}]`);
  const gameKey = assertNonEmptyString(game.gameKey, `games[${index}].gameKey`);
  const probabilities = assertArray(
    game.probabilities,
    `games[${index}].probabilities`,
  ).map((probability, probabilityIndex) =>
    assertFiniteProbability(
      probability,
      `games[${index}].probabilities[${probabilityIndex}]`,
    ),
  );
  if (probabilities.length === 0) {
    throw new Error(`games[${index}] must contain at least one PA probability.`);
  }
  const observedHitCount = assertNonNegativeInteger(
    game.observedHitCount,
    `games[${index}].observedHitCount`,
  );
  if (observedHitCount > probabilities.length) {
    throw new RangeError(`games[${index}].observedHitCount exceeds PA count.`);
  }
  return Object.freeze({
    gameKey,
    probabilities: Object.freeze(probabilities),
    observedHitCount,
  });
}

function summarizeBinaryTail(gameReports, line, side) {
  let observed = 0;
  let expected = 0;
  let logLoss = 0;
  let brier = 0;
  let minimum = 1;
  let maximum = 0;
  for (const game of gameReports) {
    const higherProbability = game.pmf.reduce(
      (sum, probability, hitCount) =>
        sum + (hitCount > line ? probability : 0),
      0,
    );
    const probability = side === 'Higher' ? higherProbability : 1 - higherProbability;
    const outcome =
      side === 'Higher'
        ? Number(game.observedHitCount > line)
        : Number(game.observedHitCount < line);
    observed += outcome;
    expected += probability;
    logLoss += outcome === 1 ? -Math.log(probability) : -Math.log(1 - probability);
    brier += (probability - outcome) ** 2;
    minimum = Math.min(minimum, probability);
    maximum = Math.max(maximum, probability);
  }
  const count = gameReports.length;
  const observedRate = observed / count;
  const meanPredictedProbability = expected / count;
  const interval = wilsonScoreInterval95(observed, count);
  return Object.freeze({
    side,
    line,
    gameCount: count,
    observedWinCount: observed,
    observedWinRate: observedRate,
    observedWinRateWilson95: interval,
    expectedWinCount: expected,
    meanPredictedWinProbability: meanPredictedProbability,
    calibrationGapObservedMinusPredicted:
      observedRate - meanPredictedProbability,
    meanPredictionInsideWilson95:
      meanPredictedProbability >= interval.lower &&
      meanPredictedProbability <= interval.upper,
    binaryLogLoss: logLoss / count,
    binaryBrier: brier / count,
    predictedProbabilityMinimum: minimum,
    predictedProbabilityMaximum: maximum,
  });
}

export function summarizeConditionalHitCountOverdispersion({
  games: rawGames,
  lines: rawLines = M8_HIT_OVERDISPERSION_HALF_LINES,
}) {
  const games = assertArray(rawGames, 'games')
    .map(normalizeGame)
    .sort((left, right) => left.gameKey.localeCompare(right.gameKey));
  if (games.length === 0) {
    throw new Error('Hit overdispersion requires at least one batter-game.');
  }
  const seen = new Set();
  for (const game of games) {
    if (seen.has(game.gameKey)) {
      throw new Error(`duplicate batter-game key ${game.gameKey}.`);
    }
    seen.add(game.gameKey);
  }
  const lines = assertArray(rawLines, 'lines').map((line, index) =>
    assertHalfLine(line, `lines[${index}]`),
  );
  if (lines.length === 0 || new Set(lines).size !== lines.length) {
    throw new Error('lines must contain unique half-integer values.');
  }

  const gameReports = games.map((game) => {
    const pmf = poissonBinomialDistribution(game.probabilities);
    const expectedHitCount = game.probabilities.reduce(
      (sum, probability) => sum + probability,
      0,
    );
    const conditionalVariance = game.probabilities.reduce(
      (sum, probability) => sum + probability * (1 - probability),
      0,
    );
    const expectedSecondFactorialMoment =
      expectedHitCount ** 2 -
      game.probabilities.reduce(
        (sum, probability) => sum + probability ** 2,
        0,
      );
    return Object.freeze({
      gameKey: game.gameKey,
      paCount: game.probabilities.length,
      observedHitCount: game.observedHitCount,
      expectedHitCount,
      conditionalVariance,
      observedSecondFactorialMoment:
        game.observedHitCount * (game.observedHitCount - 1),
      expectedSecondFactorialMoment,
      pmf,
    });
  });

  const gameCount = gameReports.length;
  const observedHitCount = gameReports.reduce(
    (sum, game) => sum + game.observedHitCount,
    0,
  );
  const expectedHitCount = gameReports.reduce(
    (sum, game) => sum + game.expectedHitCount,
    0,
  );
  const observedMean = observedHitCount / gameCount;
  const expectedMean = expectedHitCount / gameCount;
  const observedVariance =
    gameReports.reduce(
      (sum, game) => sum + (game.observedHitCount - observedMean) ** 2,
      0,
    ) / gameCount;
  const meanConditionalVariance =
    gameReports.reduce(
      (sum, game) => sum + game.conditionalVariance,
      0,
    ) / gameCount;
  const betweenGameExpectedMeanVariance =
    gameReports.reduce(
      (sum, game) => sum + (game.expectedHitCount - expectedMean) ** 2,
      0,
    ) / gameCount;
  const modelTotalVariance =
    meanConditionalVariance + betweenGameExpectedMeanVariance;
  const pearsonDispersion =
    gameReports.reduce(
      (sum, game) =>
        sum +
        (game.observedHitCount - game.expectedHitCount) ** 2 /
          game.conditionalVariance,
      0,
    ) / gameCount;
  const observedSecondFactorialMoment =
    gameReports.reduce(
      (sum, game) => sum + game.observedSecondFactorialMoment,
      0,
    ) / gameCount;
  const expectedSecondFactorialMoment =
    gameReports.reduce(
      (sum, game) => sum + game.expectedSecondFactorialMoment,
      0,
    ) / gameCount;
  const totalConditionalVariance = gameReports.reduce(
    (sum, game) => sum + game.conditionalVariance,
    0,
  );
  const maximumHitCount = Math.max(...gameReports.map((game) => game.paCount));
  const observedCountHistogram = Array.from(
    { length: maximumHitCount + 1 },
    () => 0,
  );
  const expectedCountHistogram = Array.from(
    { length: maximumHitCount + 1 },
    () => 0,
  );
  for (const game of gameReports) {
    observedCountHistogram[game.observedHitCount] += 1;
    for (const [hitCount, probability] of game.pmf.entries()) {
      expectedCountHistogram[hitCount] += probability;
    }
  }
  const expectedHistogramTotal = expectedCountHistogram.reduce(
    (sum, value) => sum + value,
    0,
  );
  const histogramTolerance = TOLERANCE * Math.max(1, gameCount);
  if (Math.abs(expectedHistogramTotal - gameCount) > histogramTolerance) {
    throw new Error('Hit overdispersion expected count histogram lost probability mass.');
  }
  if (
    observedCountHistogram.reduce((sum, value) => sum + value, 0) !== gameCount
  ) {
    throw new Error('Hit overdispersion observed count histogram lost games.');
  }

  const lineReports = Object.freeze(
    Object.fromEntries(
      lines.map((line) => {
        const higher = summarizeBinaryTail(gameReports, line, 'Higher');
        const lower = summarizeBinaryTail(gameReports, line, 'Lower');
        if (
          higher.observedWinCount + lower.observedWinCount !== gameCount ||
          Math.abs(
            higher.meanPredictedWinProbability +
              lower.meanPredictedWinProbability -
              1,
          ) > TOLERANCE
        ) {
          throw new Error(`Hit overdispersion side symmetry failed at line ${line}.`);
        }
        return [String(line), Object.freeze({ line, higher, lower })];
      }),
    ),
  );

  return Object.freeze({
    benchmarkConditioning:
      'Realized complete handedness-eligible batter-game PA count; this isolates residual per-PA outcome dependence and is not a pregame opportunity model.',
    gameCount,
    plateAppearanceCount: games.reduce(
      (sum, game) => sum + game.probabilities.length,
      0,
    ),
    observedHitCount,
    expectedHitCount,
    observedHitsPerGame: observedMean,
    expectedHitsPerGame: expectedMean,
    aggregateHitCountResidual: observedHitCount - expectedHitCount,
    aggregateHitCountStandardizedResidual:
      totalConditionalVariance > 0
        ? (observedHitCount - expectedHitCount) /
          Math.sqrt(totalConditionalVariance)
        : null,
    observedBetweenGameHitCountVariance: observedVariance,
    modelExpectedBetweenGameHitCountVariance: modelTotalVariance,
    meanConditionalPoissonBinomialVariance: meanConditionalVariance,
    betweenGameExpectedMeanVariance,
    varianceDifferenceObservedMinusExpected:
      observedVariance - modelTotalVariance,
    varianceRatioObservedToExpected:
      modelTotalVariance > 0 ? observedVariance / modelTotalVariance : null,
    pearsonDispersion,
    observedSecondFactorialMoment,
    expectedSecondFactorialMoment,
    secondFactorialMomentGapObservedMinusExpected:
      observedSecondFactorialMoment - expectedSecondFactorialMoment,
    countHistogram: Object.freeze(
      observedCountHistogram.map((observedGameCount, hitCount) =>
        Object.freeze({
          hitCount,
          observedGameCount,
          expectedGameCount: expectedCountHistogram[hitCount],
          observedRate: observedGameCount / gameCount,
          expectedRate: expectedCountHistogram[hitCount] / gameCount,
          gapObservedMinusExpected:
            observedGameCount / gameCount -
            expectedCountHistogram[hitCount] / gameCount,
        }),
      ),
    ),
    lineReports,
    decisionBoundary: Object.freeze({
      hardAcceptanceThresholdApplied: false,
      correctionFit: false,
      correctionApplied: false,
      productionValidated: false,
      interpretation:
        'Descriptive current-season benchmark only. A material variance or tail failure would require identifying omitted dependence and updating the canonical specification before production correction.',
    }),
  });
}

export function selectCompleteBatterGameCohort({
  validationOverall: rawValidationOverall,
  predictions: rawPredictions,
}) {
  const validationOverall = assertArray(
    rawValidationOverall,
    'validationOverall',
  );
  const predictions = assertArray(rawPredictions, 'predictions');
  const overallGroups = new Map();
  const predictionGroups = new Map();

  for (const observation of validationOverall) {
    const key = batterGameKey(observation);
    const current = overallGroups.get(key) ?? [];
    current.push(observation);
    overallGroups.set(key, current);
  }
  for (const prediction of predictions) {
    const key = batterGameKey(prediction);
    const current = predictionGroups.get(key) ?? [];
    current.push(prediction);
    predictionGroups.set(key, current);
  }

  const completeGames = [];
  const exclusions = [];
  let excludedOverallPaCount = 0;
  let excludedPredictedPaCount = 0;
  for (const [key, overallRows] of [...overallGroups.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const predictedRows = predictionGroups.get(key) ?? [];
    const overallIds = [...overallRows]
      .map((row) => row.observationId)
      .sort((left, right) => left.localeCompare(right));
    const predictedIds = [...predictedRows]
      .map((row) => row.observationId)
      .sort((left, right) => left.localeCompare(right));
    const complete =
      overallIds.length === predictedIds.length &&
      overallIds.every((id, index) => id === predictedIds[index]);
    predictionGroups.delete(key);
    if (!complete) {
      excludedOverallPaCount += overallRows.length;
      excludedPredictedPaCount += predictedRows.length;
      exclusions.push(
        Object.freeze({
          gameKey: key,
          overallPaCount: overallRows.length,
          predictedPaCount: predictedRows.length,
          missingPredictionCount: Math.max(
            0,
            overallRows.length - predictedRows.length,
          ),
          reason: 'incomplete-handedness-eligible-pa-coverage',
        }),
      );
      continue;
    }
    const sortedPredictions = [...predictedRows].sort(
      (left, right) =>
        left.providerPaNumber - right.providerPaNumber ||
        left.observationId.localeCompare(right.observationId),
    );
    completeGames.push(
      Object.freeze({
        gameKey: key,
        probabilities: Object.freeze(
          sortedPredictions.map((prediction) => prediction.hitProbability),
        ),
        observedHitCount: sortedPredictions.reduce(
          (sum, prediction) => sum + prediction.hit,
          0,
        ),
      }),
    );
  }
  if (predictionGroups.size > 0) {
    throw new Error('Hit overdispersion predictions contain unknown batter-game groups.');
  }
  return Object.freeze({
    completeGames: Object.freeze(completeGames),
    completeGameCount: completeGames.length,
    excludedGameCount: exclusions.length,
    excludedOverallPaCount,
    excludedPredictedPaCount,
    exclusions: Object.freeze(exclusions),
  });
}

export function evaluateResolvedCategoricalHitOverdispersion({
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
  rareOutcomeUncertainty,
  rareOutcomeUncertaintyText,
  rareCategoryReliability,
  rareCategoryReliabilityText,
  canonicalCategories: rawCanonicalCategories,
  hitCategories: rawHitCategories,
  lines = M8_HIT_OVERDISPERSION_HALF_LINES,
}) {
  const canonicalCategories = validateStringList(
    rawCanonicalCategories,
    'canonicalCategories',
    2,
  );
  const hitCategories = validateStringList(rawHitCategories, 'hitCategories', 1);
  const expectedRareCategory = evaluateResolvedCategoricalRareCategoryReliability({
    dataset,
    datasetText: preserveValidatedArtifactText(datasetText, 'datasetText'),
    fixedEvaluation,
    fixedEvaluationText: preserveValidatedArtifactText(
      fixedEvaluationText,
      'fixedEvaluationText',
    ),
    coherentWalkForward,
    coherentWalkForwardText: preserveValidatedArtifactText(
      coherentWalkForwardText,
      'coherentWalkForwardText',
    ),
    boundaryEvaluation,
    boundaryEvaluationText: preserveValidatedArtifactText(
      boundaryEvaluationText,
      'boundaryEvaluationText',
    ),
    platoonWalkForward,
    platoonWalkForwardText: preserveValidatedArtifactText(
      platoonWalkForwardText,
      'platoonWalkForwardText',
    ),
    rareOutcomeUncertainty,
    rareOutcomeUncertaintyText: preserveValidatedArtifactText(
      rareOutcomeUncertaintyText,
      'rareOutcomeUncertaintyText',
    ),
    canonicalCategories,
    hitCategories,
  });
  const rareCategory = validateRareCategoryReliabilityArtifact(
    rareCategoryReliability,
    expectedRareCategory,
    preserveValidatedArtifactText(
      rareCategoryReliabilityText,
      'rareCategoryReliabilityText',
    ),
  );
  const rebuilt = rebuildWalkForwardHitPredictions({
    dataset,
    rareCategoryArtifact: rareCategory,
    platoonWalkForward,
    hitCategories,
  });
  const perPaHitMetrics = aggregateHitMetrics(rebuilt.predictions);
  const hitSummaryEquivalence = assertSourceHitSummaryEquivalence(
    perPaHitMetrics,
    rareOutcomeUncertainty.summary.hitSummary,
  );
  const cohort = selectCompleteBatterGameCohort({
    validationOverall: rebuilt.observations.validationOverall,
    predictions: rebuilt.predictions,
  });
  const benchmark = summarizeConditionalHitCountOverdispersion({
    games: cohort.completeGames,
    lines,
  });

  const identity = {
    activeSeason: rareCategory.activeSeason,
    sourceDatasetSha256: rareCategory.sourceDatasetSha256,
    sourceDatasetFileSha256: rareCategory.sourceDatasetFileSha256,
    sourceFixedEvaluationSha256: rareCategory.sourceFixedEvaluationSha256,
    sourceCoherentWalkForwardSha256:
      rareCategory.sourceCoherentWalkForwardSha256,
    sourcePlatoonBoundarySha256: rareCategory.sourcePlatoonBoundarySha256,
    sourcePlatoonWalkForwardSha256:
      rareCategory.sourcePlatoonWalkForwardSha256,
    sourceRareOutcomeUncertaintySha256:
      rareCategory.sourceRareOutcomeUncertaintySha256,
    sourceRareCategoryReliabilitySha256:
      rareCategory.rareCategoryReliabilitySha256,
    sourceRareCategoryReliabilityFileSha256: sha256(
      rareCategoryReliabilityText,
    ),
    canonicalCategories,
    modeledCategories: rebuilt.modeledCategories,
    hitCategories,
    frozenCandidate: rareCategory.frozenCandidate,
    baseParameters: rareCategory.baseParameters,
    cohorts: Object.freeze({
      validationOverallObservationCount:
        rebuilt.observations.validationOverall.length,
      validationPlatoonObservationCount:
        rebuilt.observations.validationPlatoon.length,
      validationDateCount: rebuilt.validationDates.length,
      validationObservationIdsSha256: rebuilt.observationIdsSha256,
      completeBatterGameCount: cohort.completeGameCount,
      excludedIncompleteBatterGameCount: cohort.excludedGameCount,
      excludedOverallPaCount: cohort.excludedOverallPaCount,
      excludedPredictedPaCount: cohort.excludedPredictedPaCount,
      exclusions: cohort.exclusions,
    }),
    scorerEquivalence: Object.freeze({
      tolerance: TOLERANCE,
      foldEquivalences: rebuilt.foldEquivalences,
      maximumFoldDifference: rebuilt.maximumFoldEquivalenceDifference,
      hitSummaryEquivalence,
    }),
    benchmark,
    untouchedTestReservation: rareCategory.untouchedTestReservation,
  };
  return Object.freeze({
    hitOverdispersionVersion: 1,
    purpose:
      'Measure residual current-season Batter Hits count overdispersion and conditional tail compression under the frozen per-PA model while conditioning on realized complete batter-game PA count.',
    status:
      'offline-resolved-categorical-hit-overdispersion-benchmark-not-production-model',
    ...identity,
    hitOverdispersionSha256: sha256(JSON.stringify(identity)),
  });
}

export async function evaluateM8ResolvedCategoricalHitOverdispersion({
  datasetPath,
  fixedEvaluationPath,
  coherentWalkForwardPath,
  boundaryEvaluationPath,
  platoonWalkForwardPath,
  rareOutcomeUncertaintyPath,
  rareCategoryReliabilityPath,
  canonicalCategories,
  hitCategories,
  lines = M8_HIT_OVERDISPERSION_HALF_LINES,
}) {
  const [
    datasetText,
    fixedEvaluationText,
    coherentWalkForwardText,
    boundaryEvaluationText,
    platoonWalkForwardText,
    rareOutcomeUncertaintyText,
    rareCategoryReliabilityText,
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
    readFile(
      assertNonEmptyString(
        rareOutcomeUncertaintyPath,
        'rareOutcomeUncertaintyPath',
      ),
      'utf8',
    ),
    readFile(
      assertNonEmptyString(
        rareCategoryReliabilityPath,
        'rareCategoryReliabilityPath',
      ),
      'utf8',
    ),
  ]);
  return evaluateResolvedCategoricalHitOverdispersion({
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
    rareOutcomeUncertainty: parseJson(
      rareOutcomeUncertaintyText,
      'rare-outcome uncertainty evaluation',
    ),
    rareOutcomeUncertaintyText,
    rareCategoryReliability: parseJson(
      rareCategoryReliabilityText,
      'rare-category reliability evaluation',
    ),
    rareCategoryReliabilityText,
    canonicalCategories,
    hitCategories,
    lines,
  });
}
