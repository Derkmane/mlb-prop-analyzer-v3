import { z } from 'zod';

import { rawBallDontLieGamesResponseSchema } from './contracts.js';

export const BALLDONTLIE_FINAL_HITS_EVIDENCE_VERSION =
  'balldontlie-official-final-hits-evidence-v1' as const;
export const BALLDONTLIE_GAMES_ENDPOINT_PATH = '/mlb/v1/games' as const;
export const BALLDONTLIE_STATS_ENDPOINT_PATH = '/mlb/v1/stats' as const;

const positiveIntegerSchema = z.number().int().positive();
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const timestampSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const rawBallDontLiePlayerGameStatSchema = z
  .object({
    player: z
      .object({
        id: positiveIntegerSchema,
      })
      .passthrough(),
    game_id: positiveIntegerSchema,
    hits: nonNegativeIntegerSchema,
  })
  .passthrough();

export const rawBallDontLiePlayerGameStatsResponseSchema = z
  .object({
    data: z.array(rawBallDontLiePlayerGameStatSchema),
    meta: z
      .object({
        next_cursor: z.number().int().optional(),
        per_page: z.number().int(),
        prev_cursor: z.number().int().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type RawBallDontLiePlayerGameStat = z.infer<
  typeof rawBallDontLiePlayerGameStatSchema
>;
export type RawBallDontLiePlayerGameStatsResponse = z.infer<
  typeof rawBallDontLiePlayerGameStatsResponseSchema
>;

export interface BallDontLieRawSnapshotInputV1 {
  readonly snapshotId: string;
  readonly sha256: string;
  readonly capturedAt: string;
  readonly response: unknown;
}

export interface BallDontLieExpectedFinalHitsIdentityV1 {
  readonly providerGameId: number;
  readonly providerPlayerId: number;
}

export interface BallDontLieOfficialFinalHitsEvidenceV1 {
  readonly provider: 'balldontlie-mlb';
  readonly evidenceVersion: typeof BALLDONTLIE_FINAL_HITS_EVIDENCE_VERSION;
  readonly gamesEndpointPath: typeof BALLDONTLIE_GAMES_ENDPOINT_PATH;
  readonly statsEndpointPath: typeof BALLDONTLIE_STATS_ENDPOINT_PATH;
  readonly providerGameId: number;
  readonly providerPlayerId: number;
  readonly gameStatus: 'STATUS_FINAL';
  readonly officialHits: number;
  readonly gameSnapshotId: string;
  readonly gameSnapshotSha256: string;
  readonly gameCapturedAt: string;
  readonly statsSnapshotId: string;
  readonly statsSnapshotSha256: string;
  readonly statsCapturedAt: string;
}

function validateSnapshot(
  snapshot: BallDontLieRawSnapshotInputV1,
  label: string,
): void {
  if (snapshot.snapshotId.length === 0) {
    throw new TypeError(`${label} snapshotId must be nonempty.`);
  }
  sha256Schema.parse(snapshot.sha256);
  timestampSchema.parse(snapshot.capturedAt);
}

function identityKey(providerGameId: number, providerPlayerId: number): string {
  return `${providerGameId}:${providerPlayerId}`;
}

/**
 * Normalizes only exact final-game and per-game Hits evidence. It never joins
 * by player name and rejects absent, duplicate, non-final, or malformed rows.
 */
export function normalizeBallDontLieOfficialFinalHitsV1(input: Readonly<{
  gameSnapshot: BallDontLieRawSnapshotInputV1;
  statsSnapshot: BallDontLieRawSnapshotInputV1;
  expectedIdentities: readonly BallDontLieExpectedFinalHitsIdentityV1[];
}>): readonly BallDontLieOfficialFinalHitsEvidenceV1[] {
  validateSnapshot(input.gameSnapshot, 'game');
  validateSnapshot(input.statsSnapshot, 'stats');
  if (input.expectedIdentities.length === 0) {
    throw new Error('At least one expected final-Hits identity is required.');
  }
  const gameResponse = rawBallDontLieGamesResponseSchema.parse(
    input.gameSnapshot.response,
  );
  const statsResponse = rawBallDontLiePlayerGameStatsResponseSchema.parse(
    input.statsSnapshot.response,
  );
  const gamesById = new Map<number, (typeof gameResponse.data)[number]>();
  for (const game of gameResponse.data) {
    if (gamesById.has(game.id)) {
      throw new Error(`Duplicate BALLDONTLIE game row ${game.id}.`);
    }
    gamesById.set(game.id, game);
  }
  const statsByIdentity = new Map<
    string,
    RawBallDontLiePlayerGameStat[]
  >();
  for (const stat of statsResponse.data) {
    const key = identityKey(stat.game_id, stat.player.id);
    const rows = statsByIdentity.get(key) ?? [];
    rows.push(stat);
    statsByIdentity.set(key, rows);
  }
  const expectedKeys = new Set<string>();
  const evidence = input.expectedIdentities.map((identity) => {
    positiveIntegerSchema.parse(identity.providerGameId);
    positiveIntegerSchema.parse(identity.providerPlayerId);
    const key = identityKey(
      identity.providerGameId,
      identity.providerPlayerId,
    );
    if (expectedKeys.has(key)) {
      throw new Error(`Duplicate expected BALLDONTLIE identity ${key}.`);
    }
    expectedKeys.add(key);
    const game = gamesById.get(identity.providerGameId);
    if (game === undefined) {
      throw new Error(
        `Missing BALLDONTLIE game ${identity.providerGameId}.`,
      );
    }
    if (game.status !== 'STATUS_FINAL') {
      throw new Error(
        `BALLDONTLIE game ${identity.providerGameId} is not STATUS_FINAL.`,
      );
    }
    const rows = statsByIdentity.get(key) ?? [];
    if (rows.length !== 1) {
      throw new Error(
        `Expected exactly one BALLDONTLIE stats row for ${key}; received ${rows.length}.`,
      );
    }
    const stat = rows[0]!;
    return Object.freeze({
      provider: 'balldontlie-mlb' as const,
      evidenceVersion: BALLDONTLIE_FINAL_HITS_EVIDENCE_VERSION,
      gamesEndpointPath: BALLDONTLIE_GAMES_ENDPOINT_PATH,
      statsEndpointPath: BALLDONTLIE_STATS_ENDPOINT_PATH,
      providerGameId: identity.providerGameId,
      providerPlayerId: identity.providerPlayerId,
      gameStatus: 'STATUS_FINAL' as const,
      officialHits: stat.hits,
      gameSnapshotId: input.gameSnapshot.snapshotId,
      gameSnapshotSha256: input.gameSnapshot.sha256,
      gameCapturedAt: input.gameSnapshot.capturedAt,
      statsSnapshotId: input.statsSnapshot.snapshotId,
      statsSnapshotSha256: input.statsSnapshot.sha256,
      statsCapturedAt: input.statsSnapshot.capturedAt,
    });
  });
  return Object.freeze(evidence);
}
