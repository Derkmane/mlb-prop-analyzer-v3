import fs from 'node:fs';
import path from 'node:path';

import { loadFrozenBatterHitsProbabilityArtifactsFromFiles } from '../../src/adapters/index.js';
import {
  verifyM8_5GameOffensiveEnvironmentModelArtifactV1,
  type NormalizedBatterHitsBoardOffer,
  type ResolveM8_5GameOffensiveEnvironmentV1Input,
} from '../../src/features/batter-hits/index.js';

const GAME_ENVIRONMENT_MODEL_PATH = path.resolve(
  'model-artifacts/m8-5-game-offensive-environment-model-v1.json',
);

export async function m9FinalGameEnvironmentResolutionInput(
  offer: NormalizedBatterHitsBoardOffer,
): Promise<ResolveM8_5GameOffensiveEnvironmentV1Input> {
  const [artifacts, rawModel] = await Promise.all([
    loadFrozenBatterHitsProbabilityArtifactsFromFiles(),
    Promise.resolve(
      JSON.parse(fs.readFileSync(GAME_ENVIRONMENT_MODEL_PATH, 'utf8')) as unknown,
    ),
  ]);
  const model = verifyM8_5GameOffensiveEnvironmentModelArtifactV1(rawModel);
  return Object.freeze({
    gameId: String(offer.providerGameId),
    sourceSharedEnvironmentModelVersion:
      artifacts.sharedEnvironment.modelVersion,
    sourceSharedEnvironmentArtifactSha256:
      artifacts.sharedEnvironment.artifactSha256,
    scenarioIds: Object.freeze([...model.scenarioIds]),
    features: Object.freeze(
      Object.fromEntries(
        model.featureNormalization.map((row) => [
          row.featureName,
          row.mean,
        ]),
      ),
    ),
  });
}
