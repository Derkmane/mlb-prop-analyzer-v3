import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const originalFetch = globalThis.fetch;
if (typeof originalFetch !== 'function') {
  throw new Error('Global fetch is unavailable for HHR raw-board preservation.');
}

const HHR_ARCHIVE_ROOT = path.resolve(
  process.env.M10_HHR_ARCHIVE_ROOT?.trim() || 'artifacts/board-archives/batter-hhr',
);
const RAW_BOARD_ROOT = path.join(
  HHR_ARCHIVE_ROOT,
  'raw-provider',
  'the-odds-api-underdog-us_dfs-hhr',
);
const REQUIRED_MARKETS = new Set([
  'batter_hits_runs_rbis',
  'batter_hits_runs_rbis_alternate',
]);

function isExactHhrBoardRequest(input) {
  const rawUrl =
    typeof input === 'string' || input instanceof URL
      ? String(input)
      : input && typeof input === 'object' && 'url' in input
        ? String(input.url)
        : null;
  if (rawUrl === null) return false;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.hostname !== 'api.the-odds-api.com') return false;
  if (!url.pathname.endsWith('/odds')) return false;
  if (url.searchParams.get('regions') !== 'us_dfs') return false;
  if (url.searchParams.get('bookmakers') !== 'underdog') return false;
  const markets = new Set(
    (url.searchParams.get('markets') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return (
    markets.size === REQUIRED_MARKETS.size &&
    [...REQUIRED_MARKETS].every((market) => markets.has(market))
  );
}

async function persistExactBytes(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(filePath, bytes, { flag: 'wx' });
  } catch (error) {
    if (!(error && typeof error === 'object' && error.code === 'EEXIST')) throw error;
    const existing = await readFile(filePath);
    if (!existing.equals(bytes)) {
      throw new Error(`Immutable raw HHR board snapshot drifted: ${filePath}`);
    }
  }
}

globalThis.fetch = async function hhrEvidenceFetch(input, init) {
  const response = await originalFetch(input, init);
  if (!isExactHhrBoardRequest(input)) return response;

  const bytes = Buffer.from(await response.clone().arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const filePath = path.join(RAW_BOARD_ROOT, `${sha256}.json`);
  await persistExactBytes(filePath, bytes);
  process.stdout.write(`HHR RAW BOARD SNAPSHOT\t${sha256}\t${filePath}\n`);
  return response;
};
