import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PHASE1_DISPLAY_ARCHIVE_CONTRACT,
  PHASE1_DISPLAY_ARCHIVE_VERSION,
  buildPhase1DisplayArchive,
  persistImmutablePhase1DisplayArchive,
} from '../scripts/build-phase1-display-archive.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const CAPTURED_AT = '2026-08-10T20:48:03.213Z';

function batterHitsFullArchive() {
  return {
    captureIdentity: {
      captureKey: `20260810T204803213Z--${SHA_A}`,
      capturedAt: CAPTURED_AT,
      rawProviderSnapshotSha256: SHA_A,
    },
    capturedAt: CAPTURED_AT,
    captureDateUtc: '2026-08-10',
    productionEnabled: false,
    productionRankingEnabled: false,
    archiveSha256: SHA_B,
    providerSnapshots: [{ rawBody: { base64: 'large-provider-payload' } }],
    normalizedOffers: [{ completeNormalizedOffer: { large: true } }],
    exclusions: [{ reason: 'not-for-display' }],
    evidence: { large: true },
    rankedRows: [
      {
        rank: 1,
        normalizedOffer: {
          providerEventId: 'event-hits',
          providerGameId: 5059554,
          providerPlayerId: 101,
          providerTeamId: 10,
          playerName: 'Hits Player',
          teamName: 'Hits Team',
          homeTeamName: 'Home Team',
          awayTeamName: 'Away Team',
          eventCommenceTime: '2026-08-10T23:10:00.000Z',
          baseMarketKey: 'batter_hits',
          providerMarketKey: 'batter_hits_alternate',
          offerType: 'alternate',
          selectedSide: 'lower',
          postedLine: 1.5,
          americanPrice: -115,
          multiplier: 0.95,
          completeNormalizedOffer: { intentionally: 'omitted' },
        },
        probabilities: {
          pWin: 0.61,
          pLoss: 0.39,
          pVoid: 0,
          pWinGivenGrades: 0.61,
        },
        lineage: {
          modelVersion: 'hits-model-v1',
          distributionBuilderVersion: 'hits-distribution-v1',
          lineupStatus: 'projected',
          finalEvaluationSha256: SHA_A,
          runtimeFactorReferences: { intentionally: 'omitted' },
        },
        candidate: { intentionally: 'omitted' },
        baseEvaluation: { intentionally: 'omitted' },
        finalEvaluation: { intentionally: 'omitted' },
        distribution: { intentionally: 'omitted' },
      },
    ],
  };
}

function hhrFullArchive() {
  return {
    archiveVersion: 1,
    archiveContract: 'm10-hhr-prospective-evidence-v1',
    captureKey: `20260810T204803213Z--${SHA_A}`,
    capturedAt: CAPTURED_AT,
    captureDateUtc: '2026-08-10',
    archiveSha256: SHA_B,
    games: [
      {
        providerEventId: 'event-hhr',
        gameId: 5059554,
        date: '2026-08-10T23:10:00.000Z',
        homeTeamName: 'Home Team',
        awayTeamName: 'Away Team',
      },
    ],
    source: { intentionally: 'omitted' },
    exclusions: [{ intentionally: 'omitted' }],
    rows: [
      {
        providerEventId: 'event-hhr',
        providerGameId: 5059554,
        providerPlayerId: 202,
        providerTeamId: 20,
        providerMarketKey: 'batter_hits_runs_rbis_alternate',
        offerType: 'alternate',
        playerName: 'HHR Player',
        teamName: 'HHR Team',
        lineupStatus: 'confirmed',
        selectedSide: 'higher',
        postedLine: 0.5,
        americanPrice: null,
        multiplier: 1.02,
        archivedPWin: 0.67,
        archivedPLoss: 0.33,
        archivedPVoid: 0,
        archivedPWinGivenGrades: 0.67,
        distributionIdentity: {
          mean: 1.8,
          dispersionAlpha: 0.4,
          modelVersion: 'hhr-model-v2',
          distributionBuilderVersion: 'hhr-distribution-v1',
        },
        inputLineage: {
          lineupStatus: 'confirmed',
          teamImpliedRunTotal: 4.5,
          intentionally: 'omitted',
        },
      },
    ],
    safety: {
      productionEnabled: false,
      rankingEnabled: false,
      evidenceOnly: true,
      gradingPerformed: false,
      archiveModified: false,
    },
  };
}

