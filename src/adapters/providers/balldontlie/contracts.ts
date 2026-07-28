import { z } from 'zod';

import { TERMINAL_PA_CATEGORIES } from '../../../domain/terminal-pa.js';

const nonemptyStringSchema = z.string().min(1);
const integerSchema = z.number().int();

export const rawBallDontLiePitchSchema = z
  .object({
    description: z.string().nullable(),
    pitch_call_code: z.string().nullable(),
    pitch_type: z.string().nullable(),
    balls: integerSchema,
    strikes: integerSchema,
  })
  .passthrough();

export const rawBallDontLiePlateAppearanceSchema = z
  .object({
    batter_id: integerSchema,
    batter_side: nonemptyStringSchema,
    half_inning: nonemptyStringSchema,
    inning: integerSchema,
    is_ball_in_play_out: z.boolean(),
    outs: integerSchema,
    pa_number: integerSchema,
    pitcher_hand: nonemptyStringSchema,
    pitcher_id: integerSchema,
    pitches: z.array(rawBallDontLiePitchSchema),
    result: nonemptyStringSchema.nullable(),
    runner_on_first: z.boolean(),
    runner_on_second: z.boolean(),
    runner_on_third: z.boolean(),
  })
  .passthrough();

export const rawBallDontLiePlateAppearancesResponseSchema = z
  .object({
    data: z.array(rawBallDontLiePlateAppearanceSchema),
  })
  .passthrough();

export const rawBallDontLiePlaySchema = z
  .object({
    batter_id: integerSchema.nullable(),
    game_id: integerSchema,
    inning: integerSchema,
    inning_type: nonemptyStringSchema,
    order: integerSchema,
    outs: integerSchema,
    pitcher_id: integerSchema.nullable(),
    text: z.string().nullable(),
    type: nonemptyStringSchema,
  })
  .passthrough();

export const rawBallDontLiePaginationMetaSchema = z
  .object({
    next_cursor: integerSchema.optional(),
    per_page: integerSchema,
    prev_cursor: integerSchema.optional(),
  })
  .passthrough();

export const rawBallDontLiePlaysResponseSchema = z
  .object({
    data: z.array(rawBallDontLiePlaySchema),
    meta: rawBallDontLiePaginationMetaSchema,
  })
  .passthrough();

export const normalizedTerminalPaSchema = z
  .object({
    provider: z.literal('balldontlie'),
    providerGameId: integerSchema,
    providerBatterId: integerSchema,
    providerPitcherId: integerSchema,
    inning: integerSchema,
    halfInning: z.enum(['top', 'bottom']),
    providerPaNumber: integerSchema,
    batterSide: z.enum(['L', 'R']),
    pitcherHand: z.enum(['L', 'R']),
    rawResult: nonemptyStringSchema,
    terminalCategory: z.enum(TERMINAL_PA_CATEGORIES),
    sourceSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type RawBallDontLiePitch = z.infer<typeof rawBallDontLiePitchSchema>;
export type RawBallDontLiePlateAppearance = z.infer<
  typeof rawBallDontLiePlateAppearanceSchema
>;
export type RawBallDontLiePlateAppearancesResponse = z.infer<
  typeof rawBallDontLiePlateAppearancesResponseSchema
>;
export type RawBallDontLiePlay = z.infer<typeof rawBallDontLiePlaySchema>;
export type RawBallDontLiePlaysResponse = z.infer<
  typeof rawBallDontLiePlaysResponseSchema
>;
export type NormalizedTerminalPA = z.infer<typeof normalizedTerminalPaSchema>;
