import { z } from 'zod';

const nonemptyStringSchema = z.string().min(1);
const timestampSchema = z.string().datetime({ offset: true });

export const rawOddsApiOutcomeSchema = z
  .object({
    name: nonemptyStringSchema,
    description: nonemptyStringSchema,
    price: z.number().int(),
    point: z.number().finite().nonnegative(),
    sid: z.unknown(),
    multiplier: z.number().finite().positive(),
  })
  .passthrough();

export const rawOddsApiMarketSchema = z
  .object({
    key: nonemptyStringSchema,
    last_update: timestampSchema,
    sid: z.unknown(),
    outcomes: z.array(rawOddsApiOutcomeSchema),
  })
  .passthrough();

export const rawOddsApiBookmakerSchema = z
  .object({
    key: nonemptyStringSchema,
    title: nonemptyStringSchema,
    sid: z.unknown(),
    markets: z.array(rawOddsApiMarketSchema),
  })
  .passthrough();

export const rawOddsApiEventOddsSchema = z
  .object({
    id: nonemptyStringSchema,
    sport_key: nonemptyStringSchema,
    sport_title: nonemptyStringSchema,
    commence_time: timestampSchema,
    home_team: nonemptyStringSchema,
    away_team: nonemptyStringSchema,
    bookmakers: z.array(rawOddsApiBookmakerSchema),
  })
  .passthrough();

export type RawOddsApiOutcome = z.infer<typeof rawOddsApiOutcomeSchema>;
export type RawOddsApiMarket = z.infer<typeof rawOddsApiMarketSchema>;
export type RawOddsApiBookmaker = z.infer<typeof rawOddsApiBookmakerSchema>;
export type RawOddsApiEventOdds = z.infer<typeof rawOddsApiEventOddsSchema>;
