import { readFile } from 'node:fs/promises';

import {
  verifyM8_5BatterHitsFactorArtifactV1,
  verifyM8_5BatterHitsSuccessorFreezeV1,
  verifyM8_5GameOffensiveEnvironmentModelArtifactV1,
  verifyM8_5ParkFactorArtifactV1,
  type M8_5BatterHitsFactorArtifactV1,
  type M8_5BatterHitsSuccessorFreezeV1,
  type M8_5GameOffensiveEnvironmentModelArtifactV1,
} from '../../features/batter-hits/index.js';
import { loadFrozenBatterHitsRuntimeArtifactFromFile } from './batter-hits-runtime-artifact-file.js';

export const DEFAULT_M8_5_BATTER_HITS_SUCCESSOR_FREEZE_PATH =
  'model-artifacts/m8-5-batter-hits-successor-freeze-v1.json' as const;
export const DEFAULT_M8_5_GAME_ENVIRONMENT_MODEL_PATH =
  'model-artifacts/m8-5-game-offensive-environment-model-v1.json' as const;
export const DEFAULT_M8_5_TEAM_BULLPEN_ARTIFACT_PATH =
  'model-artifacts/m8-5-team-bullpen-outcome-v1.json' as const;
export const DEFAULT_M8_5_TIMES_THROUGH_ORDER_ARTIFACT_PATH =
  'model-artifacts/m8-5-times-through-order-identity-v1.json' as const;
export const DEFAULT_M8_5_PARK_ARTIFACT_PATH =
  'model-artifacts/m8-5-park-transformation-v1.json' as const;
export const DEFAULT_M8_5_DEFENSE_ARTIFACT_PATH =
  'model-artifacts/m8-5-defense-to-batted-ball-identity-v1.json' as const;

export interface M8_5BatterHitsSuccessorArtifactPaths {
  readonly successorFreezePath?: string;
  readonly sourceM8RuntimeArtifactPath?: string;
  readonly gameEnvironmentModelPath?: string;
  readonly teamBullpenArtifactPath?: string;
  readonly timesThroughOrderArtifactPath?: string;
  readonly parkArtifactPath?: string;
  readonly defenseArtifactPath?: string;
}

export interface M8_5BatterHitsSuccessorArtifacts {
  readonly successorFreeze: M8_5BatterHitsSuccessorFreezeV1;
  readonly gameEnvironmentModelArtifact:
    Readonly<M8_5GameOffensiveEnvironmentModelArtifactV1>;
  readonly teamBullpenArtifact: M8_5BatterHitsFactorArtifactV1;
  readonly timesThroughOrderArtifact: M8_5BatterHitsFactorArtifactV1;
  readonly parkArtifact: ReturnType<typeof verifyM8_5ParkFactorArtifactV1>;
  readonly defenseArtifact: M8_5BatterHitsFactorArtifactV1;
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

export async function loadM8_5BatterHitsSuccessorArtifactsFromFiles(
  paths: M8_5BatterHitsSuccessorArtifactPaths = {},
): Promise<M8_5BatterHitsSuccessorArtifacts> {
  const successorFreezePath =
    paths.successorFreezePath ??
    DEFAULT_M8_5_BATTER_HITS_SUCCESSOR_FREEZE_PATH;
  const sourceM8RuntimeArtifactPath =
    paths.sourceM8RuntimeArtifactPath ??
    'model-artifacts/m8-batter-hits-runtime-freeze-v1.json';
  const gameEnvironmentModelPath =
    paths.gameEnvironmentModelPath ??
    DEFAULT_M8_5_GAME_ENVIRONMENT_MODEL_PATH;
  const teamBullpenArtifactPath =
    paths.teamBullpenArtifactPath ??
    DEFAULT_M8_5_TEAM_BULLPEN_ARTIFACT_PATH;
  const timesThroughOrderArtifactPath =
    paths.timesThroughOrderArtifactPath ??
    DEFAULT_M8_5_TIMES_THROUGH_ORDER_ARTIFACT_PATH;
  const parkArtifactPath =
    paths.parkArtifactPath ?? DEFAULT_M8_5_PARK_ARTIFACT_PATH;
  const defenseArtifactPath =
    paths.defenseArtifactPath ?? DEFAULT_M8_5_DEFENSE_ARTIFACT_PATH;

  const [
    rawSuccessorFreeze,
    sourceM8RuntimeArtifact,
    rawGameEnvironmentModelArtifact,
    rawTeamBullpenArtifact,
    rawTimesThroughOrderArtifact,
    rawParkArtifact,
    rawDefenseArtifact,
  ] = await Promise.all([
    readJson(successorFreezePath, 'M8.5 successor freeze'),
    loadFrozenBatterHitsRuntimeArtifactFromFile(sourceM8RuntimeArtifactPath),
    readJson(
      gameEnvironmentModelPath,
      'M8.5 game offensive-environment model artifact',
    ),
    readJson(teamBullpenArtifactPath, 'M8.5 team bullpen factor artifact'),
    readJson(
      timesThroughOrderArtifactPath,
      'M8.5 times-through-order factor artifact',
    ),
    readJson(parkArtifactPath, 'M8.5 park factor artifact'),
    readJson(defenseArtifactPath, 'M8.5 defense factor artifact'),
  ]);

  const gameEnvironmentModelArtifact =
    verifyM8_5GameOffensiveEnvironmentModelArtifactV1(
      rawGameEnvironmentModelArtifact,
    );
  const teamBullpenArtifact = verifyM8_5BatterHitsFactorArtifactV1(
    rawTeamBullpenArtifact,
  );
  const timesThroughOrderArtifact = verifyM8_5BatterHitsFactorArtifactV1(
    rawTimesThroughOrderArtifact,
  );
  const parkArtifact = verifyM8_5ParkFactorArtifactV1(rawParkArtifact);
  const defenseArtifact = verifyM8_5BatterHitsFactorArtifactV1(
    rawDefenseArtifact,
  );
  const successorFreeze = verifyM8_5BatterHitsSuccessorFreezeV1(
    rawSuccessorFreeze,
    {
      sourceM8RuntimeArtifact,
      gameSpecificOffensiveEnvironmentArtifact:
        gameEnvironmentModelArtifact,
      teamSpecificBullpenArtifact: teamBullpenArtifact,
      timesThroughOrderArtifact,
      parkArtifact,
      defenseToBattedBallArtifact: defenseArtifact,
    },
  );

  return Object.freeze({
    successorFreeze,
    gameEnvironmentModelArtifact,
    teamBullpenArtifact,
    timesThroughOrderArtifact,
    parkArtifact,
    defenseArtifact,
  });
}
