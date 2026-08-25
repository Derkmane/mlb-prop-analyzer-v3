import { z } from 'zod';

import type {
  ActiveBoardSource,
  BoardSource,
} from '../../../domain/board-source.js';
import {
  BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
  BATTER_HITS_MARKET_KEY,
  BATTER_HITS_PROVIDER_MARKET_KEYS,
  BATTER_HITS_SETTLEMENT_RULE_VERSION,
  batterHitsPlayerIdentitySchema,
  normalizedBatterHitsBoardOfferSchema,
  type BatterHitsOfferType,
  type BatterHitsPlayerIdentity,
  type BatterHitsProviderMarketKey,
  type NormalizedBatterHitsBoardOffer,
} from '../../../features/batter-hits/index.js';
import {
  rawOddsApiEventOddsSchema,
  type RawOddsApiMarket,
  type RawOddsApiOutcome,
} from './contracts.js';

export const ODDS_API_BATTER_HITS_BOARD_ERROR_CODES = [
  'INVALID_RAW_EVENT_SNAPSHOT',
  'INVALID_SOURCE_METADATA',
  'INVALID_PLAYER_IDENTITY_INPUT',
  'INVALID_BOARD_SOURCE',
  'UNEXPECTED_SPORT',
  'AMBIGUOUS_ACTIVE_BOOKMAKER',
  'DUPLICATE_TARGET_MARKET',
  'DUPLICATE_SNAPSHOT_OFFER_TUPLE',
  'UNSUPPORTED_SELECTED_SIDE',
  'UNSUPPORTED_SOURCE_ID_CONTRACT',
] as const;
export type OddsApiBatterHitsBoardErrorCode =
  (typeof ODDS_API_BATTER_HITS_BOARD_ERROR_CODES)[number];
export class OddsApiBatterHitsBoardError extends Error {
  readonly code: OddsApiBatterHitsBoardErrorCode;
  constructor(code: OddsApiBatterHitsBoardErrorCode, message: string) {
    super(message);
    this.name = 'OddsApiBatterHitsBoardError';
    this.code = code;
  }
}

export interface OddsApiBatterHitsBoardInput {
  readonly boardSource?: ActiveBoardSource | undefined;
  readonly rawEventSnapshot: unknown;
  readonly sourceSnapshotSha256: string;
  readonly sourceCapturedAt: string;
  readonly playerIdentities: readonly unknown[];
}
export interface RejectedOddsApiBatterHitsOffer {
  readonly boardSource: BoardSource;
  readonly providerEventId: string;
  readonly providerMarketKey: BatterHitsProviderMarketKey;
  readonly playerDescription: string;
  readonly rawSide: string;
  readonly line: number;
  readonly reason: 'PLAYER_IDENTITY_UNRESOLVED';
  readonly matchCount: number;
}
export interface NormalizedOddsApiBatterHitsBoard {
  readonly provider: 'the-odds-api';
  readonly boardSource: BoardSource;
  readonly providerBookmakerKey: 'pick6' | 'draftkings' | 'underdog';
  readonly providerRegion: 'us_dfs' | 'us';
  readonly settlementRuleVersion: string | null;
  readonly providerEventId: string;
  readonly sourceSnapshotSha256: string;
  readonly sourceCapturedAt: string;
  readonly offers: readonly NormalizedBatterHitsBoardOffer[];
  readonly rejectedOffers: readonly RejectedOddsApiBatterHitsOffer[];
}
interface BoardSourceContract {
  readonly boardSource: BoardSource;
  readonly bookmaker: 'pick6' | 'draftkings' | 'underdog';
  readonly region: 'us_dfs' | 'us';
  readonly settlementRuleVersion: string | null;
}
const ACTIVE_SOURCE_CONTRACT = Object.freeze({
  pick6: Object.freeze({ boardSource: 'pick6' as const, bookmaker: 'pick6' as const, region: 'us_dfs' as const, settlementRuleVersion: null }),
  draftkings: Object.freeze({ boardSource: 'draftkings' as const, bookmaker: 'draftkings' as const, region: 'us' as const, settlementRuleVersion: BATTER_HITS_DRAFTKINGS_SETTLEMENT_RULE_VERSION }),
});
const HISTORICAL_UNDERDOG_CONTRACT = Object.freeze({ boardSource: null, bookmaker: 'underdog' as const, region: 'us_dfs' as const, settlementRuleVersion: BATTER_HITS_SETTLEMENT_RULE_VERSION });
const sourceMetadataSchema = z.object({
  sourceSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceCapturedAt: z.string().datetime({ offset: true }),
}).strict();
const historicalStandardBookEventSchema = z.object({
  bookmakers: z.array(z.object({
    markets: z.array(z.object({
      key: z.string().min(1),
      outcomes: z.array(z.object({ description: z.string().min(1), point: z.number().finite().nonnegative() }).passthrough()),
    }).passthrough()),
  }).passthrough()),
}).passthrough();