function assertTrimmedShape(display, market) {
  assert.equal(display.displayArchiveVersion, PHASE1_DISPLAY_ARCHIVE_VERSION);
  assert.equal(display.displayArchiveContract, PHASE1_DISPLAY_ARCHIVE_CONTRACT);
  assert.equal(display.market, market);
  assert.equal(display.productionEnabled, false);
  assert.equal(display.productionRankingEnabled, false);
  assert.equal(display.rows.length, 1);
  for (const forbidden of [
    'providerSnapshots',
    'normalizedOffers',
    'candidate',
    'baseEvaluation',
    'finalEvaluation',
    'distribution',
    'inputLineage',
    'exclusions',
    'evidence',
  ]) {
    assert.equal(JSON.stringify(display).includes(`"${forbidden}"`), false, `${forbidden} leaked into display archive`);
  }
}

test('Batter Hits display archive copies only frontend fields and preserves probabilities verbatim', () => {
  const display = buildPhase1DisplayArchive({
    market: 'batter-hits',
    fullArchive: batterHitsFullArchive(),
    fullArchiveFileSha256: SHA_A,
  });
  assertTrimmedShape(display, 'batter-hits');
  assert.equal(display.fullArchiveSha256, SHA_B);
  assert.equal(display.fullArchiveFileSha256, SHA_A);
  assert.equal(display.modelVersion, 'hits-model-v1');
  assert.equal(display.distributionBuilderVersion, 'hits-distribution-v1');
  assert.deepEqual(display.rows[0], {
    rank: 1,
    boardSource: null,
    providerBookmakerKey: 'underdog',
    providerRegion: 'us_dfs',
    settlementRuleVersion: null,
    providerEventId: 'event-hits',
    providerGameId: 5059554,
    providerPlayerId: 101,
    providerTeamId: 10,
    playerName: 'Hits Player',
    teamName: 'Hits Team',
    homeTeamName: 'Home Team',
    awayTeamName: 'Away Team',
    eventCommenceTime: '2026-08-10T23:10:00.000Z',
    baseMarketKey: 'batter_hits',
    providerMarketKey: 'batter_hits_alternate',
    marketLabel: 'Batter Hits',
    offerType: 'alternate',
    settlementStatistic: 'hits',
    selectedSide: 'lower',
    postedLine: 1.5,
    americanPrice: -115,
    multiplier: 0.95,
    pWin: 0.61,
    pLoss: 0.39,
    pVoid: 0,
    pWinGivenGrades: 0.61,
    lineupStatus: 'projected',
    analysisContext: {
      expectedPlateAppearances: null,
      lineupSlot: null,
      batterSide: null,
      opposingStarterHand: null,
      venue: null,
      teamImpliedRunTotal: null,
    },
  });
});

test('Batter Hits display archive copies available analysis lineage without requiring missing fields', () => {
  const archive = batterHitsFullArchive();
  archive.rankedRows[0].candidate = {
    featureData: {
      values: {
        batterHits: {
          lineupSlot: 2,
          batterSide: 'L',
          opposingStarterHand: 'R',
        },
      },
    },
  };
  archive.rankedRows[0].distribution = {
    opportunityDistribution: {
      probabilities: [0, 0, 0.1, 0.3, 0.4, 0.2],
    },
  };
  const display = buildPhase1DisplayArchive({
    market: 'batter-hits',
    fullArchive: archive,
    fullArchiveFileSha256: SHA_A,
  });
  assert.deepEqual(display.rows[0].analysisContext, {
    expectedPlateAppearances: 3.7,
    lineupSlot: 2,
    batterSide: 'L',
    opposingStarterHand: 'R',
    venue: null,
    teamImpliedRunTotal: null,
  });
});

