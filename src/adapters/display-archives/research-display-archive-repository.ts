import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  RESEARCH_BATTER_HHR_MARKET,
  RESEARCH_BATTER_HITS_MARKET,
  type ResearchAnalysisContext,
  type ResearchDisplayArchive,
  type ResearchDisplayArchiveRepository,
  type ResearchDisplayMarket,
  type ResearchDisplayRow,
  type ResearchOfferType,
  type ResearchOfferTypeReason,
  type ResearchSelectedSide,
} from '../../application/research-display-archive.js';
import { HHR_DISPLAY_ARCHIVE_ROOT } from './hhr-display-archive-repository.js';

export type {
  ResearchAnalysisContext,
  ResearchDisplayArchive,
  ResearchDisplayArchiveRepository,
  ResearchDisplayMarket,
  ResearchDisplayRow,
  ResearchOfferType,
  ResearchOfferTypeReason,
  ResearchSelectedSide,
} from '../../application/research-display-archive.js';

const AUTHORIZED_RESEARCH_IDENTITIES = Object.freeze({
  [RESEARCH_BATTER_HITS_MARKET]: Object.freeze({
    modelVersion: 'm8-5-batter-hits-successor-freeze-v1',
    distributionBuilderVersion: 'm9-batter-hits-runtime-distribution-v1',
  }),
  [RESEARCH_BATTER_HHR_MARKET]: Object.freeze({
    modelVersion: 'm11-batter-hhr-direct-composite-v2',
    distributionBuilderVersion: 'm11-batter-hhr-negative-binomial-v1',
  }),
} satisfies Record<ResearchDisplayMarket, Readonly<Record<string, string>>>);

const HHR_DISPLAY_ARCHIVE_DIRECTORY = path.basename(
  path.dirname(HHR_DISPLAY_ARCHIVE_ROOT),
);
const CAPTURE_PATTERN = /^\d{8}T\d{9}Z--[a-f0-9]{64}\.json$/u;
const CAPTURE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

