import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  M8_5_BATTER_HITS_SUCCESSOR_FREEZE_SOURCE_PATHS,
  buildM8_5BatterHitsSuccessorFreezeV1,
  verifyM8_5BatterHitsSuccessorFreezeV1,
  type M8_5BatterHitsSuccessorFreezeSourcesV1,
} from '../src/features/batter-hits/index.js';

const FREEZE_PATH = path.resolve(
  'model-artifacts/m8-5-batter-hits-successor-freeze-v1.json',
);
const EXPECTED_FREEZE_SHA256 =
  'a296c384397315832b39d322a7d061ca73e542d94a886087f743f0774199cd17';

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function loadSources(): M8_5BatterHitsSuccessorFreezeSourcesV1 {
  return {
    sourceM8RuntimeArtifact: readJson(
      M8_5_BATTER_HITS_SUCCESSOR_FREEZE_SOURCE_PATHS.sourceM8RuntimeArtifact,
    ),
    gameSpecificOffensiveEnvironmentArtifact: readJson(
      M8_5_BATTER_HITS_SUCCESSOR_FREEZE_SOURCE_PATHS.gameSpecificOffensiveEnvironment,
    ),
    teamSpecificBullpenArtifact: readJson(
      M8_5_BATTER_HITS_SUCCESSOR_FREEZE_SOURCE_PATHS.teamSpecificBullpen,
    ),
    timesThroughOrderArtifact: readJson(
      M8_5_BATTER_HITS_SUCCESSOR_FREEZE_SOURCE_PATHS.timesThroughOrder,
    ),
    parkArtifact: readJson(
      M8_5_BATTER_HITS_SUCCESSOR_FREEZE_SOURCE_PATHS.park,
    ),
    defenseToBattedBallArtifact: readJson(
      M8_5_BATTER_HITS_SUCCESSOR_FREEZE_SOURCE_PATHS.defenseToBattedBall,
    ),
  };
}

test('committed M8.5 successor freeze deterministically locks every factor disposition before untouched testing', () => {
  const committed = readJson(FREEZE_PATH);
  const sources = loadSources();
  const rebuilt = buildM8_5BatterHitsSuccessorFreezeV1(sources);
  const verified = verifyM8_5BatterHitsSuccessorFreezeV1(committed, sources);

  assert.deepEqual(verified, rebuilt);
  assert.equal(verified.artifactSha256, EXPECTED_FREEZE_SHA256);
  assert.equal(verified.productionEnabled, false);
  assert.equal(verified.rankingEnabled, false);
  assert.equal(verified.hardDiscoveryFilterEnabled, false);
  assert.equal(verified.untouchedTestAccessed, false);
  assert.deepEqual(verified.newUntouchedTestReservation, {
    reserved: false,
    rowsIncluded: false,
    cohortVersion: null,
  });
  assert.equal(
    verified.sourceM8RuntimeArtifact.artifactSha256,
    'e5a660ffc0aefc093dc80aae0169109bd7717605098d790b3257a83fad5bf3de',
  );
  assert.equal(
    verified.dBaseDefinition.identityField,
    'baseDistributionSha256',
  );
  assert.equal(
    verified.dFinalDefinition.identityField,
    'finalDistributionSha256',
  );
  assert.equal(
    verified.dFinalDefinition.sharedScenarioIdentityRule,
    'must equal source D_base sharedScenarioIdentity',
  );
  assert.deepEqual(verified.dFinalDefinition.applicationOrder, [
    'gameSpecificOffensiveEnvironment',
    'teamSpecificBullpen',
    'timesThroughOrder',
    'park',
  ]);

  assert.deepEqual(
    verified.factors.map((factor) => ({
      factorKey: factor.factorKey,
      disposition: factor.disposition,
      includedInCanonicalDFinalComposition:
        factor.includedInCanonicalDFinalComposition,
    })),
    [
      {
        factorKey: 'gameSpecificOffensiveEnvironment',
        disposition: 'applied',
        includedInCanonicalDFinalComposition: true,
      },
      {
        factorKey: 'teamSpecificBullpen',
        disposition: 'applied',
        includedInCanonicalDFinalComposition: true,
      },
      {
        factorKey: 'timesThroughOrder',
        disposition: 'identity',
        includedInCanonicalDFinalComposition: true,
      },
      {
        factorKey: 'park',
        disposition: 'validated-not-applied',
        includedInCanonicalDFinalComposition: true,
      },
      {
        factorKey: 'defenseToBattedBall',
        disposition: 'identity',
        includedInCanonicalDFinalComposition: false,
      },
    ],
  );
});

test('successor freeze hash drift fails closed', () => {
  const sources = loadSources();
  const drifted = structuredClone(readJson(FREEZE_PATH)) as {
    artifactSha256: string;
  };
  drifted.artifactSha256 = '0'.repeat(64);

  assert.throws(
    () => verifyM8_5BatterHitsSuccessorFreezeV1(drifted, sources),
    /does not match the frozen source artifacts and composition/,
  );
});

test('post-freeze coefficient changes fail closed before a new untouched cohort can be read', () => {
  const committed = readJson(FREEZE_PATH);
  const driftedSources = structuredClone(loadSources());
  const environment =
    driftedSources.gameSpecificOffensiveEnvironmentArtifact as {
      scenarioLogits: Array<{
        coefficients: Array<{ coefficient: number }>;
      }>;
    };
  const scenario = environment.scenarioLogits.at(1);
  assert.ok(scenario);
  const coefficient = scenario.coefficients.at(0);
  assert.ok(coefficient);
  coefficient.coefficient += 0.001;

  assert.throws(() =>
    verifyM8_5BatterHitsSuccessorFreezeV1(committed, driftedSources),
  );
});