test('HHR display archive copies exact archived settlement probabilities and omits model internals', () => {
  const display = buildPhase1DisplayArchive({
    market: 'batter-hhr',
    fullArchive: hhrFullArchive(),
    fullArchiveFileSha256: SHA_A,
  });
  assertTrimmedShape(display, 'batter-hhr');
  assert.equal(display.modelVersion, 'hhr-model-v2');
  assert.equal(display.distributionBuilderVersion, 'hhr-distribution-v1');
  assert.deepEqual(display.rows[0], {
    rank: 1,
    boardSource: null,
    providerBookmakerKey: 'underdog',
    providerRegion: 'us_dfs',
    settlementRuleVersion: null,
    providerEventId: 'event-hhr',
    providerGameId: 5059554,
    providerPlayerId: 202,
    providerTeamId: 20,
    playerName: 'HHR Player',
    teamName: 'HHR Team',
    homeTeamName: 'Home Team',
    awayTeamName: 'Away Team',
    eventCommenceTime: '2026-08-10T23:10:00.000Z',
    baseMarketKey: 'batter_hits_runs_rbis',
    providerMarketKey: 'batter_hits_runs_rbis_alternate',
    marketLabel: 'Batter Hits + Runs + RBIs',
    offerType: 'alternate',
    settlementStatistic: 'hits+runs+rbi',
    selectedSide: 'higher',
    postedLine: 0.5,
    americanPrice: null,
    multiplier: 1.02,
    pWin: 0.67,
    pLoss: 0.33,
    pVoid: 0,
    pWinGivenGrades: 0.67,
    lineupStatus: 'confirmed',
    analysisContext: {
      expectedPlateAppearances: null,
      lineupSlot: null,
      batterSide: null,
      opposingStarterHand: null,
      venue: null,
      teamImpliedRunTotal: 4.5,
    },
  });
});

test('trimmed display rows use canonical probability order and assign fresh ranks', () => {
  const archive = hhrFullArchive();
  const base = archive.rows[0];
  archive.rows = [
    base,
    {
      ...base,
      providerPlayerId: 203,
      playerName: 'HHR Player B',
      archivedPWin: 0.72,
      archivedPLoss: 0.18,
      archivedPVoid: 0.10,
      archivedPWinGivenGrades: 0.80,
    },
    {
      ...base,
      providerPlayerId: 204,
      playerName: 'HHR Player C',
      archivedPWin: 0.76,
      archivedPLoss: 0.19,
      archivedPVoid: 0.05,
      archivedPWinGivenGrades: 0.80,
    },
  ];
  const display = buildPhase1DisplayArchive({
    market: 'batter-hhr',
    fullArchive: archive,
    fullArchiveFileSha256: SHA_A,
  });
  assert.deepEqual(
    display.rows.map((row) => [row.rank, row.playerName, row.pWinGivenGrades, row.pVoid]),
    [
      [1, 'HHR Player C', 0.80, 0.05],
      [2, 'HHR Player B', 0.80, 0.10],
      [3, 'HHR Player', 0.67, 0],
    ],
  );
});

test('display persistence is immutable and duplicate capture identity fails closed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'phase1-display-'));
  try {
    const display = buildPhase1DisplayArchive({
      market: 'batter-hits',
      fullArchive: batterHitsFullArchive(),
      fullArchiveFileSha256: SHA_A,
    });
    const target = path.join(root, 'captures', `${display.captureKey}.json`);
    const first = await persistImmutablePhase1DisplayArchive({
      filePath: target,
      displayArchive: display,
    });
    const bytes = await readFile(target, 'utf8');
    assert.equal(bytes, `${JSON.stringify(display, null, 2)}\n`);
    assert.ok(first.byteLength > 0);
    await assert.rejects(
      persistImmutablePhase1DisplayArchive({ filePath: target, displayArchive: display }),
      /duplicate capture identity refused/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('display builder fails closed on enabled archives and unsupported markets', () => {
  assert.throws(
    () =>
      buildPhase1DisplayArchive({
        market: 'batter-hits',
        fullArchive: { ...batterHitsFullArchive(), productionEnabled: true },
        fullArchiveFileSha256: SHA_A,
      }),
    /not production and ranking disabled/u,
  );
  assert.throws(
    () =>
      buildPhase1DisplayArchive({
        market: 'unknown',
        fullArchive: batterHitsFullArchive(),
        fullArchiveFileSha256: SHA_A,
      }),
    /Unsupported display archive market/u,
  );
});
