import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGenericBullpenModel,
  buildM8BatterHitsRuntimeCandidate,
  namedHitterOpportunityPmf,
  predictM8BatterHitsDistribution,
  verifyM8BatterHitsRuntimeCandidate,
} from '../scripts/m8-batter-hits-runtime-candidate-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

const SEALED = Object.freeze({
  startDate: '2026-07-06',
  endDate: '2026-07-25',
  rowsIncluded: false,
});

function retentionArtifact() {
  const conditionalRetentionByGroup = Object.fromEntries(
    Array.from({ length: 9 }, (_, index) => [`slot:${index + 1}`, [1, 1, 0.5, 1]]),
  );
  const artifact = {
    artifactVersion: 1,
    modelVersion: 'm8-starter-retention-v1',
    status: 'frozen-current-season-candidate-awaiting-untouched-test',
    productionEnabled: false,
    activeSeason: 2026,
    sourceDatasetSha256: 'a'.repeat(64),
    sourceDatasetFileSha256: 'b'.repeat(64),
    sourceEvaluationSha256: 'c'.repeat(64),
    sourceEvaluationFileSha256: 'd'.repeat(64),
    fitWindow: { startDate: '2026-03-27', endDate: '2026-06-21' },
    validationWindow: { startDate: '2026-06-22', endDate: '2026-07-05' },
    selectedCandidate: {
      candidateId: 'retention-slot-pool-50',
      kind: 'retention',
      grouping: 'slot',
      leagueEquivalentRisk: 50,
    },
    turnMaximum: 4,
    conditionalRetentionByGroup,
    validationEvidence: { selectionAgreement: true, selectedBeatsNoRetention: true },
    untouchedTestReservation: SEALED,
  };
  const identity = {
    artifactVersion: artifact.artifactVersion,
    modelVersion: artifact.modelVersion,
    status: artifact.status,
    productionEnabled: artifact.productionEnabled,
    activeSeason: artifact.activeSeason,
    sourceDatasetSha256: artifact.sourceDatasetSha256,
    sourceDatasetFileSha256: artifact.sourceDatasetFileSha256,
    sourceEvaluationSha256: artifact.sourceEvaluationSha256,
    sourceEvaluationFileSha256: artifact.sourceEvaluationFileSha256,
    fitWindow: artifact.fitWindow,
    validationWindow: artifact.validationWindow,
    selectedCandidate: artifact.selectedCandidate,
    turnMaximum: artifact.turnMaximum,
    conditionalRetentionByGroup: artifact.conditionalRetentionByGroup,
    validationEvidence: artifact.validationEvidence,
    untouchedTestReservation: artifact.untouchedTestReservation,
  };
  return { ...artifact, artifactSha256: sha256(JSON.stringify(identity)) };
}

