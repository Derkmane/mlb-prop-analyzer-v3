import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  buildM8SharedOffensiveEnvironmentArtifact,
  verifyM8SharedOffensiveEnvironmentArtifact,
} from '../scripts/m8-shared-offensive-environment-artifact-utils.mjs';

const digest = (character) => character.repeat(64);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function datasetIdentity(dataset) {
  return {
    datasetVersion: dataset.datasetVersion,
    provider: dataset.provider,
    activeSeason: dataset.activeSeason,
    sourceCaptureManifestSha256: dataset.sourceCaptureManifestSha256,
    sourceCapturePlanSha256: dataset.sourceCapturePlanSha256,
    sourceResolvedDatasetSha256: dataset.sourceResolvedDatasetSha256,
    sourceResolvedDatasetFileSha256: dataset.sourceResolvedDatasetFileSha256,
    includedPeriods: dataset.includedPeriods,
    untouchedTestReservation: dataset.untouchedTestReservation,
    exclusionPolicy: dataset.exclusionPolicy,
    totals: dataset.totals,
    exclusionReasonCounts: dataset.exclusionReasonCounts,
    periods: dataset.periods,
    excludedGames: dataset.excludedGames,
  };
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

function walkForwardIdentity(evaluation) {
  return {
    walkForwardVersion: evaluation.walkForwardVersion,
    purpose: evaluation.purpose,
    status: evaluation.status,
    activeSeason: evaluation.activeSeason,
    sourceDatasetSha256: evaluation.sourceDatasetSha256,
    sourceDatasetFileSha256: evaluation.sourceDatasetFileSha256,
    sourceEvaluationSha256: evaluation.sourceEvaluationSha256,
    sourceEvaluationFileSha256: evaluation.sourceEvaluationFileSha256,
    candidateScenarioCounts: evaluation.candidateScenarioCounts,
    fitWindow: evaluation.fitWindow,
    validationWindow: evaluation.validationWindow,
    foldCount: evaluation.foldCount,
    validationGameCount: evaluation.validationGameCount,
    folds: evaluation.folds,
    aggregateCandidates: evaluation.aggregateCandidates,
    selectedCandidate: evaluation.selectedCandidate,
    independenceBaseline: evaluation.independenceBaseline,
    bestSharedScenarioCandidate: evaluation.bestSharedScenarioCandidate,
    walkForwardSupportsSharedScenarios: evaluation.walkForwardSupportsSharedScenarios,
    sourceSelectionAgreement: evaluation.sourceSelectionAgreement,
    allValidationGamesScoredExactlyOnce: evaluation.allValidationGamesScoredExactlyOnce,
    untouchedTestReservation: evaluation.untouchedTestReservation,
    untouchedTestRowsRead: evaluation.untouchedTestRowsRead,
  };
}

function makeRow({ gameId, date, periodId, side, teamPa, opponentPa, hits }) {
  return {
    rowId: `${periodId}:${date}:${gameId}:${side}`,
    observedDate: date,
    periodId,
    gameId,
    side,
    homeAway: side,
    teamId: gameId * 10 + (side === 'away' ? 1 : 2),
    teamName: `${side}-${gameId}`,
    opponentTeamId: gameId * 10 + (side === 'away' ? 2 : 1),
    opponentTeamName: `${side === 'away' ? 'home' : 'away'}-${gameId}`,
    teamPlateAppearances: teamPa,
    opponentPlateAppearances: opponentPa,
    gamePlateAppearances: teamPa + opponentPa,
    teamHits: hits,
    teamRuns: Math.max(0, hits - 2),
    pitcherIds: [gameId * 100 + (side === 'away' ? 1 : 2)],
    pitcherCount: 1,
    resolvedRowCount: teamPa,
    paEvidenceRowCount: teamPa,
    ignoredBaserunningRowCount: 0,
    directBatterPaComparator: {
      available: true,
      playerCount: 9,
      totalPlateAppearances: teamPa,
    },
    sourceCaptureSha256: digest('d'),
    sourceStatsRawBodySha256s: [digest('e')],
  };
}

function gameRows(gameId, date, periodId, awayPa, homePa, awayHits, homeHits) {
  return [
    makeRow({
      gameId,
      date,
      periodId,
      side: 'away',
      teamPa: awayPa,
      opponentPa: homePa,
      hits: awayHits,
    }),
    makeRow({
      gameId,
      date,
      periodId,
      side: 'home',
      teamPa: homePa,
      opponentPa: awayPa,
      hits: homeHits,
    }),
  ];
}

function period(rows) {
  return {
    startDate: rows[0].observedDate,
    endDate: rows.at(-1).observedDate,
    rowCount: rows.length,
    rows,
  };
}

function makeDataset() {
  const fitRows = [
    ...gameRows(1, '2026-06-01', 'fit', 35, 34, 6, 7),
    ...gameRows(2, '2026-06-02', 'fit', 42, 39, 10, 9),
  ];
  const validationRows = [
    ...gameRows(3, '2026-06-22', 'validation', 37, 38, 7, 9),
    ...gameRows(4, '2026-06-23', 'validation', 45, 42, 12, 11),
  ];
  const rows = [...fitRows, ...validationRows];
  const identity = {
    datasetVersion: 2,
    provider: 'BALLDONTLIE MLB API',
    activeSeason: 2026,
    sourceCaptureManifestSha256: digest('a'),
    sourceCapturePlanSha256: digest('b'),
    sourceResolvedDatasetSha256: digest('c'),
    sourceResolvedDatasetFileSha256: digest('d'),
    includedPeriods: ['fit', 'validation'],
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      rowsIncluded: false,
    },
    exclusionPolicy: {
      pairedTeamGameRequirement: 'both-sides-or-neither',
    },
    totals: {
      capturedGameCount: 4,
      candidateTeamGameCount: 8,
      includedGameCount: 4,
      includedTeamGameCount: 8,
      excludedGameCount: 0,
      excludedTeamGameCount: 0,
      totalIncludedPlateAppearances: rows.reduce(
        (sum, row) => sum + row.teamPlateAppearances,
        0,
      ),
      totalIncludedHits: rows.reduce((sum, row) => sum + row.teamHits, 0),
      totalIncludedRuns: rows.reduce((sum, row) => sum + row.teamRuns, 0),
      ignoredBaserunningRowCount: 0,
      optionalDirectPaComparatorSideCount: 8,
    },
    exclusionReasonCounts: {},
    periods: {
      fit: period(fitRows),
      validation: period(validationRows),
    },
    excludedGames: [],
  };
  return {
    purpose: 'synthetic shared-environment artifact fixture',
    ...identity,
    datasetSha256: sha256(JSON.stringify(datasetIdentity(identity))),
  };
}

