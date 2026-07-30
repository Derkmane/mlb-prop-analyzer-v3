import {
  DEFAULT_BATTER_HITS_RUNTIME_ARTIFACT_PATH,
  loadFrozenBatterHitsRuntimeArtifactFromFile,
} from '../adapters/index.js';
import type { FrozenBatterHitsRuntimeArtifact } from '../features/batter-hits/index.js';

export interface BatterHitsRuntimeConnection {
  readonly artifactPath: string;
  readonly artifact: FrozenBatterHitsRuntimeArtifact;
  readonly productionEnabled: false;
}

export async function connectFrozenBatterHitsRuntimeArtifact(
  artifactPath: string = DEFAULT_BATTER_HITS_RUNTIME_ARTIFACT_PATH,
): Promise<BatterHitsRuntimeConnection> {
  const artifact = await loadFrozenBatterHitsRuntimeArtifactFromFile(artifactPath);

  return Object.freeze({
    artifactPath,
    artifact,
    productionEnabled: artifact.productionEnabled,
  });
}
