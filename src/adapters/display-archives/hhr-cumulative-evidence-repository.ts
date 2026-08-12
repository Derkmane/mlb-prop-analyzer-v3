import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type {
  HhrCumulativeDisplayEvidence,
  HhrCumulativeDisplayEvidenceRepository,
} from '../../application/index.js';

export const HHR_CUMULATIVE_DISPLAY_EVIDENCE_ROOT = path.resolve(
  'artifacts/display-archives/batter-hhr/cumulative',
);

const DISPLAY_EVIDENCE_VERSION = 1;
const DISPLAY_EVIDENCE_CONTRACT = 'phase3-hhr-cumulative-display-v1';
const SOURCE_REPORT_TYPE = 'm10-hhr-cumulative-selected-side-v1';
const CUMULATIVE_FILE = /^m10-hhr-cumulative-selected-side-v1--([a-f0-9]{64})\.json$/u;
const nonnegativeInteger = z.number().int().nonnegative();
const finiteOrNull = z.number().finite().nullable();
const probabilityOrNull = z.number().min(0).max(1).nullable();
const evidenceStatus = z.enum(['sufficient', 'insufficient']);

const performanceSummary = z.strictObject({
  picksGraded: nonnegativeInteger,
  wins: nonnegativeInteger,
  losses: nonnegativeInteger,
  voids: nonnegativeInteger,
  decidedPicks: nonnegativeInteger,
  observedWinRate: probabilityOrNull,
  predictedMeanWinProbability: probabilityOrNull,
  observedMinusPredicted: finiteOrNull,
  expectedWins: z.number().finite().nonnegative(),
  actualMinusExpectedWins: z.number().finite(),
  binaryBrier: z.number().finite().nonnegative().nullable(),
  binaryLogLoss: z.number().finite().nonnegative().nullable(),
});

const calibrationBand = performanceSummary.extend({
  label: z.string().min(1),
  lowerInclusive: z.number().min(0).max(1),
  upperExclusive: z.number().min(0).max(1).nullable(),
  evidenceStatus,
});

const lineEvidence = z.strictObject({
  lineCohort: z.enum(['0.5', '1.5', '2.5+']),
  selectedSideRowsBeforeDedup: nonnegativeInteger,
  supersededSelectedSideRows: nonnegativeInteger,
  calibrationEligiblePicksBeforeDedup: nonnegativeInteger,
  summary: performanceSummary,
  calibrationEligiblePicks: nonnegativeInteger,
  calibration: z.array(calibrationBand),
  evidenceStatus,
  minimumCountGatePassed: z.boolean(),
  ownerDecisionRequired: z.literal(true),
  productionEnabled: z.literal(false),
  rankingEnabled: z.literal(false),
});

const displayEvidence = z.strictObject({
  displayEvidenceVersion: z.literal(DISPLAY_EVIDENCE_VERSION),
  displayEvidenceContract: z.literal(DISPLAY_EVIDENCE_CONTRACT),
  sourceReportVersion: z.literal(1),
  sourceReportType: z.literal(SOURCE_REPORT_TYPE),
  generatedAt: z.iso.datetime({ offset: true }),
  sourceSetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  archivesIncluded: nonnegativeInteger,
  selectedSide: z.strictObject({
    deduplicationVersion: z.string().min(1),
    deduplicationIdentity: z.tuple([
      z.literal('providerGameId'),
      z.literal('providerPlayerId'),
      z.literal('providerMarketKey'),
      z.literal('offerType'),
      z.literal('postedLine'),
    ]),
    deduplicationWinnerRule: z.literal('most-recent-capture-timestamp-only'),
    selectedSideRowsBeforeDedup: nonnegativeInteger,
    retainedSelectedSideRows: nonnegativeInteger,
    supersededSelectedSideRows: nonnegativeInteger,
    calibrationEligiblePicksBeforeDedup: nonnegativeInteger,
    summary: performanceSummary,
    calibrationEligiblePicks: nonnegativeInteger,
    calibration: z.array(calibrationBand),
    perLine: z.strictObject({
      '0.5': lineEvidence,
      '1.5': lineEvidence,
      '2.5+': lineEvidence,
    }),
  }),
  safety: z.strictObject({
    productionEnabled: z.literal(false),
    rankingEnabled: z.literal(false),
    evidenceOnly: z.literal(true),
    ownerDecisionRequired: z.literal(true),
    archivesModified: z.literal(false),
    deepLineCohort: z.literal('2.5+'),
    minimumCalibrationBucketCount: nonnegativeInteger,
  }),
});