function scenario(scenarioIndex, weight, awayMeanPa, homeMeanPa, awayP, homeP) {
  const awayExpectedHits = awayMeanPa * awayP;
  const homeExpectedHits = homeMeanPa * homeP;
  return {
    scenarioIndex,
    weight,
    expectedTotalPa: awayMeanPa + homeMeanPa,
    expectedTotalHits: awayExpectedHits + homeExpectedHits,
    away: {
      meanPa: awayMeanPa,
      sigmaPa: 2,
      hitProbability: awayP,
      expectedHits: awayExpectedHits,
    },
    home: {
      meanPa: homeMeanPa,
      sigmaPa: 2,
      hitProbability: homeP,
      expectedHits: homeExpectedHits,
    },
  };
}

function scenarios(count) {
  return Array.from({ length: count }, (_, index) =>
    scenario(
      index,
      1 / count,
      34 + index * 3,
      33 + index * 2,
      0.16 + index * 0.025,
      0.17 + index * 0.02,
    ),
  );
}

function candidate(scenarioCount, jointLogLoss) {
  return {
    candidateId: `shared-environment-k${scenarioCount}`,
    scenarioCount,
    selectedInitialization: 'synthetic',
    converged: true,
    iterations: 10,
    fit: {
      gameCount: 2,
      jointLogLoss: jointLogLoss - 0.1,
      paLogLoss: 5.7,
      hitConditionalLogLoss: jointLogLoss - 5.7 - 0.1,
    },
    validation: {
      gameCount: 2,
      jointLogLoss,
      paLogLoss: 5.8,
      hitConditionalLogLoss: jointLogLoss - 5.8,
    },
    scenarios: scenarios(scenarioCount),
  };
}

