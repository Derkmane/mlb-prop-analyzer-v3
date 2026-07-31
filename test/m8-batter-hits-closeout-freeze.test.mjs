import assert from 'node:assert/strict';
import test from 'node:test';

import {
  M8_BATTER_HITS_CLOSEOUT_CONTRACT,
  M8_DEFERRED_COMPONENT_MANIFEST,
  REQUIRED_FITTED_COMPONENT_IDS,
  applyDeferredIdentityComponents,
  buildBatterHitsCloseoutFreeze,
  buildM8BatterHitsCloseoutFreeze,
  summarizeSelectedEvidence,
  verifyBatterHitsCloseoutFreeze,
  verifyM8BatterHitsCloseoutFreeze,
} from '../scripts/m8-batter-hits-closeout-freeze-utils.mjs';

const CANDIDATES = Object.freeze({
  recencyWeighting: 'uniform',
  batterPooling: 'league-pa-256',
  pitcherAllowedPooling: 'league-pa-256',
  coherentMatchup: 'batter-1.00-pitcher-0.75',
  platoon:
    'league-raw-cell-limit-split-pa-1024-coefficient-0.75',
  starterBullpenTransition: 'starter-bf-side-pool-1000',
  paSurvival: 'slot-home-away-pool-50',
  sharedOffensiveEnvironment: 'shared-environment-k4',
});

const V5_CONTRACT = Object.freeze({
  purpose:
    'Frozen M9 Batter Hits V5 acceptance runtime manifest containing only preselected current-season components.',
  modelVersion: 'm9-batter-hits-v5-runtime-freeze-v1',
  settlementVersion: 'batter-hits-settlement-not-production-validated',
  settlementRegistryVersion: 'settlement-registry-v1',
  status: 'frozen-current-season-v5-runtime-manifest-before-untouched-test',
});

function evidence(candidateId, period) {
  return {
    selection: {
      selectedCandidate: { candidateId },
      nondominatedCandidateIds: [candidateId],
    },
    metrics: {
      categoricalLogLoss:
        period === 'fixed' ? 2.8 : 2.81,
      categoricalBrier:
        period === 'fixed' ? 0.92 : 0.93,
    },
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      rowsIncluded: false,
    },
  };
}

function fittedComponents() {
  return Object.fromEntries(
    REQUIRED_FITTED_COMPONENT_IDS.map((componentId) => {
      const candidateId = CANDIDATES[componentId];

      return [
        componentId,
        {
          candidateId,
          fixedValidation: summarizeSelectedEvidence({
            sourcePath: `${componentId}-fixed.json`,
            sourceValue: evidence(candidateId, 'fixed'),
            candidateId,
            declaredNondominatedCandidateIds: [candidateId],
          }),
          walkForward: summarizeSelectedEvidence({
            sourcePath: `${componentId}-walk-forward.json`,
            sourceValue: evidence(candidateId, 'walk-forward'),
            candidateId,
            declaredNondominatedCandidateIds: [candidateId],
          }),
        },
      ];
    }),
  );
}

function buildArguments() {
  return {
    activeSeason: 2026,
    fittedComponents: fittedComponents(),
    runtimeSourceArtifacts: [
      {
        sourcePath: 'terminal.json',
        sourceSha256: 'a'.repeat(64),
      },
      {
        sourcePath: 'environment.json',
        sourceSha256: 'b'.repeat(64),
      },
    ],
    untouchedTestReservation: {
      startDate: '2026-07-06',
      endDate: '2026-07-25',
      rowsIncluded: false,
    },
  };
}

function build() {
  return buildM8BatterHitsCloseoutFreeze(buildArguments());
}

test('freezes deterministic selected-component evidence without test access', () => {
  const first = build();
  const second = build();

  assert.equal(first.artifactSha256, second.artifactSha256);
  assert.equal(first.productionEnabled, false);
  assert.equal(first.untouchedTestAccessed, false);
  assert.equal(first.untouchedTestReservation.rowsIncluded, false);
  assert.equal(verifyM8BatterHitsCloseoutFreeze(first), first);

  for (const componentId of REQUIRED_FITTED_COMPONENT_IDS) {
    assert.equal(
      first.fittedComponents[componentId].candidateId,
      CANDIDATES[componentId],
    );
    assert.ok(
      first.fittedComponents[componentId].fixedValidation.properScores
        .length > 0,
    );
    assert.ok(
      first.fittedComponents[componentId].walkForward.properScores
        .length > 0,
    );
  }
});

test('preserves the exact default M8 freeze contract through the generic builder', () => {
  const legacy = buildM8BatterHitsCloseoutFreeze(buildArguments());
  const generic = buildBatterHitsCloseoutFreeze({
    ...buildArguments(),
    contract: M8_BATTER_HITS_CLOSEOUT_CONTRACT,
  });

  assert.deepEqual(generic, legacy);
  assert.equal(
    verifyBatterHitsCloseoutFreeze(generic, {
      expectedContract: M8_BATTER_HITS_CLOSEOUT_CONTRACT,
    }),
    generic,
  );
});

test('freezes a distinctly versioned pre-untouched acceptance candidate without changing M8', () => {
  const custom = buildBatterHitsCloseoutFreeze({
    ...buildArguments(),
    contract: V5_CONTRACT,
  });

  assert.equal(custom.modelVersion, V5_CONTRACT.modelVersion);
  assert.equal(custom.status, V5_CONTRACT.status);
  assert.equal(custom.productionEnabled, false);
  assert.equal(custom.untouchedTestAccessed, false);
  assert.equal(custom.untouchedTestReservation.rowsIncluded, false);
  assert.equal(
    verifyBatterHitsCloseoutFreeze(custom, {
      expectedContract: V5_CONTRACT,
    }),
    custom,
  );
  assert.throws(
    () => verifyM8BatterHitsCloseoutFreeze(custom),
    /does not match the expected contract/,
  );
});

test('identity components leave synthetic terminal PA vectors unchanged', () => {
  const vectors = [
    { K: 0.22, UBB: 0.08, '1B': 0.16, BIP_OUT: 0.54 },
    { K: 0.3, UBB: 0.1, '1B': 0.2, BIP_OUT: 0.4 },
    { K: 0.15, UBB: 0.05, '1B': 0.25, BIP_OUT: 0.55 },
  ];

  for (const vector of vectors) {
    const scored = applyDeferredIdentityComponents({
      probabilities: vector,
      componentManifest: M8_DEFERRED_COMPONENT_MANIFEST,
    });

    assert.deepEqual(scored, vector);

    const total = Object.values(scored).reduce(
      (sum, probability) => sum + probability,
      0,
    );

    assert.ok(Math.abs(total - 1) < 1e-12);
  }
});

test('rejects a disguised fitted adjustment or exposed untouched rows', () => {
  const invalidManifest = structuredClone(
    M8_DEFERRED_COMPONENT_MANIFEST,
  );

  invalidManifest.park.modeled = true;

  assert.throws(
    () =>
      applyDeferredIdentityComponents({
        probabilities: { K: 0.5, BIP_OUT: 0.5 },
        componentManifest: invalidManifest,
      }),
    /park must be an explicit identity component/,
  );

  const exposed = structuredClone(build());
  exposed.untouchedTestReservation.rowsIncluded = true;

  assert.throws(
    () => verifyM8BatterHitsCloseoutFreeze(exposed),
    /untouched-test rows/,
  );
});
