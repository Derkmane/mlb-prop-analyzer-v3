import { z } from 'zod';

const timestampSchema = z.string().datetime({ offset: true });

export const rawOddsApiOutcomeSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    price: z.number().int().nullable().optional(),
    point: z.number().finite().nonnegative(),
    sid: z.unknown().optional(),
    multiplier: z.number().finite().positive().nullable().optional(),
  })
  .passthrough();

export const rawOddsApiMarketSchema = z
  .object({
    key: z.string().min(1),
    last_update: timestampSchema,
    sid: z.unknown().optional(),
    outcomes: z.array(rawOddsApiOutcomeSchema),
  })
  .passthrough();

export const rawOddsApiBookmakerSchema = z
  .object({
    key: z.string().min(1),
    title: z.string().min(1),
    sid: z.unknown().optional(),
    markets: z.array(rawOddsApiMarketSchema),
  })
  .passthrough();

export const rawOddsApiEventOddsSchema = z
  .object({
    id: z.string().min(1),
    sport_key: z.string().min(1),
    sport_title: z.string().min(1),
    commence_time: timestampSchema,
    home_team: z.string().min(1),
    away_team: z.string().min(1),
    bookmakers: z.array(rawOddsApiBookmakerSchema),
  })
  .passthrough();

export type RawOddsApiOutcome = z.infer<typeof rawOddsApiOutcomeSchema>;
export type RawOddsApiMarket = z.infer<typeof rawOddsApiMarketSchema>;
export type RawOddsApiBookmaker = z.infer<typeof rawOddsApiBookmakerSchema>;
export type RawOddsApiEventOdds = z.infer<typeof rawOddsApiEventOddsSchema>;
