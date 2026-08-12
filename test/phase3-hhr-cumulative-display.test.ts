import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  createHhrCumulativeDisplayEvidenceRepository,
  HHR_CUMULATIVE_DISPLAY_EVIDENCE_ROOT,
  HHR_DISPLAY_APP_JS,
  renderHhrDisplayAppPage,
  type HhrCumulativeDisplayEvidenceFileReader,
} from '../src/adapters/index.js';
import {
  readLatestHhrDisplayUiBoard,
  type HhrCumulativeDisplayEvidence,
  type HhrCumulativeDisplayEvidenceRepository,
  type HhrDisplayArchive,
  type HhrDisplayArchiveRepository,
} from '../src/application/index.js';

function summary(picksGraded: number, voids = 0) {
  const decidedPicks = picksGraded - voids;
  return Object.freeze({
    picksGraded,
    wins: decidedPicks,
    losses: 0,
    voids,
    decidedPicks,
    observedWinRate: decidedPicks === 0 ? null : 1,
    predictedMeanWinProbability: decidedPicks === 0 ? null : 0.61,
    observedMinusPredicted: decidedPicks === 0 ? null : 0.39,
    expectedWins: decidedPicks * 0.61,
    actualMinusExpectedWins: decidedPicks * 0.39,
    binaryBrier: decidedPicks === 0 ? null : 0.15,
    binaryLogLoss: decidedPicks === 0 ? null : 0.49,
  });
}

function band(picksGraded: number) {
  return Object.freeze({
    label: '60-65%',
    lowerInclusive: 0.6,
    upperExclusive: 0.65,
    ...summary(picksGraded),
    evidenceStatus: picksGraded >= 30 ? 'sufficient' as const : 'insufficient' as const,
  });
}

function lineEvidence(
  lineCohort: '0.5' | '1.5' | '2.5+',
  picksGraded: number,
  calibrationEligiblePicks: number,
  voids = 0,
) {
  return Object.freeze({
    lineCohort,
    selectedSideRowsBeforeDedup: picksGraded + 3,
    supersededSelectedSideRows: 3,
    calibrationEligiblePicksBeforeDedup: calibrationEligiblePicks + 3,
    summary: summary(picksGraded, voids),
    calibrationEligiblePicks,
    calibration: Object.freeze([band(calibrationEligiblePicks)]),
    evidenceStatus: calibrationEligiblePicks >= 30 ? 'sufficient' as const : 'insufficient' as const,
    minimumCountGatePassed: calibrationEligiblePicks >= 30,
    ownerDecisionRequired: true as const,
    productionEnabled: false as const,
    rankingEnabled: false as const,
  });
}

function fixtureEvidence(
  sourceSetSha256 = 'a'.repeat(64),
  generatedAt = '2026-08-12T17:30:45.315Z',
): HhrCumulativeDisplayEvidence {
  return Object.freeze({
    displayEvidenceVersion: 1,
    displayEvidenceContract: 'phase3-hhr-cumulative-display-v1',
    sourceReportVersion: 1,
    sourceReportType: 'm10-hhr-cumulative-selected-side-v1',
    generatedAt,
    sourceSetSha256,
    archivesIncluded: 6,
    selectedSide: Object.freeze({
      deduplicationVersion: 'hhr-latest-capture-per-prop-v1',
      deduplicationIdentity: Object.freeze([
        'providerGameId',
        'providerPlayerId',
        'providerMarketKey',
        'offerType',
        'postedLine',
      ] as const),
      deduplicationWinnerRule: 'most-recent-capture-timestamp-only',
      selectedSideRowsBeforeDedup: 693,
      retainedSelectedSideRows: 422,
      supersededSelectedSideRows: 271,
      calibrationEligiblePicksBeforeDedup: 683,
      summary: summary(422, 4),
      calibrationEligiblePicks: 418,
      calibration: Object.freeze([band(75)]),
      perLine: Object.freeze({
        '0.5': lineEvidence('0.5', 86, 85, 1),
        '1.5': lineEvidence('1.5', 325, 322, 3),
        '2.5+': lineEvidence('2.5+', 11, 11),
      }),
    }),
    safety: Object.freeze({
      productionEnabled: false,
      rankingEnabled: false,
      evidenceOnly: true,
      ownerDecisionRequired: true,
      archivesModified: false,
      deepLineCohort: '2.5+',
      minimumCalibrationBucketCount: 30,
    }),
  });
}

