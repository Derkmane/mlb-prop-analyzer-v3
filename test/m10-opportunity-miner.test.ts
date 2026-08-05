import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  createOpportunityMinerCandidateV1,
  indicativeImpliedProbabilityFromAmericanPrice,
  OPPORTUNITY_MINER_PRICE_EDGE_RULE_V1,
  selectOpportunityMinerFavoritesV1,
  type OpportunityMinerCandidateInput,
} from '../src/categories/index.js';
import type { PredictionCandidate } from '../src/domain/prediction-candidate.js';
import type { SelectedSide } from '../src/domain/selected-side.js';

const FIXTURE_PATH = path.resolve(
  'fixtures/sanitized/m10/opportunity-miner/20260805T160217812Z--235bac8c-price-projection.json',
);
const EXPECTED_CAPTURE_KEY =
  '20260805T160217812Z--235bac8c330999cccfe86b6037a1007eb06f8ec23d1aacdbc3131a70d18db353';
const EXPECTED_ARCHIVE_SHA256 =
  'f817216794f98b3c842170507f10fa0c40526f67f1cdc08084188388e5ca5b26';
const EXPECTED_FILE_SHA256 =
  'a7feb694ee125293aa9e16eadf4bc66085e9d43ea3cc1a9d9721644460c97144';

type TestCandidate = PredictionCandidate<Readonly<{ identity: string }>>;

interface CandidateOptions {
  readonly identity: string;
  readonly pFinal: number;
  readonly pVoid?: number;
  readonly playerId?: string;
  readonly playerName?: string;
  readonly selectedSide?: SelectedSide;
  readonly line?: number;
  readonly eventId?: string;
  readonly gameId?: string;
  readonly pWin?: number;
  readonly pLoss?: number;
}

function candidate(options: CandidateOptions): TestCandidate {
  const pVoid = options.pVoid ?? 0;
  const gradeMass = 1 - pVoid;
  const pWin = options.pWin ?? options.pFinal * gradeMass;
  const pLoss = options.pLoss ?? (1 - options.pFinal) * gradeMass;

  return Object.freeze({
    eventId: options.eventId ?? `event-${options.identity}`,
    gameId: options.gameId ?? `game-${options.identity}`,
    playerId: options.playerId ?? `player-${options.identity}`,
    playerName: options.playerName ?? `Player ${options.identity}`,
    baseMarketKey: 'batter-hits',
    marketLabel: 'Batter Hits',
    line: options.line ?? 0.5,
    selectedSide: options.selectedSide ?? 'higher',
    settlementStatistic: 'hits',
    eligibilityProbability: gradeMass,
    statisticDistribution: Object.freeze({
      probabilities: Object.freeze([1 - options.pFinal, options.pFinal]),
    }),
    pWin,
    pLoss,
    pVoid,
    pWinGivenGrades: options.pFinal,
    modelVersion: 'm8-5-batter-hits-successor-freeze-v1',
    distributionBuilderVersion: 'm9-batter-hits-runtime-distribution-v1',
    settlementRuleVersion: 'batter-hits-settlement-not-production-validated',
    sharedScenarioReference: Object.freeze({ identity: options.identity }),
    featureData: Object.freeze({
      featureId: 'batter-hits',
      schemaVersion: 2,
      values: Object.freeze({}),
    }),
  });
}

function input(
  value: TestCandidate,
  americanPrice: number,
  multiplier = 1,
): OpportunityMinerCandidateInput<TestCandidate> {
  return Object.freeze({ candidate: value, americanPrice, multiplier });
}

function assertClose(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-12,
    `expected ${actual} to equal ${expected} within 1e-12`,
  );
}

test('American-price implied probability is correct for negative and positive prices', () => {
  assertClose(
    indicativeImpliedProbabilityFromAmericanPrice(-110),
    110 / 210,
  );
  assertClose(
    indicativeImpliedProbabilityFromAmericanPrice(150),
    100 / 250,
  );
  assert.throws(
    () => indicativeImpliedProbabilityFromAmericanPrice(0),
    /nonzero integer/,
  );
});

