import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type {
  HhrDisplayArchive,
  HhrDisplayArchiveRepository,
} from '../../application/hhr-display-board.js';

export const HHR_DISPLAY_ARCHIVE_ROOT = path.resolve(
  'artifacts/display-archives/batter-hhr/captures',
);
const DISPLAY_ARCHIVE_VERSION = 1;
const DISPLAY_ARCHIVE_CONTRACT = 'phase1-trimmed-board-display-v1';
const ENRICHMENT_CONTRACT = 'phase2-last-five-and-opposing-starter-v1';
const CAPTURE_FILE = /^(\d{8}T\d{9}Z)--([a-f0-9]{64})\.json$/u;

const nonnegativeInteger = z.number().int().nonnegative();
const probability = z.number().min(0).max(1);
const nullableFinite = z.number().finite().nullable();
const lastFiveGame = z.strictObject({
  gameDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  opponentTeamName: z.string().min(1),
  opponentAbbreviation: z.string().min(1).nullable(),
  homeOrAway: z.enum(['home', 'away']),
  hits: nonnegativeInteger,
  runs: nonnegativeInteger,
  rbi: nonnegativeInteger,
  hrr: nonnegativeInteger,
  atBats: nonnegativeInteger,
  plateAppearances: nonnegativeInteger,
  totalBases: nonnegativeInteger,
});
const pitchingBlock = z.strictObject({
  inningsPitched: z.union([z.string(), z.number()]).nullable(),
  earnedRuns: nonnegativeInteger.nullable(),
  strikeouts: nonnegativeInteger.nullable(),
  whip: nullableFinite,
});
const last10PitchingBlock = z.strictObject({
  starts: nonnegativeInteger,
  inningsPitched: z.string(),
  earnedRuns: nonnegativeInteger,
  strikeouts: nonnegativeInteger,
  whip: nullableFinite,
});
const opposingStarter = z.union([
  z.strictObject({ failureReason: z.string().min(1) }),
  z.strictObject({
    name: z.string().min(1).nullable(),
    throwingHand: z.string().min(1).nullable(),
    era: nullableFinite,
    last10: last10PitchingBlock,
    season: pitchingBlock,
  }),
]);
const enrichmentRecord = z.strictObject({
  providerGameId: nonnegativeInteger,
  providerPlayerId: nonnegativeInteger,
  lastFiveGames: z.strictObject({
    count: nonnegativeInteger.max(5),
    games: z.array(lastFiveGame).max(5),
    failureReason: z.string().min(1).nullable(),
  }),
  opposingStarter,
});
const analysisContext = z.strictObject({
  expectedPlateAppearances: nullableFinite,
  lineupSlot: nullableFinite,
  batterSide: z.string().min(1).nullable(),
  opposingStarterHand: z.string().min(1).nullable(),
  venue: z.string().min(1).nullable(),
  teamImpliedRunTotal: nullableFinite,
});
const row = z.strictObject({
  rank: z.number().int().positive(),
  boardSource: z.enum(['pick6', 'draftkings']).nullable().optional(),
  providerBookmakerKey: z.enum(['pick6', 'draftkings', 'underdog']).optional(),
  providerRegion: z.enum(['us', 'us_dfs']).optional(),
  settlementRuleVersion: z.string().min(1).nullable().optional(),
  providerEventId: z.string().min(1),
  providerGameId: nonnegativeInteger,
  providerPlayerId: nonnegativeInteger,
  providerTeamId: nonnegativeInteger,
  playerName: z.string().min(1),
  teamName: z.string().min(1),
  homeTeamName: z.string().min(1),
  awayTeamName: z.string().min(1),
  eventCommenceTime: z.iso.datetime({ offset: true }),
  baseMarketKey: z.literal('batter_hits_runs_rbis'),
  providerMarketKey: z.enum(['batter_hits_runs_rbis', 'batter_hits_runs_rbis_alternate']),
  marketLabel: z.literal('Batter Hits + Runs + RBIs'),
  offerType: z.enum(['baseline', 'alternate']),
  settlementStatistic: z.literal('hits+runs+rbi'),
  selectedSide: z.enum(['higher', 'lower']),
  postedLine: z.number().finite().nonnegative(),
  americanPrice: z.number().finite().nullable(),
  multiplier: z.number().finite().nullable(),
  pWin: probability,
  pLoss: probability,
  pVoid: probability,
  pWinGivenGrades: probability,
  lineupStatus: z.string().min(1),
  analysisContext: analysisContext.optional(),
});
const archive = z.strictObject({
  displayArchiveVersion: z.literal(DISPLAY_ARCHIVE_VERSION),
  displayArchiveContract: z.literal(DISPLAY_ARCHIVE_CONTRACT),
  market: z.literal('batter-hhr'),
  captureKey: z.string(),
  capturedAt: z.iso.datetime({ offset: true }),
  captureDateUtc: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  fullArchiveSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  fullArchiveFileSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  productionEnabled: z.literal(false),
  productionRankingEnabled: z.literal(false),
  modelVersion: z.string().min(1),
  distributionBuilderVersion: z.string().min(1),
  displayEnrichment: z.strictObject({
    version: z.literal(1),
    contract: z.literal(ENRICHMENT_CONTRACT),
    keyFormat: z.literal('providerGameId:providerPlayerId'),
    byGamePlayerKey: z.record(z.string(), enrichmentRecord),
    diagnostics: z.strictObject({
      playerCount: nonnegativeInteger,
      failureReasons: z.record(z.string(), nonnegativeInteger),
    }),
  }),
  rows: z.array(row),
});