function makeSources() {
  const dataset = makeDataset();
  const datasetText = JSON.stringify(dataset);
  const candidates = [
    candidate(4, 10.2),
    candidate(3, 10.3),
    candidate(2, 10.4),
    candidate(1, 10.7),
  ];
  const selectedCandidate = candidates[0];
  const independenceBaseline = candidates[3];
  const evaluation = {
    evaluationVersion: 1,
    purpose: 'synthetic holdout evaluation',
    status: 'benchmark-only-not-production-validated',
    activeSeason: 2026,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: sha256(datasetText),
    fitWindow: { startDate: '2026-06-01', endDate: '2026-06-02', gameCount: 2 },
    validationWindow: {
      startDate: '2026-06-22',
      endDate: '2026-06-23',
      gameCount: 2,
    },
    candidateScenarioCounts: [1, 2, 3, 4],
    observed: {},
    candidates,
    selectedCandidate,
    independenceBaseline,
    bestSharedScenarioCandidate: selectedCandidate,
    holdoutSupportsSharedScenarios: true,
    untouchedTestReservation: dataset.untouchedTestReservation,
    untouchedTestRowsRead: false,
  };
  evaluation.evaluationSha256 = sha256(JSON.stringify(evaluationIdentity(evaluation)));
  const evaluationText = JSON.stringify(evaluation);

  const aggregateCandidates = [
    {
      candidateId: 'shared-environment-k4',
      scenarioCount: 4,
      validation: {
        gameCount: 2,
        jointLogLoss: 10.21,
        paLogLoss: 5.81,
        hitConditionalLogLoss: 4.4,
      },
      foldWins: 2,
      meanFoldRank: 1,
      convergedFoldCount: 2,
      foldCount: 2,
    },
    {
      candidateId: 'shared-environment-k3',
      scenarioCount: 3,
      validation: {
        gameCount: 2,
        jointLogLoss: 10.31,
        paLogLoss: 5.82,
        hitConditionalLogLoss: 4.49,
      },
      foldWins: 0,
      meanFoldRank: 2,
      convergedFoldCount: 2,
      foldCount: 2,
    },
    {
      candidateId: 'shared-environment-k2',
      scenarioCount: 2,
      validation: {
        gameCount: 2,
        jointLogLoss: 10.41,
        paLogLoss: 5.83,
        hitConditionalLogLoss: 4.58,
      },
      foldWins: 0,
      meanFoldRank: 3,
      convergedFoldCount: 2,
      foldCount: 2,
    },
    {
      candidateId: 'shared-environment-k1',
      scenarioCount: 1,
      validation: {
        gameCount: 2,
        jointLogLoss: 10.71,
        paLogLoss: 5.9,
        hitConditionalLogLoss: 4.81,
      },
      foldWins: 0,
      meanFoldRank: 4,
      convergedFoldCount: 2,
      foldCount: 2,
    },
  ];
  const foldCandidates = aggregateCandidates.map((value, index) => ({
    rank: index + 1,
    candidateId: value.candidateId,
    scenarioCount: value.scenarioCount,
    selectedInitialization: 'synthetic',
    converged: true,
    iterations: 10,
    validation: value.validation,
    scenarioWeightSum: 1,
  }));
  const walkForward = {
    walkForwardVersion: 1,
    purpose: 'synthetic walk-forward evaluation',
    status: 'benchmark-only-not-production-validated',
    activeSeason: 2026,
    sourceDatasetSha256: dataset.datasetSha256,
    sourceDatasetFileSha256: sha256(datasetText),
    sourceEvaluationSha256: evaluation.evaluationSha256,
    sourceEvaluationFileSha256: sha256(evaluationText),
    candidateScenarioCounts: [1, 2, 3, 4],
    fitWindow: {
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      initialGameCount: 2,
    },
    validationWindow: { startDate: '2026-06-22', endDate: '2026-06-23' },
    foldCount: 2,
    validationGameCount: 2,
    folds: [
      {
        foldIndex: 1,
        validationDate: '2026-06-22',
        fitStartDate: '2026-06-01',
        fitEndDate: '2026-06-02',
        fitGameCount: 2,
        validationGameCount: 1,
        validationGameIds: [3],
        selectedCandidateId: 'shared-environment-k4',
        selectedScenarioCount: 4,
        holdoutSupportsSharedScenarios: true,
        candidates: foldCandidates,
      },
      {
        foldIndex: 2,
        validationDate: '2026-06-23',
        fitStartDate: '2026-06-01',
        fitEndDate: '2026-06-22',
        fitGameCount: 3,
        validationGameCount: 1,
        validationGameIds: [4],
        selectedCandidateId: 'shared-environment-k4',
        selectedScenarioCount: 4,
        holdoutSupportsSharedScenarios: true,
        candidates: foldCandidates,
      },
    ],
    aggregateCandidates,
    selectedCandidate: aggregateCandidates[0],
    independenceBaseline: aggregateCandidates[3],
    bestSharedScenarioCandidate: aggregateCandidates[0],
    walkForwardSupportsSharedScenarios: true,
    sourceSelectionAgreement: true,
    allValidationGamesScoredExactlyOnce: true,
    untouchedTestReservation: dataset.untouchedTestReservation,
    untouchedTestRowsRead: false,
  };
  walkForward.walkForwardSha256 = sha256(
    JSON.stringify(walkForwardIdentity(walkForward)),
  );
  return {
    dataset,
    datasetFileSha256: sha256(datasetText),
    evaluation,
    evaluationFileSha256: sha256(evaluationText),
    walkForward,
    walkForwardFileSha256: sha256(JSON.stringify(walkForward)),
  };
}

