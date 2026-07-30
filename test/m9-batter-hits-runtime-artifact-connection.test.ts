import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  MarketRegistryUnavailableError,
  authorizeMarketForPrediction,
} from '../src/application/index.js';
import { DEFAULT_BATTER_HITS_RUNTIME_ARTIFACT_PATH } from '../src/adapters/index.js';
import {
  PRODUCTION_REGISTRIES,
  connectFrozenBatterHitsRuntimeArtifact,
} from '../src/composition/index.js';
import {
  BATTER_HITS_FROZEN_COMPONENT_CANDIDATES,
  BATTER_HITS_FROZEN_RUNTIME_ARTIFACT_SHA256,
  BATTER_HITS_FROZEN_RUNTIME_MODEL_VERSION,
  BATTER_HITS_MARKET_KEY,
} from '../src/features/batter-hits/index.js';

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

test('connects the exact frozen Batter Hits runtime artifact while ranking stays disabled', async () => {
  const connection = await connectFrozenBatterHitsRuntimeArtifact();

  assert.equal(
    connection.artifactPath,
    DEFAULT_BATTER_HITS_RUNTIME_ARTIFACT_PATH,
  );
  assert.equal(
    connection.artifact.modelVersion,
    BATTER_HITS_FROZEN_RUNTIME_MODEL_VERSION,
  );
  assert.equal(
    connection.artifact.artifactSha256,
    BATTER_HITS_FROZEN_RUNTIME_ARTIFACT_SHA256,
  );
  assert.equal(connection.artifact.productionEnabled, false);
  assert.equal(connection.artifact.untouchedTestAccessed, false);
  assert.equal(
    connection.artifact.untouchedTestReservation.rowsIncluded,
    false,
  );

  for (const [componentId, candidateId] of Object.entries(
    BATTER_HITS_FROZEN_COMPONENT_CANDIDATES,
  )) {
    const component = connection.artifact.fittedComponents[
      componentId as keyof typeof BATTER_HITS_FROZEN_COMPONENT_CANDIDATES
    ];
    assert.equal(component.candidateId, candidateId);
  }

  assert.throws(
    () => authorizeMarketForPrediction(PRODUCTION_REGISTRIES, BATTER_HITS_MARKET_KEY),
    (error: unknown) => {
      assert.ok(error instanceof MarketRegistryUnavailableError);
      assert.equal(error.code, 'MARKET_NOT_PRODUCTION_ENABLED');
      return true;
    },
  );
});

test('rejects a changed frozen component before it can enter composition', async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), 'm9-batter-hits-runtime-'),
  );

  try {
    const sourceText = await readFile(
      DEFAULT_BATTER_HITS_RUNTIME_ARTIFACT_PATH,
      'utf8',
    );
    const artifact = record(JSON.parse(sourceText), 'artifact');
    const fittedComponents = record(
      artifact['fittedComponents'],
      'fittedComponents',
    );
    const platoon = record(fittedComponents['platoon'], 'platoon');
    platoon['candidateId'] = 'tampered-platoon-candidate';

    const tamperedPath = path.join(temporaryDirectory, 'tampered.json');
    await writeFile(tamperedPath, JSON.stringify(artifact), 'utf8');

    await assert.rejects(
      connectFrozenBatterHitsRuntimeArtifact(tamperedPath),
      /fittedComponents\.platoon\.candidateId must equal/u,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
