import { readFile } from 'node:fs/promises';

import {
  verifyFrozenBatterHitsProbabilityArtifacts,
  type FrozenBatterHitsProbabilityArtifacts,
  type FrozenCompleteBatterHitsCandidate,
  type FrozenSharedOffensiveEnvironmentArtifact,
  type FrozenStarterRetentionArtifact,
  type FrozenTerminalPaOutcomeArtifact,
} from '../../features/batter-hits/index.js';
import { loadFrozenBatterHitsRuntimeArtifactFromFile } from './batter-hits-runtime-artifact-file.js';

export const DEFAULT_BATTER_HITS_COMPLETE_CANDIDATE_PATH =
  'model-artifacts/m8-batter-hits-complete-candidate-v1.json' as const;
export const DEFAULT_BATTER_HITS_SHARED_ENVIRONMENT_PATH =
  'model-artifacts/m8-shared-offensive-environment-v2.json' as const;
export const DEFAULT_BATTER_HITS_STARTER_RETENTION_PATH =
  'model-artifacts/m8-starter-retention-v1.json' as const;
export const DEFAULT_BATTER_HITS_TERMINAL_OUTCOME_PATH =
  'model-artifacts/m8-terminal-pa-outcome-v1.json' as const;

export interface BatterHitsProbabilityArtifactPaths {
  readonly runtimeManifestPath?: string;
  readonly completeCandidatePath?: string;
  readonly sharedEnvironmentPath?: string;
  readonly starterRetentionPath?: string;
  readonly terminalOutcomePath?: string;
}

async function readJson(filePath: string, label: string): Promise<unknown> {
  if (filePath.trim().length === 0) {
    throw new TypeError(`${label} path must not be empty.`);
  }
  const text = await readFile(filePath, 'utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} ${filePath} is not valid JSON.`);
  }
}

export async function loadFrozenBatterHitsProbabilityArtifactsFromFiles(
  paths: BatterHitsProbabilityArtifactPaths = {},
): Promise<FrozenBatterHitsProbabilityArtifacts> {
  const runtimeManifestPath =
    paths.runtimeManifestPath ??
    'model-artifacts/m8-batter-hits-runtime-freeze-v1.json';
  const completeCandidatePath =
    paths.completeCandidatePath ?? DEFAULT_BATTER_HITS_COMPLETE_CANDIDATE_PATH;
  const sharedEnvironmentPath =
    paths.sharedEnvironmentPath ?? DEFAULT_BATTER_HITS_SHARED_ENVIRONMENT_PATH;
  const starterRetentionPath =
    paths.starterRetentionPath ?? DEFAULT_BATTER_HITS_STARTER_RETENTION_PATH;
  const terminalOutcomePath =
    paths.terminalOutcomePath ?? DEFAULT_BATTER_HITS_TERMINAL_OUTCOME_PATH;

  const [runtimeManifest, completeCandidate, sharedEnvironment, starterRetention, terminalOutcome] =
    await Promise.all([
      loadFrozenBatterHitsRuntimeArtifactFromFile(runtimeManifestPath),
      readJson(completeCandidatePath, 'Batter Hits complete candidate'),
      readJson(sharedEnvironmentPath, 'Batter Hits shared environment artifact'),
      readJson(starterRetentionPath, 'Batter Hits starter retention artifact'),
      readJson(terminalOutcomePath, 'Batter Hits terminal outcome artifact'),
    ]);

  return verifyFrozenBatterHitsProbabilityArtifacts({
    runtimeManifest,
    completeCandidate:
      completeCandidate as FrozenCompleteBatterHitsCandidate,
    sharedEnvironment:
      sharedEnvironment as FrozenSharedOffensiveEnvironmentArtifact,
    starterRetention: starterRetention as FrozenStarterRetentionArtifact,
    terminalOutcome: terminalOutcome as FrozenTerminalPaOutcomeArtifact,
  });
}
