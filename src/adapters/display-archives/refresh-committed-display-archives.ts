import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  RESEARCH_BATTER_HHR_MARKET,
  RESEARCH_DISPLAY_MARKETS,
  type ResearchDisplayMarket,
} from '../../application/research-display-archive.js';
import { HHR_DISPLAY_ARCHIVE_ROOT } from './hhr-display-archive-repository.js';

const AUTHORIZED_REPOSITORY = 'Derkmane/mlb-prop-analyzer-v3' as const;
const AUTHORIZED_BRANCH = 'main' as const;
const DISPLAY_ROOT = 'artifacts/display-archives' as const;
const CATEGORY_PERFORMANCE_DIRECTORY = 'category-performance' as const;
const MARKETS = RESEARCH_DISPLAY_MARKETS;
const HHR_DISPLAY_ARCHIVE_DIRECTORY = path.basename(
  path.dirname(HHR_DISPLAY_ARCHIVE_ROOT),
);
const CAPTURE_FILE = /^\d{8}T\d{9}Z--[a-f0-9]{64}\.json$/u;
const CATEGORY_PERFORMANCE_FILE = /^product-category-performance-v1--([a-f0-9]{64})\.json$/u;
const DEFAULT_REFRESH_INTERVAL_MS = 60_000;

type DisplayMarket = ResearchDisplayMarket;

type FetchResponse = Readonly<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

type FetchLike = (
  input: string,
  init?: Readonly<Record<string, unknown>>,
) => Promise<FetchResponse>;

export interface CommittedDisplayArchiveRefreshOptions {
  readonly rootDirectory?: string;
  readonly refreshIntervalMs?: number;
  readonly fetchImpl?: FetchLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function persistedIdentityForMarket(market: DisplayMarket): string {
  return market === RESEARCH_BATTER_HHR_MARKET
    ? HHR_DISPLAY_ARCHIVE_DIRECTORY
    : market;
}

function capturePathForMarket(value: unknown, market: DisplayMarket): string | null {
  if (!isRecord(value)) return null;
  const rawPath = value['path'];
  if (typeof rawPath !== 'string') return null;
  const persistedIdentity = persistedIdentityForMarket(market);
  const prefix = `${DISPLAY_ROOT}/${persistedIdentity}/captures/`;
  if (!rawPath.startsWith(prefix)) return null;
  const filename = rawPath.slice(prefix.length);
  return CAPTURE_FILE.test(filename) ? rawPath : null;
}

function categoryPerformancePath(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const rawPath = value['path'];
  if (typeof rawPath !== 'string') return null;
  const prefix = `${DISPLAY_ROOT}/${CATEGORY_PERFORMANCE_DIRECTORY}/`;
  if (!rawPath.startsWith(prefix)) return null;
  const filename = rawPath.slice(prefix.length);
  return CATEGORY_PERFORMANCE_FILE.test(filename) ? rawPath : null;
}

function captureDateFromPath(remotePath: string): string {
  return path.posix.basename(remotePath).slice(0, 8);
}

function newestDayCapturePaths(
  treePayload: unknown,
): Readonly<Record<DisplayMarket, readonly string[]>> {
  if (!isRecord(treePayload) || !Array.isArray(treePayload['tree'])) {
    throw new Error('GitHub display-archive tree response is malformed.');
  }
  const pathsByMarket = Object.fromEntries(
    MARKETS.map((market) => [market, [] as string[]]),
  ) as Record<DisplayMarket, string[]>;
  for (const entry of treePayload['tree']) {
    for (const market of MARKETS) {
      const capturePath = capturePathForMarket(entry, market);
      if (capturePath !== null) pathsByMarket[market].push(capturePath);
    }
  }

  const newestDay = {} as Record<DisplayMarket, readonly string[]>;
  for (const market of MARKETS) {
    const candidates = pathsByMarket[market].sort().reverse();
    const newestPath = candidates[0];
    if (newestPath === undefined) {
      throw new Error(`No committed ${market} display archive is available on main.`);
    }
    const newestDate = captureDateFromPath(newestPath);
    newestDay[market] = Object.freeze(
      candidates.filter((candidate) => captureDateFromPath(candidate) === newestDate),
    );
  }
  return Object.freeze(newestDay);
}

function committedCategoryPerformancePath(treePayload: unknown): string | null {
  if (!isRecord(treePayload) || !Array.isArray(treePayload['tree'])) {
    throw new Error('GitHub display-archive tree response is malformed.');
  }
  const paths = treePayload['tree'].flatMap((entry) => {
    const result = categoryPerformancePath(entry);
    return result === null ? [] : [result];
  });
  if (paths.length > 1) {
    throw new Error('Committed category-performance display evidence must have exactly one active report.');
  }
  return paths[0] ?? null;
}

function validateFetchedArchive(bytes: string, market: DisplayMarket, remotePath: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes) as unknown;
  } catch {
    throw new Error(`Newest committed ${market} display archive is malformed JSON.`);
  }
  if (!isRecord(parsed) || parsed['market'] !== persistedIdentityForMarket(market)) {
    throw new Error(`Newest committed ${market} display archive has the wrong market identity.`);
  }
  const filename = path.posix.basename(remotePath);
  const captureKey = filename.slice(0, -'.json'.length);
  if (parsed['captureKey'] !== captureKey) {
    throw new Error(`Newest committed ${market} display archive has a capture identity mismatch.`);
  }
  if (parsed['productionEnabled'] !== false || parsed['productionRankingEnabled'] !== false) {
    throw new Error(`Newest committed ${market} display archive is not research-authorized.`);
  }
}