type LoadedResearchDisplayArchive = Readonly<{
  archive: ResearchDisplayArchive;
  captureDateUtc: string;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const result = string(value, label);
  if (!Number.isFinite(Date.parse(result))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return result;
}

function captureDateUtc(value: unknown, label: string): string {
  const result = string(value, label);
  if (
    !CAPTURE_DATE_PATTERN.test(result) ||
    new Date(`${result}T00:00:00.000Z`).toISOString().slice(0, 10) !== result
  ) {
    throw new TypeError(`${label} must be a YYYY-MM-DD UTC date.`);
  }
  return result;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a safe integer.`);
  }
  return value as number;
}

function nullableFinite(value: unknown, label: string): number | null {
  return value === null || value === undefined ? null : finite(value, label);
}

function nullableString(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : string(value, label);
}

function probability(value: unknown, label: string): number {
  const result = finite(value, label);
  if (result < 0 || result > 1) {
    throw new RangeError(`${label} must be in [0, 1].`);
  }
  return result;
}

function offerType(value: unknown): ResearchOfferType {
  if (value !== 'baseline' && value !== 'alternate') {
    throw new TypeError('research offerType must be baseline or alternate.');
  }
  return value;
}

function offerTypeReason(value: unknown): ResearchOfferTypeReason | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === 'NO_PLAYER_BASELINE') return value;
  throw new TypeError(
    'research offerTypeReason must be null, NO_PLAYER_BASELINE, or absent.',
  );
}

function selectedSide(value: unknown): ResearchSelectedSide {
  if (value !== 'higher' && value !== 'lower') {
    throw new TypeError('research selectedSide must be higher or lower.');
  }
  return value;
}

function lineupStatus(value: unknown): 'confirmed' | 'projected' | null {
  if (value === null || value === undefined) return null;
  if (value !== 'confirmed' && value !== 'projected') {
    throw new TypeError('research lineupStatus must be confirmed, projected, or null.');
  }
  return value;
}

function analysisContext(value: unknown): ResearchAnalysisContext {
  const source = value === undefined ? {} : record(value, 'analysisContext');
  return Object.freeze({
    expectedPlateAppearances: nullableFinite(
      source['expectedPlateAppearances'],
      'analysisContext.expectedPlateAppearances',
    ),
    lineupSlot: nullableFinite(source['lineupSlot'], 'analysisContext.lineupSlot'),
    batterSide: nullableString(source['batterSide'], 'analysisContext.batterSide'),
    opposingStarterHand: nullableString(
      source['opposingStarterHand'],
      'analysisContext.opposingStarterHand',
    ),
    venue: nullableString(source['venue'], 'analysisContext.venue'),
    teamImpliedRunTotal: nullableFinite(
      source['teamImpliedRunTotal'],
      'analysisContext.teamImpliedRunTotal',
    ),
  });
}

function enrichmentForRow(
  archive: Record<string, unknown>,
  gameId: number,
  playerId: number,
): Readonly<Record<string, unknown>> | null {
  if (archive['displayEnrichment'] === undefined) return null;
  const enrichment = record(archive['displayEnrichment'], 'displayEnrichment');
  const byKey = record(
    enrichment['byGamePlayerKey'],
    'displayEnrichment.byGamePlayerKey',
  );
  const value = byKey[`${gameId}:${playerId}`];
  return value === undefined
    ? null
    : Object.freeze(record(value, 'display enrichment row'));
}

function normalizeRow(
  market: ResearchDisplayMarket,
  archive: Record<string, unknown>,
  raw: unknown,
  index: number,
): ResearchDisplayRow {
  const row = record(raw, `${market} rows[${index}]`);
  const providerGameId = integer(row['providerGameId'], `${market} providerGameId`);
  const providerPlayerId = integer(
    row['providerPlayerId'],
    `${market} providerPlayerId`,
  );
  const pWin = probability(row['pWin'], `${market} pWin`);
  const pLoss = probability(row['pLoss'], `${market} pLoss`);
  const pVoid = probability(row['pVoid'], `${market} pVoid`);
  const pWinGivenGrades = probability(
    row['pWinGivenGrades'],
    `${market} pWinGivenGrades`,
  );
  if (Math.abs(pWin + pLoss + pVoid - 1) > 1e-9) {
    throw new Error(`${market} archived probability mass does not sum to 1.`);
  }

  return Object.freeze({
    market,
    captureKey: string(archive['captureKey'], `${market} captureKey`),
    capturedAt: timestamp(archive['capturedAt'], `${market} capturedAt`),
    modelVersion: string(archive['modelVersion'], `${market} modelVersion`),
    distributionBuilderVersion: string(
      archive['distributionBuilderVersion'],
      `${market} distributionBuilderVersion`,
    ),
    providerEventId: string(row['providerEventId'], `${market} providerEventId`),
    providerGameId,
    providerPlayerId,
    playerName: string(row['playerName'], `${market} playerName`),
    teamName: string(row['teamName'], `${market} teamName`),
    homeTeamName: string(row['homeTeamName'], `${market} homeTeamName`),
    awayTeamName: string(row['awayTeamName'], `${market} awayTeamName`),
    eventCommenceTime: string(
      row['eventCommenceTime'],
      `${market} eventCommenceTime`,
    ),
    providerMarketKey: string(
      row['providerMarketKey'],
      `${market} providerMarketKey`,
    ),
    offerType: offerType(row['offerType']),
    offerTypeReason: offerTypeReason(row['offerTypeReason']),
    selectedSide: selectedSide(row['selectedSide']),
    postedLine: finite(row['postedLine'], `${market} postedLine`),
    americanPrice: nullableFinite(row['americanPrice'], `${market} americanPrice`),
    multiplier: nullableFinite(row['multiplier'], `${market} multiplier`),
    pWin,
    pLoss,
    pVoid,
    pWinGivenGrades,
    lineupStatus: lineupStatus(row['lineupStatus']),
    analysisContext: analysisContext(row['analysisContext']),
    enrichment: enrichmentForRow(archive, providerGameId, providerPlayerId),
  });
}

function persistedIdentityForMarket(market: ResearchDisplayMarket): string {
  return market === RESEARCH_BATTER_HHR_MARKET
    ? HHR_DISPLAY_ARCHIVE_DIRECTORY
    : market;
}

function verifyArchiveIdentity(
  market: ResearchDisplayMarket,
  archive: Record<string, unknown>,
): void {
  if (
    archive['displayArchiveVersion'] !== 1 ||
    archive['displayArchiveContract'] !== 'phase1-trimmed-board-display-v1' ||
    archive['market'] !== persistedIdentityForMarket(market)
  ) {
    throw new Error(`${market} display archive contract is unsupported.`);
  }
  if (
    archive['productionEnabled'] !== false ||
    archive['productionRankingEnabled'] !== false
  ) {
    throw new Error(`${market} research archive must remain production-disabled.`);
  }
  const expected = AUTHORIZED_RESEARCH_IDENTITIES[market];
  if (
    archive['modelVersion'] !== expected.modelVersion ||
    archive['distributionBuilderVersion'] !== expected.distributionBuilderVersion
  ) {
    throw new Error(`${market} display archive model identity is not research-authorized.`);
  }
}

function captureFilenameDate(name: string): string {
  return `${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}`;
}

async function readArchiveFile(
  directory: string,
  name: string,
  market: ResearchDisplayMarket,
): Promise<LoadedResearchDisplayArchive> {
  const parsed = JSON.parse(
    await readFile(path.join(directory, name), 'utf8'),
  ) as unknown;
  const source = record(parsed, `${market} display archive`);
  verifyArchiveIdentity(market, source);
  const archiveCaptureDateUtc = captureDateUtc(
    source['captureDateUtc'],
    `${market} captureDateUtc`,
  );
  if (archiveCaptureDateUtc !== captureFilenameDate(name)) {
    throw new Error(`${market} display archive capture date does not match its filename.`);
  }
  const rawRows = source['rows'];
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    throw new Error(`${market} display archive rows must be nonempty.`);
  }
  const rows = Object.freeze(
    rawRows.map((row, index) => normalizeRow(market, source, row, index)),
  );
  return Object.freeze({
    captureDateUtc: archiveCaptureDateUtc,
    archive: Object.freeze({
      market,
      captureKey: string(source['captureKey'], `${market} captureKey`),
      capturedAt: timestamp(source['capturedAt'], `${market} capturedAt`),
      modelVersion: string(source['modelVersion'], `${market} modelVersion`),
      distributionBuilderVersion: string(
        source['distributionBuilderVersion'],
        `${market} distributionBuilderVersion`,
      ),
      rows,
    }),
  });
}

async function readLatestFromDirectory(
  rootDirectory: string,
  market: ResearchDisplayMarket,
): Promise<ResearchDisplayArchive | null> {
  const directory = path.join(
    rootDirectory,
    persistedIdentityForMarket(market),
    'captures',
  );
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
  const names = entries
    .filter((entry) => entry.isFile() && CAPTURE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  if (names.length === 0) return null;

  const newestName = names[0] as string;
  const newestCaptureDate = captureFilenameDate(newestName);
  const sameDayNames = names.filter(
    (name) => captureFilenameDate(name) === newestCaptureDate,
  );
  const loaded = await Promise.all(
    sameDayNames.map((name) => readArchiveFile(directory, name, market)),
  );
  const newestArchive = loaded[0]?.archive;
  if (newestArchive === undefined) return null;

  const claimedGameIds = new Set<number>();
  const rows: ResearchDisplayRow[] = [];
  for (const { archive } of loaded) {
    const captureGameIds = new Set(
      archive.rows.map((row) => row.providerGameId),
    );
    for (const row of archive.rows) {
      if (!claimedGameIds.has(row.providerGameId)) rows.push(row);
    }
    for (const gameId of captureGameIds) claimedGameIds.add(gameId);
  }

  return Object.freeze({
    ...newestArchive,
    rows: Object.freeze(rows),
  });
}

export function createResearchDisplayArchiveRepository(
  options: Readonly<{ rootDirectory?: string }> = {},
): ResearchDisplayArchiveRepository {
  const rootDirectory = path.resolve(
    options.rootDirectory ?? 'artifacts/display-archives',
  );
  return Object.freeze({
    readLatest: (market: ResearchDisplayMarket) =>
      readLatestFromDirectory(rootDirectory, market),
  });
}
