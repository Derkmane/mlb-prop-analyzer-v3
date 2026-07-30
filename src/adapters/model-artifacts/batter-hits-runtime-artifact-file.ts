import { readFile } from 'node:fs/promises';

import {
  verifyFrozenBatterHitsRuntimeArtifact,
  type FrozenBatterHitsRuntimeArtifact,
} from '../../features/batter-hits/index.js';

export const DEFAULT_BATTER_HITS_RUNTIME_ARTIFACT_PATH =
  'model-artifacts/m8-batter-hits-runtime-freeze-v1.json' as const;

export async function loadFrozenBatterHitsRuntimeArtifactFromFile(
  artifactPath: string = DEFAULT_BATTER_HITS_RUNTIME_ARTIFACT_PATH,
): Promise<FrozenBatterHitsRuntimeArtifact> {
  if (artifactPath.trim().length === 0) {
    throw new TypeError('Batter Hits runtime artifact path must not be empty.');
  }

  const text = await readFile(artifactPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Batter Hits runtime artifact ${artifactPath} is not valid JSON.`);
  }

  return verifyFrozenBatterHitsRuntimeArtifact(parsed);
}