function fail(code: OddsApiBatterHitsBoardErrorCode, message: string): never {
  throw new OddsApiBatterHitsBoardError(code, message);
}
function sourceContract(boardSource: ActiveBoardSource | undefined): BoardSourceContract {
  if (boardSource === undefined) return HISTORICAL_UNDERDOG_CONTRACT;
  const contract = ACTIVE_SOURCE_CONTRACT[boardSource];
  if (contract === undefined) return fail('INVALID_BOARD_SOURCE', `Unsupported Batter Hits board source: ${String(boardSource)}`);
  return contract;
}
function isTargetMarketKey(value: string): value is BatterHitsProviderMarketKey {
  return BATTER_HITS_PROVIDER_MARKET_KEYS.includes(value as BatterHitsProviderMarketKey);
}
function offerTypeForMarketKey(marketKey: BatterHitsProviderMarketKey): BatterHitsOfferType {
  return marketKey === BATTER_HITS_PROVIDER_MARKET_KEYS[0] ? 'baseline' : 'alternate';
}
/** Historical compatibility helper only. Active Pick6/DraftKings code must not call it. */
export function deriveStandardBookBaselineLines(
  rawEventSnapshot: unknown,
  marketKey: 'batter_hits' | 'batter_hits_runs_rbis',
): ReadonlyMap<string, number> {
  const event = historicalStandardBookEventSchema.parse(rawEventSnapshot);
  const counts = new Map<string, Map<number, number>>();
  for (const bookmaker of event.bookmakers) {
    const pointsByPlayer = new Map<string, Set<number>>();
    for (const market of bookmaker.markets.filter((entry) => entry.key === marketKey)) {
      for (const outcome of market.outcomes) {
        const points = pointsByPlayer.get(outcome.description) ?? new Set<number>();
        points.add(outcome.point);
        pointsByPlayer.set(outcome.description, points);
      }
    }
    for (const [player, points] of pointsByPlayer) {
      for (const point of points) {
        const playerCounts = counts.get(player) ?? new Map<number, number>();
        playerCounts.set(point, (playerCounts.get(point) ?? 0) + 1);
        counts.set(player, playerCounts);
      }
    }
  }
  const baselines = new Map<string, number>();
  for (const [player, playerCounts] of counts) {
    const sorted = [...playerCounts].sort((left, right) => right[1] - left[1]);
    if (sorted[0] !== undefined && sorted[0][1] > (sorted[1]?.[1] ?? 0)) baselines.set(player, sorted[0][0]);
  }
  return baselines;
}
function selectedSideForRawSide(rawSide: string): 'higher' | 'lower' {
  if (rawSide === 'Over') return 'higher';
  if (rawSide === 'Under') return 'lower';
  return fail('UNSUPPORTED_SELECTED_SIDE', `Unsupported Batter Hits side: ${rawSide}`);
}
function normalizedNullSourceId(_value: unknown, _label: string): null {
  return null;
}
function normalizedBookmakerSid(contract: BoardSourceContract, value: unknown, label: string): null {
  if (value === undefined || value === null) return null;
  if (contract.boardSource === 'pick6') return null;
  return fail('UNSUPPORTED_SOURCE_ID_CONTRACT', `${label} must be absent or null until a non-null source ID is verified and approved.`);
}
function identityKey(providerEventId: string, offerPlayerName: string): string {
  return `${providerEventId}\u0000${offerPlayerName}`;
}
function tupleKey(marketKey: BatterHitsProviderMarketKey, outcome: RawOddsApiOutcome): string {
  return JSON.stringify([marketKey, outcome.description, outcome.point, outcome.name]);
}