function terminalArtifact() {
  const categories = ['K', '1B', 'HR'];
  const leagueTarget = { K: 0.5, '1B': 0.4, HR: 0.1 };
  const artifact = {
    artifactVersion: 1,
    modelVersion: 'm8-terminal-pa-outcome-v1',
    status: 'frozen-current-season-candidate-awaiting-untouched-test',
    productionEnabled: false,
    activeSeason: 2026,
    sourceDatasetSha256: '1'.repeat(64),
    sourceDatasetFileSha256: '2'.repeat(64),
    sourcePlatoonEvaluationSha256: '3'.repeat(64),
    sourcePlatoonEvaluationFileSha256: '4'.repeat(64),
    fitWindow: { startDate: '2026-03-27', endDate: '2026-06-21', observationCount: 100 },
    validationWindow: { startDate: '2026-06-22', endDate: '2026-07-05', observationCount: 20 },
    categories,
    hitCategories: ['1B', 'HR'],
    structuralZeroCategories: [],
    baseParameters: {
      batterPooling: 4,
      pitcherPooling: 4,
      batterCoefficient: 1,
      pitcherAllowedCoefficient: 1,
    },
    selectedPlatoonCandidate: {
      candidateId: 'no-platoon',
      leaguePlatoonPriorId: null,
      leaguePlatoonEquivalentPa: null,
      leaguePlatoonExactTarget: true,
      playerSplitPriorId: null,
      playerSplitEquivalentPa: null,
      playerSplitExactTarget: true,
      platoonCoefficient: 0,
    },
    rowCounts: { fit: 100, validation: 20, total: 120 },
    leagueCounts: { K: 60, '1B': 48, HR: 12 },
    leagueTarget,
    batterCounts: { '1': { K: 10, '1B': 15, HR: 5 } },
    pitcherCounts: {
      '10': { K: 5, '1B': 20, HR: 5 },
      '20': { K: 25, '1B': 4, HR: 1 },
    },
    matchupCounts: {},
    batterSplitCounts: {},
    batterOverall: { '1': { K: 0.3, '1B': 0.5, HR: 0.2 } },
    pitcherAllowed: {
      '10': { K: 0.2, '1B': 0.6, HR: 0.2 },
      '20': { K: 0.8, '1B': 0.15, HR: 0.05 },
    },
    leaguePlatoonByMatchup: {},
    batterSplitByMatchup: {},
    unseenBatter: leagueTarget,
    unseenPitcher: leagueTarget,
    untouchedTestReservation: SEALED,
  };
  const identity = {
    artifactVersion: artifact.artifactVersion,
    modelVersion: artifact.modelVersion,
    status: artifact.status,
    productionEnabled: artifact.productionEnabled,
    activeSeason: artifact.activeSeason,
    sourceDatasetSha256: artifact.sourceDatasetSha256,
    sourceDatasetFileSha256: artifact.sourceDatasetFileSha256,
    sourcePlatoonEvaluationSha256: artifact.sourcePlatoonEvaluationSha256,
    sourcePlatoonEvaluationFileSha256: artifact.sourcePlatoonEvaluationFileSha256,
    fitWindow: artifact.fitWindow,
    validationWindow: artifact.validationWindow,
    categories: artifact.categories,
    hitCategories: artifact.hitCategories,
    structuralZeroCategories: artifact.structuralZeroCategories,
    baseParameters: artifact.baseParameters,
    selectedPlatoonCandidate: artifact.selectedPlatoonCandidate,
    rowCounts: artifact.rowCounts,
    leagueCounts: artifact.leagueCounts,
    leagueTarget: artifact.leagueTarget,
    batterCounts: artifact.batterCounts,
    pitcherCounts: artifact.pitcherCounts,
    matchupCounts: artifact.matchupCounts,
    batterSplitCounts: artifact.batterSplitCounts,
    batterOverall: artifact.batterOverall,
    pitcherAllowed: artifact.pitcherAllowed,
    leaguePlatoonByMatchup: artifact.leaguePlatoonByMatchup,
    batterSplitByMatchup: artifact.batterSplitByMatchup,
    unseenBatter: artifact.unseenBatter,
    unseenPitcher: artifact.unseenPitcher,
    untouchedTestReservation: artifact.untouchedTestReservation,
  };
  return { ...artifact, artifactSha256: sha256(JSON.stringify(identity)) };
}

function sharedArtifact() {
  const scenarios = Array.from({ length: 4 }, (_, index) => ({
    scenarioIndex: index,
    weight: 0.25,
    expectedTotalPa: 72,
    expectedTotalHits: 16,
    away: {
      meanPa: 36,
      sigmaPa: 0,
      hitProbability: 0.18 + index * 0.02,
      expectedHits: 8,
    },
    home: {
      meanPa: 36,
      sigmaPa: 0,
      hitProbability: 0.2 + index * 0.02,
      expectedHits: 8,
    },
  }));
  const starterPmf = Array(29).fill(0);
  starterPmf[18] = 1;
  const artifact = {
    artifactVersion: 2,
    modelVersion: 'm8-shared-offensive-environment-v2',
    status: 'frozen-current-season-candidate-awaiting-downstream-untouched-test',
    productionEnabled: false,
    activeSeason: 2026,
    sourceSharedEnvironmentArtifactSha256: '5'.repeat(64),
    sourceSharedEnvironmentArtifactFileSha256: '6'.repeat(64),
    sourceStarterBullpenDatasetSha256: '7'.repeat(64),
    sourceStarterBullpenEvaluationSha256: '8'.repeat(64),
    sourceStarterBullpenEvaluationFileSha256: '9'.repeat(64),
    fitWindow: { startDate: '2026-03-27', endDate: '2026-06-21' },
    validationWindow: { startDate: '2026-06-22', endDate: '2026-07-05' },
    scenarioCount: 4,
    scenarios,
    starterBullpenTransition: {
      selectedCandidate: { candidateId: 'starter-bf-league', grouping: 'league' },
      supportMaximum: 28,
      bySide: { away: starterPmf, home: starterPmf },
      scenarioDependence: 'not-selected',
    },
    validationEvidence: { selectionAgreement: true },
    untouchedTestReservation: SEALED,
  };
  const identity = {
    artifactVersion: artifact.artifactVersion,
    modelVersion: artifact.modelVersion,
    status: artifact.status,
    productionEnabled: artifact.productionEnabled,
    activeSeason: artifact.activeSeason,
    sourceSharedEnvironmentArtifactSha256: artifact.sourceSharedEnvironmentArtifactSha256,
    sourceSharedEnvironmentArtifactFileSha256: artifact.sourceSharedEnvironmentArtifactFileSha256,
    sourceStarterBullpenDatasetSha256: artifact.sourceStarterBullpenDatasetSha256,
    sourceStarterBullpenEvaluationSha256: artifact.sourceStarterBullpenEvaluationSha256,
    sourceStarterBullpenEvaluationFileSha256: artifact.sourceStarterBullpenEvaluationFileSha256,
    fitWindow: artifact.fitWindow,
    validationWindow: artifact.validationWindow,
    scenarioCount: artifact.scenarioCount,
    scenarios: artifact.scenarios,
    starterBullpenTransition: artifact.starterBullpenTransition,
    validationEvidence: artifact.validationEvidence,
    untouchedTestReservation: artifact.untouchedTestReservation,
  };
  return { ...artifact, artifactSha256: sha256(JSON.stringify(identity)) };
}

