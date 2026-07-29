import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildM8SharedOffensiveEnvironmentV2,
  verifyM8SharedOffensiveEnvironmentV2,
} from '../scripts/m8-shared-offensive-environment-v2-utils.mjs';
import {
  buildM8StarterBullpenDataset,
  evaluateM8StarterBullpenTransition,
} from '../scripts/m8-starter-bullpen-transition-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

function pa(gameId, date, number, half, pitcherId) {
  return {
    rowId: `${date}:${gameId}:${number}:${half}`,
    observedDate: date,
    providerGameId: gameId,
    providerPaNumber: number,
    providerBatterId: 1000 + number,
    providerPitcherId: pitcherId,
    halfInning: half,
    mappingStatus: 'classified-terminal',
    includedInOverallOutcomeModel: true,
    terminalCategory: number % 3 === 0 ? '1B' : 'BIP_OUT',
    normalizedPitcherHand: pitcherId % 2 === 0 ? 'R' : 'L',
    normalizedBatterSide: number % 2 === 0 ? 'L' : 'R',
  };
}

function sideRows(gameId, date, half, starterId, starterBf) {
  return Array.from({ length: 6 }, (_, index) =>
    pa(gameId, date, index + 1, half, index < starterBf ? starterId : starterId + 100),
  );
}

function resolvedDataset() {
  const fit = [];
  const validation = [];
  for (let game = 1; game <= 12; game += 1) {
    const date = `2026-05-${String(game).padStart(2, '0')}`;
    fit.push(...sideRows(game, date, 'top', 10 + game, 3));
    fit.push(...sideRows(game, date, 'bottom', 30 + game, 5));
  }
  for (let game = 13; game <= 18; game += 1) {
    const date = `2026-06-${String(game).padStart(2, '0')}`;
    validation.push(...sideRows(game, date, 'top', 10 + game, 3));
    validation.push(...sideRows(game, date, 'bottom', 30 + game, 5));
  }
  return {
    datasetVersion: 3,
    activeSeason: 2026,
    datasetSha256: 'a'.repeat(64),
    periods: { fit: { rows: fit }, validation: { rows: validation } },
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      rowsIncluded: false,
    },
  };
}

function sharedV1() {
  const scenarios = Array.from({ length: 4 }, (_, index) => ({
    scenarioIndex: index,
    weight: 0.25,
    expectedTotalPa: 72 + index,
    expectedTotalHits: 16 + index,
    away: {
      meanPa: 36 + index * 0.25,
      sigmaPa: 4,
      hitProbability: 0.21 + index * 0.01,
      expectedHits: (36 + index * 0.25) * (0.21 + index * 0.01),
    },
    home: {
      meanPa: 36 + index * 0.25,
      sigmaPa: 4,
      hitProbability: 0.22 + index * 0.01,
      expectedHits: (36 + index * 0.25) * (0.22 + index * 0.01),
    },
  }));
  for (const scenario of scenarios) {
    scenario.expectedTotalPa = scenario.away.meanPa + scenario.home.meanPa;
    scenario.expectedTotalHits = scenario.away.expectedHits + scenario.home.expectedHits;
  }
  const artifact = {
    artifactVersion: 1,
    purpose: 'synthetic shared environment',
    status: 'benchmark-only-not-production-validated',
    productionEnabled: false,
    activeSeason: 2026,
    sourceDatasetSha256: '1'.repeat(64),
    sourceDatasetFileSha256: '2'.repeat(64),
    sourceHoldoutEvaluationSha256: '3'.repeat(64),
    sourceHoldoutEvaluationFileSha256: '4'.repeat(64),
    sourceWalkForwardSha256: '5'.repeat(64),
    sourceWalkForwardFileSha256: '6'.repeat(64),
    fitWindow: { startDate: '2026-03-26', endDate: '2026-06-21' },
    validationWindow: { startDate: '2026-06-22', endDate: '2026-07-05' },
    candidateScenarioCounts: [1, 2, 3, 4],
    selectedCandidateId: 'shared-environment-k4',
    scenarioCount: 4,
    scenarioCountPolicy: {},
    scenarios,
    validationEvidence: {},
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      rowsIncluded: false,
    },
  };
  const identity = {
    artifactVersion: artifact.artifactVersion,
    purpose: artifact.purpose,
    status: artifact.status,
    productionEnabled: artifact.productionEnabled,
    activeSeason: artifact.activeSeason,
    sourceDatasetSha256: artifact.sourceDatasetSha256,
    sourceDatasetFileSha256: artifact.sourceDatasetFileSha256,
    sourceHoldoutEvaluationSha256: artifact.sourceHoldoutEvaluationSha256,
    sourceHoldoutEvaluationFileSha256: artifact.sourceHoldoutEvaluationFileSha256,
    sourceWalkForwardSha256: artifact.sourceWalkForwardSha256,
    sourceWalkForwardFileSha256: artifact.sourceWalkForwardFileSha256,
    fitWindow: artifact.fitWindow,
    validationWindow: artifact.validationWindow,
    candidateScenarioCounts: artifact.candidateScenarioCounts,
    selectedCandidateId: artifact.selectedCandidateId,
    scenarioCount: artifact.scenarioCount,
    scenarioCountPolicy: artifact.scenarioCountPolicy,
    scenarios: artifact.scenarios,
    validationEvidence: artifact.validationEvidence,
    untouchedTestReservation: artifact.untouchedTestReservation,
  };
  return { ...artifact, artifactSha256: sha256(JSON.stringify(identity)) };
}

test('adds a conserved starter-to-bullpen distribution to every shared scenario', () => {
  const transitionDataset = buildM8StarterBullpenDataset(resolvedDataset());
  const transition = evaluateM8StarterBullpenTransition({ rawDataset: transitionDataset });
  const artifact = buildM8SharedOffensiveEnvironmentV2({
    rawSharedEnvironmentArtifact: sharedV1(),
    sharedEnvironmentArtifactFileSha256: '7'.repeat(64),
    rawStarterBullpenEvaluation: transition,
    starterBullpenEvaluationFileSha256: '8'.repeat(64),
  });
  verifyM8SharedOffensiveEnvironmentV2(artifact);
  assert.equal(artifact.scenarioCount, 4);
  assert.equal(artifact.validationEvidence.starterBullpenStableSelection, true);
  assert.equal(
    artifact.validationEvidence.starterBullpenSelectedCandidateId,
    transition.selectedCandidateId,
  );
  for (const side of ['away', 'home']) {
    assert.ok(
      Math.abs(
        artifact.starterBullpenTransition.bySide[side].reduce(
          (sum, value) => sum + value,
          0,
        ) - 1,
      ) < 1e-12,
    );
  }

  const tampered = structuredClone(artifact);
  tampered.scenarios[0].weight += 0.1;
  assert.throws(() => verifyM8SharedOffensiveEnvironmentV2(tampered), /weights|SHA-256/);
});
