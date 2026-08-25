import type { BoardSource } from '../../domain/board-source.js';
import type { SelectedSide } from '../../domain/selected-side.js';
import type { NormalizedBatterHhrOffer } from './contracts.js';
import {
  BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
  BATTER_HHR_SETTLEMENT_RULE_VERSION,
} from './contracts.js';
import {
  BATTER_HHR_ALTERNATE_PROVIDER_MARKET_KEY,
  BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY,
  BATTER_HHR_MARKET_KEY,
} from './manifest.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

type HhrBoardSourceContract = Readonly<{
  boardSource: BoardSource;
  bookmaker: 'pick6' | 'draftkings' | 'underdog';
  region: 'us_dfs' | 'us';
  settlementRuleVersion: string | null;
}>;

function sourceContract(bookmaker: unknown, region: unknown): HhrBoardSourceContract {
  if (bookmaker === 'pick6') {
    if (region !== 'us_dfs') throw new Error('Pick6 HHR region must be us_dfs.');
    return Object.freeze({ boardSource: 'pick6', bookmaker: 'pick6', region: 'us_dfs', settlementRuleVersion: null });
  }
  if (bookmaker === 'draftkings') {
    if (region !== 'us') throw new Error('DraftKings HHR region must be us.');
    return Object.freeze({
      boardSource: 'draftkings',
      bookmaker: 'draftkings',
      region: 'us',
      settlementRuleVersion: BATTER_HHR_DRAFTKINGS_SETTLEMENT_RULE_VERSION,
    });
  }
  if (bookmaker === 'underdog') {
    if (region !== 'us_dfs') throw new Error('Historical HHR Underdog region must be us_dfs.');
    return Object.freeze({
      boardSource: null,
      bookmaker: 'underdog',
      region: 'us_dfs',
      settlementRuleVersion: BATTER_HHR_SETTLEMENT_RULE_VERSION,
    });
  }
  throw new Error('HHR bookmaker is unsupported.');
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}
function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}
function asTimestamp(value: unknown, label: string): string {
  const timestamp = asString(value, label);
  if (!Number.isFinite(Date.parse(timestamp))) throw new TypeError(`${label} must be an ISO timestamp.`);
  return timestamp;
}
function asFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
  return value;
}
function asNullableNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  return asFiniteNumber(value, label);
}
function asNullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return asString(value, label);
}
function selectedSide(value: unknown, label: string): SelectedSide {
  if (value === 'Over') return 'higher';
  if (value === 'Under') return 'lower';
  throw new RangeError(`${label} must be exact Over or Under.`);
}
function providerMarketKey(value: unknown) {
  if (value !== BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY && value !== BATTER_HHR_ALTERNATE_PROVIDER_MARKET_KEY) {
    throw new RangeError('HHR provider market key is unsupported.');
  }
  return value;
}

