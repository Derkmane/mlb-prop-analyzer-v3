import { z } from 'zod';

import type {
  BaserunningEventCategory,
  TerminalPaCategory,
} from '../../../domain/terminal-pa.js';
import {
  normalizedTerminalPaSchema,
  rawBallDontLiePlateAppearanceSchema,
  type NormalizedTerminalPA,
  type RawBallDontLiePlateAppearance,
} from './contracts.js';

export const BALLDONTLIE_BATTER_DISPOSITIONS = ['reached', 'retired'] as const;

export type BallDontLieBatterDisposition =
  (typeof BALLDONTLIE_BATTER_DISPOSITIONS)[number];

export const ballDontLieTerminalPaMappingInputSchema = z
  .object({
    plateAppearance: rawBallDontLiePlateAppearanceSchema,
    providerGameId: z.number().int(),
    sourceSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
    batterDisposition: z.enum(BALLDONTLIE_BATTER_DISPOSITIONS).optional(),
  })
  .strict();

export type BallDontLieTerminalPaMappingInput = z.infer<
  typeof ballDontLieTerminalPaMappingInputSchema
>;

export const BALLDONTLIE_TERMINAL_PA_REJECTION_REASONS = [
  'malformed-input',
  'unknown-result',
  'context-required',
  'context-contradiction',
] as const;

export type BallDontLieTerminalPaRejectionReason =
  (typeof BALLDONTLIE_TERMINAL_PA_REJECTION_REASONS)[number];

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

interface DirectTerminalMapping {
  readonly terminalCategory: TerminalPaCategory;
  readonly batterDisposition: BallDontLieBatterDisposition;
}

const DIRECT_TERMINAL_MAPPINGS = {
  Strikeout: { terminalCategory: 'K', batterDisposition: 'retired' },
  Walk: { terminalCategory: 'UBB', batterDisposition: 'reached' },
  'Intent Walk': { terminalCategory: 'IBB', batterDisposition: 'reached' },
  'Hit By Pitch': { terminalCategory: 'HBP', batterDisposition: 'reached' },
  Single: { terminalCategory: '1B', batterDisposition: 'reached' },
  Double: { terminalCategory: '2B', batterDisposition: 'reached' },
  Triple: { terminalCategory: '3B', batterDisposition: 'reached' },
  'Home Run': { terminalCategory: 'HR', batterDisposition: 'reached' },
  'Field Error': { terminalCategory: 'ROE', batterDisposition: 'reached' },
  'Sac Fly': { terminalCategory: 'SF', batterDisposition: 'retired' },
  'Sac Bunt': { terminalCategory: 'SH', batterDisposition: 'retired' },
  Flyout: { terminalCategory: 'BIP_OUT', batterDisposition: 'retired' },
  Groundout: { terminalCategory: 'BIP_OUT', batterDisposition: 'retired' },
  Lineout: { terminalCategory: 'BIP_OUT', batterDisposition: 'retired' },
  'Pop Out': { terminalCategory: 'BIP_OUT', batterDisposition: 'retired' },
  'Bunt Groundout': {
    terminalCategory: 'BIP_OUT',
    batterDisposition: 'retired',
  },
  'Bunt Pop Out': {
    terminalCategory: 'BIP_OUT',
    batterDisposition: 'retired',
  },
  GIDP: { terminalCategory: 'BIP_OUT', batterDisposition: 'retired' },
  'Catcher Interference': {
    terminalCategory: 'CATCHER_INTERFERENCE',
    batterDisposition: 'reached',
  },
} as const satisfies Readonly<Record<string, DirectTerminalMapping>>;

const CONTEXTUAL_FC_RESULTS = new Set([
  'Fielders Choice',
  'Fielders Choice Out',
  'Forceout',
]);

const CONTEXTUAL_BIP_OUT_RESULTS = new Set(['Double Play', 'Triple Play']);

const NO_BASERUNNING_EVENTS: readonly BaserunningEventCategory[] = Object.freeze(
  [],
);
const CAUGHT_STEALING_EVENT: readonly BaserunningEventCategory[] = Object.freeze([
  'CS',
]);

function extractRawResult(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) {
    return null;
  }

  const plateAppearance = Reflect.get(input, 'plateAppearance');
  if (typeof plateAppearance !== 'object' || plateAppearance === null) {
    return null;
  }

  const result = Reflect.get(plateAppearance, 'result');
  return typeof result === 'string' ? result : null;
}

function reject(
  rawResult: string | null,
  reason: BallDontLieTerminalPaRejectionReason,
): BallDontLieRejectedTerminalPaResult {
  return { status: 'rejected', rawResult, reason };
}

