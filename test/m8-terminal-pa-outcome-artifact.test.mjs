import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildM8TerminalPaOutcomeArtifact,
  terminalPaOutcomeProbabilities,
  verifyM8TerminalPaOutcomeArtifact,
} from '../scripts/m8-terminal-pa-outcome-artifact-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

const categories = ['K', '1B', 'HR'];

function row(id, date, batter, pitcher, category, batterSide, pitcherHand) {
  return {
    rowId: id,
    observedDate: date,
    providerBatterId: batter,
    providerPitcherId: pitcher,
    mappingStatus: 'classified-terminal',
    includedInOverallOutcomeModel: true,
    includedInPlatoonModel: true,
    normalizedBatterSide: batterSide,
    normalizedPitcherHand: pitcherHand,
    terminalCategory: category,
  };
}

function dataset() {
  const fitRows = [
    row('f1', '2026-04-01', 1, 10, '1B', 'L', 'R'),
    row('f2', '2026-04-01', 1, 10, 'HR', 'L', 'R'),
    row('f3', '2026-04-02', 1, 11, '1B', 'L', 'L'),
    row('f4', '2026-04-02', 1, 11, 'K', 'L', 'L'),
    row('f5', '2026-04-03', 2, 10, 'K', 'R', 'R'),
    row('f6', '2026-04-03', 2, 10, 'K', 'R', 'R'),
    row('f7', '2026-04-04', 2, 11, '1B', 'R', 'L'),
    row('f8', '2026-04-04', 2, 11, 'HR', 'R', 'L'),
    row('f9', '2026-04-05', 3, 12, 'K', 'R', 'R'),
    row('f10', '2026-04-05', 3, 12, '1B', 'R', 'R'),
    row('f11', '2026-04-06', 3, 12, 'HR', 'R', 'L'),
  ];
  const validationRows = [
    row('v1', '2026-06-22', 1, 10, '1B', 'L', 'R'),
    row('v2', '2026-06-23', 2, 11, 'K', 'R', 'L'),
    row('v3', '2026-06-24', 3, 12, 'HR', 'R', 'L'),
  ];
  return {
    datasetVersion: 3,
    activeSeason: 2026,
    datasetSha256: 'a'.repeat(64),
    periods: {
      fit: { startDate: '2026-04-01', endDate: '2026-06-21', rows: fitRows },
      validation: {
        startDate: '2026-06-22',
        endDate: '2026-07-05',
        rows: validationRows,
      },
    },
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      rowsIncluded: false,
    },
  };
}

function evaluation(sourceDatasetSha256) {
  const selectedCandidate = {
    candidateId: 'league-pa-4-split-pa-4-coefficient-1.00',
    leaguePlatoonPriorId: 'league-pa-4',
    leaguePlatoonEquivalentPa: 4,
    leaguePlatoonExactTarget: false,
    playerSplitPriorId: 'split-pa-4',
    playerSplitEquivalentPa: 4,
    playerSplitExactTarget: false,
    platoonCoefficient: 1,
  };
  const identity = {
    activeSeason: 2026,
    sourceDatasetSha256,
    sourceDatasetFileSha256: 'b'.repeat(64),
    sourceFixedEvaluationSha256: 'c'.repeat(64),
    sourceFixedEvaluationFileSha256: 'd'.repeat(64),
    sourceWalkForwardSha256: 'e'.repeat(64),
    sourceWalkForwardFileSha256: 'f'.repeat(64),
    canonicalCategories: categories,
    modeledCategories: categories,
    structuralZeroCategories: [],
    hitCategories: ['1B', 'HR'],
    baseParameters: {
      batterPooling: 4,
      pitcherPooling: 4,
      batterCoefficient: 1,
      pitcherAllowedCoefficient: 1,
      selectedCandidateId: 'base',
    },
    platoonModel: {},
    cohorts: {},
    candidates: [selectedCandidate],
    results: [],
    baseline: {},
    selection: { status: 'platoon-candidate-selected', selectedCandidate },
    improvementVersusNoPlatoon: {},
    selectedBoundaryFlags: {},
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      rowsIncluded: false,
    },
  };
  return {
    platoonEvaluationVersion: 1,
    purpose: 'synthetic test evaluation',
    status: 'offline-resolved-categorical-platoon-evaluation-not-production-model',
    ...identity,
    platoonEvaluationSha256: sha256(JSON.stringify(identity)),
  };
}

test('freezes one coherent current-season terminal vector and verifies tamper evidence', () => {
  const source = dataset();
  const artifact = buildM8TerminalPaOutcomeArtifact({
    rawDataset: source,
    datasetFileSha256: '1'.repeat(64),
    rawPlatoonEvaluation: evaluation(source.datasetSha256),
    platoonEvaluationFileSha256: '2'.repeat(64),
  });

  verifyM8TerminalPaOutcomeArtifact(artifact);
  assert.equal(artifact.productionEnabled, false);
  assert.equal(artifact.rowCounts.total, 14);
  assert.deepEqual(Object.keys(artifact.leaguePlatoonByMatchup).sort(), [
    'L-vs-L',
    'L-vs-R',
    'R-vs-L',
    'R-vs-R',
  ]);

  const probabilities = terminalPaOutcomeProbabilities({
    artifact,
    batterId: 1,
    pitcherId: 10,
    batterSide: 'L',
    pitcherHand: 'R',
  });
  assert.ok(Math.abs(Object.values(probabilities).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.ok(probabilities['1B'] > 0);
  assert.ok(probabilities.HR > 0);
  assert.ok(probabilities.K > 0);

  const tampered = structuredClone(artifact);
  tampered.leagueTarget.K += 0.01;
  assert.throws(() => verifyM8TerminalPaOutcomeArtifact(tampered), /sum to one|SHA-256/);
});

test('unseen current-season identities use only the frozen league-pooled vectors', () => {
  const source = dataset();
  const artifact = buildM8TerminalPaOutcomeArtifact({
    rawDataset: source,
    datasetFileSha256: '3'.repeat(64),
    rawPlatoonEvaluation: evaluation(source.datasetSha256),
    platoonEvaluationFileSha256: '4'.repeat(64),
  });
  const probabilities = terminalPaOutcomeProbabilities({
    artifact,
    batterId: 999,
    pitcherId: 999,
    batterSide: 'L',
    pitcherHand: 'R',
  });
  assert.ok(Math.abs(Object.values(probabilities).reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
});
