import {
  normalizeBallDontLieGamesSnapshot,
  normalizeOddsApiBatterHitsBoard,
  type NormalizeBallDontLieGamesInput,
  type NormalizedBallDontLieGameState,
  type NormalizedOddsApiBatterHitsBoard,
  type OddsApiBatterHitsBoardInput,
  type RejectedBallDontLieGameState,
} from '../adapters/index.js';
import type { NormalizedBatterHitsBoardOffer } from '../features/batter-hits/index.js';
import {
  evaluatePregameGameEligibility,
  type PregameGameIneligibilityReason,
} from '../game/index.js';

/**
 * Connects a captured The Odds API event snapshot to the strict normalized
 * Batter Hits board boundary. This step preserves offer identity only; it does
 * not build probabilities, authorize predictions, or rank props.
 */
export function connectNormalizedBatterHitsBoard(
  input: OddsApiBatterHitsBoardInput,
): NormalizedOddsApiBatterHitsBoard {
  return normalizeOddsApiBatterHitsBoard(input);
}

export const BATTER_HITS_PREGAME_EXCLUSION_REASONS = [
  'GAME_STATE_UNRESOLVED',
  'GAME_STATUS_NOT_SCHEDULED',
  'GAME_START_REACHED',
] as const;

export type BatterHitsPregameExclusionReason =
  (typeof BATTER_HITS_PREGAME_EXCLUSION_REASONS)[number];

export interface ExcludedPregameBatterHitsOffer {
  readonly offer: NormalizedBatterHitsBoardOffer;
  readonly reason: BatterHitsPregameExclusionReason;
  readonly rawGameStatus?: string;
  readonly cutoffTime?: string;
}

export interface ConnectPregameBatterHitsBoardInput
  extends OddsApiBatterHitsBoardInput,
    NormalizeBallDontLieGamesInput {
  readonly asOf: string;
}

export interface PregameNormalizedBatterHitsBoard
  extends NormalizedOddsApiBatterHitsBoard {
  readonly asOf: string;
  readonly gameSourceCapturedAt: string;
  readonly gameSourceSnapshotSha256: string;
  readonly excludedOffers: readonly ExcludedPregameBatterHitsOffer[];
}

function indexGames(
  games: readonly NormalizedBallDontLieGameState[],
): ReadonlyMap<number, NormalizedBallDontLieGameState> {
  return new Map(games.map((game) => [game.providerGameId, game]));
}

function indexRejectedGames(
  games: readonly RejectedBallDontLieGameState[],
): ReadonlyMap<number, RejectedBallDontLieGameState> {
  return new Map(games.map((game) => [game.providerGameId, game]));
}

function unresolvedExclusion(
  offer: NormalizedBatterHitsBoardOffer,
  rejectedGame: RejectedBallDontLieGameState | undefined,
): ExcludedPregameBatterHitsOffer {
  return Object.freeze({
    offer,
    reason: 'GAME_STATE_UNRESOLVED',
    ...(rejectedGame === undefined
      ? {}
      : { rawGameStatus: rejectedGame.rawStatus }),
  });
}

function decisionExclusion(
  offer: NormalizedBatterHitsBoardOffer,
  game: NormalizedBallDontLieGameState,
  reason: PregameGameIneligibilityReason,
  cutoffTime: string,
): ExcludedPregameBatterHitsOffer {
  return Object.freeze({
    offer,
    reason,
    rawGameStatus: game.rawStatus,
    cutoffTime,
  });
}

/**
 * Produces only offers that are still safely pregame at the supplied evaluation
 * time. The exact normalized offer object survives unchanged; this gate adds no
 * probability, settlement, ranking, or category behavior.
 */
export function connectPregameBatterHitsBoard(
  input: ConnectPregameBatterHitsBoardInput,
): PregameNormalizedBatterHitsBoard {
  const board = normalizeOddsApiBatterHitsBoard(input);
  const gameSnapshot = normalizeBallDontLieGamesSnapshot(input);
  const gamesById = indexGames(gameSnapshot.games);
  const rejectedGamesById = indexRejectedGames(gameSnapshot.rejectedGames);
  const offers: NormalizedBatterHitsBoardOffer[] = [];
  const excludedOffers: ExcludedPregameBatterHitsOffer[] = [];

  for (const offer of board.offers) {
    const game = gamesById.get(offer.providerGameId);
    if (game === undefined) {
      excludedOffers.push(
        unresolvedExclusion(
          offer,
          rejectedGamesById.get(offer.providerGameId),
        ),
      );
      continue;
    }

    const decision = evaluatePregameGameEligibility({
      game,
      eventCommenceTime: offer.eventCommenceTime,
      asOf: input.asOf,
    });

    if (decision.eligible) {
      offers.push(offer);
      continue;
    }

    excludedOffers.push(
      decisionExclusion(
        offer,
        game,
        decision.reason,
        decision.cutoffTime,
      ),
    );
  }

  return Object.freeze({
    ...board,
    asOf: input.asOf,
    gameSourceCapturedAt: gameSnapshot.sourceCapturedAt,
    gameSourceSnapshotSha256: gameSnapshot.sourceSnapshotSha256,
    offers: Object.freeze(offers),
    excludedOffers: Object.freeze(excludedOffers),
  });
}