function normalizeCapture(
  captureInput: unknown,
  historicalStandardBookBaselineLinesByPlayer: ReadonlyMap<string, number> | null,
): readonly NormalizedBatterHhrOffer[] {
  const capture = asRecord(captureInput, 'HHR provider capture');
  if (capture['captureVersion'] !== 1) throw new Error('HHR provider captureVersion must equal 1.');
  const request = asRecord(capture['request'], 'HHR capture request');
  if (request['provider'] !== 'The Odds API') throw new Error('HHR provider must be The Odds API.');
  const contract = sourceContract(request['bookmaker'], request['region']);
  if (
    JSON.stringify(request['marketKeys']) !==
    JSON.stringify([BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY, BATTER_HHR_ALTERNATE_PROVIDER_MARKET_KEY])
  ) {
    throw new Error('HHR capture must request the exact baseline and alternate keys.');
  }
  const sourceSnapshotSha256 = asString(capture['sourceSnapshotSha256'], 'HHR sourceSnapshotSha256');
  if (!SHA256_PATTERN.test(sourceSnapshotSha256)) throw new Error('HHR sourceSnapshotSha256 must be lowercase SHA-256.');

  const response = asRecord(capture['response'], 'HHR provider response');
  const eventId = asString(response['id'], 'HHR event id');
  const commenceTime = asTimestamp(response['commence_time'], 'HHR commence time');
  const homeTeam = asString(response['home_team'], 'HHR home team');
  const awayTeam = asString(response['away_team'], 'HHR away team');
  if (!Array.isArray(response['bookmakers'])) throw new TypeError('HHR response bookmakers must be an array.');
  const sourceRows = response['bookmakers']
    .map((value, index) => asRecord(value, `HHR bookmaker[${index}]`))
    .filter((bookmaker) => bookmaker['key'] === contract.bookmaker);
  if (sourceRows.length === 0 && contract.boardSource !== null) return Object.freeze([]);
  if (sourceRows.length !== 1) throw new Error(`HHR response must contain exactly one ${contract.bookmaker} bookmaker.`);
  const sourceBook = sourceRows[0];
  if (sourceBook === undefined || !Array.isArray(sourceBook['markets'])) throw new TypeError('HHR source markets must be an array.');

  const markets = sourceBook['markets']
    .map((marketValue, marketIndex) => ({ market: asRecord(marketValue, `HHR market[${marketIndex}]`), marketIndex }))
    .filter(({ market }) =>
      market['key'] === BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY || market['key'] === BATTER_HHR_ALTERNATE_PROVIDER_MARKET_KEY,
    );
  const baselineLineSets = new Map<string, Set<number>>();
  for (const { market, marketIndex } of markets) {
    if (providerMarketKey(market['key']) !== BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY) continue;
    if (!Array.isArray(market['outcomes'])) throw new TypeError(`HHR market[${marketIndex}].outcomes must be an array.`);
    for (const [outcomeIndex, outcomeValue] of market['outcomes'].entries()) {
      const outcome = asRecord(outcomeValue, `HHR market[${marketIndex}].outcome[${outcomeIndex}]`);
      const player = asString(outcome['description'], `HHR outcome[${outcomeIndex}].description`);
      const line = asFiniteNumber(outcome['point'], `HHR outcome[${outcomeIndex}].point`);
      const lines = baselineLineSets.get(player) ?? new Set<number>();
      lines.add(line);
      baselineLineSets.set(player, lines);
    }
  }
  const baselineLines = new Map<string, number | undefined>(
    [...baselineLineSets].map(([player, lines]) => [player, lines.size === 1 ? [...lines][0] : undefined]),
  );
  if (contract.boardSource === null && historicalStandardBookBaselineLinesByPlayer !== null) {
    for (const [player, line] of historicalStandardBookBaselineLinesByPlayer) {
      if (!baselineLines.has(player)) baselineLines.set(player, line);
    }
  }

  const normalized: NormalizedBatterHhrOffer[] = [];
  const seenOffers = new Set<string>();
  markets.sort(({ market: left }, { market: right }) =>
    left['key'] === right['key'] ? 0 : left['key'] === BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY ? -1 : 1,
  );
  for (const { market, marketIndex } of markets) {
    const key = providerMarketKey(market['key']);
    const marketLastUpdate = asTimestamp(market['last_update'], `HHR market[${marketIndex}].last_update`);
    if (!Array.isArray(market['outcomes'])) throw new TypeError(`HHR market[${marketIndex}].outcomes must be an array.`);
    for (const [outcomeIndex, outcomeValue] of market['outcomes'].entries()) {
      const outcome = asRecord(outcomeValue, `HHR market[${marketIndex}].outcome[${outcomeIndex}]`);
      const line = asFiniteNumber(outcome['point'], `HHR outcome[${outcomeIndex}].point`);
      if (line < 0) throw new RangeError('HHR posted line must be non-negative.');
      const playerName = asString(outcome['description'], `HHR outcome[${outcomeIndex}].description`);
      const side = selectedSide(outcome['name'], `HHR outcome[${outcomeIndex}].name`);
      const offerKey = JSON.stringify([key, playerName, line, side]);
      if (seenOffers.has(offerKey)) continue;
      seenOffers.add(offerKey);
      normalized.push(Object.freeze({
        source: 'the-odds-api',
        boardSource: contract.boardSource,
        bookmaker: contract.bookmaker,
        region: contract.region,
        settlementRuleVersion: contract.settlementRuleVersion,
        eventId,
        commenceTime,
        homeTeam,
        awayTeam,
        playerName,
        providerMarketKey: key,
        baseMarketKey: BATTER_HHR_MARKET_KEY,
        offerType: key === BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY ? 'baseline' : 'alternate',
        offerTypeReason: baselineLines.get(playerName) !== undefined ? null : 'NO_PLAYER_BASELINE',
        selectedSide: side,
        line,
        price: asNullableNumber(outcome['price'], `HHR outcome[${outcomeIndex}].price`),
        multiplier: asNullableNumber(outcome['multiplier'], `HHR outcome[${outcomeIndex}].multiplier`),
        providerSid: asNullableString(outcome['sid'], `HHR outcome[${outcomeIndex}].sid`),
        marketLastUpdate,
        sourceSnapshotSha256,
      }));
    }
  }
  if (normalized.length === 0 && contract.boardSource === null) throw new Error('Historical HHR capture contained no normalized offers.');
  return Object.freeze(normalized);
}

/** Active Pick6/DraftKings normalizer. It never accepts an external baseline. */
export function normalizeOddsApiBatterHhrCapture(captureInput: unknown): readonly NormalizedBatterHhrOffer[] {
  return normalizeCapture(captureInput, null);
}

/** Historical replay compatibility only. Active code must not call this function. */
export function normalizeUnderdogBatterHhrCapture(
  captureInput: unknown,
  standardBookBaselineLinesByPlayer: ReadonlyMap<string, number> = new Map(),
): readonly NormalizedBatterHhrOffer[] {
  return normalizeCapture(captureInput, standardBookBaselineLinesByPlayer);
}
