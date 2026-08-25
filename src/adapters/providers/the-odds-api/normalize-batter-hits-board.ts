import { z } from 'zod';

import type { ActiveBoardSource } from '../../../domain/board-source.js';
import {
  BATTER_HITS_MARKET_KEY,
  BATTER_HITS_PROVIDER_MARKET_KEYS,
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
  readonly boardSource: ActiveBoardSource;
  readonly rawEventSnapshot: unknown;
  readonly sourceSnapshotSha256: string;
  readonly sourceCapturedAt: string;
  readonly playerIdentities: readonly unknown[];
}

export interface RejectedOddsApiBatterHitsOffer {
  readonly boardSource: ActiveBoardSource;
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
  readonly boardSource: ActiveBoardSource;
  readonly providerBookmakerKey: ActiveBoardSource;
  readonly providerRegion: 'us_dfs' | 'us';
  readonly providerEventId: string;
  readonly sourceSnapshotSha256: string;
  readonly sourceCapturedAt: string;
  readonly offers: readonly NormalizedBatterHitsBoardOffer[];
  readonly rejectedOffers: readonly RejectedOddsApiBatterHitsOffer[];
}

const SOURCE_CONTRACT = Object.freeze({
  pick6: Object.freeze({ bookmaker: 'pick6' as const, region: 'us_dfs' as const }),
  draftkings: Object.freeze({ bookmaker: 'draftkings' as const, region: 'us' as const }),
});

const sourceMetadataSchema = z
  .object({
    sourceSnapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourceCapturedAt: z.string().datetime({ offset: true }),
  })
  .strict();

function fail(
  code: OddsApiBatterHitsBoardErrorCode,
  message: string,
): never {
  throw new OddsApiBatterHitsBoardError(code, message);
}

function sourceContract(boardSource: ActiveBoardSource) {
  const contract = SOURCE_CONTRACT[boardSource];
  if (contract === undefined) {
    return fail('INVALID_BOARD_SOURCE', `Unsupported Batter Hits board source: ${String(boardSource)}`);
  }
  return contract;
}

function isTargetMarketKey(
  value: string,
): value is BatterHitsProviderMarketKey {
  return BATTER_HITS_PROVIDER_MARKET_KEYS.includes(
    value as BatterHitsProviderMarketKey,
  );
}

function offerTypeForMarketKey(
  marketKey: BatterHitsProviderMarketKey,
): BatterHitsOfferType {
  return marketKey === BATTER_HITS_PROVIDER_MARKET_KEYS[0]
    ? 'baseline'
    : 'alternate';
}

function selectedSideForRawSide(rawSide: string): 'higher' | 'lower' {
  if (rawSide === 'Over') return 'higher';
  if (rawSide === 'Under') return 'lower';

  return fail(
    'UNSUPPORTED_SELECTED_SIDE',
    `Unsupported Batter Hits side: ${rawSide}`,
  );
}

function normalizedNullSourceId(value: unknown, label: string): null {
  if (value !== undefined && value !== null) {
    fail(
      'UNSUPPORTED_SOURCE_ID_CONTRACT',
      `${label} must be absent or null until a non-null source ID is verified and approved.`,
    );
  }
  return null;
}

function identityKey(providerEventId: string, offerPlayerName: string): string {
  return `${providerEventId}\u0000${offerPlayerName}`;
}

function tupleKey(
  marketKey: BatterHitsProviderMarketKey,
  outcome: RawOddsApiOutcome,
): string {
  return JSON.stringify([
    marketKey,
    outcome.description,
    outcome.point,
    outcome.name,
  ]);
}

