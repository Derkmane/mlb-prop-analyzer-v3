import type { SelectedSide } from '../../domain/selected-side.js';
import type { NormalizedBatterHhrOffer } from './contracts.js';
import {
  BATTER_HHR_ALTERNATE_PROVIDER_MARKET_KEY,
  BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY,
  BATTER_HHR_MARKET_KEY,
} from './manifest.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

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
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return timestamp;
}

function asFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
  return value;
}

function asNullableNumber(value: unknown, label: string): number | null {
  if (value === null) return null;
  return asFiniteNumber(value, label);
}

function asNullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return asString(value, label);
}

function selectedSide(value: unknown, label: string): SelectedSide {
  if (value === 'Over') return 'higher';
  if (value === 'Under') return 'lower';
  throw new RangeError(`${label} must be exact Over or Under.`);
}

function providerMarketKey(value: unknown) {
  if (
    value !== BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY &&
    value !== BATTER_HHR_ALTERNATE_PROVIDER_MARKET_KEY
  ) {
    throw new RangeError('HHR provider market key is unsupported.');
  }
  return value;
}

export function normalizeUnderdogBatterHhrCapture(
  captureInput: unknown,
): readonly NormalizedBatterHhrOffer[] {
  const capture = asRecord(captureInput, 'HHR provider capture');
  if (capture['captureVersion'] !== 1) {
    throw new Error('HHR provider captureVersion must equal 1.');
  }
  const request = asRecord(capture['request'], 'HHR capture request');
  if (request['provider'] !== 'The Odds API') {
    throw new Error('HHR provider must be The Odds API.');
  }
  if (request['bookmaker'] !== 'underdog') {
    throw new Error('HHR bookmaker must be underdog.');
  }
  if (request['region'] !== 'us_dfs') {
    throw new Error('HHR region must be us_dfs.');
  }
  if (
    JSON.stringify(request['marketKeys']) !==
    JSON.stringify([
      BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY,
      BATTER_HHR_ALTERNATE_PROVIDER_MARKET_KEY,
    ])
  ) {
    throw new Error('HHR capture must request the exact baseline and alternate keys.');
  }
  const sourceSnapshotSha256 = asString(
    capture['sourceSnapshotSha256'],
    'HHR sourceSnapshotSha256',
  );
  if (!SHA256_PATTERN.test(sourceSnapshotSha256)) {
    throw new Error('HHR sourceSnapshotSha256 must be lowercase SHA-256.');
  }

  const response = asRecord(capture['response'], 'HHR provider response');
  const eventId = asString(response['id'], 'HHR event id');
  const commenceTime = asTimestamp(
    response['commence_time'],
    'HHR commence time',
  );
  const homeTeam = asString(response['home_team'], 'HHR home team');
  const awayTeam = asString(response['away_team'], 'HHR away team');
  if (!Array.isArray(response['bookmakers'])) {
    throw new TypeError('HHR response bookmakers must be an array.');
  }
  const underdogRows = response['bookmakers']
    .map((value, index) => asRecord(value, `HHR bookmaker[${index}]`))
    .filter((bookmaker) => bookmaker['key'] === 'underdog');
  if (underdogRows.length !== 1) {
    throw new Error('HHR response must contain exactly one underdog bookmaker.');
  }
  const underdog = underdogRows[0];
  if (underdog === undefined || !Array.isArray(underdog['markets'])) {
    throw new TypeError('HHR underdog markets must be an array.');
  }

  const normalized: NormalizedBatterHhrOffer[] = [];
  for (const [marketIndex, marketValue] of underdog['markets'].entries()) {
    const market = asRecord(marketValue, `HHR market[${marketIndex}]`);
    const key = providerMarketKey(market['key']);
    const marketLastUpdate = asTimestamp(
      market['last_update'],
      `HHR market[${marketIndex}].last_update`,
    );
    if (!Array.isArray(market['outcomes'])) {
      throw new TypeError(`HHR market[${marketIndex}].outcomes must be an array.`);
    }
    for (const [outcomeIndex, outcomeValue] of market['outcomes'].entries()) {
      const outcome = asRecord(
        outcomeValue,
        `HHR market[${marketIndex}].outcome[${outcomeIndex}]`,
      );
      const line = asFiniteNumber(
        outcome['point'],
        `HHR outcome[${outcomeIndex}].point`,
      );
      if (line < 0) {
        throw new RangeError('HHR posted line must be non-negative.');
      }
      normalized.push(
        Object.freeze({
          source: 'the-odds-api',
          bookmaker: 'underdog',
          region: 'us_dfs',
          eventId,
          commenceTime,
          homeTeam,
          awayTeam,
          playerName: asString(
            outcome['description'],
            `HHR outcome[${outcomeIndex}].description`,
          ),
          providerMarketKey: key,
          baseMarketKey: BATTER_HHR_MARKET_KEY,
          offerType:
            key === BATTER_HHR_BASELINE_PROVIDER_MARKET_KEY
              ? 'baseline'
              : 'alternate',
          selectedSide: selectedSide(
            outcome['name'],
            `HHR outcome[${outcomeIndex}].name`,
          ),
          line,
          price: asNullableNumber(
            outcome['price'],
            `HHR outcome[${outcomeIndex}].price`,
          ),
          multiplier: asNullableNumber(
            outcome['multiplier'],
            `HHR outcome[${outcomeIndex}].multiplier`,
          ),
          providerSid: asNullableString(
            outcome['sid'],
            `HHR outcome[${outcomeIndex}].sid`,
          ),
          marketLastUpdate,
          sourceSnapshotSha256,
        }),
      );
    }
  }

  if (normalized.length === 0) {
    throw new Error('HHR capture contained no normalized offers.');
  }
  return Object.freeze(normalized);
}