function validateFetchedCategoryPerformance(bytes: string, remotePath: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes) as unknown;
  } catch {
    throw new Error('Committed category-performance display evidence is malformed JSON.');
  }
  const filename = path.posix.basename(remotePath);
  const match = CATEGORY_PERFORMANCE_FILE.exec(filename);
  if (
    match === null ||
    !isRecord(parsed) ||
    parsed['reportVersion'] !== 1 ||
    parsed['reportType'] !== 'product-category-performance-v1' ||
    parsed['sourceSetSha256'] !== match[1]
  ) {
    throw new Error('Committed category-performance display evidence has an identity mismatch.');
  }
  const safety = parsed['safety'];
  if (
    !isRecord(safety) ||
    safety['evidenceOnly'] !== true ||
    safety['archivesModified'] !== false ||
    safety['probabilitiesModified'] !== false ||
    safety['rankingModified'] !== false
  ) {
    throw new Error('Committed category-performance display evidence safety boundary drifted.');
  }
}

async function atomicWrite(filePath: string, bytes: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.refresh-${process.pid}-${Date.now()}`;
  await writeFile(temporary, bytes, 'utf8');
  await rename(temporary, filePath);
}

export function createCommittedDisplayArchiveRefresher(
  options: Readonly<CommittedDisplayArchiveRefreshOptions> = {},
): () => Promise<void> {
  const rootDirectory = path.resolve(options.rootDirectory ?? DISPLAY_ROOT);
  const refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  if (!Number.isFinite(refreshIntervalMs) || refreshIntervalMs < 0) {
    throw new RangeError('Display-archive refresh interval must be a nonnegative finite number.');
  }
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  let lastSuccessfulRefreshAt = 0;
  let inFlight: Promise<void> | null = null;

  async function refreshNow(): Promise<void> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'user-agent': 'mlb-prop-analyzer-v3-live-display',
      'x-github-api-version': '2022-11-28',
    };
    const token = process.env['GITHUB_TOKEN'];
    if (token !== undefined && token.length > 0) headers['authorization'] = `Bearer ${token}`;

    const treeUrl = `https://api.github.com/repos/${AUTHORIZED_REPOSITORY}/git/trees/${AUTHORIZED_BRANCH}?recursive=1`;
    const treeResponse = await fetchImpl(treeUrl, {
      headers,
      cache: 'no-store',
    });
    if (!treeResponse.ok) {
      throw new Error(`Unable to refresh current display board from GitHub tree: HTTP ${treeResponse.status}.`);
    }
    const treePayload = await treeResponse.json();
    const capturePaths = newestDayCapturePaths(treePayload);
    const performancePath = committedCategoryPerformancePath(treePayload);

    await Promise.all(MARKETS.flatMap((market) =>
      capturePaths[market].map(async (remotePath) => {
        const rawUrl = `https://raw.githubusercontent.com/${AUTHORIZED_REPOSITORY}/${AUTHORIZED_BRANCH}/${remotePath}`;
        const response = await fetchImpl(rawUrl, {
          headers,
          cache: 'no-store',
        });
        if (!response.ok) {
          throw new Error(`Unable to refresh current ${market} display archive: HTTP ${response.status}.`);
        }
        const bytes = await response.text();
        validateFetchedArchive(bytes, market, remotePath);
        const persistedIdentity = persistedIdentityForMarket(market);
        const destination = path.join(
          rootDirectory,
          persistedIdentity,
          'captures',
          path.posix.basename(remotePath),
        );
        await atomicWrite(destination, bytes);
      }),
    ));

    if (performancePath !== null) {
      const rawUrl = `https://raw.githubusercontent.com/${AUTHORIZED_REPOSITORY}/${AUTHORIZED_BRANCH}/${performancePath}`;
      const response = await fetchImpl(rawUrl, {
        headers,
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Unable to refresh category performance evidence: HTTP ${response.status}.`);
      }
      const bytes = await response.text();
      validateFetchedCategoryPerformance(bytes, performancePath);
      await atomicWrite(
        path.join(rootDirectory, CATEGORY_PERFORMANCE_DIRECTORY, path.posix.basename(performancePath)),
        bytes,
      );
    }
  }

  return async function refreshCommittedDisplayArchives(): Promise<void> {
    if (Date.now() - lastSuccessfulRefreshAt < refreshIntervalMs) return;
    if (inFlight !== null) return inFlight;
    inFlight = refreshNow()
      .then(() => {
        lastSuccessfulRefreshAt = Date.now();
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}
