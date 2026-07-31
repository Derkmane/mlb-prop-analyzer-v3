import assert from 'node:assert/strict';
import test from 'node:test';

import {
  M9_BATTER_HITS_V5_EXPECTED_CANDIDATES,
  M9_BATTER_HITS_V5_FREEZE_CONTRACT,
  buildM9BatterHitsV5FreezeRunSpecification,
} from '../scripts/m9-batter-hits-v5-runtime-freeze-utils.mjs';

const SHA = Object.freeze({
  pa: 'a'.repeat(64),
  retention: 'b'.repeat(64),
  sharedV1: 'c'.repeat(64),
  sharedV2: 'd'.repeat(64),
  terminal: 'e'.repeat(64),
  complete: 'f'.repeat(64),
});

function reservation() {
  return {
    startDate: '2026-07-30',
    endDate: '2026-08-04',
    rowsIncluded: false,
  };
}

function wrapped(path, value) {
  return {
    path,
    value: {
      ...value,
      untouchedTestReservation:
        value.untouchedTestReservation ?? reservation(),
    },
  };
}

function sources() {
  const coherentCandidate = {
    candidateId: M9_BATTER_HITS_V5_EXPECTED_CANDIDATES.coherentMatchup,
    batterCoefficient: 1,
    pitcherAllowedCoefficient: 1,
  };
  const platoonCandidate = {
    candidateId: M9_BATTER_HITS_V5_EXPECTED_CANDIDATES.platoon,
  };
  const fixedBatter = {
    candidate: { candidateId: 'league-pa-128', leagueEquivalentPa: 128 },
  };
  const fixedPitcher = {
    candidate: { candidateId: 'league-pa-256', leagueEquivalentPa: 256 },
  };

  return {
    recencyFixed: wrapped('recency-fixed.json', {
      selection: { selectedCandidate: { candidateId: 'uniform' } },
      metrics: { validationLogLoss: 0.5, validationBrierScore: 0.2 },
    }),
    recencyWalk: wrapped('recency-walk.json', {
      selection: { selectedCandidate: { candidateId: 'uniform' } },
      metrics: { validationLogLoss: 0.51, validationBrierScore: 0.21 },
    }),
    poolingWalk: wrapped('pooling-walk.json', {
      productionEnabled: false,
      untouchedTestAccessed: false,
      parameters: {
        batter: {
          stableSelection: true,
          fixedNondominatedCandidateIds: ['league-pa-64', 'league-pa-128'],
          walkForwardNondominatedCandidateIds: ['league-pa-64', 'league-pa-128'],
          stableCandidateIds: ['league-pa-64', 'league-pa-128'],
          selectedCandidateId: 'league-pa-128',
          fixedResults: [
            { candidate: { candidateId: 'league-pa-64', leagueEquivalentPa: 64 } },
            fixedBatter,
          ],
        },
        pitcherAllowed: {
          stableSelection: true,
          fixedNondominatedCandidateIds: ['league-pa-256'],
          walkForwardNondominatedCandidateIds: ['league-pa-256'],
          stableCandidateIds: ['league-pa-256'],
          selectedCandidateId: 'league-pa-256',
          fixedResults: [fixedPitcher],
        },
      },
    }),
    categoricalFixed: wrapped('categorical-fixed.json', {
      coherentMatchup: {
        selection: { selectedCandidate: coherentCandidate },
      },
      metrics: { categoricalLogLoss: 1.6, categoricalBrier: 0.8 },
    }),
    categoricalWalk: wrapped('categorical-walk.json', {
      aggregateSelection: { selectedCandidate: coherentCandidate },
      metrics: { categoricalLogLoss: 1.61, categoricalBrier: 0.81 },
    }),
    platoonFixed: wrapped('platoon-fixed.json', {
      selection: { selectedCandidate: platoonCandidate },
      metrics: { categoricalLogLoss: 1.62, categoricalBrier: 0.82 },
    }),
    platoonWalk: wrapped('platoon-walk.json', {
      frozenCandidate: platoonCandidate,
      metrics: { categoricalLogLoss: 1.63, categoricalBrier: 0.83 },
    }),
    starterBullpenEvaluation: wrapped('starter-bullpen.json', {
      stableSelection: true,
      selectedCandidateId: 'starter-bf-league',
      fixedNondominatedCandidateIds: ['starter-bf-league'],
      walkForwardNondominatedCandidateIds: ['starter-bf-league'],
      admissibleCandidateIds: ['starter-bf-league'],
      metrics: { logLoss: 2.8, multiclassBrier: 0.92 },
    }),
    paFixed: wrapped('pa-fixed.json', {
      selectedCandidateId: 'slot-home-away-pool-25',
      metrics: { logLoss: 1.05, brier: 0.56 },
    }),
    paWalk: wrapped('pa-walk.json', {
      sourceHoldoutSelectedCandidateId: 'slot-home-away-pool-25',
      selectedCandidateId: 'slot-home-away-pool-25',
      metrics: { logLoss: 1.051, brier: 0.561 },
    }),
    paArtifact: wrapped('pa-artifact.json', {
      selectedCandidateId: 'slot-home-away-pool-25',
      artifactSha256: SHA.pa,
    }),
    sharedFixed: wrapped('shared-fixed.json', {
      selectedCandidate: { candidateId: 'shared-environment-k4' },
      metrics: { jointLogLoss: 10.3, brier: 0.9 },
    }),
    sharedWalk: wrapped('shared-walk.json', {
      selectedCandidate: { candidateId: 'shared-environment-k4' },
      metrics: { jointLogLoss: 10.31, brier: 0.91 },
    }),
    sharedArtifact: wrapped('shared-v1.json', {
      selectedCandidateId: 'shared-environment-k4',
      artifactSha256: SHA.sharedV1,
    }),
    sharedV2: wrapped('shared-v2.json', {
      sourceSharedEnvironmentArtifactSha256: SHA.sharedV1,
      starterBullpenTransition: {
        selectedCandidate: { candidateId: 'starter-bf-league' },
      },
      artifactSha256: SHA.sharedV2,
    }),
    retentionArtifact: wrapped('retention.json', {
      selectedCandidate: { candidateId: 'retention-slot-pool-200' },
      artifactSha256: SHA.retention,
    }),
    terminalArtifact: wrapped('terminal.json', {
      baseParameters: {
        batterPooling: 128,
        pitcherPooling: 256,
        batterCoefficient: 1,
        pitcherAllowedCoefficient: 1,
      },
      selectedPlatoonCandidate: platoonCandidate,
      artifactSha256: SHA.terminal,
    }),
    completeCandidate: wrapped('complete.json', {
      productionEnabled: false,
      sourceSharedEnvironmentArtifactSha256: SHA.sharedV2,
      sourceStarterRetentionArtifactSha256: SHA.retention,
      sourceTerminalOutcomeArtifactSha256: SHA.terminal,
      artifactSha256: SHA.complete,
    }),
  };
}