export interface HhrCumulativeDisplayEvidenceFileReader {
  readdir(directory: string): Promise<readonly string[]>;
  readFile(filePath: string): Promise<string>;
}

const nodeFileReader: HhrCumulativeDisplayEvidenceFileReader = Object.freeze({
  readdir: async (directory) => readdir(directory),
  readFile: async (filePath) => readFile(filePath, 'utf8'),
});

function isMissingDirectory(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT';
}

function parseEvidence(bytes: string, filename: string): HhrCumulativeDisplayEvidence {
  let input: unknown;
  try {
    input = JSON.parse(bytes);
  } catch {
    throw new Error(`Malformed HHR cumulative display evidence JSON: ${filename}`);
  }
  const parsed = displayEvidence.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid HHR cumulative display evidence contract: ${filename}`);
  }
  const value = parsed.data;
  const match = CUMULATIVE_FILE.exec(filename);
  if (match === null || match[1] !== value.sourceSetSha256) {
    throw new Error(`HHR cumulative display evidence filename/source identity disagreement: ${filename}`);
  }
  for (const cohort of ['0.5', '1.5', '2.5+'] as const) {
    if (value.selectedSide.perLine[cohort].lineCohort !== cohort) {
      throw new Error(`HHR cumulative display evidence line identity disagreement: ${cohort}`);
    }
  }
  if (
    value.selectedSide.retainedSelectedSideRows +
      value.selectedSide.supersededSelectedSideRows !==
    value.selectedSide.selectedSideRowsBeforeDedup
  ) {
    throw new Error('HHR cumulative display evidence dedup counts do not conserve selected-side rows.');
  }
  if (value.selectedSide.summary.picksGraded !== value.selectedSide.retainedSelectedSideRows) {
    throw new Error('HHR cumulative display evidence retained-row summary count disagrees.');
  }
  return Object.freeze(value);
}

/** Read-only access to the committed HHR-only cumulative display-evidence root. */
export function createHhrCumulativeDisplayEvidenceRepository(
  reader: HhrCumulativeDisplayEvidenceFileReader = nodeFileReader,
): HhrCumulativeDisplayEvidenceRepository {
  return Object.freeze({
    async readLatest(): Promise<HhrCumulativeDisplayEvidence | null> {
      let filenames: readonly string[];
      try {
        filenames = await reader.readdir(HHR_CUMULATIVE_DISPLAY_EVIDENCE_ROOT);
      } catch (error) {
        if (isMissingDirectory(error)) return null;
        throw error;
      }
      if (filenames.length === 0) return null;

      const candidates: Array<Readonly<{
        filename: string;
        evidence: HhrCumulativeDisplayEvidence;
      }>> = [];
      for (const filename of filenames) {
        if (!CUMULATIVE_FILE.test(filename)) {
          throw new Error(`Unexpected HHR cumulative display evidence filename: ${filename}`);
        }
        const evidence = parseEvidence(
          await reader.readFile(path.join(HHR_CUMULATIVE_DISPLAY_EVIDENCE_ROOT, filename)),
          filename,
        );
        candidates.push(Object.freeze({ filename, evidence }));
      }
      candidates.sort((left, right) =>
        left.evidence.generatedAt.localeCompare(right.evidence.generatedAt) ||
        left.evidence.sourceSetSha256.localeCompare(right.evidence.sourceSetSha256),
      );
      return candidates.at(-1)?.evidence ?? null;
    },
  });
}
