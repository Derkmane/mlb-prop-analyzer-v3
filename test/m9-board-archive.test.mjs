import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildM9ProspectiveBoardArchive,
  createM9RawProviderSnapshot,
  m9ArchiveFilePath,
  persistImmutableM9BoardArchive,
  sha256Bytes,
} from '../scripts/m9-board-archive-utils.mjs';
import { buildM9RankedFixtureEvidence } from '../scripts/print-m9-ranked-batter-hits-fixture.mjs';
import {
  M9_GAMES_FIXTURE_PATH,
  M9_LINEUPS_FIXTURE_PATH,
  M9_ODDS_FIXTURE_PATH,
} from '../dist/test/helpers/m9-batter-hits-final-runtime-fixture.js';

const FIXED_CAPTURED_AT = '2026-07-23T15:12:25.190Z';

function snapshot({ provider, label, filePath, pathname }) {
  return readFile(filePath).then((rawBodyBytes) =>
    createM9RawProviderSnapshot({
      provider,
      label,
      capturedAt: FIXED_CAPTURED_AT,
      request: {
        method: 'GET',
        origin:
          provider === 'The Odds API'
            ? 'https://api.the-odds-api.com'
            : 'https://api.balldontlie.io',
        pathname,
        queryKeys: ['fixture'],
        headerNames: [],
      },
      response: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
      },
      rawBodyBytes,
      requireNonemptyRecords: true,
    }),
  );
}

const evidence = await buildM9RankedFixtureEvidence();
const providerSnapshots = await Promise.all([
  snapshot({
    provider: 'The Odds API',
    label: 'Committed Underdog Batter Hits board',
    filePath: M9_ODDS_FIXTURE_PATH,
    pathname: '/v4/sports/baseball_mlb/events/fixture/odds',
  }),
  snapshot({
    provider: 'BALLDONTLIE MLB API',
    label: 'Committed BALLDONTLIE games',
    filePath: M9_GAMES_FIXTURE_PATH,
    pathname: '/mlb/v1/games',
  }),
  snapshot({
    provider: 'BALLDONTLIE MLB API',
    label: 'Committed BALLDONTLIE lineups',
    filePath: M9_LINEUPS_FIXTURE_PATH,
    pathname: '/mlb/v1/lineups',
  }),
]);

function fixtureArchive() {
  return buildM9ProspectiveBoardArchive({
    archiveDate: '2026-07-23',
    capturedAt: FIXED_CAPTURED_AT,
    providerSnapshots,
    normalizedOffers: evidence.board.offers,
    candidateEvaluations: evidence.candidateResults.map((result, index) =>
      Object.freeze({
        offer: evidence.board.offers[index],
        result,
      }),
    ),
    ranking: evidence.ranking,
    evidence: Object.freeze({
      liveBoard: false,
      fixtureBackedEvidence: true,
      productionRegistryUnchanged: true,
    }),
  });
}

test('a fixture-backed archive preserves every required offer, probability, lineup, factor, and version field', () => {
  const archive = fixtureArchive();
  assert.equal(archive.productionEnabled, false);
  assert.equal(archive.productionRankingEnabled, false);
  assert.equal(archive.gradingPerformed, false);
  assert.equal(archive.counts.normalizedOfferCount, 34);
  assert.equal(archive.counts.composedCandidateCount, 34);
  assert.equal(archive.counts.rankedCandidateCount, 34);
  assert.equal(archive.rankedRows.length, 34);

  const first = archive.rankedRows[0];
  const sourceCandidate = evidence.ranking.rankedCandidates[0];
  const sourceResult = evidence.candidateResults.find(
    (result) => result.candidate === sourceCandidate,
  );
  assert.ok(sourceResult);
  const sourceDetails = Object.values(sourceCandidate.featureData.values)[0];
  assert.ok(sourceDetails);

  assert.equal(first.rank, 1);
  assert.equal(first.normalizedOffer.playerName, sourceCandidate.playerName);
  assert.equal(first.normalizedOffer.selectedSide, sourceCandidate.selectedSide);
  assert.equal(first.normalizedOffer.postedLine, sourceCandidate.line);
  assert.equal(first.probabilities.pWin, sourceCandidate.pWin);
  assert.equal(first.probabilities.pLoss, sourceCandidate.pLoss);
  assert.equal(first.probabilities.pVoid, sourceCandidate.pVoid);
  assert.equal(
    first.probabilities.pWinGivenGrades,
    sourceCandidate.pWinGivenGrades,
  );
  assert.equal(first.diagnosticOnly.pBase, sourceDetails.pBase);
  assert.equal(
    first.diagnosticOnly.contextProbabilityDelta,
    sourceDetails.contextProbabilityDelta,
  );
  assert.equal(
    first.lineage.baseDistributionSha256,
    sourceDetails.baseDistributionSha256,
  );
  assert.equal(
    first.lineage.finalDistributionSha256,
    sourceDetails.finalDistributionSha256,
  );
  assert.equal(
    first.lineage.lineupStatus,
    sourceDetails.lineupStatus,
  );
  assert.equal(
    first.lineage.lineupSourceSnapshotSha256,
    sourceDetails.lineupSourceSnapshotSha256,
  );
  assert.deepEqual(
    first.lineage.factorDispositions,
    sourceDetails.factorDispositions,
  );
  assert.deepEqual(
    first.lineage.runtimeFactorReferences,
    sourceDetails.runtimeFactorReferences,
  );
  assert.equal(first.lineage.modelVersion, sourceCandidate.modelVersion);
  assert.equal(
    first.lineage.distributionBuilderVersion,
    sourceCandidate.distributionBuilderVersion,
  );
  assert.equal(
    first.lineage.settlementRuleVersion,
    sourceCandidate.settlementRuleVersion,
  );
  assert.deepEqual(first.candidate, sourceCandidate);
  assert.deepEqual(first.baseEvaluation, sourceResult.baseEvaluation);
  assert.deepEqual(first.finalEvaluation, sourceResult.finalEvaluation);
});

