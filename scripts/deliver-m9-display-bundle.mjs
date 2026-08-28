import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DISPLAY_DELIVERY_BUNDLE_VERSION = 1;
export const DISPLAY_DELIVERY_OIDC_AUDIENCE = 'mlb-prop-analyzer-v3-display-delivery-v1';
export const DEFAULT_DISPLAY_DELIVERY_URL =
  'https://player-analytics--derkmane.replit.app/internal/display-delivery-v1';

const CAPTURE_FILE = /^(\d{8}T\d{9}Z)--[a-f0-9]{64}\.json$/u;
const CATEGORY_PERFORMANCE_FILE = /^product-category-performance-v1--[a-f0-9]{64}\.json$/u;
const MARKETS = Object.freeze(['batter-hits', 'batter-hhr']);

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function capturedAtIdentity(capturedAt) {
  return capturedAt.replaceAll('-', '').replaceAll(':', '').replace('.', '');
}

function utcDateFromPrefix(prefix) {
  return `${prefix.slice(0, 4)}-${prefix.slice(4, 6)}-${prefix.slice(6, 8)}`;
}

async function captureFilesByDate(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = new Map();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = CAPTURE_FILE.exec(entry.name);
    if (match === null) continue;
    const date = match[1].slice(0, 8);
    const names = result.get(date) ?? [];
    names.push(entry.name);
    result.set(date, names);
  }
  for (const names of result.values()) names.sort();
  return result;
}

export async function findLatestCommonDisplayDay(rootDirectory = 'artifacts/display-archives') {
  const root = path.resolve(rootDirectory);
  const maps = await Promise.all(MARKETS.map((market) =>
    captureFilesByDate(path.join(root, market, 'captures'))));
  const commonDates = [...maps[0].keys()]
    .filter((date) => maps[1].has(date))
    .sort()
    .reverse();
  const dateKey = commonDates[0];
  if (dateKey === undefined) {
    throw new Error('No common Batter Hits/HHR display capture date is available.');
  }
  return Object.freeze({
    dateKey,
    displayDateUtc: utcDateFromPrefix(dateKey),
    files: Object.freeze(MARKETS.flatMap((market, index) =>
      maps[index].get(dateKey).map((filename) => Object.freeze({
        market,
        path: path.join(root, market, 'captures', filename),
        filename,
      })))),
  });
}

async function categoryPerformanceEnvelope(root) {
  const directory = path.join(root, 'category-performance');
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return null;
    throw error;
  }
  const names = entries
    .filter((entry) => entry.isFile() && CATEGORY_PERFORMANCE_FILE.test(entry.name))
    .map((entry) => entry.name);
  if (names.length === 0) return null;
  if (names.length !== 1) {
    throw new Error(`Expected exactly one active category-performance display report; found ${names.length}.`);
  }
  const filename = names[0];
  const bytes = await readFile(path.join(directory, filename));
  return Object.freeze({
    filename,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytesBase64: bytes.toString('base64'),
  });
}

