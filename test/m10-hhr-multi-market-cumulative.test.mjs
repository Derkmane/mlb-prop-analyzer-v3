import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildM10MultiMarketCumulativeReport,
  M10_MULTI_MARKET_CUMULATIVE_VERSION,
} from '../scripts/build-m10-multi-market-cumulative-grades.mjs';
import {
  M10_HHR_CUMULATIVE_VERSION,
} from '../scripts/m10-hhr-evidence-utils.mjs';
import {
  M10_SELECTED_SIDE_CUMULATIVE_GRADE_METRICS_VERSION,
  M10_SELECTED_SIDE_GRADE_METRICS_VERSION,
} from '../scripts/m10-selected-side-grade-metrics-utils.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function stableJson(value) {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(',')}}`;
}

function digest(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function hitsReport() {
  return {
    reportVersion: M10_SELECTED_SIDE_CUMULATIVE_GRADE_METRICS_VERSION,
    reportType: 'cumulative-selected-side-and-opportunity-miner-grade-metrics',
    generatedAt: '2026-08-07T12:00:00.000Z',
    sourceSetSha256: SHA_A,
    archivesIncluded: 2,
    selectedSide: {
      deduplicationVersion: 'batter-hits-latest-capture-per-prop-v1',
      deduplicationIdentity: [
        'providerGameId',
        'providerPlayerId',
        'providerMarketKey',
        'offerType',
        'postedLine',
      ],
      deduplicationWinnerRule: 'most-recent-capture-timestamp-only',
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

test('combined M10 cumulative v2 keeps markets separate and hashes component contract identity', () => {
  const hits = hitsReport();
  const hhr = hhrReport();
  const combined = buildM10MultiMarketCumulativeReport({
    batterHits: hits,
    hhr,
  });
  assert.equal(combined.reportVersion, 2);
  assert.equal(combined.reportType, M10_MULTI_MARKET_CUMULATIVE_VERSION);
  assert.equal(combined.generatedAt, '2026-08-07T16:44:50.494Z');
  assert.deepEqual(combined.source, {
    batterHits: {
      reportVersion: hits.reportVersion,
      reportType: hits.reportType,
      sourceSetSha256: hits.sourceSetSha256,
    },
    batterHitsRunsRbis: {
      reportVersion: hhr.reportVersion,
      reportType: hhr.reportType,
      sourceSetSha256: hhr.sourceSetSha256,
    },
  });
  assert.equal(combined.sourceSetSha256, digest(combined.source));
  assert.notEqual(
    combined.sourceSetSha256,
    digest({
      batterHitsSourceSetSha256: hits.sourceSetSha256,
      hhrSourceSetSha256: hhr.sourceSetSha256,
    }),
  );
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

test('combined cumulative v2 rejects historical Batter Hits cumulative v1 instead of reinterpreting it', () => {
  const historical = {
    ...hitsReport(),
    reportVersion: M10_SELECTED_SIDE_GRADE_METRICS_VERSION,
  };
  assert.throws(
    () => buildM10MultiMarketCumulativeReport({ batterHits: historical, hhr: hhrReport() }),
    /Batter Hits cumulative report contract is unsupported/u,
  );
});

test('identical cumulative source reports produce byte-identical combined v2 evidence', () => {
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

test('existing M10 grading workflow isolates HHR evidence from a Batter Hits grading failure and persists combined v2 afterward', async () => {
  const workflow = await readFile('.github/workflows/m10-grade-pending-archives.yml', 'utf8');
  assert.match(workflow, /build-m10-multi-market-cumulative-grades\.mjs/u);
  assert.match(
    workflow,
    /set -euo pipefail[\s\S]*build-m10-multi-market-cumulative-grades\.mjs 2>&1 \| tee/u,
  );
  assert.match(workflow, /artifacts\/board-archives\/cumulative\/\*\*/u);
  assert.match(workflow, /if:\s*always\(\)[\s\S]*artifacts\/board-archives\/cumulative\/\*\*/u);
  assert.match(
    workflow,
    /git add -f -- artifacts\/board-archives\/cumulative\/m10-multi-market-cumulative-selected-side-v2--\*\.json/u,
  );
  assert.doesNotMatch(
    workflow,
    /git add -f -- artifacts\/board-archives\/cumulative\/m10-multi-market-cumulative-selected-side-v1--\*\.json/u,
  );

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
    /if: always\(\) && \(steps\.grade-batter-hits\.outcome == 'failure' \|\| steps\.grade-hhr\.outcome == 'failure'\)/u,
  );
  assert.match(failureBlock, /exit 1/u);
});

test('combined cumulative builder passes Node syntax checking', () => {
  const result = spawnSync(process.execPath, ['--check', 'scripts/build-m10-multi-market-cumulative-grades.mjs'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});
