import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const SNAPSHOT_CONTRACT = 'm9-first-board-snapshot-v1';
export const REPLAY_CONTRACT = 'm9-board-snapshot-replay-receipt-v1';
const HITS_MARKETS = Object.freeze(['batter_hits', 'batter_hits_alternate']);
const HHR_MARKETS = Object.freeze([
  'batter_hits_runs_rbis',
  'batter_hits_runs_rbis_alternate',
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

function eventOddsUrl(eventId, scheduleUrl, consumer) {
  const url = new URL(
    `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${eventId}/odds`,
  );
  for (const [name, value] of scheduleUrl.searchParams.entries()) {
    if (!PUBLIC_QUERY_NAMES.has(name)) url.searchParams.set(name, value);
  }
  url.searchParams.set('bookmakers', 'underdog');
  url.searchParams.set(
    'markets',
    (consumer === 'hits' ? HITS_MARKETS : HHR_MARKETS).join(','),
  );
  if (consumer === 'hhr') url.searchParams.set('regions', 'us_dfs');
  url.searchParams.set('dateFormat', 'iso');
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('includeMultipliers', 'true');
  url.searchParams.set('includeSids', 'true');
  return url;
}

function stamp(now) {
  return new Date(now()).toISOString();
}

async function captureOne(fetchImpl, url, requestKey, consumer, now) {
  const response = await fetchImpl(url);
  const bytes = Buffer.from(await response.clone().arrayBuffer());
  if (!response.ok) {
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
  const pregameEvents = events.filter(
    (event) => Date.parse(event.commenceTimeUtc) > runStartMs,
  );
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
    responses.push(
      await captureOne(
        fetchImpl,
        eventOddsUrl(event.eventId, scheduleUrl, 'hits'),
        `hits:${event.eventId}`,
        'hits',
        now,
      ),
    );
    responses.push(
      await captureOne(
        fetchImpl,
        eventOddsUrl(event.eventId, scheduleUrl, 'hhr'),
        `hhr:${event.eventId}`,
        'hhr',
        now,
      ),
    );
  }

  const boardSnapshotCompletedAt = stamp(now);
  const replayEligibleEvents = pregameEvents.filter(
    (event) =>
      Date.parse(event.commenceTimeUtc) > Date.parse(boardSnapshotCompletedAt),
  );
  const identity = responses.map(({ bytes: _bytes, ...entry }) => entry);
  const snapshotSetSha256 = sha256Bytes(
    Buffer.from(JSON.stringify(identity), 'utf8'),
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
    version: 1,
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
  if (!hitsControlled && !hhrControlled) return null;

  if (hitsControlled) {
    if (!sameSet(markets, HITS_MARKETS)) {
      throw new Error('Hits snapshot market set drifted.');
    }
    if (url.searchParams.get('bookmakers') !== 'underdog') {
      throw new Error('Hits snapshot bookmaker drifted.');
    }
    if (url.searchParams.has('regions')) {
      throw new Error('Hits snapshot regions drifted.');
    }
    return `hits:${match[1]}`;
  }

  if (!sameSet(markets, HHR_MARKETS)) {
    throw new Error('HHR snapshot market set drifted.');
  }
  if (url.searchParams.get('regions') !== 'us_dfs') {
    throw new Error('HHR snapshot region drifted.');
  }
  if (url.searchParams.get('bookmakers') !== 'underdog') {
    throw new Error('HHR snapshot bookmaker drifted.');
  }
  return `hhr:${match[1]}`;
}

function requiredKeys(manifest, consumer) {
  const eligibleIds = new Set(
    manifest.replayEligibleEvents.map((event) => event.eventId),
  );
  const keys = [];
  if (consumer === 'hits') keys.push('events');
  for (const eventId of [...eligibleIds].sort()) {
    keys.push(`${consumer}:${eventId}`);
  }
  return keys.sort();
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
  if (manifest.contract !== SNAPSHOT_CONTRACT) {
    throw new Error('Wrong board snapshot contract.');
  }

  const expectedKeys = requiredKeys(manifest, consumer);
  const byKey = new Map(
    manifest.requests
      .filter((entry) => expectedKeys.includes(entry.requestKey))
      .map((entry) => [entry.requestKey, entry]),
  );
  if (byKey.size !== expectedKeys.length) {
    throw new Error(`${consumer} snapshot is missing a required replay request.`);
  }
  const consumed = new Map();
  const originalFetch = globalThis.fetch;

  const writeReceipt = () => {
    const rows = [...consumed.values()].sort((a, b) =>
      a.requestKey.localeCompare(b.requestKey),
    );
    const consumedKeys = rows.map((row) => row.requestKey);
    const complete =
      consumedKeys.length === expectedKeys.length &&
      consumedKeys.every((key, index) => key === expectedKeys[index]);
    const receipt = {
      version: 1,
      contract: REPLAY_CONTRACT,
      consumer,
      snapshotId: manifest.snapshotId,
      snapshotSetSha256: manifest.snapshotSetSha256,
      complete,
      expectedRequestKeys: expectedKeys,
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
