export const GAME_LIFECYCLE_STATUSES = ['scheduled', 'final'] as const;

export type GameLifecycleStatus = (typeof GAME_LIFECYCLE_STATUSES)[number];

export const PREGAME_GAME_INELIGIBILITY_REASONS = [
  'GAME_STATUS_NOT_SCHEDULED',
  'GAME_START_REACHED',
] as const;

export type PregameGameIneligibilityReason =
  (typeof PREGAME_GAME_INELIGIBILITY_REASONS)[number];

export interface PregameGameState {
  readonly gameId: string;
  readonly scheduledStartTime: string;
  readonly lifecycleStatus: GameLifecycleStatus;
}

export interface PregameGameEligibilityInput {
  readonly game: PregameGameState;
  readonly eventCommenceTime: string;
  readonly asOf: string;
}

export interface EligiblePregameGameDecision {
  readonly eligible: true;
  readonly cutoffTime: string;
}

export interface IneligiblePregameGameDecision {
  readonly eligible: false;
  readonly reason: PregameGameIneligibilityReason;
  readonly cutoffTime: string;
}

export type PregameGameEligibilityDecision =
  | EligiblePregameGameDecision
  | IneligiblePregameGameDecision;

export class InvalidPregameTimestampError extends Error {
  constructor(label: string, value: string) {
    super(`${label} must be a valid explicit timestamp; received ${value}.`);
    this.name = 'InvalidPregameTimestampError';
  }
}

function timestampMillis(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new InvalidPregameTimestampError(label, value);
  }
  return parsed;
}

function earlierTimestamp(
  left: string,
  leftMillis: number,
  right: string,
  rightMillis: number,
): string {
  return leftMillis <= rightMillis ? left : right;
}

/**
 * A game is pregame only while the approved game source still reports it as
 * scheduled and the evaluation clock is strictly before both preserved
 * provider start timestamps. Using the earlier timestamp is conservative and
 * prevents a one-provider delay or stale scheduled status from admitting a
 * started game.
 */
export function evaluatePregameGameEligibility(
  input: PregameGameEligibilityInput,
): PregameGameEligibilityDecision {
  const gameStartMillis = timestampMillis(
    input.game.scheduledStartTime,
    'game scheduledStartTime',
  );
  const eventStartMillis = timestampMillis(
    input.eventCommenceTime,
    'event commence time',
  );
  const asOfMillis = timestampMillis(input.asOf, 'pregame evaluation time');
  const cutoffTime = earlierTimestamp(
    input.game.scheduledStartTime,
    gameStartMillis,
    input.eventCommenceTime,
    eventStartMillis,
  );

  if (input.game.lifecycleStatus !== 'scheduled') {
    return Object.freeze({
      eligible: false,
      reason: 'GAME_STATUS_NOT_SCHEDULED',
      cutoffTime,
    });
  }

  if (asOfMillis >= Math.min(gameStartMillis, eventStartMillis)) {
    return Object.freeze({
      eligible: false,
      reason: 'GAME_START_REACHED',
      cutoffTime,
    });
  }

  return Object.freeze({ eligible: true, cutoffTime });
}