function build(sourceOverrides = {}) {
  return buildM9BatterHitsV5FreezeRunSpecification({
    rootPath: 'artifacts/m9-batter-hits-v5-refit',
    outputPath:
      'artifacts/m9-batter-hits-v5-refit/m9-batter-hits-v5-runtime-freeze-v1.json',
    sources: {
      ...sources(),
      ...sourceOverrides,
    },
  });
}

test('builds the exact V5 spec and keeps the connected M8 runtime separate', () => {
  const specification = build();

  assert.deepEqual(specification.contract, M9_BATTER_HITS_V5_FREEZE_CONTRACT);
  assert.equal(specification.specifications.length, 8);
  assert.deepEqual(
    Object.fromEntries(
      specification.specifications.map((component) => [
        component.componentId,
        component.candidateId,
      ]),
    ),
    M9_BATTER_HITS_V5_EXPECTED_CANDIDATES,
  );
  assert.deepEqual(specification.runtimeSourcePaths, [
    'pa-artifact.json',
    'retention.json',
    'shared-v2.json',
    'terminal.json',
    'complete.json',
  ]);
});

test('rejects a pooling selection that does not match the frozen terminal model', () => {
  const invalidTerminal = sources().terminalArtifact;
  invalidTerminal.value.baseParameters.batterPooling = 64;

  assert.throws(
    () => build({ terminalArtifact: invalidTerminal }),
    /selected pooling strength versus terminal artifact/,
  );
});

test('rejects a complete-candidate source-link mismatch', () => {
  const invalidComplete = sources().completeCandidate;
  invalidComplete.value.sourceTerminalOutcomeArtifactSha256 = '0'.repeat(64);

  assert.throws(
    () => build({ completeCandidate: invalidComplete }),
    /complete-candidate terminal-PA source/,
  );
});

test('rejects any exposed untouched-test rows', () => {
  const exposed = sources().paFixed;
  exposed.value.untouchedTestReservation.rowsIncluded = true;

  assert.throws(
    () => build({ paFixed: exposed }),
    /rowsIncluded must equal false/,
  );
});
