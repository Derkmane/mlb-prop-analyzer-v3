import { createHash } from 'node:crypto';

import {
  M8_5_GAME_OFFENSIVE_ENVIRONMENT_FEATURE_NAMES,
  verifyM8_5GameOffensiveEnvironmentFeatureDataset,
} from './m8-5-game-offensive-environment-feature-dataset-utils.mjs';
import { verifyM8SharedOffensiveEnvironmentV2 } from './m8-shared-offensive-environment-v2-utils.mjs';

const PROBABILITY_FLOOR = 1e-300;
const SQRT_TWO = Math.sqrt(2);
const IMPROVEMENT_TOLERANCE = 1e-9;
const DEFAULT_REGULARIZATION = Object.freeze([0.01, 0.1, 1, 10]);
const DEFAULT_FEATURE_SETS = Object.freeze([
  Object.freeze({
    featureSetId: 'offense-only',
    featureNames: Object.freeze([
      'awayOffensePaPerGame',
      'awayOffenseHitRate',
      'homeOffensePaPerGame',
      'homeOffenseHitRate',
    ]),
  }),
  Object.freeze({
    featureSetId: 'opponent-only',
    featureNames: Object.freeze([
      'awayOpponentPaAllowedPerGame',
      'awayOpponentHitRateAllowed',
      'homeOpponentPaAllowedPerGame',
      'homeOpponentHitRateAllowed',
    ]),
  }),
  Object.freeze({
    featureSetId: 'all',
    featureNames: M8_5_GAME_OFFENSIVE_ENVIRONMENT_FEATURE_NAMES,
  }),
]);

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
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function finiteNumber(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
  return value;
}