test('re-archiving an existing date fails closed without overwriting even identical bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm9-board-archive-'));
  const filePath = m9ArchiveFilePath(root, '2026-07-23');
  const archive = fixtureArchive();
  try {
    const first = await persistImmutableM9BoardArchive({ filePath, archive });
    const originalBytes = await readFile(filePath);
    assert.equal(first.archiveSha256, archive.archiveSha256);

    await assert.rejects(
      persistImmutableM9BoardArchive({ filePath, archive }),
      /rerun refused without overwrite/u,
    );
    assert.deepEqual(await readFile(filePath), originalBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('raw provider bytes and their SHA-256 survive unchanged', async () => {
  const rawBodyBytes = Buffer.from(' {\n  "data": [{"id": 7}]\n}\n', 'utf8');
  const rawSnapshot = createM9RawProviderSnapshot({
    provider: 'fixture provider',
    label: 'whitespace-sensitive fixture',
    capturedAt: FIXED_CAPTURED_AT,
    request: {
      method: 'GET',
      origin: 'https://example.test',
      pathname: '/raw',
      queryKeys: [],
      headerNames: [],
    },
    response: { status: 200, statusText: 'OK', headers: {} },
    rawBodyBytes,
    requireNonemptyRecords: true,
  });
  assert.deepEqual(
    Buffer.from(rawSnapshot.rawBody.base64, 'base64'),
    rawBodyBytes,
  );
  assert.equal(rawSnapshot.rawBody.byteLength, rawBodyBytes.length);
  assert.equal(rawSnapshot.rawBody.sha256, sha256Bytes(rawBodyBytes));
});

test('the archive layer copies existing outputs and contains no probability, settlement, or ranking implementation', async () => {
  const archive = fixtureArchive();
  archive.rankedRows.forEach((row, index) => {
    const sourceCandidate = evidence.ranking.rankedCandidates[index];
    assert.equal(row.probabilities.pWin, sourceCandidate.pWin);
    assert.equal(row.probabilities.pLoss, sourceCandidate.pLoss);
    assert.equal(row.probabilities.pVoid, sourceCandidate.pVoid);
    assert.equal(
      row.probabilities.pWinGivenGrades,
      sourceCandidate.pWinGivenGrades,
    );
  });

  const source = await readFile(
    'scripts/m9-board-archive-utils.mjs',
    'utf8',
  );
  assert.doesNotMatch(source, /compareSettlementResultsForRanking/u);
  assert.doesNotMatch(source, /rankPredictionCandidates/u);
  assert.doesNotMatch(source, /settle[A-Z]|Poisson|convol/u);
  assert.doesNotMatch(source, /pWin\s*[+*/-]|pLoss\s*[+*/-]|pVoid\s*[+*/-]/u);
});

test('malformed or empty provider responses fail closed', () => {
  const base = {
    provider: 'fixture provider',
    capturedAt: FIXED_CAPTURED_AT,
    request: {
      method: 'GET',
      origin: 'https://example.test',
      pathname: '/board',
      queryKeys: [],
      headerNames: [],
    },
    response: { status: 200, statusText: 'OK', headers: {} },
    requireNonemptyRecords: true,
  };
  assert.throws(
    () =>
      createM9RawProviderSnapshot({
        ...base,
        label: 'empty bytes',
        rawBodyBytes: Buffer.alloc(0),
      }),
    /empty response body/u,
  );
  assert.throws(
    () =>
      createM9RawProviderSnapshot({
        ...base,
        label: 'malformed JSON',
        rawBodyBytes: Buffer.from('{'),
      }),
    /malformed JSON/u,
  );
  assert.throws(
    () =>
      createM9RawProviderSnapshot({
        ...base,
        label: 'empty records',
        rawBodyBytes: Buffer.from('[]'),
      }),
    /no provider records/u,
  );
});

test('identical versioned inputs produce one deterministic archive identity and ranked order', () => {
  const first = fixtureArchive();
  const second = fixtureArchive();
  assert.equal(first.archiveSha256, second.archiveSha256);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(
    first.rankedRows.map((row) => row.normalizedOffer),
    evidence.ranking.rankedCandidates.map((candidate) => {
      const resultIndex = evidence.candidateResults.findIndex(
        (result) => result.candidate === candidate,
      );
      const offer = evidence.board.offers[resultIndex];
      return first.normalizedOffers.find(
        (entry) =>
          entry.providerEventId === offer.providerEventId &&
          entry.providerGameId === offer.providerGameId &&
          entry.providerPlayerId === offer.providerPlayerId &&
          entry.providerMarketKey === offer.providerMarketKey &&
          entry.offerType === offer.offerType &&
          entry.selectedSide === offer.selectedSide &&
          entry.postedLine === offer.line,
      );
    }),
  );
});