function normalizeTargetMarket(
  boardSource: ActiveBoardSource,
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
    const outcomeSid = normalizedNullSourceId(
      outcome.sid,
      `Outcome ${market.key}/${outcome.description}/${outcome.name}/${outcome.point} sid`,
    );

    const key = tupleKey(market.key, outcome);
    if (seenTuples.has(key)) {
      if (boardSource === 'pick6') continue;
      fail(
        'DUPLICATE_SNAPSHOT_OFFER_TUPLE',
        `Duplicate snapshot-scoped offer tuple: ${key}`,
      );
    }
    seenTuples.add(key);

    const selectedSide = selectedSideForRawSide(outcome.name);
    const identities =
      identitiesByKey.get(identityKey(event.id, outcome.description)) ?? [];

    if (identities.length !== 1) {
      rejectedOffers.push(
        Object.freeze({
          boardSource,
          providerEventId: event.id,
          providerMarketKey: market.key,
          playerDescription: outcome.description,
          rawSide: outcome.name,
          line: outcome.point,
          reason: 'PLAYER_IDENTITY_UNRESOLVED',
          matchCount: identities.length,
        }),
      );
      continue;
    }

    const identity = identities[0];
    if (identity === undefined) {
      fail(
        'INVALID_PLAYER_IDENTITY_INPUT',
        'A single resolved player identity unexpectedly disappeared.',
      );
    }

    const contract = sourceContract(boardSource);
    const normalized = normalizedBatterHitsBoardOfferSchema.parse({
      provider: 'the-odds-api',
      boardSource,
      providerBookmakerKey: contract.bookmaker,
      providerRegion: contract.region,
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
      offerTypeReason: baselineLinesByPlayer.get(outcome.description) != null
        ? null
        : 'NO_PLAYER_BASELINE',
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

export function normalizeOddsApiBatterHitsBoard(
  input: OddsApiBatterHitsBoardInput,
): NormalizedOddsApiBatterHitsBoard {
  const contract = sourceContract(input.boardSource);
  const parsedEvent = rawOddsApiEventOddsSchema.safeParse(
    input.rawEventSnapshot,
  );
  if (!parsedEvent.success) {
    return fail(
      'INVALID_RAW_EVENT_SNAPSHOT',
      'The Odds API event snapshot does not satisfy the fixture-backed raw contract.',
    );
  }

  const sourceMetadata = sourceMetadataSchema.safeParse({
    sourceSnapshotSha256: input.sourceSnapshotSha256,
    sourceCapturedAt: input.sourceCapturedAt,
  });
  if (!sourceMetadata.success) {
    return fail(
      'INVALID_SOURCE_METADATA',
      'The board snapshot requires a valid capture timestamp and SHA-256.',
    );
  }

  const parsedIdentities = z
    .array(batterHitsPlayerIdentitySchema)
    .safeParse(input.playerIdentities);
  if (!parsedIdentities.success) {
    return fail(
      'INVALID_PLAYER_IDENTITY_INPUT',
      'Player identities do not satisfy the event-scoped Batter Hits identity contract.',
    );
  }

  const event = parsedEvent.data;
  if (event.sport_key !== 'baseball_mlb') {
    return fail(
      'UNEXPECTED_SPORT',
      `Expected baseball_mlb, received ${event.sport_key}.`,
    );
  }

  const activeBookmakers = event.bookmakers.filter(
    (bookmaker) => bookmaker.key === contract.bookmaker,
  );
  if (activeBookmakers.length > 1) {
    return fail(
      'AMBIGUOUS_ACTIVE_BOOKMAKER',
      `Event ${event.id} contains multiple ${contract.bookmaker} bookmaker records.`,
    );
  }

  const identitiesByKey = new Map<string, BatterHitsPlayerIdentity[]>();
  for (const identity of parsedIdentities.data) {
    const key = identityKey(identity.providerEventId, identity.offerPlayerName);
    const identities = identitiesByKey.get(key) ?? [];
    identities.push(identity);
    identitiesByKey.set(key, identities);
  }

  const bookmaker = activeBookmakers[0];
  if (bookmaker === undefined) {
    return Object.freeze({
      provider: 'the-odds-api',
      boardSource: input.boardSource,
      providerBookmakerKey: contract.bookmaker,
      providerRegion: contract.region,
      providerEventId: event.id,
      sourceSnapshotSha256: sourceMetadata.data.sourceSnapshotSha256,
      sourceCapturedAt: sourceMetadata.data.sourceCapturedAt,
      offers: Object.freeze([]),
      rejectedOffers: Object.freeze([]),
    });
  }

  const bookmakerSid = normalizedNullSourceId(
    bookmaker.sid,
    `${contract.bookmaker} bookmaker sid`,
  );

  const targetMarkets = bookmaker.markets
    .filter((market) => isTargetMarketKey(market.key))
    .sort((left, right) =>
      left.key === right.key ? 0 : left.key === 'batter_hits' ? -1 : 1,
    );
  const targetMarketKeys = new Set<string>();
  for (const market of targetMarkets) {
    if (targetMarketKeys.has(market.key)) {
      return fail(
        'DUPLICATE_TARGET_MARKET',
        `Event ${event.id} contains duplicate ${market.key} market records.`,
      );
    }
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
  const baselineLinesByPlayer = new Map<string, number | null>(
    [...baselineLineSets].map(([player, lines]) => [
      player,
      lines.size === 1 ? [...lines][0]! : null,
    ]),
  );

  for (const market of targetMarkets) {
    normalizeTargetMarket(
      input.boardSource,
      market,
      event,
      bookmakerSid,
      sourceMetadata.data,
      identitiesByKey,
      baselineLinesByPlayer,
      seenTuples,
      offers,
      rejectedOffers,
    );
  }

  return Object.freeze({
    provider: 'the-odds-api',
    boardSource: input.boardSource,
    providerBookmakerKey: contract.bookmaker,
    providerRegion: contract.region,
    providerEventId: event.id,
    sourceSnapshotSha256: sourceMetadata.data.sourceSnapshotSha256,
    sourceCapturedAt: sourceMetadata.data.sourceCapturedAt,
    offers: Object.freeze(offers),
    rejectedOffers: Object.freeze(rejectedOffers),
  });
}