function readerFor(evidence: readonly HhrCumulativeDisplayEvidence[]): HhrCumulativeDisplayEvidenceFileReader {
  const files = new Map(evidence.map((value) => [
    `m10-hhr-cumulative-selected-side-v1--${value.sourceSetSha256}.json`,
    `${JSON.stringify(value, null, 2)}\n`,
  ]));
  return Object.freeze({
    async readdir(directory: string) {
      assert.equal(directory, HHR_CUMULATIVE_DISPLAY_EVIDENCE_ROOT);
      return [...files.keys()];
    },
    async readFile(filePath: string) {
      const bytes = files.get(path.basename(filePath));
      if (bytes === undefined) throw new Error(`missing fixture ${filePath}`);
      return bytes;
    },
  });
}

function emptyArchive(): HhrDisplayArchive {
  return Object.freeze({
    captureKey: '20260812T180000000Z--' + 'c'.repeat(64),
    capturedAt: '2026-08-12T18:00:00.000Z',
    modelVersion: 'hhr-model-v1',
    distributionBuilderVersion: 'hhr-distribution-v1',
    rows: Object.freeze([]),
    enrichmentByGamePlayerKey: Object.freeze({}),
  });
}

const boardRepository: HhrDisplayArchiveRepository = Object.freeze({
  readLatest: async () => emptyArchive(),
});

test('HHR cumulative display repository reads only committed display evidence and preserves written values literally', async () => {
  assert.match(HHR_CUMULATIVE_DISPLAY_EVIDENCE_ROOT, /artifacts[/\\]display-archives[/\\]batter-hhr[/\\]cumulative$/u);
  assert.equal(HHR_CUMULATIVE_DISPLAY_EVIDENCE_ROOT.includes('board-archives'), false);

  const older = fixtureEvidence('a'.repeat(64), '2026-08-11T17:30:45.315Z');
  const latest = fixtureEvidence('b'.repeat(64));
  const actual = await createHhrCumulativeDisplayEvidenceRepository(readerFor([latest, older])).readLatest();

  assert.deepEqual(actual, latest);
  assert.equal(actual?.selectedSide.retainedSelectedSideRows, 422);
  assert.equal(actual?.selectedSide.supersededSelectedSideRows, 271);
  assert.equal(actual?.selectedSide.perLine['0.5'].summary.picksGraded, 86);
  assert.equal(actual?.selectedSide.perLine['0.5'].calibrationEligiblePicks, 85);
  assert.equal(actual?.selectedSide.perLine['1.5'].summary.picksGraded, 325);
  assert.equal(actual?.selectedSide.perLine['1.5'].calibrationEligiblePicks, 322);
  assert.equal(actual?.selectedSide.perLine['2.5+'].summary.picksGraded, 11);
  assert.equal(actual?.selectedSide.perLine['2.5+'].minimumCountGatePassed, false);
  assert.equal(actual?.safety.ownerDecisionRequired, true);
  assert.equal(actual?.safety.productionEnabled, false);
  assert.equal(actual?.safety.rankingEnabled, false);
});

test('board availability is independent of missing or invalid cumulative display evidence', async () => {
  const missing: HhrCumulativeDisplayEvidenceRepository = Object.freeze({ readLatest: async () => null });
  const missingBoard = await readLatestHhrDisplayUiBoard(boardRepository, missing);
  assert.equal(missingBoard.cumulativeEvidence.available, false);
  assert.equal(missingBoard.cumulativeEvidence.unavailableReason, 'no-hhr-cumulative-display-evidence');

  const invalid: HhrCumulativeDisplayEvidenceRepository = Object.freeze({
    readLatest: async () => { throw new Error('invalid evidence'); },
  });
  const invalidBoard = await readLatestHhrDisplayUiBoard(boardRepository, invalid);
  assert.equal(invalidBoard.cumulativeEvidence.available, false);
  assert.equal(invalidBoard.cumulativeEvidence.unavailableReason, 'invalid-hhr-cumulative-display-evidence');

  const valid: HhrCumulativeDisplayEvidenceRepository = Object.freeze({ readLatest: async () => fixtureEvidence() });
  const validBoard = await readLatestHhrDisplayUiBoard(boardRepository, valid);
  assert.equal(validBoard.cumulativeEvidence.available, true);
  if (validBoard.cumulativeEvidence.available) {
    assert.equal(validBoard.cumulativeEvidence.selectedSide.perLine['0.5'].summary.picksGraded, 86);
    assert.equal(validBoard.cumulativeEvidence.selectedSide.perLine['1.5'].summary.picksGraded, 325);
    assert.equal(validBoard.cumulativeEvidence.selectedSide.perLine['2.5+'].summary.picksGraded, 11);
  }
});