function directMappingFor(rawResult: string): DirectTerminalMapping | undefined {
  if (!Object.hasOwn(DIRECT_TERMINAL_MAPPINGS, rawResult)) {
    return undefined;
  }

  return DIRECT_TERMINAL_MAPPINGS[
    rawResult as keyof typeof DIRECT_TERMINAL_MAPPINGS
  ];
}

function finalPitchDescription(
  plateAppearance: RawBallDontLiePlateAppearance,
): string | null {
  return plateAppearance.pitches.at(-1)?.description ?? null;
}

function normalizeTerminalPa(
  input: BallDontLieTerminalPaMappingInput,
  terminalCategory: TerminalPaCategory,
  baserunningEvents: readonly BaserunningEventCategory[],
): BallDontLieTerminalPaMappingResult {
  const normalized = normalizedTerminalPaSchema.safeParse({
    provider: 'balldontlie',
    providerGameId: input.providerGameId,
    providerBatterId: input.plateAppearance.batter_id,
    providerPitcherId: input.plateAppearance.pitcher_id,
    inning: input.plateAppearance.inning,
    halfInning: input.plateAppearance.half_inning,
    providerPaNumber: input.plateAppearance.pa_number,
    batterSide: input.plateAppearance.batter_side,
    pitcherHand: input.plateAppearance.pitcher_hand,
    rawResult: input.plateAppearance.result,
    terminalCategory,
    sourceSnapshotSha256: input.sourceSnapshotSha256,
  });

  if (!normalized.success) {
    return reject(input.plateAppearance.result, 'malformed-input');
  }

  return {
    status: 'normalized',
    terminalPa: normalized.data,
    baserunningEvents,
  };
}

function dispositionContradicts(
  supplied: BallDontLieBatterDisposition | undefined,
  expected: BallDontLieBatterDisposition,
): boolean {
  return supplied !== undefined && supplied !== expected;
}

export function normalizeBallDontLieTerminalPa(
  input: unknown,
): BallDontLieTerminalPaMappingResult {
  const parsed = ballDontLieTerminalPaMappingInputSchema.safeParse(input);
  if (!parsed.success) {
    return reject(extractRawResult(input), 'malformed-input');
  }

  const value = parsed.data;
  const rawResult = value.plateAppearance.result;

  if (rawResult === 'Caught Stealing 2B') {
    if (finalPitchDescription(value.plateAppearance) !== 'Ball') {
      return reject(rawResult, 'context-required');
    }

    return {
      status: 'baserunning-only',
      providerGameId: value.providerGameId,
      providerPaNumber: value.plateAppearance.pa_number,
      rawResult,
      sourceSnapshotSha256: value.sourceSnapshotSha256,
      baserunningEvents: CAUGHT_STEALING_EVENT,
    };
  }

  if (rawResult === 'Strikeout Double Play') {
    if (value.batterDisposition === 'reached') {
      return reject(rawResult, 'context-contradiction');
    }

    if (finalPitchDescription(value.plateAppearance) !== 'Swinging Strike') {
      return reject(rawResult, 'context-required');
    }

    return normalizeTerminalPa(value, 'K', CAUGHT_STEALING_EVENT);
  }

  const directMapping = directMappingFor(rawResult);
  if (directMapping !== undefined) {
    if (
      dispositionContradicts(
        value.batterDisposition,
        directMapping.batterDisposition,
      )
    ) {
      return reject(rawResult, 'context-contradiction');
    }

    return normalizeTerminalPa(
      value,
      directMapping.terminalCategory,
      NO_BASERUNNING_EVENTS,
    );
  }

  if (CONTEXTUAL_FC_RESULTS.has(rawResult)) {
    if (value.batterDisposition === undefined) {
      return reject(rawResult, 'context-required');
    }

    if (value.batterDisposition !== 'reached') {
      return reject(rawResult, 'context-contradiction');
    }

    return normalizeTerminalPa(value, 'FC', NO_BASERUNNING_EVENTS);
  }

  if (CONTEXTUAL_BIP_OUT_RESULTS.has(rawResult)) {
    if (value.batterDisposition === undefined) {
      return reject(rawResult, 'context-required');
    }

    if (value.batterDisposition !== 'retired') {
      return reject(rawResult, 'context-contradiction');
    }

    return normalizeTerminalPa(value, 'BIP_OUT', NO_BASERUNNING_EVENTS);
  }

  return reject(rawResult, 'unknown-result');
}
