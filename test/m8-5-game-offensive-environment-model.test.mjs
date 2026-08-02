import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  M8_5_GAME_OFFENSIVE_ENVIRONMENT_FEATURE_NAMES,
} from '../scripts/m8-5-game-offensive-environment-feature-dataset-utils.mjs';
import {
  evaluateM8_5GameOffensiveEnvironmentCandidates,
  verifyM8_5GameOffensiveEnvironmentEvaluation,
} from '../scripts/m8-5-game-offensive-environment-model-utils.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sharedArtifactIdentity(value) {
  return {
    artifactVersion: value.artifactVersion,
    modelVersion: value.modelVersion,
    status: value.status,
    productionEnabled: value.productionEnabled,
    activeSeason: value.activeSeason,
    sourceSharedEnvironmentArtifactSha256: value.sourceSharedEnvironmentArtifactSha256,
    sourceSharedEnvironmentArtifactFileSha256:
      value.sourceSharedEnvironmentArtifactFileSha256,
    sourceStarterBullpenDatasetSha256: value.sourceStarterBullpenDatasetSha256,
    sourceStarterBullpenEvaluationSha256:
      value.sourceStarterBullpenEvaluationSha256,
    sourceStarterBullpenEvaluationFileSha256:
      value.sourceStarterBullpenEvaluationFileSha256,
    fitWindow: value.fitWindow,
    validationWindow: value.validationWindow,
    scenarioCount: value.scenarioCount,
    scenarios: value.scenarios,
    starterBullpenTransition: value.starterBullpenTransition,
    validationEvidence: value.validationEvidence,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

function sharedArtifact({ identical = false } = {}) {
  const scenarios = Array.from({ length: 4 }, (unused, scenarioIndex) => {
    const level = identical ? 0 : scenarioIndex;
    const meanPa = 30 + level * 5;
    const hitProbability = 0.1 + level * 0.08;
    return {
      scenarioIndex,
      weight: 0.25,
      expectedTotalPa: meanPa * 2,
      expectedTotalHits: meanPa * hitProbability * 2,
      away: {
        meanPa,
        sigmaPa: 1.25,
        hitProbability,
        expectedHits: meanPa * hitProbability,
      },
      home: {
        meanPa,
        sigmaPa: 1.25,
        hitProbability,
        expectedHits: meanPa * hitProbability,
      },
    };
  });
  const artifact = {
    purpose: 'synthetic frozen shared scenarios',
    artifactVersion: 2,
    modelVersion: 'm8-shared-offensive-environment-v2',
    status: 'frozen-current-season-candidate-awaiting-downstream-untouched-test',
    productionEnabled: false,
    activeSeason: 2026,
    sourceSharedEnvironmentArtifactSha256: SHA_A,
    sourceSharedEnvironmentArtifactFileSha256: SHA_B,
    sourceStarterBullpenDatasetSha256: SHA_C,
    sourceStarterBullpenEvaluationSha256: SHA_D,
    sourceStarterBullpenEvaluationFileSha256: SHA_A,
    fitWindow: { startDate: '2026-03-26', endDate: '2026-06-21', observationCount: 100 },
    validationWindow: { startDate: '2026-06-22', endDate: '2026-07-05', observationCount: 20 },
    scenarioCount: 4,
    scenarios,
    starterBullpenTransition: {
      selectedCandidate: { candidateId: 'test' },
      supportMaximum: 1,
      bySide: { away: [0, 1], home: [0, 1] },
      scenarioDependence: 'unchanged synthetic test transition',
    },
    validationEvidence: {},
    untouchedTestReservation: { rowsIncluded: false },
  };
  return {
    ...artifact,
    artifactSha256: sha256(JSON.stringify(sharedArtifactIdentity(artifact))),
  };
}

function featureDatasetIdentity(value) {
  return {
    datasetVersion: value.datasetVersion,
    factorKey: value.factorKey,
    provider: value.provider,
    activeSeason: value.activeSeason,
    sourceTeamEnvironmentDatasetSha256: value.sourceTeamEnvironmentDatasetSha256,
    sourceTeamEnvironmentDatasetFileSha256:
      value.sourceTeamEnvironmentDatasetFileSha256,
    featureVersion: value.featureVersion,
    featureNames: value.featureNames,
    historyPolicy: value.historyPolicy,
    untouchedTestReservation: value.untouchedTestReservation,
    excludedOffensiveStatisticsUsed: value.excludedOffensiveStatisticsUsed,
    totals: value.totals,
    periods: value.periods,
    excludedGames: value.excludedGames,
  };
}

function featureValues(level, constant = false) {
  const effective = constant ? 0 : level;
  return {
    awayOffensePaPerGame: 30 + effective * 5,
    awayOffenseHitRate: 0.1 + effective * 0.08,
    homeOffensePaPerGame: 30 + effective * 5,
    homeOffenseHitRate: 0.1 + effective * 0.08,
    awayOpponentPaAllowedPerGame: 30 + effective * 5,
    awayOpponentHitRateAllowed: 0.1 + effective * 0.08,
    homeOpponentPaAllowedPerGame: 30 + effective * 5,
    homeOpponentHitRateAllowed: 0.1 + effective * 0.08,
  };
}

function row({ gameId, observedDate, periodId, level, constantFeatures = false }) {
  const pa = 30 + level * 5;
  const probability = 0.1 + level * 0.08;
  const hits = Math.round(pa * probability);
  return {
    status: 'included',
    rowId: `${periodId}:${observedDate}:${gameId}`,
    gameId,
    observedDate,
    periodId,
    awayTeamId: 100 + gameId,
    homeTeamId: 200 + gameId,
    priorEvidence: {
      awayOffenseGames: 5,
      homeOffenseGames: 5,
      awayOpponentDefenseGames: 5,
      homeOpponentDefenseGames: 5,
    },
    features: featureValues(level, constantFeatures),
    target: {
      awayPlateAppearances: pa,
      homePlateAppearances: pa,
      awayHits: hits,
      homeHits: hits,
    },
  };
}

function featureDataset({ constantFeatures = false } = {}) {
  const fitRows = [];
  let gameId = 1;
  for (let repeat = 0; repeat < 6; repeat += 1) {
    for (let level = 0; level < 4; level += 1) {
      fitRows.push(
        row({
          gameId: gameId++,
          observedDate: `2026-05-${String(1 + repeat * 4 + level).padStart(2, '0')}`,
          periodId: 'fit',
          level,
          constantFeatures,
        }),
      );
    }
  }
  const validationRows = [];
  for (let level = 0; level < 4; level += 1) {
    validationRows.push(
      row({
        gameId: gameId++,
        observedDate: `2026-06-${String(22 + level).padStart(2, '0')}`,
        periodId: 'validation',
        level,
        constantFeatures,
      }),
    );
  }
  const dataset = {
    purpose: 'synthetic game environment feature dataset',
    datasetVersion: 1,
    factorKey: 'gameSpecificOffensiveEnvironment',
    provider: 'BALLDONTLIE MLB API',
    activeSeason: 2026,
    sourceTeamEnvironmentDatasetSha256: SHA_A,
    sourceTeamEnvironmentDatasetFileSha256: SHA_B,
    featureVersion: 'm8-5-game-offensive-environment-features-v1',
    featureNames: M8_5_GAME_OFFENSIVE_ENVIRONMENT_FEATURE_NAMES,
    historyPolicy: {
      currentSeasonOnly: true,
      strictlyEarlierObservedDateOnly: true,
      sameDateOutcomesAvailableToEachOther: false,
      minimumPriorGamesPerRequiredTeamRole: 1,
      priorSeasonFallback: false,
      excludedGameOffensiveValuesAllowed: false,
    },
    untouchedTestReservation: { rowsIncluded: false },
    excludedOffensiveStatisticsUsed: false,
    totals: {
      sourceTeamGameRowCount: (fitRows.length + validationRows.length) * 2,
      sourceGameCount: fitRows.length + validationRows.length,
      includedGameCount: fitRows.length + validationRows.length,
      excludedGameCount: 0,
    },
    periods: {
      fit: {
        startDate: fitRows[0].observedDate,
        endDate: fitRows.at(-1).observedDate,
        sourceGameCount: fitRows.length,
        rowCount: fitRows.length,
        rows: fitRows,
      },
      validation: {
        startDate: validationRows[0].observedDate,
        endDate: validationRows.at(-1).observedDate,
        sourceGameCount: validationRows.length,
        rowCount: validationRows.length,
        rows: validationRows,
      },
    },
    excludedGames: [],
  };
  return {
    ...dataset,
    datasetSha256: sha256(JSON.stringify(featureDatasetIdentity(dataset))),
  };
}

function evaluate({
  dataset = featureDataset(),
  shared = sharedArtifact(),
  featureSets = [
    {
      featureSetId: 'all',
      featureNames: M8_5_GAME_OFFENSIVE_ENVIRONMENT_FEATURE_NAMES,
    },
  ],
  regularizationValues = [0.1],
} = {}) {
  return evaluateM8_5GameOffensiveEnvironmentCandidates({
    rawFeatureDataset: dataset,
    sourceFeatureDatasetFileSha256: SHA_C,
    rawSharedEnvironmentArtifact: shared,
    sourceSharedEnvironmentArtifactFileSha256: SHA_D,
    featureSets,
    regularizationValues,
  });
}

test('validates a genuine pregame signal in fixed holdout and walk-forward evaluation', () => {
  const evaluation = evaluate();

  assert.equal(evaluation.decision, 'VALIDATED_GAME_SIGNAL');
  assert.ok(evaluation.fixedHoldout.jointLogLossImprovement > 0);
  assert.ok(evaluation.walkForward.jointLogLossImprovement > 0);
  assert.equal(evaluation.walkForward.foldCount, 4);
  assert.equal(evaluation.finalModel.candidateId, 'all-l2-0.1');
  assert.deepEqual(
    evaluation.finalModel.scenarioLogits.map((scenario) => scenario.scenarioId),
    evaluation.scenarioIds,
  );
  assert.equal(evaluation.productionEnabled, false);
  assert.equal(evaluation.selectedSideInputUsed, false);
  assert.equal(evaluation.directProbabilityAdjustmentUsed, false);
  assert.equal(evaluation.sharedScenarioDefinitionsChanged, false);
  assert.equal(evaluation.untouchedTestRowsAccessed, false);
  verifyM8_5GameOffensiveEnvironmentEvaluation(evaluation);
});

test('identical shared scenarios produce an explicit no-signal decision', () => {
  const evaluation = evaluate({
    dataset: featureDataset({ constantFeatures: true }),
    shared: sharedArtifact({ identical: true }),
  });

  assert.equal(evaluation.decision, 'NO_VALIDATED_GAME_SIGNAL');
  assert.equal(evaluation.finalModel, null);
  assert.ok(Math.abs(evaluation.fixedHoldout.jointLogLossImprovement) < 1e-9);
  assert.ok(Math.abs(evaluation.walkForward.jointLogLossImprovement) < 1e-9);
});

test('later validation outcomes cannot alter an earlier walk-forward fold', () => {
  const originalDataset = featureDataset();
  const changedDataset = structuredClone(originalDataset);
  const last = changedDataset.periods.validation.rows.at(-1);
  last.target.awayPlateAppearances = 48;
  last.target.homePlateAppearances = 48;
  last.target.awayHits = 18;
  last.target.homeHits = 18;
  changedDataset.datasetSha256 = sha256(
    JSON.stringify(featureDatasetIdentity(changedDataset)),
  );

  const original = evaluate({ dataset: originalDataset });
  const changed = evaluate({ dataset: changedDataset });

  assert.deepEqual(original.walkForward.folds[0], changed.walkForward.folds[0]);
  assert.notDeepEqual(original.walkForward.folds.at(-1), changed.walkForward.folds.at(-1));
});

test('tampered evidence and untouched-test exposure fail closed', () => {
  const evaluation = evaluate();
  assert.throws(
    () =>
      verifyM8_5GameOffensiveEnvironmentEvaluation({
        ...evaluation,
        selectedSideInputUsed: true,
      }),
    /unsupported or unsafe/u,
  );

  const badDataset = featureDataset();
  badDataset.untouchedTestReservation = { rowsIncluded: false, rows: [] };
  assert.throws(
    () => evaluate({ dataset: badDataset }),
    /untouched-test rows excluded/u,
  );
});