export async function buildDisplayDeliveryBundle(rootDirectory = 'artifacts/display-archives') {
  const root = path.resolve(rootDirectory);
  const day = await findLatestCommonDisplayDay(root);
  const archives = [];
  const newestByMarket = new Map();
  for (const item of day.files) {
    const bytes = await readFile(item.path);
    let parsed;
    try {
      parsed = record(JSON.parse(bytes.toString('utf8')), `${item.market} display archive`);
    } catch (error) {
      throw new Error(`${item.market} display archive is malformed JSON.`, { cause: error });
    }
    if (
      parsed.displayArchiveVersion !== 1 ||
      parsed.displayArchiveContract !== 'phase1-trimmed-board-display-v1' ||
      parsed.market !== item.market ||
      parsed.captureDateUtc !== day.displayDateUtc ||
      parsed.productionEnabled !== false ||
      parsed.productionRankingEnabled !== false ||
      !Array.isArray(parsed.rows) || parsed.rows.length === 0
    ) {
      throw new Error(`${item.market} display archive contract is invalid.`);
    }
    if (typeof parsed.capturedAt !== 'string' || !Number.isFinite(Date.parse(parsed.capturedAt))) {
      throw new Error(`${item.market} display archive capturedAt is invalid.`);
    }
    const match = CAPTURE_FILE.exec(item.filename);
    if (match === null || capturedAtIdentity(parsed.capturedAt) !== match[1]) {
      throw new Error(`${item.market} display archive capturedAt does not match its filename.`);
    }
    if (parsed.captureKey !== item.filename.slice(0, -'.json'.length)) {
      throw new Error(`${item.market} display archive captureKey does not match its filename.`);
    }
    const prior = newestByMarket.get(item.market);
    if (prior === undefined || item.filename > prior.filename) {
      newestByMarket.set(item.market, { filename: item.filename, capturedAt: parsed.capturedAt });
    }
    archives.push(Object.freeze({
      market: item.market,
      filename: item.filename,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytesBase64: bytes.toString('base64'),
    }));
  }
  const newestHits = newestByMarket.get('batter-hits');
  const newestHhr = newestByMarket.get('batter-hhr');
  if (
    newestHits === undefined ||
    newestHhr === undefined ||
    newestHits.filename.slice(0, 18) !== newestHhr.filename.slice(0, 18) ||
    newestHits.capturedAt !== newestHhr.capturedAt
  ) {
    throw new Error('Newest Batter Hits/HHR display captures do not share one timestamp.');
  }
  return Object.freeze({
    deliveryVersion: DISPLAY_DELIVERY_BUNDLE_VERSION,
    displayDateUtc: day.displayDateUtc,
    capturedAt: newestHits.capturedAt,
    archives: Object.freeze(archives),
    categoryPerformance: await categoryPerformanceEnvelope(root),
  });
}

export async function requestGitHubOidcToken(options = {}) {
  const requestUrl = options.requestUrl ?? process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = options.requestToken ?? process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (typeof requestUrl !== 'string' || requestUrl.length === 0) {
    throw new Error('GitHub Actions OIDC request URL is unavailable.');
  }
  if (typeof requestToken !== 'string' || requestToken.length === 0) {
    throw new Error('GitHub Actions OIDC request token is unavailable.');
  }
  const url = new URL(requestUrl);
  url.searchParams.set('audience', DISPLAY_DELIVERY_OIDC_AUDIENCE);
  const response = await fetchImpl(url, {
    headers: {
      authorization: `Bearer ${requestToken}`,
      accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Unable to request GitHub Actions OIDC token: HTTP ${response.status}.`);
  }
  const body = record(await response.json(), 'GitHub Actions OIDC response');
  if (typeof body.value !== 'string' || body.value.length === 0) {
    throw new Error('GitHub Actions OIDC response did not contain a token.');
  }
  return body.value;
}

export async function deliverDisplayBundle(bundle, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const deliveryUrl = options.deliveryUrl ?? process.env.DISPLAY_DELIVERY_URL ?? DEFAULT_DISPLAY_DELIVERY_URL;
  const oidcToken = options.oidcToken ?? await requestGitHubOidcToken({ fetchImpl });
  const response = await fetchImpl(deliveryUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${oidcToken}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(bundle),
  });
  if (response.status !== 204) {
    const body = await response.text();
    throw new Error(
      `Display delivery failed: HTTP ${response.status}${body.length > 0 ? ` ${body.slice(0, 500)}` : ''}.`,
    );
  }
}

async function main() {
  const bundle = await buildDisplayDeliveryBundle();
  await deliverDisplayBundle(bundle);
  console.log(
    `DISPLAY DELIVERY PASS\t${bundle.displayDateUtc}\t${bundle.capturedAt}\tarchives=${bundle.archives.length}`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath !== null && invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
