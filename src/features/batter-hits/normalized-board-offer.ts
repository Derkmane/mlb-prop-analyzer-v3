import { z } from 'zod';

import { SELECTED_SIDES } from '../../domain/selected-side.js';
import { BATTER_HITS_MARKET_KEY } from './manifest.js';

export const BATTER_HITS_PROVIDER_MARKET_KEYS = [
  'batter_hits',
  'batter_hits_alternate',
] as const;

export const BATTER_HITS_OFFER_TYPES = ['baseline', 'alternate'] as const;
export const UNDERDOG_RAW_SELECTED_SIDES = ['Over', 'Under'] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.string().datetime({ offset: true });

export const batterHitsPlayerIdentitySchema = z
  .object({
    providerEventId: z.string().min(1),
    offerPlayerName: z.string().min(1),
    providerGameId: z.number().int().positive(),
    providerPlayerId: z.number().int().positive(),
    providerTeamId: z.number().int().positive(),
    playerName: z.string().min(1),
    teamName: z.string().min(1),
    batsThrows: z.string().min(1).optional(),
  })
  .strict();

export const normalizedBatterHitsBoardOfferSchema = z
  .object({
    provider: z.literal('the-odds-api'),
    providerBookmakerKey: z.literal('underdog'),
    providerEventId: z.string().min(1),
    providerGameId: z.number().int().positive(),
    providerPlayerId: z.number().int().positive(),
    providerTeamId: z.number().int().positive(),
    playerName: z.string().min(1),
    teamName: z.string().min(1),
    homeTeamName: z.string().min(1),
    awayTeamName: z.string().min(1),
    eventCommenceTime: timestampSchema,
    baseMarketKey: z.literal(BATTER_HITS_MARKET_KEY),
    providerMarketKey: z.enum(BATTER_HITS_PROVIDER_MARKET_KEYS),
    offerType: z.enum(BATTER_HITS_OFFER_TYPES),
    offerTypeReason: z.literal('NO_PLAYER_BASELINE').nullable(),
    selectedSide: z.enum(SELECTED_SIDES),
    rawSide: z.enum(UNDERDOG_RAW_SELECTED_SIDES),
    line: z.number().finite().nonnegative(),
    americanPrice: z.number().int(),
    multiplier: z.number().finite().positive(),
    marketLastUpdate: timestampSchema,
    providerOutcomeSid: z.null(),
    providerMarketSid: z.null(),
    providerBookmakerSid: z.null(),
    sourceCapturedAt: timestampSchema,
    sourceSnapshotSha256: sha256Schema,
  })
  .strict();

export type BatterHitsProviderMarketKey =
  (typeof BATTER_HITS_PROVIDER_MARKET_KEYS)[number];
export type BatterHitsOfferType = (typeof BATTER_HITS_OFFER_TYPES)[number];
export type UnderdogRawSelectedSide =
  (typeof UNDERDOG_RAW_SELECTED_SIDES)[number];
export type BatterHitsPlayerIdentity = z.infer<
  typeof batterHitsPlayerIdentitySchema
>;
export type NormalizedBatterHitsBoardOffer = z.infer<
  typeof normalizedBatterHitsBoardOfferSchema
>;
