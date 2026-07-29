import type { BaserunningEventCategory } from '../../../domain/terminal-pa.js';
import {
  normalizedTerminalPaSchema,
  type NormalizedTerminalPA,
} from './contracts.js';
import {
  BALLDONTLIE_BATTER_DISPOSITIONS,
  BALLDONTLIE_TERMINAL_PA_UNRESOLVED_REASONS,
  ballDontLieTerminalPaMappingInputSchema,
  classifyBallDontLieTerminalPa,
  type BallDontLieBatterDisposition,
  type BallDontLieTerminalPaMappingInput,
  type BallDontLieTerminalPaUnresolvedReason,
} from './classify-terminal-pa.js';

export {
  BALLDONTLIE_BATTER_DISPOSITIONS,
  ballDontLieTerminalPaMappingInputSchema,
};
export type {
  BallDontLieBatterDisposition,
  BallDontLieTerminalPaMappingInput,
};

export const BALLDONTLIE_TERMINAL_PA_REJECTION_REASONS =
  BALLDONTLIE_TERMINAL_PA_UNRESOLVED_REASONS;

export type BallDontLieTerminalPaRejectionReason =
  BallDontLieTerminalPaUnresolvedReason;

export interface BallDontLieNormalizedTerminalPaResult {
  readonly status: 'normalized';
  readonly terminalPa: NormalizedTerminalPA;
  readonly baserunningEvents: readonly BaserunningEventCategory[];
}

export interface BallDontLieBaserunningOnlyResult {
  readonly status: 'baserunning-only';
  readonly providerGameId: number;
  readonly providerPaNumber: number;
  readonly rawResult: string;
  readonly sourceSnapshotSha256: string;
  readonly baserunningEvents: readonly BaserunningEventCategory[];
}

export interface BallDontLieRejectedTerminalPaResult {
  readonly status: 'rejected';
  readonly rawResult: string | null;
  readonly reason: BallDontLieTerminalPaRejectionReason;
}

export type BallDontLieTerminalPaMappingResult =
  | BallDontLieNormalizedTerminalPaResult
  | BallDontLieBaserunningOnlyResult
  | BallDontLieRejectedTerminalPaResult;

function reject(
  rawResult: string | null,
  reason: BallDontLieTerminalPaRejectionReason,
): BallDontLieRejectedTerminalPaResult {
  return { status: 'rejected', rawResult, reason };
}

export function normalizeBallDontLieTerminalPa(
  input: unknown,
): BallDontLieTerminalPaMappingResult {
  const classified = classifyBallDontLieTerminalPa(input);

  if (classified.status === 'unresolved') {
    return reject(classified.rawResult, classified.reason);
  }

  if (classified.status === 'baserunning-only') {
    return classified;
  }

  const terminalPa = classified.terminalPa;
  if (terminalPa.batterSide === null || terminalPa.pitcherHand === null) {
    return reject(terminalPa.rawResult, 'malformed-input');
  }

  const normalized = normalizedTerminalPaSchema.safeParse({
    provider: terminalPa.provider,
    providerGameId: terminalPa.providerGameId,
    providerBatterId: terminalPa.providerBatterId,
    providerPitcherId: terminalPa.providerPitcherId,
    inning: terminalPa.inning,
    halfInning: terminalPa.halfInning,
    providerPaNumber: terminalPa.providerPaNumber,
    batterSide: terminalPa.batterSide,
    pitcherHand: terminalPa.pitcherHand,
    rawResult: terminalPa.rawResult,
    terminalCategory: terminalPa.terminalCategory,
    sourceSnapshotSha256: terminalPa.sourceSnapshotSha256,
  });

  if (!normalized.success) {
    return reject(terminalPa.rawResult, 'malformed-input');
  }

  return {
    status: 'normalized',
    terminalPa: normalized.data,
    baserunningEvents: classified.baserunningEvents,
  };
}