test('Opportunity Miner eligibility requires priceEdge strictly greater than the versioned threshold', () => {
  assert.equal(
    OPPORTUNITY_MINER_PRICE_EDGE_RULE_V1.priceEdgeThresholdExclusive,
    0,
  );
  assert.match(
    OPPORTUNITY_MINER_PRICE_EDGE_RULE_V1.version,
    /positive-american-price-edge-v1/,
  );

  const below = input(candidate({ identity: 'below', pFinal: 0.49 }), 100);
  const equal = input(candidate({ identity: 'equal', pFinal: 0.5 }), 100);
  const above = input(candidate({ identity: 'above', pFinal: 0.51 }), 100);
  const result = selectOpportunityMinerFavoritesV1([below, equal, above]);

  assert.deepEqual(
    result.eligibleCandidates.map((entry) => entry.playerId),
    ['player-above'],
  );
  assert.deepEqual(
    result.ineligibleCandidates.map((entry) => entry.playerId),
    ['player-below', 'player-equal'],
  );
});

test('within Opportunity Miner, order is final P(Win | grades), then P(Void) only', () => {
  const lowerFinal = input(
    candidate({ identity: 'lower-final', pFinal: 0.61, pVoid: 0.01 }),
    200,
  );
  const higherFinalMoreVoid = input(
    candidate({ identity: 'higher-final-more-void', pFinal: 0.64, pVoid: 0.08 }),
    200,
  );
  const higherFinalLessVoid = input(
    candidate({ identity: 'higher-final-less-void', pFinal: 0.64, pVoid: 0.02 }),
    200,
  );

  const result = selectOpportunityMinerFavoritesV1([
    lowerFinal,
    higherFinalMoreVoid,
    higherFinalLessVoid,
  ]);

  assert.deepEqual(
    result.eligibleCandidates.map((entry) => entry.playerId),
    [
      'player-higher-final-less-void',
      'player-higher-final-more-void',
      'player-lower-final',
    ],
  );
});

test('a higher priceEdge cannot improve Opportunity Miner rank', () => {
  const largerEdgeLowerFinal = input(
    candidate({ identity: 'larger-edge', pFinal: 0.55 }),
    200,
  );
  const smallerEdgeHigherFinal = input(
    candidate({ identity: 'smaller-edge', pFinal: 0.6 }),
    -140,
  );
  const result = selectOpportunityMinerFavoritesV1([
    largerEdgeLowerFinal,
    smallerEdgeHigherFinal,
  ]);

  assert.ok(
    result.eligibleCandidates[1]!.opportunityMiner.priceEdge >
      result.eligibleCandidates[0]!.opportunityMiner.priceEdge,
  );
  assert.deepEqual(
    result.eligibleCandidates.map((entry) => entry.playerId),
    ['player-smaller-edge', 'player-larger-edge'],
  );
});

test('multiplier is preserved unchanged and never converted', () => {
  const original = candidate({ identity: 'multiplier', pFinal: 0.6 });
  const lowMultiplier = createOpportunityMinerCandidateV1(
    input(original, -110, 0.7),
  );
  const highMultiplier = createOpportunityMinerCandidateV1(
    input(original, -110, 9.5),
  );

  assert.equal(lowMultiplier.opportunityMiner.multiplier, 0.7);
  assert.equal(highMultiplier.opportunityMiner.multiplier, 9.5);
  assert.equal(
    lowMultiplier.opportunityMiner.postedImpliedProbability,
    highMultiplier.opportunityMiner.postedImpliedProbability,
  );
  assert.equal(
    lowMultiplier.opportunityMiner.priceEdge,
    highMultiplier.opportunityMiner.priceEdge,
  );
  assert.equal(
    OPPORTUNITY_MINER_PRICE_EDGE_RULE_V1.multiplierTreatment,
    'preserve-only-no-conversion',
  );
});

test('Opportunity Miner keeps one prop per player using only the canonical comparator', () => {
  const samePlayerLowerFinal = input(
    candidate({
      identity: 'same-player-low',
      playerId: 'player-shared',
      pFinal: 0.61,
      pVoid: 0,
    }),
    300,
  );
  const samePlayerHigherFinal = input(
    candidate({
      identity: 'same-player-high',
      playerId: 'player-shared',
      pFinal: 0.64,
      pVoid: 0.08,
    }),
    300,
  );
  const sameFinalLowerVoid = input(
    candidate({
      identity: 'same-player-low-void',
      playerId: 'player-shared',
      pFinal: 0.64,
      pVoid: 0.02,
    }),
    300,
  );

  const result = selectOpportunityMinerFavoritesV1([
    samePlayerLowerFinal,
    samePlayerHigherFinal,
    sameFinalLowerVoid,
  ]);

  assert.equal(result.eligibleCandidates.length, 1);
  assert.equal(
    result.eligibleCandidates[0]!.sharedScenarioReference.identity,
    'same-player-low-void',
  );
});

