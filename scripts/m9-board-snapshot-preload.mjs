import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const SNAPSHOT_CONTRACT = 'm9-first-board-snapshot-v4';
export const REPLAY_CONTRACT = 'm9-board-snapshot-replay-receipt-v3';
export const CLAIMED_EVENT_IDS_ENV = 'M9_BOARD_CLAIMED_EVENT_IDS';
const HITS_MARKETS = Object.freeze(['batter_hits', 'batter_hits_alternate']);
const HHR_MARKETS = Object.freeze([
  'batter_hits_runs_rbis',
  'batter_hits_runs_rbis_alternate',
]);
const TOTAL_BASES_MARKETS = Object.freeze([
  'batter_total_bases',
  'batter_total_bases_alternate',
]);
const ACTIVE_BOARD_SOURCES = Object.freeze([
  Object.freeze({ boardSource: 'pick6', bookmaker: 'pick6', region: 'us_dfs' }),
  Object.freeze({ boardSource: 'draftkings', bookmaker: 'draftkings', region: 'us' }),
]);
const PUBLIC_QUERY_NAMES = new Set([
  'bookmakers',
  'markets',
  'regions',
  'dateFormat',
  'oddsFormat',
  'includeMultipliers',
  'includeSids',
]);

export const sha256Bytes = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');