function build(source) {
  return buildM8SharedOffensiveEnvironmentArtifact({
    rawDataset: source.dataset,
    datasetFileSha256: source.datasetFileSha256,
    rawEvaluation: source.evaluation,
    evaluationFileSha256: source.evaluationFileSha256,
    rawWalkForward: source.walkForward,
    walkForwardFileSha256: source.walkForwardFileSha256,
  });
}

function resignWalkForward(source) {
  source.walkForward.walkForwardSha256 = sha256(
    JSON.stringify(walkForwardIdentity(source.walkForward)),
  );
  source.walkForwardFileSha256 = sha256(JSON.stringify(source.walkForward));
}

test('freezes the holdout and walk-forward selected K=4 benchmark deterministically', () => {
  const source = makeSources();
  const first = build(source);
  const second = build(source);
  assert.deepEqual(first, second);
  assert.equal(first.selectedCandidateId, 'shared-environment-k4');
  assert.equal(first.scenarioCount, 4);
  assert.equal(first.scenarios.length, 4);
  assert.equal(first.scenarioCountPolicy.permanentFixedCount, false);
  assert.equal(first.validationEvidence.walkForward.validationGameCount, 2);
  assert.equal(first.productionEnabled, false);
  assert.equal(verifyM8SharedOffensiveEnvironmentArtifact(first), first);
});

test('rejects holdout and walk-forward disagreement on K=4', () => {
  const source = makeSources();
  source.walkForward.selectedCandidate = source.walkForward.aggregateCandidates[1];
  source.walkForward.sourceSelectionAgreement = false;
  resignWalkForward(source);
  assert.throws(() => build(source), /do not agree on shared-environment-k4/);
});

test('rejects K=4 when it no longer beats the K=1 independence baseline', () => {
  const source = makeSources();
  source.walkForward.aggregateCandidates[0].validation.jointLogLoss = 10.9;
  source.walkForward.selectedCandidate = source.walkForward.aggregateCandidates[0];
  resignWalkForward(source);
  assert.throws(() => build(source), /does not beat the K=1 independence baseline/);
});

test('rejects any untouched-test row payload', () => {
  const source = makeSources();
  source.dataset.untouchedTestReservation = {
    ...source.dataset.untouchedTestReservation,
    rows: [],
  };
  assert.throws(() => build(source), /untouched-test rows excluded/);
});
