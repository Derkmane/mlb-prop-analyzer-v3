import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DISPLAY_DELIVERY_BUNDLE_VERSION = 1;
export const DISPLAY_DELIVERY_OIDC_AUDIENCE = 'mlb-prop-analyzer-v3-display-delivery-v1';
export const DEFAULT_DISPLAY_DELIVERY_URL =
  'https://player-analytics--derkmane.replit.app/internal/display-delivery-v1';

const CAPTURE_FILE = /^(\d{8}T\d{9}Z)--[a-f0-9]{64}\.json$/u;
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

async function captureMap(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = new Map();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = CAPTURE_FILE.exec(entry.name);
    if (match === null) continue;
    const prefix = match[1];
    if (result.has(prefix)) throw new Error(`Ambiguous display capture timestamp: ${prefix}.`);
    result.set(prefix, entry.name);
  }
  return result;
}

export async function findLatestCommonDisplayPair(rootDirectory = 'artifacts/display-archives') {
  const root = path.resolve(rootDirectory);
  const maps = await Promise.all(MARKETS.map((market) =>
    captureMap(path.join(root, market, 'captures'))));
  const commonPrefixes = [...maps[0].keys()]
    .filter((prefix) => maps[1].has(prefix))
    .sort()
    .reverse();
  const prefix = commonPrefixes[0];
  if (prefix === undefined) {
    throw new Error('No common Batter Hits/HHR display capture timestamp is available.');
  }
  return Object.freeze({
    prefix,
    files: Object.freeze(MARKETS.map((market, index) => Object.freeze({
      market,
      path: path.join(root, market, 'captures', maps[index].get(prefix)),
      filename: maps[index].get(prefix),
    }))),
  });
}

export async function buildDisplayDeliveryBundle(rootDirectory = 'artifacts/display-archives') {
  const pair = await findLatestCommonDisplayPair(rootDirectory);
  const archives = [];
  let capturedAt = null;
  for (const item of pair.files) {
    if (typeof item.filename !== 'string') throw new Error(`Missing ${item.market} display filename.`);
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
      parsed.productionEnabled !== false ||
      parsed.productionRankingEnabled !== false ||
      !Array.isArray(parsed.rows) || parsed.rows.length === 0
    ) {
      throw new Error(`${item.market} display archive contract is invalid.`);
    }
    if (typeof parsed.capturedAt !== 'string' || !Number.isFinite(Date.parse(parsed.capturedAt))) {
      throw new Error(`${item.market} display archive capturedAt is invalid.`);
    }
    if (capturedAt === null) capturedAt = parsed.capturedAt;
    if (parsed.capturedAt !== capturedAt || capturedAtIdentity(parsed.capturedAt) !== pair.prefix) {
      throw new Error('Batter Hits/HHR display archives do not share one capture timestamp.');
    }
    const captureKey = item.filename.slice(0, -'.json'.length);
    if (parsed.captureKey !== captureKey) {
      throw new Error(`${item.market} display archive captureKey does not match its filename.`);
    }
    archives.push(Object.freeze({
      market: item.market,
      filename: item.filename,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytesBase64: bytes.toString('base64'),
    }));
  }
  if (capturedAt === null) throw new Error('Display delivery bundle has no capturedAt timestamp.');
  return Object.freeze({
    deliveryVersion: DISPLAY_DELIVERY_BUNDLE_VERSION,
    capturedAt,
    archives: Object.freeze(archives),
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
  console.log(`DISPLAY DELIVERY PASS\t${bundle.capturedAt}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath !== null && invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
