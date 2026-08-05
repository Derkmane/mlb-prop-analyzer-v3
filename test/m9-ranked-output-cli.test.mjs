import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildM9RankedFixtureEvidence,
  formatM9RankedFixtureTable,
} from '../scripts/print-m9-ranked-batter-hits-fixture.mjs';

const SCRIPT_PATH = 'scripts/print-m9-ranked-batter-hits-fixture.mjs';
let firstEvidencePromise;

function firstEvidence() {
  firstEvidencePromise ??= buildM9RankedFixtureEvidence();
  return firstEvidencePromise;
}

test('the fixture-backed ranked-output CLI is deterministic for identical inputs', async () => {
  const first = await firstEvidence();
  const second = await buildM9RankedFixtureEvidence();

  assert.deepEqual(first.output, second.output);
  assert.equal(
    JSON.stringify(first.output, null, 2),
    JSON.stringify(second.output, null, 2),
  );
  assert.equal(
    formatM9RankedFixtureTable(first.output),
    formatM9RankedFixtureTable(second.output),
  );
});

test('ranked CLI rows match the existing application ranking adapter exactly', async () => {
  const evidence = await firstEvidence();
  assert.equal(
    evidence.output.rows.length,
    evidence.ranking.rankedCandidates.length,
  );
  assert.equal(evidence.ranking.excludedCandidates.length, 0);
  assert.equal(
    evidence.output.normalizedOfferCount,
    evidence.output.rankedRowCount + evidence.output.fixtureExclusionCount,
  );
  assert.ok(evidence.output.fixtureExclusionCount > 0);
  assert.ok(
    evidence.output.fixtureExclusions.every(
      (exclusion) =>
        exclusion.reason === 'FIXTURE_HAND_NOT_RUNTIME_SUPPORTED' &&
        /excluded rather than coerced/u.test(exclusion.explanation),
    ),
  );

  evidence.output.rows.forEach((row, index) => {
    const candidate = evidence.ranking.rankedCandidates[index];
    assert.ok(candidate);
    const details = candidate.featureData.values.batterHits;
    assert.ok(details && typeof details === 'object' && !Array.isArray(details));

    assert.equal(row.rank, index + 1);
    assert.equal(row.playerName, candidate.playerName);
    assert.equal(row.market, candidate.marketLabel);
    assert.equal(row.selectedSide, candidate.selectedSide);
    assert.equal(row.postedLine, candidate.line);
    assert.equal(row.offerType, details.offerType);
    assert.equal(row.pWin, candidate.pWin);
    assert.equal(row.pLoss, candidate.pLoss);
    assert.equal(row.pVoid, candidate.pVoid);
    assert.equal(row.pWinGivenGrades, candidate.pWinGivenGrades);
    assert.equal(row.diagnosticOnly.pBase, details.pBase);
    assert.equal(
      row.diagnosticOnly.contextProbabilityDelta,
      details.contextProbabilityDelta,
    );
    assert.equal(row.modelVersion, candidate.modelVersion);
    assert.equal(
      row.distributionBuilderVersion,
      candidate.distributionBuilderVersion,
    );
    assert.equal(row.settlementVersion, candidate.settlementRuleVersion);
  });
});

test('the CLI layer formats existing candidate probabilities without computing or settling them', async () => {
  const source = await readFile(SCRIPT_PATH, 'utf8');
  const evidence = await firstEvidence();

  assert.doesNotMatch(source, /from ['"]\.\.\/dist\/src\/core\//u);
  assert.doesNotMatch(source, /compareSettlementResultsForRanking/u);
  assert.doesNotMatch(source, /settleM8|settleM8_5|createM8|buildM8_5Validated/u);
  assert.doesNotMatch(
    source,
    /candidate\.p(?:Win|Loss|Void|WinGivenGrades)\s*[+\-*/]/u,
  );

  for (const [index, candidate] of evidence.ranking.rankedCandidates.entries()) {
    const row = evidence.output.rows[index];
    assert.ok(row);
    assert.equal(row.pWin, candidate.pWin);
    assert.equal(row.pLoss, candidate.pLoss);
    assert.equal(row.pVoid, candidate.pVoid);
    assert.equal(row.pWinGivenGrades, candidate.pWinGivenGrades);
  }
});

test('production and ranking remain disabled after the fixture CLI runs', async () => {
  const source = await readFile(SCRIPT_PATH, 'utf8');
  const evidence = await firstEvidence();

  assert.match(source, /assertProductionRankingDisabled\(\)/u);
  assert.match(source, /JSON\.stringify\(PRODUCTION_REGISTRIES\)/u);
  assert.match(source, /The fixture CLI mutated the production registries/u);
  assert.equal(evidence.output.productionRankingEnabled, false);
  assert.equal(evidence.output.fixtureBackedEvidence, true);
  assert.equal(evidence.output.liveBoard, false);
  assert.match(evidence.output.notice, /Production ranking is DISABLED/u);
  assert.match(evidence.output.notice, /not a live board/u);
  assert.ok(
    evidence.candidateResults.every(
      (result) =>
        result.productionEnabled === false &&
        result.rankingEnabled === false &&
        result.hardDiscoveryFilterEnabled === false,
    ),
  );

  process.stdout.write('\n--- M9 RANKED FIXTURE OUTPUT ---\n');
  process.stdout.write(formatM9RankedFixtureTable(evidence.output));
  process.stdout.write('--- END M9 RANKED FIXTURE OUTPUT ---\n');
});