export interface HhrDisplayArchiveFileReader {
  readdir(directory: string): Promise<readonly string[]>;
  readFile(filePath: string): Promise<string>;
}

const nodeFileReader: HhrDisplayArchiveFileReader = Object.freeze({
  readdir: async (directory: string) => readdir(directory),
  readFile: async (filePath: string) => readFile(filePath, 'utf8'),
});

function capturedAtIdentity(capturedAt: string): string {
  return capturedAt.replaceAll('-', '').replaceAll(':', '').replace('.', '');
}

function assertSourceIdentity(candidate: z.infer<typeof row>, filename: string): void {
  const sourceFields = [
    candidate.boardSource,
    candidate.providerBookmakerKey,
    candidate.providerRegion,
    candidate.settlementRuleVersion,
  ];
  const supplied = sourceFields.filter((value) => value !== undefined).length;
  if (supplied === 0) return; // Historical pre-source-switch display evidence.
  if (supplied !== sourceFields.length) {
    throw new Error(`Incomplete HHR display source identity: ${filename}`);
  }
  if (candidate.boardSource === null) {
    if (candidate.providerBookmakerKey !== 'underdog' || candidate.providerRegion !== 'us_dfs') {
      throw new Error(`Invalid historical HHR display source identity: ${filename}`);
    }
    return;
  }
  if (candidate.boardSource === 'draftkings') {
    if (candidate.providerBookmakerKey !== 'draftkings' || candidate.providerRegion !== 'us') {
      throw new Error(`Invalid DraftKings HHR display source identity: ${filename}`);
    }
    return;
  }
  if (candidate.providerBookmakerKey !== 'pick6' || candidate.providerRegion !== 'us_dfs') {
    throw new Error(`Invalid Pick6 HHR display source identity: ${filename}`);
  }
}

function parseArchive(bytes: string, filename: string): HhrDisplayArchive | null {
  let input: unknown;
  try {
    input = JSON.parse(bytes);
  } catch {
    throw new Error(`Malformed HHR display archive JSON: ${filename}`);
  }
  if (typeof input === 'object' && input !== null && !('displayEnrichment' in input)) {
    return null; // Committed pre-Phase-2 captures are not eligible display-board inputs.
  }
  const parsed = archive.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid HHR display archive contract: ${filename}`);
  const value = parsed.data;
  const filenameIdentity = filename.slice(0, -'.json'.length);
  if (value.captureKey !== filenameIdentity ||
      capturedAtIdentity(value.capturedAt) !== filenameIdentity.split('--')[0]) {
    throw new Error(`HHR display archive filename/capture identity disagreement: ${filename}`);
  }
  const ranks = new Set<number>();
  for (const candidate of value.rows) {
    assertSourceIdentity(candidate, filename);
    if (ranks.has(candidate.rank)) throw new Error(`Ambiguous HHR persisted rank: ${candidate.rank}`);
    ranks.add(candidate.rank);
  }
  for (const [key, enrichment] of Object.entries(value.displayEnrichment.byGamePlayerKey)) {
    if (key !== `${enrichment.providerGameId}:${enrichment.providerPlayerId}` ||
        enrichment.lastFiveGames.count !== enrichment.lastFiveGames.games.length) {
      throw new Error(`Malformed Phase 2 enrichment identity: ${key}`);
    }
  }
  return Object.freeze({
    captureKey: value.captureKey,
    capturedAt: value.capturedAt,
    modelVersion: value.modelVersion,
    distributionBuilderVersion: value.distributionBuilderVersion,
    rows: Object.freeze(value.rows),
    enrichmentByGamePlayerKey: Object.freeze(value.displayEnrichment.byGamePlayerKey),
  });
}

/** Read-only access to the single approved committed HHR display-archive root. */
export function createHhrDisplayArchiveRepository(
  reader: HhrDisplayArchiveFileReader = nodeFileReader,
): HhrDisplayArchiveRepository {
  return Object.freeze({
    async readLatest(): Promise<HhrDisplayArchive> {
      const filenames = await reader.readdir(HHR_DISPLAY_ARCHIVE_ROOT);
      const capturePrefixes = new Set<string>();
      const captureFiles: Array<Readonly<{ filename: string; capturePrefix: string }>> = [];
      for (const filename of filenames) {
        const match = CAPTURE_FILE.exec(filename);
        if (match === null) throw new Error(`Unexpected HHR display archive filename: ${filename}`);
        const capturePrefix = match[1]!;
        if (capturePrefixes.has(capturePrefix)) throw new Error(`Ambiguous HHR capture timestamp: ${capturePrefix}`);
        capturePrefixes.add(capturePrefix);
        captureFiles.push(Object.freeze({ filename, capturePrefix }));
      }
      captureFiles.sort((left, right) => right.capturePrefix.localeCompare(left.capturePrefix));
      for (const { filename } of captureFiles) {
        const candidate = parseArchive(
          await reader.readFile(path.join(HHR_DISPLAY_ARCHIVE_ROOT, filename)),
          filename,
        );
        if (candidate !== null) return candidate;
      }
      throw new Error('No valid Phase 2 HHR display archive is available.');
    },
  });
}