async function exactWrite(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(filePath, bytes, { flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readFile(filePath);
    if (!existing.equals(bytes)) {
      throw new Error(`Immutable snapshot drift: ${filePath}`);
    }
  }
}

function publicRequest(url) {
  return Object.freeze({
    method: 'GET',
    origin: url.origin,
    pathname: url.pathname,
    query: Object.freeze(
      Object.fromEntries(
        [...url.searchParams.entries()].filter(([name]) =>
          PUBLIC_QUERY_NAMES.has(name),
        ),
      ),
    ),
  });
}

function copyPrivateScheduleParams(scheduleUrl, url) {
  for (const [name, value] of scheduleUrl.searchParams.entries()) {
    if (!PUBLIC_QUERY_NAMES.has(name)) url.searchParams.set(name, value);
  }
  return url;
}

function marketsForConsumer(consumer) {
  if (consumer === 'hits') return HITS_MARKETS;
  if (consumer === 'hhr') return HHR_MARKETS;
  if (consumer === 'total-bases') return TOTAL_BASES_MARKETS;
  throw new Error(`Unsupported board snapshot consumer: ${consumer}.`);
}

function eventOddsUrl(eventId, scheduleUrl, consumer, source) {
  const url = copyPrivateScheduleParams(
    scheduleUrl,
    new URL(
      `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds`,
    ),
  );
  url.searchParams.set('regions', source.region);
  url.searchParams.set('bookmakers', source.bookmaker);
  url.searchParams.set('markets', marketsForConsumer(consumer).join(','));
  url.searchParams.set('dateFormat', 'iso');
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('includeMultipliers', 'true');
  url.searchParams.set('includeSids', 'true');
  return url;
}

function stamp(now) {
  return new Date(now()).toISOString();
}

function claimedPregameEvents(events, claimedGames, runStartMs) {
  if (!Array.isArray(claimedGames) || claimedGames.length === 0) {
    throw new Error('CAPTURE snapshot requires at least one claimed game.');
  }
  const byId = new Map(events.map((event) => [event.eventId, event]));
  if (byId.size !== events.length) {
    throw new Error('Provider schedule contains duplicate event IDs.');
  }
  const seen = new Set();
  const claimed = claimedGames.map((game, index) => {
    const eventId = game?.eventId;
    if (typeof eventId !== 'string' || eventId.length === 0) {
      throw new Error(`Claimed game ${index} has no event ID.`);
    }
    if (seen.has(eventId)) {
      throw new Error(`Claimed game event ID is duplicated: ${eventId}.`);
    }
    seen.add(eventId);
    const event = byId.get(eventId);
    if (!event) {
      throw new Error(`Claimed game is absent from provider schedule: ${eventId}.`);
    }
    if (
      event.commenceTimeUtc !== game.commenceTimeUtc ||
      event.homeTeamName !== game.homeTeamName ||
      event.awayTeamName !== game.awayTeamName
    ) {
      throw new Error(`Claimed game identity drifted from provider schedule: ${eventId}.`);
    }
    if (Date.parse(event.commenceTimeUtc) <= runStartMs) {
      throw new Error(`Claimed game has already started: ${eventId}.`);
    }
    return event;
  });
  return Object.freeze(
    claimed.sort(
      (left, right) =>
        left.commenceTimeUtc.localeCompare(right.commenceTimeUtc) ||
        left.eventId.localeCompare(right.eventId),
    ),
  );
}

async function captureOne(
  fetchImpl,
  url,
  requestKey,
  consumer,
  now,
  { requireOk = true } = {},
) {
  const response = await fetchImpl(url);
  const bytes = Buffer.from(await response.clone().arrayBuffer());
  if (requireOk && !response.ok) {
    throw new Error(`${requestKey} returned HTTP ${response.status}.`);
  }
  return Object.freeze({
    requestKey,
    consumer,
    request: publicRequest(url),
    capturedAt: stamp(now),
    response: Object.freeze({
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
      sha256: sha256Bytes(bytes),
      byteLength: bytes.length,
    }),
    bytes,
  });
}

export async function captureFirstBoardSnapshot({
  fetchImpl,
  archiveRoot,
  runStartedAt,
  snapshotStartedAt,
  scheduleUrl,
  scheduleResponse,
  scheduleBytes,
  scheduleCapturedAt,
  events,
  claimedGames,
  now,
}) {
  const runStartMs = Date.parse(runStartedAt);
  const pregameEvents = claimedPregameEvents(events, claimedGames, runStartMs);
  const auxiliaryFailures = [];
  const responses = [
    Object.freeze({
      requestKey: 'events',
      consumer: 'hits',
      request: publicRequest(scheduleUrl),
      capturedAt: scheduleCapturedAt,
      response: Object.freeze({
        status: scheduleResponse.status,
        statusText: scheduleResponse.statusText,
        contentType: scheduleResponse.headers.get('content-type'),
        sha256: sha256Bytes(scheduleBytes),
        byteLength: scheduleBytes.length,
      }),
      bytes: scheduleBytes,
    }),
  ];

  for (const event of pregameEvents) {
    for (const source of ACTIVE_BOARD_SOURCES) {
      responses.push(
        await captureOne(
          fetchImpl,
          eventOddsUrl(event.eventId, scheduleUrl, 'hits', source),
          `hits:${source.boardSource}:${event.eventId}`,
          'hits',
          now,
        ),
      );
    }
    for (const source of ACTIVE_BOARD_SOURCES) {
      responses.push(
        await captureOne(
          fetchImpl,
          eventOddsUrl(event.eventId, scheduleUrl, 'hhr', source),
          `hhr:${source.boardSource}:${event.eventId}`,
          'hhr',
          now,
        ),
      );
    }
    for (const source of ACTIVE_BOARD_SOURCES) {
      responses.push(
        await captureOne(
          fetchImpl,
          eventOddsUrl(event.eventId, scheduleUrl, 'total-bases', source),
          `total-bases:${source.boardSource}:${event.eventId}`,
          'total-bases',
          now,
        ),
      );
    }
  }

  const boardSnapshotCompletedAt = stamp(now);
  const replayEligibleEvents = pregameEvents.filter(
    (event) =>
      Date.parse(event.commenceTimeUtc) > Date.parse(boardSnapshotCompletedAt),
  );
  const identity = responses.map(({ bytes: _bytes, ...entry }) => entry);
  const snapshotSetSha256 = sha256Bytes(
    Buffer.from(
      JSON.stringify({ requests: identity, auxiliaryFailures }),
      'utf8',
    ),
  );
  const snapshotId = `${boardSnapshotCompletedAt.replace(/[-:.]/gu, '')}--${snapshotSetSha256}`;
  const directory = path.join(
    archiveRoot,
    'capture-controller',
    'snapshots',
    snapshotId,
  );

  for (const entry of responses) {
    await exactWrite(
      path.join(directory, 'raw', `${entry.response.sha256}.json`),
      entry.bytes,
    );
  }

  const manifest = Object.freeze({
    version: 3,
    contract: SNAPSHOT_CONTRACT,
    snapshotId,
    snapshotSetSha256,
    runStartedAt,
    boardSnapshotStartedAt: snapshotStartedAt,
    boardSnapshotCompletedAt,
    runStartToSnapshotElapsedMs:
      Date.parse(boardSnapshotCompletedAt) - Date.parse(runStartedAt),
    providerEvents: events,
    pregameEvents,
    replayEligibleEvents,
    claimedGames,
    auxiliaryFailures: Object.freeze(auxiliaryFailures),
    requests: Object.freeze(
      identity.map((entry) =>
        Object.freeze({
          ...entry,
          response: Object.freeze({
            ...entry.response,
            bodyFile: `raw/${entry.response.sha256}.json`,
          }),
        }),
      ),
    ),
  });
  const manifestPath = path.join(directory, 'manifest.json');
  await exactWrite(
    manifestPath,
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
  );
  return Object.freeze({ manifest, manifestPath });
}

function marketSet(value) {
  return new Set((value ?? '').split(',').filter(Boolean));
}

function sameSet(actual, expected) {
  return (
    actual.size === expected.length &&
    expected.every((market) => actual.has(market))
  );
}

function exactPublicQuery(url, expected) {
  const entries = [...url.searchParams.entries()].filter(([name]) =>
    PUBLIC_QUERY_NAMES.has(name),
  );
  const expectedEntries = Object.entries(expected);
  if (entries.length !== expectedEntries.length) return false;
  return expectedEntries.every(
    ([name, value]) =>
      url.searchParams.getAll(name).length === 1 &&
      url.searchParams.get(name) === value,
  );
}

function sourceForUrl(url) {
  const bookmaker = url.searchParams.get('bookmakers');
  const region = url.searchParams.get('regions');
  const source = ACTIVE_BOARD_SOURCES.find(
    (entry) => entry.bookmaker === bookmaker && entry.region === region,
  );
  if (source !== undefined) return source;
  if (
    ACTIVE_BOARD_SOURCES.some(
      (entry) => entry.bookmaker === bookmaker || entry.region === region,
    )
  ) {
    throw new Error('Board snapshot source identity drifted.');
  }
  return null;
}

function replayKey(input) {
  const url = new URL(
    typeof input === 'string' || input instanceof URL ? input : input.url,
  );
  if (url.hostname !== 'api.the-odds-api.com') return null;
  if (url.pathname === '/v4/sports/baseball_mlb/events') {
    if (url.searchParams.get('dateFormat') !== 'iso') {
      throw new Error('Snapshot events request contract drifted.');
    }
    return 'events';
  }
  const match = url.pathname.match(
    /^\/v4\/sports\/baseball_mlb\/events\/([^/]+)\/odds$/u,
  );
  if (!match) return null;
  const markets = marketSet(url.searchParams.get('markets'));
  const hitsControlled = HITS_MARKETS.some((key) => markets.has(key));
  const hhrControlled = HHR_MARKETS.some((key) => markets.has(key));
  const totalBasesControlled = TOTAL_BASES_MARKETS.some((key) => markets.has(key));
  if (!hitsControlled && !hhrControlled && !totalBasesControlled) return null;
  const source = sourceForUrl(url);
  if (source === null) {
    throw new Error('Controlled board snapshot request has an unsupported source.');
  }
  const consumer = hitsControlled
    ? 'hits'
    : hhrControlled
      ? 'hhr'
      : 'total-bases';
  const expectedMarkets = marketsForConsumer(consumer);
  const marketLabel = consumer === 'hits'
    ? 'Hits'
    : consumer === 'hhr'
      ? 'HHR'
      : 'Total Bases';
  if (!sameSet(markets, expectedMarkets)) {
    throw new Error(`${marketLabel} snapshot market set drifted.`);
  }
  if (
    !exactPublicQuery(url, {
      regions: source.region,
      bookmakers: source.bookmaker,
      markets: expectedMarkets.join(','),
      dateFormat: 'iso',
      oddsFormat: 'american',
      includeMultipliers: 'true',
      includeSids: 'true',
    })
  ) {
    throw new Error(`${marketLabel} snapshot request contract drifted.`);
  }
  return `${consumer}:${source.boardSource}:${match[1]}`;
}

function requiredKeys(manifest, consumer) {
  const eligibleIds = new Set(
    manifest.replayEligibleEvents.map((event) => event.eventId),
  );
  const keys = [];
  if (consumer === 'hits') keys.push('events');
  for (const eventId of [...eligibleIds].sort()) {
    for (const source of ACTIVE_BOARD_SOURCES) {
      keys.push(`${consumer}:${source.boardSource}:${eventId}`);
    }
  }
  return keys.sort();
}

function optionalKeys() {
  return [];
}

export function publishClaimedEventScope(manifest) {
  if (!Array.isArray(manifest?.claimedGames) || manifest.claimedGames.length === 0) {
    throw new Error('Snapshot manifest must contain at least one claimed game.');
  }
  const eventIds = manifest.claimedGames.map((game, index) => {
    const eventId = game?.eventId;
    if (typeof eventId !== 'string' || eventId.length === 0) {
      throw new Error(`Snapshot claimed game ${index} has no event ID.`);
    }
    return eventId;
  });
  if (new Set(eventIds).size !== eventIds.length) {
    throw new Error('Snapshot claimed event IDs must be unique.');
  }
  process.env[CLAIMED_EVENT_IDS_ENV] = JSON.stringify(eventIds);
  return Object.freeze([...eventIds]);
}

function installReplay() {
  const manifestPath = process.env.M9_BOARD_SNAPSHOT_MANIFEST?.trim();
  if (!manifestPath) return;
  const consumer = process.env.M9_BOARD_SNAPSHOT_CONSUMER?.trim();
  const receiptPath = process.env.M9_BOARD_REPLAY_RECEIPT?.trim();
  if (!['hits', 'hhr'].includes(consumer) || !receiptPath) {
    throw new Error(
      'Snapshot replay requires hits|hhr consumer and receipt path.',
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.contract !== SNAPSHOT_CONTRACT || manifest.version !== 3) {
    throw new Error('Wrong board snapshot contract.');
  }
  publishClaimedEventScope(manifest);

  const expectedKeys = requiredKeys(manifest, consumer);
  const optionalRequestKeys = optionalKeys(manifest, consumer);
  const allowedKeys = new Set([...expectedKeys, ...optionalRequestKeys]);
  const byKey = new Map(
    manifest.requests
      .filter((entry) => allowedKeys.has(entry.requestKey))
      .map((entry) => [entry.requestKey, entry]),
  );
  if (expectedKeys.some((key) => !byKey.has(key))) {
    throw new Error(`${consumer} snapshot is missing a required replay request.`);
  }
  const consumed = new Map();
  const originalFetch = globalThis.fetch;

  const writeReceipt = () => {
    const rows = [...consumed.values()].sort((a, b) =>
      a.requestKey.localeCompare(b.requestKey),
    );
    const complete = expectedKeys.every((key) => consumed.has(key));
    const receipt = {
      version: 3,
      contract: REPLAY_CONTRACT,
      consumer,
      snapshotId: manifest.snapshotId,
      snapshotSetSha256: manifest.snapshotSetSha256,
      complete,
      expectedRequestKeys: expectedKeys,
      optionalRequestKeys,
      consumed: rows,
    };
    mkdirSync(path.dirname(receiptPath), { recursive: true });
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  };
  writeReceipt();

  globalThis.fetch = async (input, init) => {
    const key = replayKey(input);
    if (key === null) return originalFetch(input, init);
    const entry = byKey.get(key);
    if (!entry) {
      throw new Error(
        `First snapshot has no ${consumer} replay entry for ${key}.`,
      );
    }
    const bodyPath = path.resolve(
      path.dirname(manifestPath),
      entry.response.bodyFile,
    );
    const bytes = readFileSync(bodyPath);
    const digest = sha256Bytes(bytes);
    if (digest !== entry.response.sha256) {
      throw new Error(`First snapshot byte drift at ${key}.`);
    }
    consumed.set(
      key,
      Object.freeze({
        requestKey: key,
        responseSha256: digest,
        byteLength: bytes.length,
        capturedAt: entry.capturedAt,
      }),
    );
    writeReceipt();
    const responseHeaders = new Headers();
    if (entry.response.contentType) {
      responseHeaders.set('content-type', entry.response.contentType);
    }
    responseHeaders.set('x-m9-board-snapshot-captured-at', entry.capturedAt);
    responseHeaders.set(
      'x-m9-board-snapshot-set-sha256',
      manifest.snapshotSetSha256,
    );
    return new Response(bytes, {
      status: entry.response.status,
      statusText: entry.response.statusText,
      headers: responseHeaders,
    });
  };
}

installReplay();
