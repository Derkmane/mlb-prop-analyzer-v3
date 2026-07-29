import { z } from 'zod';

import type {
  BaserunningEventCategory,
  TerminalPaCategory,
} from '../../../domain/terminal-pa.js';
import {
  rawBallDontLiePlateAppearanceSchema,
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

export const BALLDONTLIE_TERMINAL_PA_UNRESOLVED_REASONS = [
  'malformed-input',
  'missing-result',
  'unknown-result',
  'context-required',
  'context-contradiction',
] as const;

export type BallDontLieTerminalPaUnresolvedReason =
  (typeof BALLDONTLIE_TERMINAL_PA_UNRESOLVED_REASONS)[number];

type NormalizedHandedness = 'L' | 'R' | null;

export interface BallDontLieClassifiedTerminalPa {
  readonly provider: 'balldontlie';
  readonly providerGameId: number;
  readonly providerBatterId: number;
  readonly providerPitcherId: number;
  readonly inning: number;
  readonly halfInning: string;
  readonly providerPaNumber: number;
  readonly rawBatterSide: string;
  readonly batterSide: NormalizedHandedness;
  readonly rawPitcherHand: string;
  readonly pitcherHand: NormalizedHandedness;
  readonly rawResult: string;
  readonly terminalCategory: TerminalPaCategory;
  readonly sourceSnapshotSha256: string;
}

export interface BallDontLieClassifiedTerminalResult {
  readonly status: 'classified-terminal';
  readonly terminalPa: BallDontLieClassifiedTerminalPa;
  readonly overallOutcomeEligible: true;
  readonly platoonEligible: boolean;
  readonly baserunningEvents: readonly BaserunningEventCategory[];
}

export interface BallDontLieClassifiedBaserunningOnlyResult {
  readonly status: 'baserunning-only';
  readonly providerGameId: number;
  readonly providerPaNumber: number;
  readonly rawResult: string;
  readonly sourceSnapshotSha256: string;
  readonly baserunningEvents: readonly BaserunningEventCategory[];
}

export interface BallDontLieUnresolvedTerminalPaResult {
  readonly status: 'unresolved';
  readonly rawResult: string | null;
  readonly reason: BallDontLieTerminalPaUnresolvedReason;
}

export type BallDontLieTerminalPaClassificationResult =
  | BallDontLieClassifiedTerminalResult
  | BallDontLieClassifiedBaserunningOnlyResult
  | BallDontLieUnresolvedTerminalPaResult;

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

function unresolved(
  rawResult: string | null,
  reason: BallDontLieTerminalPaUnresolvedReason,
): BallDontLieUnresolvedTerminalPaResult {
  return { status: 'unresolved', rawResult, reason };
}

function normalizeHandedness(value: string): NormalizedHandedness {
  return value === 'L' || value === 'R' ? value : null;
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

function dispositionContradicts(
  supplied: BallDontLieBatterDisposition | undefined,
  expected: BallDontLieBatterDisposition,
): boolean {
  return supplied !== undefined && supplied !== expected;
}

function classifiedTerminal(
  input: BallDontLieTerminalPaMappingInput,
  terminalCategory: TerminalPaCategory,
  baserunningEvents: readonly BaserunningEventCategory[],
): BallDontLieClassifiedTerminalResult {
  const rawResult = input.plateAppearance.result;
  if (rawResult === null) {
    throw new Error('classifiedTerminal requires a non-null terminal result.');
  }
  const batterSide = normalizeHandedness(input.plateAppearance.batter_side);
  const pitcherHand = normalizeHandedness(input.plateAppearance.pitcher_hand);

  return {
    status: 'classified-terminal',
    terminalPa: {
      provider: 'balldontlie',
      providerGameId: input.providerGameId,
      providerBatterId: input.plateAppearance.batter_id,
      providerPitcherId: input.plateAppearance.pitcher_id,
      inning: input.plateAppearance.inning,
      halfInning: input.plateAppearance.half_inning,
      providerPaNumber: input.plateAppearance.pa_number,
      rawBatterSide: input.plateAppearance.batter_side,
      batterSide,
      rawPitcherHand: input.plateAppearance.pitcher_hand,
      pitcherHand,
      rawResult,
      terminalCategory,
      sourceSnapshotSha256: input.sourceSnapshotSha256,
    },
    overallOutcomeEligible: true,
    platoonEligible: batterSide !== null && pitcherHand !== null,
    baserunningEvents,
  };
}

export function classifyBallDontLieTerminalPa(
  input: unknown,
): BallDontLieTerminalPaClassificationResult {
  const parsed = ballDontLieTerminalPaMappingInputSchema.safeParse(input);
  if (!parsed.success) {
    return unresolved(extractRawResult(input), 'malformed-input');
  }

  const value = parsed.data;
  const rawResult = value.plateAppearance.result;
  if (rawResult === null) {
    return unresolved(null, 'missing-result');
  }

  if (rawResult === 'Caught Stealing 2B') {
    if (finalPitchDescription(value.plateAppearance) !== 'Ball') {
      return unresolved(rawResult, 'context-required');
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
      return unresolved(rawResult, 'context-contradiction');
    }
    if (finalPitchDescription(value.plateAppearance) !== 'Swinging Strike') {
      return unresolved(rawResult, 'context-required');
    }
    return classifiedTerminal(value, 'K', CAUGHT_STEALING_EVENT);
  }

  const directMapping = directMappingFor(rawResult);
  if (directMapping !== undefined) {
    if (
      dispositionContradicts(
        value.batterDisposition,
        directMapping.batterDisposition,
      )
    ) {
      return unresolved(rawResult, 'context-contradiction');
    }
    return classifiedTerminal(
      value,
      directMapping.terminalCategory,
      NO_BASERUNNING_EVENTS,
    );
  }

  if (CONTEXTUAL_FC_RESULTS.has(rawResult)) {
    if (value.batterDisposition === undefined) {
      return unresolved(rawResult, 'context-required');
    }
    if (value.batterDisposition !== 'reached') {
      return unresolved(rawResult, 'context-contradiction');
    }
    return classifiedTerminal(value, 'FC', NO_BASERUNNING_EVENTS);
  }

  if (CONTEXTUAL_BIP_OUT_RESULTS.has(rawResult)) {
    if (value.batterDisposition === undefined) {
      return unresolved(rawResult, 'context-required');
    }
    if (value.batterDisposition !== 'retired') {
      return unresolved(rawResult, 'context-contradiction');
    }
    return classifiedTerminal(value, 'BIP_OUT', NO_BASERUNNING_EVENTS);
  }

  return unresolved(rawResult, 'unknown-result');
}