function bullpenRows() {
  return [
    ...Array.from({ length: 20 }, () => ({ pitcherHand: 'R', terminalCategory: 'K' })),
    ...Array.from({ length: 5 }, () => ({ pitcherHand: 'R', terminalCategory: '1B' })),
    ...Array.from({ length: 20 }, () => ({ pitcherHand: 'L', terminalCategory: 'K' })),
    ...Array.from({ length: 5 }, () => ({ pitcherHand: 'L', terminalCategory: 'HR' })),
  ];
}

function observation(index = 1, actualHits = 1) {
  return {
    observationId: `observation-${index}`,
    side: 'away',
    lineupSlot: 1,
    batterId: 1,
    starterPitcherId: 10,
    batterSide: 'L',
    starterPitcherHand: 'R',
    actualHits,
  };
}

test('starter retention reduces only the named hitter tail while preserving probability', () => {
  const teamPaPmf = Array(37).fill(0);
  teamPaPmf[36] = 1;
  const pmf = namedHitterOpportunityPmf({
    teamPaPmf,
    lineupSlot: 1,
    conditionalRetention: [1, 1, 0.5, 1],
  });
  assert.deepEqual(pmf, [0, 0, 0.5, 0, 0.5]);
  assert.equal(pmf.reduce((sum, value) => sum + value, 0), 1);
});

test('the complete candidate mixes starter and bullpen outcomes and conserves hit mass', () => {
  const shared = sharedArtifact();
  const retention = retentionArtifact();
  const terminal = terminalArtifact();
  const bullpenModel = buildGenericBullpenModel({
    terminalArtifact: terminal,
    bullpenRows: bullpenRows(),
  });
  const prediction = predictM8BatterHitsDistribution({
    sharedEnvironmentArtifact: shared,
    starterRetentionArtifact: retention,
    terminalOutcomeArtifact: terminal,
    bullpenModel,
    environmentCoefficient: 0,
    observation: observation(),
  });
  assert.ok(
    Math.abs(
      prediction.statisticDistribution.reduce((sum, value) => sum + value, 0) - 1,
    ) < 1e-12,
  );
  const firstScenario = prediction.scenarios[0];
  assert.ok(
    firstScenario.perOpportunityHitProbabilities[0] >
      firstScenario.perOpportunityHitProbabilities[2],
    'the first PA should use the hit-friendly starter while the third PA has transitioned to the bullpen',
  );
  assert.deepEqual(
    prediction.scenarios.map((scenario) => scenario.opportunityCountPmf),
    prediction.scenarios.map(() => [0, 0, 0.5, 0, 0.5]),
  );
});

test('freezes one complete validation-selected candidate and rejects tampering', () => {
  const candidate = buildM8BatterHitsRuntimeCandidate({
    sharedEnvironmentArtifact: sharedArtifact(),
    starterRetentionArtifact: retentionArtifact(),
    terminalOutcomeArtifact: terminalArtifact(),
    bullpenRows: bullpenRows(),
    validationObservations: [
      observation(1, 0),
      observation(2, 1),
      observation(3, 1),
      observation(4, 2),
    ],
  });
  verifyM8BatterHitsRuntimeCandidate(candidate);
  assert.equal(candidate.productionEnabled, false);
  assert.equal(candidate.validationResults.length, 7);
  assert.equal(candidate.selectedValidationMetrics.observationCount, 4);

  const tampered = structuredClone(candidate);
  tampered.selectedEnvironmentCoefficient = 99;
  assert.throws(
    () => verifyM8BatterHitsRuntimeCandidate(tampered),
    /SHA-256 is invalid/,
  );
});