test('adding Opportunity Miner diagnostics leaves every model probability unchanged', () => {
  const original = candidate({
    identity: 'unchanged',
    pFinal: 0.63,
    pVoid: 0.04,
  });
  const enriched = createOpportunityMinerCandidateV1(
    input(original, 200, 1.37),
  );

  assert.equal(enriched.pWin, original.pWin);
  assert.equal(enriched.pLoss, original.pLoss);
  assert.equal(enriched.pVoid, original.pVoid);
  assert.equal(enriched.pWinGivenGrades, original.pWinGivenGrades);
  assert.equal(
    enriched.eligibilityProbability,
    original.eligibilityProbability,
  );
  assert.equal(enriched.statisticDistribution, original.statisticDistribution);
  assert.equal(enriched.selectedSide, original.selectedSide);
  assert.equal(enriched.line, original.line);
});

type ArchiveRow = readonly [
  rank: number,
  providerEventId: string,
  providerGameId: number,
  providerPlayerId: number,
  playerName: string,
  offerType: 'baseline' | 'alternate',
  selectedSide: SelectedSide,
  postedLine: number,
  americanPrice: number,
  multiplier: number,
  pWin: number,
  pLoss: number,
  pVoid: number,
  pWinGivenGrades: number,
];

interface ArchiveProjectionFixture {
  readonly fixtureVersion: 1;
  readonly evidenceType: 'real-live-board-archive-price-projection';
  readonly synthetic: false;
  readonly sourceCaptureKey: string;
  readonly sourceArchiveSha256: string;
  readonly sourceFileSha256: string;
  readonly columns: readonly string[];
  readonly rows: readonly ArchiveRow[];
}

function readArchiveProjection(): ArchiveProjectionFixture {
  return JSON.parse(
    fs.readFileSync(FIXTURE_PATH, 'utf8'),
  ) as ArchiveProjectionFixture;
}

function archiveInput(row: ArchiveRow): OpportunityMinerCandidateInput<TestCandidate> {
  const [
    rank,
    providerEventId,
    providerGameId,
    providerPlayerId,
    playerName,
    offerType,
    selectedSide,
    postedLine,
    americanPrice,
    multiplier,
    pWin,
    pLoss,
    pVoid,
    pWinGivenGrades,
  ] = row;

  const archiveCandidate = candidate({
    identity: `archive-rank-${rank}`,
    eventId: providerEventId,
    gameId: String(providerGameId),
    playerId: String(providerPlayerId),
    playerName,
    selectedSide,
    line: postedLine,
    pFinal: pWinGivenGrades,
    pVoid,
    pWin,
    pLoss,
  });

  return Object.freeze({
    candidate: Object.freeze({
      ...archiveCandidate,
      featureData: Object.freeze({
        ...archiveCandidate.featureData,
        values: Object.freeze({ offerType, sourceArchiveRank: rank }),
      }),
    }),
    americanPrice,
    multiplier,
  });
}

test('the exact August 5 live archive projection yields only Buddy Kennedy, Grant McCray, and Yainer Diaz', () => {
  const fixture = readArchiveProjection();
  assert.equal(fixture.synthetic, false);
  assert.equal(fixture.sourceCaptureKey, EXPECTED_CAPTURE_KEY);
  assert.equal(fixture.sourceArchiveSha256, EXPECTED_ARCHIVE_SHA256);
  assert.equal(fixture.sourceFileSha256, EXPECTED_FILE_SHA256);
  assert.equal(fixture.rows.length, 78);

  const result = selectOpportunityMinerFavoritesV1(
    fixture.rows.map(archiveInput),
  );

  assert.deepEqual(
    result.eligibleCandidates.map((entry) => ({
      playerName: entry.playerName,
      selectedSide: entry.selectedSide,
      line: entry.line,
    })),
    [
      { playerName: 'Buddy Kennedy', selectedSide: 'higher', line: 0.5 },
      { playerName: 'Grant McCray', selectedSide: 'higher', line: 0.5 },
      { playerName: 'Yainer Diaz', selectedSide: 'lower', line: 0.5 },
    ],
  );
  assert.equal(result.ineligibleCandidates.length, 75);
  assert.equal(
    new Set(result.eligibleCandidates.map((entry) => entry.playerId)).size,
    result.eligibleCandidates.length,
  );

  const edges = Object.fromEntries(
    result.eligibleCandidates.map((entry) => [
      entry.playerName,
      entry.opportunityMiner.priceEdge,
    ]),
  );
  assertClose(edges['Buddy Kennedy']!, 0.08105602963187108);
  assertClose(edges['Grant McCray']!, 0.01766149624433533);
  assertClose(edges['Yainer Diaz']!, 0.025486811796722242);
});