function normalizeTargetMarket(
  contract: BoardSourceContract,
  market: RawOddsApiMarket,
  event: z.infer<typeof rawOddsApiEventOddsSchema>,
  bookmakerSid: null,
  sourceMetadata: z.infer<typeof sourceMetadataSchema>,
  identitiesByKey: ReadonlyMap<string, readonly BatterHitsPlayerIdentity[]>,
  baselineLinesByPlayer: ReadonlyMap<string, number | null>,
  seenTuples: Set<string>,
  offers: NormalizedBatterHitsBoardOffer[],
  rejectedOffers: RejectedOddsApiBatterHitsOffer[],
): void {
  if (!isTargetMarketKey(market.key)) return;
  const marketSid = normalizedNullSourceId(market.sid, `Market ${market.key} sid`);
  for (const outcome of market.outcomes) {
    const outcomeSid = normalizedNullSourceId(outcome.sid, `Outcome ${market.key}/${outcome.description}/${outcome.name}/${outcome.point} sid`);
    const key = tupleKey(market.key, outcome);
    if (seenTuples.has(key)) {
      if (contract.boardSource === 'pick6') continue;
      fail('DUPLICATE_SNAPSHOT_OFFER_TUPLE', `Duplicate snapshot-scoped offer tuple: ${key}`);
    }
    seenTuples.add(key);
    const selectedSide = selectedSideForRawSide(outcome.name);
    const identities = identitiesByKey.get(identityKey(event.id, outcome.description)) ?? [];
    if (identities.length !== 1) {
      rejectedOffers.push(Object.freeze({ boardSource: contract.boardSource, providerEventId: event.id, providerMarketKey: market.key, playerDescription: outcome.description, rawSide: outcome.name, line: outcome.point, reason: 'PLAYER_IDENTITY_UNRESOLVED', matchCount: identities.length }));
      continue;
    }
    const identity = identities[0];
    if (identity === undefined) fail('INVALID_PLAYER_IDENTITY_INPUT', 'A single resolved player identity unexpectedly disappeared.');
    const normalized = normalizedBatterHitsBoardOfferSchema.parse({
      provider: 'the-odds-api',
      boardSource: contract.boardSource,
      providerBookmakerKey: contract.bookmaker,
      providerRegion: contract.region,
      settlementRuleVersion: contract.settlementRuleVersion,
      providerEventId: event.id,
      providerGameId: identity.providerGameId,
      providerPlayerId: identity.providerPlayerId,
      providerTeamId: identity.providerTeamId,
      playerName: identity.playerName,
      teamName: identity.teamName,
      homeTeamName: event.home_team,
      awayTeamName: event.away_team,
      eventCommenceTime: event.commence_time,
      baseMarketKey: BATTER_HITS_MARKET_KEY,
      providerMarketKey: market.key,
      offerType: offerTypeForMarketKey(market.key),
      offerTypeReason: baselineLinesByPlayer.get(outcome.description) != null ? null : 'NO_PLAYER_BASELINE',
      selectedSide,
      rawSide: outcome.name,
      line: outcome.point,
      americanPrice: outcome.price ?? null,
      multiplier: outcome.multiplier ?? null,
      marketLastUpdate: market.last_update,
      providerOutcomeSid: outcomeSid,
      providerMarketSid: marketSid,
      providerBookmakerSid: bookmakerSid,
      sourceCapturedAt: sourceMetadata.sourceCapturedAt,
      sourceSnapshotSha256: sourceMetadata.sourceSnapshotSha256,
    });
    offers.push(Object.freeze(normalized));
  }
}