test('UI labels HHR lists as High Probability Altline display sublists without browser ranking or side settlement logic', () => {
  const html = renderHhrDisplayAppPage();
  assert.match(html, /High Probability Altline Props/u);
  assert.match(html, /display sublists of this category, not standalone product categories/u);
  assert.match(html, /HHR 2\.5 Lower Alt/u);
  assert.match(html, /HHR 0\.5 Higher Alt/u);
  assert.equal(HHR_DISPLAY_APP_JS.includes('.sort('), false);
  assert.equal(HHR_DISPLAY_APP_JS.includes('selectedSide ==='), false);
  assert.equal(HHR_DISPLAY_APP_JS.includes('hrr >'), false);
  assert.equal(HHR_DISPLAY_APP_JS.includes('hrr <'), false);
  assert.match(HHR_DISPLAY_APP_JS, /selectedSideOutcome/u);
  assert.match(HHR_DISPLAY_APP_JS, /calibrationEligiblePicks/u);
});

test('missing display directory is clean while malformed safety evidence fails closed', async () => {
  const missing = createHhrCumulativeDisplayEvidenceRepository(Object.freeze({
    async readdir() { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
    async readFile() { throw new Error('must not read'); },
  }));
  assert.equal(await missing.readLatest(), null);

  const invalid = JSON.parse(JSON.stringify(fixtureEvidence())) as Record<string, unknown>;
  (invalid['safety'] as Record<string, unknown>)['productionEnabled'] = true;
  const filename = `m10-hhr-cumulative-selected-side-v1--${'a'.repeat(64)}.json`;
  const repository = createHhrCumulativeDisplayEvidenceRepository(Object.freeze({
    async readdir() { return [filename]; },
    async readFile() { return JSON.stringify(invalid); },
  }));
  await assert.rejects(repository.readLatest(), /Invalid HHR cumulative display evidence contract/u);
});

test('grading workflow persists HHR-only cumulative display evidence before Batter Hits cumulative and keeps no-report as a clean no-op', async () => {
  const workflow = await readFile('.github/workflows/m10-grade-pending-archives.yml', 'utf8');
  const hhrGradeIndex = workflow.indexOf('id: grade-hhr');
  const persistIndex = workflow.indexOf('- name: Persist HHR cumulative display evidence');
  const hitsCumulativeIndex = workflow.indexOf('- name: Build Batter Hits selected-side and cumulative grading evidence');
  assert.ok(hhrGradeIndex >= 0 && persistIndex > hhrGradeIndex && hitsCumulativeIndex > persistIndex);

  const step = workflow.slice(persistIndex, hitsCumulativeIndex);
  assert.match(step, /if: always\(\) && steps\.grade-hhr\.outcome == 'success'/u);
  assert.match(step, /artifacts\/board-archives\/batter-hhr\/cumulative/u);
  assert.match(step, /artifacts\/display-archives\/batter-hhr\/cumulative/u);
  assert.match(step, /phase3-hhr-cumulative-display-v1/u);
  assert.match(step, /No HHR cumulative report to persist; clean no-op\./u);
  assert.match(step, /exit 0/u);
  assert.doesNotMatch(step, /m10-multi-market-cumulative/u);
  assert.doesNotMatch(step, /build-m10-selected-side-cumulative-grades/u);

  assert.match(workflow, /- name: Persist small cumulative grading report to repository/u);
  assert.match(workflow, /git add -f -- artifacts\/board-archives\/cumulative\/m10-multi-market-cumulative-selected-side-v1--\*\.json/u);
});
