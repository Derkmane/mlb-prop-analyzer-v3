import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  buildM10MultiMarketCumulativeReport,
  M10_MULTI_MARKET_CUMULATIVE_VERSION,
} from '../scripts/build-m10-multi-market-cumulative-grades.mjs';
import {
  M10_HHR_CUMULATIVE_VERSION,
} from '../scripts/m10-hhr-evidence-utils.mjs';
import {
  M10_SELECTED_SIDE_GRADE_METRICS_VERSION,
} from '../scripts/m10-selected-side-grade-metrics-utils.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function hitsReport() {
  return {
    reportVersion: M10_SELECTED_SIDE_GRADE_METRICS_VERSION,
    reportType: 'cumulative-selected-side-and-opportunity-miner-grade-metrics',
    generatedAt: '2026-08-07T12:00:00.000Z',
    sourceSetSha256: SHA_A,
    archivesIncluded: 2,
    selectedSide: {
      summary: { picksGraded: 50 },
      calibration: [],
    },
    opportunityMiner: { summary: { picksGraded: 4 } },
    safety: {
      productionEnabled: false,
      rankingEnabled: false,
      archivesModified: false,
      finalOnlySourceGradesRequired: true,
    },
  };
}

function hhrReport() {
  return {
    reportVersion: 1,
    reportType: M10_HHR_CUMULATIVE_VERSION,
    generatedAt: '2026-08-07T16:44:50.494Z',
    sourceSetSha256: SHA_B,
    archivesIncluded: 1,
    selectedSide: {
      summary: { picksGraded: 36 },
      calibration: [],
      perLine: {
        '0.5': { summary: { picksGraded: 10 }, calibration: [] },
        '1.5': { summary: { picksGraded: 25 }, calibration: [] },
        '2.5+': { summary: { picksGraded: 1 }, calibration: [] },
      },
    },
    safety: {
      productionEnabled: false,
      rankingEnabled: false,
      evidenceOnly: true,
      archivesModified: false,
      deepLineCohort: '2.5+',
      minimumCalibrationBucketCount: 30,
    },
  };
}

test('combined M10 cumulative evidence keeps Batter Hits and HHR separate with no cross-market pooling', () => {
  const combined = buildM10MultiMarketCumulativeReport({
    batterHits: hitsReport(),
    hhr: hhrReport(),
  });
  assert.equal(combined.reportType, M10_MULTI_MARKET_CUMULATIVE_VERSION);
  assert.equal(combined.generatedAt, '2026-08-07T16:44:50.494Z');
  assert.equal(combined.markets.batterHits.selectedSide.summary.picksGraded, 50);
  assert.equal(combined.markets.batterHitsRunsRbis.selectedSide.summary.picksGraded, 36);
  assert.equal(
    combined.markets.batterHitsRunsRbis.selectedSide.perLine['2.5+'].summary.picksGraded,
    1,
  );
  assert.equal(combined.safety.crossMarketPooling, false);
  assert.equal(combined.safety.productionEnabled, false);
  assert.equal(combined.safety.rankingEnabled, false);
});

test('identical cumulative source reports produce byte-identical combined evidence', () => {
  const first = buildM10MultiMarketCumulativeReport({
    batterHits: hitsReport(),
    hhr: hhrReport(),
  });
  const second = buildM10MultiMarketCumulativeReport({
    batterHits: hitsReport(),
    hhr: hhrReport(),
  });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.sourceSetSha256, second.sourceSetSha256);
});

test('HHR cumulative runtime derives generatedAt from immutable Step 3 grade and later grade reports rather than wall-clock time', async () => {
  const script = await readFile('scripts/grade-m10-hhr-pending-archives.mjs', 'utf8');
  const sourceTimeIndex = script.indexOf('const cumulativeGeneratedAt = [');
  const buildIndex = script.indexOf('const cumulative = buildM10HhrCumulativeSelectedSideReport');
  assert.ok(sourceTimeIndex >= 0);
  assert.ok(sourceTimeIndex < buildIndex);
  const sourceBlock = script.slice(sourceTimeIndex, buildIndex);
  assert.match(sourceBlock, /step3Archive\.gradedAt/u);
  assert.doesNotMatch(sourceBlock, /step3Archive\.generatedAt/u);
  assert.match(sourceBlock, /gradeReports\.map\(\(report\) => report\.gradedAt\)/u);
  const buildBlock = script.slice(buildIndex, script.indexOf('const cumulativePath', buildIndex));
  assert.match(buildBlock, /generatedAt: cumulativeGeneratedAt/u);
  assert.doesNotMatch(buildBlock, /new Date/u);
});

test('existing M10 grading workflow isolates HHR evidence from a Batter Hits grading failure and still fails the job afterward', async () => {
  const workflow = await readFile('.github/workflows/m10-grade-pending-archives.yml', 'utf8');
  assert.match(workflow, /build-m10-multi-market-cumulative-grades\.mjs/u);
  assert.match(
    workflow,
    /set -euo pipefail[\s\S]*build-m10-multi-market-cumulative-grades\.mjs 2>&1 \| tee/u,
  );
  assert.match(workflow, /artifacts\/board-archives\/cumulative\/\*\*/u);
  assert.match(workflow, /if:\s*always\(\)[\s\S]*artifacts\/board-archives\/cumulative\/\*\*/u);

  const hitsIndex = workflow.indexOf('- name: Grade only Batter Hits archives whose exact games are final');
  const hhrIndex = workflow.indexOf('- name: Grade only HHR archives whose exact games are final and accumulate HHR evidence');
  const persistIndex = workflow.indexOf('- name: Persist small cumulative grading report to repository');
  const preserveFailureIndex = workflow.indexOf('- name: Preserve Batter Hits grading failure after HHR evidence');
  assert.ok(hitsIndex >= 0);
  assert.ok(hitsIndex < hhrIndex);
  assert.ok(hhrIndex < persistIndex);
  assert.ok(persistIndex < preserveFailureIndex);

  const hitsBlock = workflow.slice(hitsIndex, hhrIndex);
  assert.match(hitsBlock, /id:\s*grade-batter-hits/u);
  assert.match(hitsBlock, /continue-on-error:\s*true/u);

  const failureBlock = workflow.slice(preserveFailureIndex);
  assert.match(
    failureBlock,
    /if:\s*always\(\) && steps\.grade-batter-hits\.outcome == 'failure'/u,
  );
  assert.match(failureBlock, /exit 1/u);
});

test('combined cumulative builder passes Node syntax checking', () => {
  const result = spawnSync(process.execPath, ['--check', 'scripts/build-m10-multi-market-cumulative-grades.mjs'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});
