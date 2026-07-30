import { z } from 'zod';

import type {
  GameLifecycleStatus,
  PregameGameState,
} from '../../../game/index.js';
import {
  rawBallDontLieGamesResponseSchema,
  type RawBallDontLieGame,
} from './contracts.js';

export const BALLDONTLIE_GAME_STATE_ERROR_CODES = [
  'INVALID_RAW_GAMES_SNAPSHOT',
  'INVALID_SOURCE_METADATA',
  'DUPLICATE_PROVIDER_GAME_ID',
] as const;

export type BallDontLieGameStateErrorCode =
  (typeof BALLDONTLIE_GAME_STATE_ERROR_CODES)[number];

export class BallDontLieGameStateError extends Error {
  readonly code: BallDontLieGameStateErrorCode;

  constructor(code: BallDontLieGameStateErrorCode, message: string) {
    super(message);
    this.name = 'BallDontLieGameStateError';
    this.code = code;
  }
}

export const BALLDONTLIE_GAME_REJECTION_REASONS = [
  'UNSUPPORTED_SEASON_CONTEXT',
  'UNSUPPORTED_GAME_STATUS',
] as const;

export type BallDontLieGameRejectionReason =
  (typeof BALLDONTLIE_GAME_REJECTION_REASONS)[number];

export interface NormalizedBallDontLieGameState extends PregameGameState {
  readonly provider: 'balldontlie';
  readonly providerGameId: number;
  readonly season: 2026;
  readonly seasonType: 'regular';
  readonly postseason: false;
  readonly homeTeamId: number;
  readonly awayTeamId: number;
  readonly homeTeamName: string;
  readonly awayTeamName: string;
  readonly rawStatus: 'STATUS_SCHEDULED' | 'STATUS_FINAL';
  readonly sourceCapturedAt: string;
  readonly sourceSnapshotSha256: string;
}

export interface RejectedBallDontLieGameState {
  readonly providerGameId: number;
  readonly rawStatus: string;
  readonly reason: BallDontLieGameRejectionReason;
}

export interface NormalizedBallDontLieGamesSnapshot {
  readonly provider: 'balldontlie';
  readonly sourceCapturedAt: string;
  readonly sourceSnapshotSha256: string;
  readonly games: readonly NormalizedBallDontLieGameState[];
  readonly rejectedGames: readonly RejectedBallDontLieGameState[];
}

export interface NormalizeBallDontLieGamesInput {
  readonly rawGamesSnapshot: unknown;
  readonly sourceCapturedAt: string;
  readonly sourceSnapshotSha256: string;
}

const sourceMetadataSchema = z
  .object({
    sourceCapturedAt: z.string().datetime({ offset: true }),
    sourceSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

function fail(code: BallDontLieGameStateErrorCode, message: string): never {
  throw new BallDontLieGameStateError(code, message);
}

function lifecycleStatus(
  rawStatus: string,
): GameLifecycleStatus | undefined {
  if (rawStatus === 'STATUS_SCHEDULED') return 'scheduled';
  if (rawStatus === 'STATUS_FINAL') return 'final';
  return undefined;
}

function reject(
  game: RawBallDontLieGame,
  reason: BallDontLieGameRejectionReason,
): RejectedBallDontLieGameState {
  return Object.freeze({
    providerGameId: game.id,
    rawStatus: game.status,
    reason,
  });
}

export function normalizeBallDontLieGamesSnapshot(
  input: NormalizeBallDontLieGamesInput,
): NormalizedBallDontLieGamesSnapshot {
  const parsedSnapshot = rawBallDontLieGamesResponseSchema.safeParse(
    input.rawGamesSnapshot,
  );
  if (!parsedSnapshot.success) {
    return fail(
      'INVALID_RAW_GAMES_SNAPSHOT',
      'The BALLDONTLIE games snapshot does not satisfy the fixture-backed raw contract.',
    );
  }

  const sourceMetadata = sourceMetadataSchema.safeParse({
    sourceCapturedAt: input.sourceCapturedAt,
    sourceSnapshotSha256: input.sourceSnapshotSha256,
  });
  if (!sourceMetadata.success) {
    return fail(
      'INVALID_SOURCE_METADATA',
      'The BALLDONTLIE games snapshot requires a valid capture timestamp and SHA-256.',
    );
  }

  const seenGameIds = new Set<number>();
  const games: NormalizedBallDontLieGameState[] = [];
  const rejectedGames: RejectedBallDontLieGameState[] = [];

  for (const game of parsedSnapshot.data.data) {
    if (seenGameIds.has(game.id)) {
      return fail(
        'DUPLICATE_PROVIDER_GAME_ID',
        `The BALLDONTLIE games snapshot contains duplicate game ID ${game.id}.`,
      );
    }
    seenGameIds.add(game.id);

    if (
      game.season !== 2026 ||
      game.season_type !== 'regular' ||
      game.postseason !== false
    ) {
      rejectedGames.push(reject(game, 'UNSUPPORTED_SEASON_CONTEXT'));
      continue;
    }

    const normalizedLifecycleStatus = lifecycleStatus(game.status);
    if (normalizedLifecycleStatus === undefined) {
      rejectedGames.push(reject(game, 'UNSUPPORTED_GAME_STATUS'));
      continue;
    }

    games.push(
      Object.freeze({
        provider: 'balldontlie',
        providerGameId: game.id,
        gameId: String(game.id),
        season: 2026,
        seasonType: 'regular',
        postseason: false,
        scheduledStartTime: game.date,
        lifecycleStatus: normalizedLifecycleStatus,
        homeTeamId: game.home_team.id,
        awayTeamId: game.away_team.id,
        homeTeamName: game.home_team_name,
        awayTeamName: game.away_team_name,
        rawStatus: game.status,
        sourceCapturedAt: sourceMetadata.data.sourceCapturedAt,
        sourceSnapshotSha256: sourceMetadata.data.sourceSnapshotSha256,
      }),
    );
  }

  return Object.freeze({
    provider: 'balldontlie',
    sourceCapturedAt: sourceMetadata.data.sourceCapturedAt,
    sourceSnapshotSha256: sourceMetadata.data.sourceSnapshotSha256,
    games: Object.freeze(games),
    rejectedGames: Object.freeze(rejectedGames),
  });
}