export function normalizeOddsApiBatterHitsBoard(input: OddsApiBatterHitsBoardInput): NormalizedOddsApiBatterHitsBoard {
  const contract = sourceContract(input.boardSource);
  const parsedEvent = rawOddsApiEventOddsSchema.safeParse(input.rawEventSnapshot);
  if (!parsedEvent.success) return fail('INVALID_RAW_EVENT_SNAPSHOT', 'The Odds API event snapshot does not satisfy the fixture-backed raw contract.');
  const sourceMetadata = sourceMetadataSchema.safeParse({ sourceSnapshotSha256: input.sourceSnapshotSha256, sourceCapturedAt: input.sourceCapturedAt });
  if (!sourceMetadata.success) return fail('INVALID_SOURCE_METADATA', 'The board snapshot requires a valid capture timestamp and SHA-256.');
  const parsedIdentities = z.array(batterHitsPlayerIdentitySchema).safeParse(input.playerIdentities);
  if (!parsedIdentities.success) return fail('INVALID_PLAYER_IDENTITY_INPUT', 'Player identities do not satisfy the event-scoped Batter Hits identity contract.');
  const event = parsedEvent.data;
  if (event.sport_key !== 'baseball_mlb') return fail('UNEXPECTED_SPORT', `Expected baseball_mlb, received ${event.sport_key}.`);
  const sourceBookmakers = event.bookmakers.filter((bookmaker) => bookmaker.key === contract.bookmaker);
  if (sourceBookmakers.length > 1) return fail('AMBIGUOUS_ACTIVE_BOOKMAKER', `Event ${event.id} contains multiple ${contract.bookmaker} bookmaker records.`);
  const identitiesByKey = new Map<string, BatterHitsPlayerIdentity[]>();
  for (const identity of parsedIdentities.data) {
    const key = identityKey(identity.providerEventId, identity.offerPlayerName);
    const identities = identitiesByKey.get(key) ?? [];
    identities.push(identity);
    identitiesByKey.set(key, identities);
  }
  const bookmaker = sourceBookmakers[0];
  if (bookmaker === undefined) {
    return Object.freeze({ provider: 'the-odds-api', boardSource: contract.boardSource, providerBookmakerKey: contract.bookmaker, providerRegion: contract.region, settlementRuleVersion: contract.settlementRuleVersion, providerEventId: event.id, sourceSnapshotSha256: sourceMetadata.data.sourceSnapshotSha256, sourceCapturedAt: sourceMetadata.data.sourceCapturedAt, offers: Object.freeze([]), rejectedOffers: Object.freeze([]) });
  }
  const bookmakerSid = normalizedBookmakerSid(contract, bookmaker.sid, `${contract.bookmaker} bookmaker sid`);
  const targetMarkets = bookmaker.markets.filter((market) => isTargetMarketKey(market.key)).sort((left, right) => left.key === right.key ? 0 : left.key === 'batter_hits' ? -1 : 1);
  const targetMarketKeys = new Set<string>();
  for (const market of targetMarkets) {
    if (targetMarketKeys.has(market.key)) return fail('DUPLICATE_TARGET_MARKET', `Event ${event.id} contains duplicate ${market.key} market records.`);
    targetMarketKeys.add(market.key);
  }
  const offers: NormalizedBatterHitsBoardOffer[] = [];
  const rejectedOffers: RejectedOddsApiBatterHitsOffer[] = [];
  const seenTuples = new Set<string>();
  const baselineLineSets = new Map<string, Set<number>>();
  for (const market of targetMarkets) {
    if (market.key !== 'batter_hits') continue;
    for (const outcome of market.outcomes) {
      const lines = baselineLineSets.get(outcome.description) ?? new Set<number>();
      lines.add(outcome.point);
      baselineLineSets.set(outcome.description, lines);
    }
  }
  const baselineLinesByPlayer = new Map<string, number | null>([...baselineLineSets].map(([player, lines]) => [player, lines.size === 1 ? [...lines][0]! : null]));
  for (const market of targetMarkets) normalizeTargetMarket(contract, market, event, bookmakerSid, sourceMetadata.data, identitiesByKey, baselineLinesByPlayer, seenTuples, offers, rejectedOffers);
  return Object.freeze({ provider: 'the-odds-api', boardSource: contract.boardSource, providerBookmakerKey: contract.bookmaker, providerRegion: contract.region, settlementRuleVersion: contract.settlementRuleVersion, providerEventId: event.id, sourceSnapshotSha256: sourceMetadata.data.sourceSnapshotSha256, sourceCapturedAt: sourceMetadata.data.sourceCapturedAt, offers: Object.freeze(offers), rejectedOffers: Object.freeze(rejectedOffers) });
}