function sha256String(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 value.`);
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

function softmax(logits) {
  const maximum = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  if (!(total > 0) || !Number.isFinite(total)) {
    throw new Error('softmax normalization is invalid.');
  }
  return exponentials.map((value) => value / total);
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
  const p = Math.min(1 - 1e-12, Math.max(1e-12, probability));
  return (
    logFactorials[trials] -
    logFactorials[successes] -
    logFactorials[trials - successes] +
    successes * Math.log(p) +
    (trials - successes) * Math.log1p(-p)
  );
}

function scenarioDefinitions(rawSharedArtifact) {
  const artifact = verifyM8SharedOffensiveEnvironmentV2(rawSharedArtifact);
  const scenarios = array(artifact.scenarios, 'shared environment scenarios').map(
    (rawScenario, index) => {
      const scenario = object(rawScenario, `shared scenario ${index}`);
      const away = object(scenario.away, `shared scenario ${index} away`);
      const home = object(scenario.home, `shared scenario ${index} home`);
      return Object.freeze({
        scenarioId: `shared-environment:${positiveInteger(
          scenario.scenarioIndex + 1,
          `shared scenario ${index} index`,
        ) - 1}`,
        weight: finiteNumber(scenario.weight, `shared scenario ${index} weight`),
        away: Object.freeze({
          meanPa: finiteNumber(away.meanPa, `shared scenario ${index} away meanPa`),
          sigmaPa: finiteNumber(away.sigmaPa, `shared scenario ${index} away sigmaPa`),
          hitProbability: finiteNumber(
            away.hitProbability,
            `shared scenario ${index} away hitProbability`,
          ),
        }),
        home: Object.freeze({
          meanPa: finiteNumber(home.meanPa, `shared scenario ${index} home meanPa`),
          sigmaPa: finiteNumber(home.sigmaPa, `shared scenario ${index} home sigmaPa`),
          hitProbability: finiteNumber(
            home.hitProbability,
            `shared scenario ${index} home hitProbability`,
          ),
        }),
      });
    },
  );
  const total = scenarios.reduce((sum, scenario) => sum + scenario.weight, 0);
  if (Math.abs(total - 1) > 1e-12 || scenarios.some((scenario) => !(scenario.weight > 0))) {
    throw new Error('shared scenario weights are invalid.');
  }
  return Object.freeze({ artifact, scenarios: Object.freeze(scenarios) });
}

function datasetRows(rawFeatureDataset) {
  const dataset = verifyM8_5GameOffensiveEnvironmentFeatureDataset(rawFeatureDataset);
  if (
    dataset.untouchedTestReservation?.rowsIncluded !== false ||
    Object.hasOwn(dataset.untouchedTestReservation ?? {}, 'rows')
  ) {
    throw new Error('game environment feature dataset exposes untouched-test rows.');
  }
  const periods = {};
  for (const periodId of ['fit', 'validation']) {
    periods[periodId] = Object.freeze(
      array(dataset.periods?.[periodId]?.rows, `${periodId} rows`).map((row) =>
        Object.freeze({
          rowId: row.rowId,
          gameId: positiveInteger(row.gameId, `${row.rowId}.gameId`),
          observedDate: row.observedDate,
          periodId,
          features: row.features,
          target: row.target,
        }),
      ),
    );
    if (periods[periodId].length === 0) {
      throw new Error(`${periodId} must contain game environment feature rows.`);
    }
  }
  if (periods.fit.at(-1).observedDate >= periods.validation[0].observedDate) {
    throw new Error('fit and validation game environment periods overlap.');
  }
  return Object.freeze({ dataset, periods });
}

function componentLogRows(rows, scenarios, logFactorials) {
  return rows.map((row) => {
    const awayPa = positiveInteger(
      row.target.awayPlateAppearances,
      `${row.rowId}.awayPlateAppearances`,
    );
    const homePa = positiveInteger(
      row.target.homePlateAppearances,
      `${row.rowId}.homePlateAppearances`,
    );
    const awayHits = row.target.awayHits;
    const homeHits = row.target.homeHits;
    return Object.freeze({
      row,
      componentLogs: Object.freeze(
        scenarios.map((scenario) => {
          const pa =
            logDiscreteNormalPmf(awayPa, scenario.away.meanPa, scenario.away.sigmaPa) +
            logDiscreteNormalPmf(homePa, scenario.home.meanPa, scenario.home.sigmaPa);
          const hit =
            logBinomialPmf(
              awayHits,
              awayPa,
              scenario.away.hitProbability,
              logFactorials,
            ) +
            logBinomialPmf(
              homeHits,
              homePa,
              scenario.home.hitProbability,
              logFactorials,
            );
          return Object.freeze({ pa, joint: pa + hit });
        }),
      ),
    });
  });
}

function normalization(rows, featureNames) {
  return Object.freeze(
    featureNames.map((featureName) => {
      const values = rows.map((entry) =>
        finiteNumber(entry.row.features[featureName], `${entry.row.rowId}.${featureName}`),
      );
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const variance =
        values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
      return Object.freeze({ featureName, mean, scale: Math.sqrt(variance) || 1 });
    }),
  );
}

function normalizedFeatures(entry, normalizationRows) {
  return normalizationRows.map(
    (normalizationRow) =>
      (entry.row.features[normalizationRow.featureName] - normalizationRow.mean) /
      normalizationRow.scale,
  );
}

function cloneMatrix(matrix) {
  return matrix.map((row) => [...row]);
}

function logitsFor(parameters, features) {
  return [
    0,
    ...parameters.map(
      (row) => row[0] + features.reduce((sum, value, index) => sum + value * row[index + 1], 0),
    ),
  ];
}

function objectiveAndGradient({ rows, parameters, normalizationRows, regularization }) {
  const gradient = parameters.map((row) => row.map(() => 0));
  let negativeLogLikelihood = 0;
  for (const entry of rows) {
    const features = normalizedFeatures(entry, normalizationRows);
    const logits = logitsFor(parameters, features);
    const weights = softmax(logits);
    const posterior = softmax(
      logits.map((logit, index) => logit + entry.componentLogs[index].joint),
    );
    negativeLogLikelihood -= logSumExp(
      logits.map((logit, index) => logit + entry.componentLogs[index].joint),
    ) - logSumExp(logits);
    for (let scenarioIndex = 1; scenarioIndex < logits.length; scenarioIndex += 1) {
      const difference = weights[scenarioIndex] - posterior[scenarioIndex];
      const parameterRow = gradient[scenarioIndex - 1];
      parameterRow[0] += difference;
      for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
        parameterRow[featureIndex + 1] += difference * features[featureIndex];
      }
    }
  }
  negativeLogLikelihood /= rows.length;
  for (let scenarioIndex = 0; scenarioIndex < parameters.length; scenarioIndex += 1) {
    for (let parameterIndex = 0; parameterIndex < parameters[scenarioIndex].length; parameterIndex += 1) {
      gradient[scenarioIndex][parameterIndex] /= rows.length;
      if (parameterIndex > 0) {
        negativeLogLikelihood +=
          0.5 * regularization * parameters[scenarioIndex][parameterIndex] ** 2;
        gradient[scenarioIndex][parameterIndex] +=
          regularization * parameters[scenarioIndex][parameterIndex];
      }
    }
  }
  return Object.freeze({ negativeLogLikelihood, gradient });
}

function fitGate({ rows, scenarios, featureNames, regularization, maximumIterations = 1200 }) {
  const normalizationRows = normalization(rows, featureNames);
  const referenceWeight = scenarios[0].weight;
  let parameters = scenarios.slice(1).map((scenario) => [
    Math.log(scenario.weight / referenceWeight),
    ...featureNames.map(() => 0),
  ]);
  let bestParameters = cloneMatrix(parameters);
  let bestObjective = objectiveAndGradient({
    rows,
    parameters,
    normalizationRows,
    regularization,
  }).negativeLogLikelihood;
  const firstMoment = parameters.map((row) => row.map(() => 0));
  const secondMoment = parameters.map((row) => row.map(() => 0));
  const learningRate = 0.03;
  const beta1 = 0.9;
  const beta2 = 0.999;
  const epsilon = 1e-8;
  let iterations = 0;
  for (iterations = 1; iterations <= maximumIterations; iterations += 1) {
    const result = objectiveAndGradient({
      rows,
      parameters,
      normalizationRows,
      regularization,
    });
    if (result.negativeLogLikelihood < bestObjective) {
      bestObjective = result.negativeLogLikelihood;
      bestParameters = cloneMatrix(parameters);
    }
    for (let rowIndex = 0; rowIndex < parameters.length; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < parameters[rowIndex].length; columnIndex += 1) {
        const gradient = result.gradient[rowIndex][columnIndex];
        firstMoment[rowIndex][columnIndex] =
          beta1 * firstMoment[rowIndex][columnIndex] + (1 - beta1) * gradient;
        secondMoment[rowIndex][columnIndex] =
          beta2 * secondMoment[rowIndex][columnIndex] + (1 - beta2) * gradient ** 2;
        const correctedFirst = firstMoment[rowIndex][columnIndex] / (1 - beta1 ** iterations);
        const correctedSecond = secondMoment[rowIndex][columnIndex] / (1 - beta2 ** iterations);
        parameters[rowIndex][columnIndex] -=
          (learningRate * correctedFirst) / (Math.sqrt(correctedSecond) + epsilon);
      }
    }
  }
  const scenarioLogits = Object.freeze([
    Object.freeze({
      scenarioId: scenarios[0].scenarioId,
      intercept: 0,
      coefficients: Object.freeze(
        featureNames.map((featureName) => Object.freeze({ featureName, coefficient: 0 })),
      ),
    }),
    ...scenarios.slice(1).map((scenario, index) =>
      Object.freeze({
        scenarioId: scenario.scenarioId,
        intercept: bestParameters[index][0],
        coefficients: Object.freeze(
          featureNames.map((featureName, featureIndex) =>
            Object.freeze({
              featureName,
              coefficient: bestParameters[index][featureIndex + 1],
            }),
          ),
        ),
      }),
    ),
  ]);
  return Object.freeze({
    regularization,
    featureNames: Object.freeze([...featureNames]),
    normalization: normalizationRows,
    scenarioLogits,
    trainingObjective: bestObjective,
    iterations,
  });
}

function modelWeights(entry, model) {
  const features = normalizedFeatures(entry, model.normalization);
  return softmax(
    model.scenarioLogits.map(
      (scenario) =>
        scenario.intercept +
        scenario.coefficients.reduce(
          (sum, coefficient, index) => sum + coefficient.coefficient * features[index],
          0,
        ),
    ),
  );
}

function metrics(rows, weightForRow) {
  let jointNegativeLogLikelihood = 0;
  let paNegativeLogLikelihood = 0;
  for (const entry of rows) {
    const weights = weightForRow(entry);
    jointNegativeLogLikelihood -= logSumExp(
      weights.map(
        (weight, scenarioIndex) =>
          Math.log(Math.max(weight, PROBABILITY_FLOOR)) +
          entry.componentLogs[scenarioIndex].joint,
      ),
    );
    paNegativeLogLikelihood -= logSumExp(
      weights.map(
        (weight, scenarioIndex) =>
          Math.log(Math.max(weight, PROBABILITY_FLOOR)) + entry.componentLogs[scenarioIndex].pa,
      ),
    );
  }
  const gameCount = rows.length;
  const jointLogLoss = jointNegativeLogLikelihood / gameCount;
  const paLogLoss = paNegativeLogLikelihood / gameCount;
  return Object.freeze({
    gameCount,
    jointLogLoss,
    paLogLoss,
    hitConditionalLogLoss: jointLogLoss - paLogLoss,
  });
}

function aggregateMetrics(parts) {
  const gameCount = parts.reduce((sum, part) => sum + part.gameCount, 0);
  const weighted = (key) =>
    parts.reduce((sum, part) => sum + part[key] * part.gameCount, 0) / gameCount;
  const jointLogLoss = weighted('jointLogLoss');
  const paLogLoss = weighted('paLogLoss');
  return Object.freeze({
    gameCount,
    jointLogLoss,
    paLogLoss,
    hitConditionalLogLoss: jointLogLoss - paLogLoss,
  });
}

function candidateGrid(featureSets, regularizationValues) {
  const validFeatureNames = new Set(M8_5_GAME_OFFENSIVE_ENVIRONMENT_FEATURE_NAMES);
  const featureSetIds = new Set();
  const candidates = [];
  for (const rawFeatureSet of featureSets) {
    const featureSet = object(rawFeatureSet, 'feature set');
    const featureSetId = String(featureSet.featureSetId);
    if (featureSetIds.has(featureSetId)) throw new Error(`duplicate featureSetId ${featureSetId}.`);
    featureSetIds.add(featureSetId);
    const featureNames = array(featureSet.featureNames, `${featureSetId}.featureNames`);
    if (
      featureNames.length === 0 ||
      new Set(featureNames).size !== featureNames.length ||
      featureNames.some((featureName) => !validFeatureNames.has(featureName))
    ) {
      throw new Error(`${featureSetId} contains invalid feature names.`);
    }
    for (const regularization of regularizationValues) {
      if (!(Number.isFinite(regularization) && regularization > 0)) {
        throw new Error('regularization values must be positive finite numbers.');
      }
      candidates.push(
        Object.freeze({
          candidateId: `${featureSetId}-l2-${regularization}`,
          featureSetId,
          featureNames: Object.freeze([...featureNames]),
          regularization,
        }),
      );
    }
  }
  return Object.freeze(candidates);
}

function walkForward({ fitRows, validationRows, scenarios, candidate }) {
  const byDate = new Map();
  for (const row of validationRows) {
    const rows = byDate.get(row.row.observedDate) ?? [];
    rows.push(row);
    byDate.set(row.row.observedDate, rows);
  }
  const dates = [...byDate.keys()].sort();
  const prior = [...fitRows];
  const folds = [];
  for (const date of dates) {
    const foldRows = byDate.get(date);
    const model = fitGate({
      rows: prior,
      scenarios,
      featureNames: candidate.featureNames,
      regularization: candidate.regularization,
    });
    const baseline = metrics(foldRows, () => scenarios.map((scenario) => scenario.weight));
    const selected = metrics(foldRows, (row) => modelWeights(row, model));
    folds.push(
      Object.freeze({
        validationDate: date,
        trainingGameCount: prior.length,
        validationGameCount: foldRows.length,
        baseline,
        selected,
      }),
    );
    prior.push(...foldRows);
  }
  return Object.freeze({
    foldCount: folds.length,
    baseline: aggregateMetrics(folds.map((fold) => fold.baseline)),
    selected: aggregateMetrics(folds.map((fold) => fold.selected)),
    folds: Object.freeze(folds),
  });
}

function evaluationIdentity(value) {
  return {
    evaluationVersion: value.evaluationVersion,
    modelFamily: value.modelFamily,
    activeSeason: value.activeSeason,
    sourceFeatureDatasetSha256: value.sourceFeatureDatasetSha256,
    sourceFeatureDatasetFileSha256: value.sourceFeatureDatasetFileSha256,
    sourceSharedEnvironmentModelVersion: value.sourceSharedEnvironmentModelVersion,
    sourceSharedEnvironmentArtifactSha256: value.sourceSharedEnvironmentArtifactSha256,
    sourceSharedEnvironmentArtifactFileSha256:
      value.sourceSharedEnvironmentArtifactFileSha256,
    scenarioIds: value.scenarioIds,
    featureNames: value.featureNames,
    candidateGrid: value.candidateGrid,
    fitWindow: value.fitWindow,
    validationWindow: value.validationWindow,
    fixedHoldout: value.fixedHoldout,
    walkForward: value.walkForward,
    decision: value.decision,
    finalModel: value.finalModel,
    productionEnabled: value.productionEnabled,
    selectedSideInputUsed: value.selectedSideInputUsed,
    directProbabilityAdjustmentUsed: value.directProbabilityAdjustmentUsed,
    sharedScenarioDefinitionsChanged: value.sharedScenarioDefinitionsChanged,
    excludedOffensiveStatisticsUsed: value.excludedOffensiveStatisticsUsed,
    untouchedTestReservation: value.untouchedTestReservation,
    untouchedTestRowsAccessed: value.untouchedTestRowsAccessed,
  };
}

export function evaluateM8_5GameOffensiveEnvironmentCandidates({
  rawFeatureDataset,
  sourceFeatureDatasetFileSha256,
  rawSharedEnvironmentArtifact,
  sourceSharedEnvironmentArtifactFileSha256,
  featureSets = DEFAULT_FEATURE_SETS,
  regularizationValues = DEFAULT_REGULARIZATION,
}) {
  const sourceFeatureFileSha = sha256String(
    sourceFeatureDatasetFileSha256,
    'sourceFeatureDatasetFileSha256',
  );
  const sourceSharedFileSha = sha256String(
    sourceSharedEnvironmentArtifactFileSha256,
    'sourceSharedEnvironmentArtifactFileSha256',
  );
  const { dataset, periods } = datasetRows(rawFeatureDataset);
  const shared = scenarioDefinitions(rawSharedEnvironmentArtifact);
  const scenarios = shared.scenarios;
  const allRows = [...periods.fit, ...periods.validation];
  const maximumPa = Math.max(
    ...allRows.flatMap((row) => [
      row.target.awayPlateAppearances,
      row.target.homePlateAppearances,
    ]),
  );
  const logFactorials = buildLogFactorials(maximumPa);
  const fitRows = componentLogRows(periods.fit, scenarios, logFactorials);
  const validationRows = componentLogRows(periods.validation, scenarios, logFactorials);
  const baselineWeights = () => scenarios.map((scenario) => scenario.weight);
  const baseline = Object.freeze({
    fit: metrics(fitRows, baselineWeights),
    validation: metrics(validationRows, baselineWeights),
  });
  const grid = candidateGrid(featureSets, regularizationValues);
  const candidates = grid.map((candidate) => {
    const model = fitGate({
      rows: fitRows,
      scenarios,
      featureNames: candidate.featureNames,
      regularization: candidate.regularization,
    });
    return Object.freeze({
      ...candidate,
      trainingObjective: model.trainingObjective,
      fit: metrics(fitRows, (row) => modelWeights(row, model)),
      validation: metrics(validationRows, (row) => modelWeights(row, model)),
      fittedModel: model,
    });
  });
  const ranked = candidates
    .slice()
    .sort(
      (left, right) =>
        left.validation.jointLogLoss - right.validation.jointLogLoss ||
        left.featureNames.length - right.featureNames.length ||
        right.regularization - left.regularization ||
        left.candidateId.localeCompare(right.candidateId),
    );
  const selected = ranked[0];
  const walkForwardEvidence = walkForward({
    fitRows,
    validationRows,
    scenarios,
    candidate: selected,
  });
  const fixedImprovement =
    baseline.validation.jointLogLoss - selected.validation.jointLogLoss;
  const walkForwardImprovement =
    walkForwardEvidence.baseline.jointLogLoss -
    walkForwardEvidence.selected.jointLogLoss;
  const validated =
    fixedImprovement > IMPROVEMENT_TOLERANCE &&
    walkForwardImprovement > IMPROVEMENT_TOLERANCE;
  const finalFit = validated
    ? fitGate({
        rows: [...fitRows, ...validationRows],
        scenarios,
        featureNames: selected.featureNames,
        regularization: selected.regularization,
      })
    : null;
  const finalModel =
    finalFit === null
      ? null
      : Object.freeze({
          candidateId: selected.candidateId,
          featureSetId: selected.featureSetId,
          regularization: selected.regularization,
          featureNames: finalFit.featureNames,
          featureNormalization: finalFit.normalization,
          scenarioLogits: finalFit.scenarioLogits,
          trainingGameCount: fitRows.length + validationRows.length,
        });
  const evaluation = {
    evaluationVersion: 1,
    modelFamily: 'm8-5-game-specific-offensive-environment-softmax-gate-v1',
    activeSeason: dataset.activeSeason,
    sourceFeatureDatasetSha256: dataset.datasetSha256,
    sourceFeatureDatasetFileSha256: sourceFeatureFileSha,
    sourceSharedEnvironmentModelVersion: shared.artifact.modelVersion,
    sourceSharedEnvironmentArtifactSha256: shared.artifact.artifactSha256,
    sourceSharedEnvironmentArtifactFileSha256: sourceSharedFileSha,
    scenarioIds: Object.freeze(scenarios.map((scenario) => scenario.scenarioId)),
    featureNames: M8_5_GAME_OFFENSIVE_ENVIRONMENT_FEATURE_NAMES,
    candidateGrid: grid,
    fitWindow: Object.freeze({
      start: periods.fit[0].observedDate,
      end: periods.fit.at(-1).observedDate,
      gameCount: periods.fit.length,
    }),
    validationWindow: Object.freeze({
      start: periods.validation[0].observedDate,
      end: periods.validation.at(-1).observedDate,
      gameCount: periods.validation.length,
    }),
    fixedHoldout: Object.freeze({
      baseline,
      candidates: Object.freeze(ranked),
      selectedCandidateId: selected.candidateId,
      jointLogLossImprovement: fixedImprovement,
    }),
    walkForward: Object.freeze({
      ...walkForwardEvidence,
      candidateId: selected.candidateId,
      jointLogLossImprovement: walkForwardImprovement,
    }),
    decision: validated ? 'VALIDATED_GAME_SIGNAL' : 'NO_VALIDATED_GAME_SIGNAL',
    finalModel,
    productionEnabled: false,
    selectedSideInputUsed: false,
    directProbabilityAdjustmentUsed: false,
    sharedScenarioDefinitionsChanged: false,
    excludedOffensiveStatisticsUsed: false,
    untouchedTestReservation: Object.freeze({ rowsIncluded: false }),
    untouchedTestRowsAccessed: false,
  };
  return Object.freeze({
    ...evaluation,
    evaluationSha256: sha256(JSON.stringify(evaluationIdentity(evaluation))),
  });
}

export function verifyM8_5GameOffensiveEnvironmentEvaluation(rawEvaluation) {
  const evaluation = object(rawEvaluation, 'game offensive-environment evaluation');
  if (
    evaluation.evaluationVersion !== 1 ||
    evaluation.modelFamily !==
      'm8-5-game-specific-offensive-environment-softmax-gate-v1' ||
    evaluation.activeSeason !== 2026 ||
    evaluation.productionEnabled !== false ||
    evaluation.selectedSideInputUsed !== false ||
    evaluation.directProbabilityAdjustmentUsed !== false ||
    evaluation.sharedScenarioDefinitionsChanged !== false ||
    evaluation.excludedOffensiveStatisticsUsed !== false ||
    evaluation.untouchedTestRowsAccessed !== false ||
    evaluation.untouchedTestReservation?.rowsIncluded !== false
  ) {
    throw new Error('unsupported or unsafe game offensive-environment evaluation.');
  }
  sha256String(evaluation.sourceFeatureDatasetSha256, 'sourceFeatureDatasetSha256');
  sha256String(evaluation.sourceFeatureDatasetFileSha256, 'sourceFeatureDatasetFileSha256');
  sha256String(
    evaluation.sourceSharedEnvironmentArtifactSha256,
    'sourceSharedEnvironmentArtifactSha256',
  );
  sha256String(
    evaluation.sourceSharedEnvironmentArtifactFileSha256,
    'sourceSharedEnvironmentArtifactFileSha256',
  );
  if (!['VALIDATED_GAME_SIGNAL', 'NO_VALIDATED_GAME_SIGNAL'].includes(evaluation.decision)) {
    throw new Error('game offensive-environment decision is invalid.');
  }
  if (
    (evaluation.decision === 'VALIDATED_GAME_SIGNAL') !==
    (evaluation.finalModel !== null)
  ) {
    throw new Error('game offensive-environment final model does not match decision.');
  }
  const expected = sha256(JSON.stringify(evaluationIdentity(evaluation)));
  if (sha256String(evaluation.evaluationSha256, 'evaluationSha256') !== expected) {
    throw new Error('game offensive-environment evaluation SHA-256 is invalid.');
  }
  return evaluation;
}

export const M8_5_GAME_OFFENSIVE_ENVIRONMENT_DEFAULT_FEATURE_SETS =
  DEFAULT_FEATURE_SETS;
export const M8_5_GAME_OFFENSIVE_ENVIRONMENT_DEFAULT_REGULARIZATION =
  DEFAULT_REGULARIZATION;
