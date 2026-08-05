import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildM10ArchivedCategoryEvidence,
  formatM10ArchivedCategoryTable,
} from '../scripts/print-m9-ranked-batter-hits-fixture.mjs';

const SCRIPT_PATH = 'scripts/print-m9-ranked-batter-hits-fixture.mjs';
const EXPECTED_CAPTURE_KEY =
  '20260805T160217812Z--235bac8c330999cccfe86b6037a1007eb06f8ec23d1aacdbc3131a70d18db353';
let evidencePromise;

function evidence() {
  evidencePromise ??= buildM10ArchivedCategoryEvidence();
  return evidencePromise;
}

test('category output is pinned to the exact real archive and remains production-disabled', async () => {
  const result = await evidence();
  assert.equal(result.output.sourceCaptureKey, EXPECTED_CAPTURE_KEY);
  assert.equal(result.output.sourceOfferCount, 78);
  assert.equal(result.output.productionRankingEnabled, false);
  assert.match(result.output.notice, /DIAGNOSTIC ONLY/u);
  assert.match(result.output.notice, /never affects category order/u);
});

test('the real archive yields the approved Top Five for all three categories', async () => {
  const result = await evidence();
  assert.deepEqual(
    result.output.categories.map((category) => ({
      title: category.title,
      names: category.rows.map((row) => row.playerName),
    })),
    [
      {
        title: 'Opportunity Miner Favorites',
        names: ['Buddy Kennedy', 'Grant McCray', 'Yainer Diaz'],
      },
      {
        title: 'High Probability Baseline Props',
        names: ['Grant McCray', 'Andres Gimenez', 'Hunter Feduccia'],
      },
      {
        title: 'High Probability Altline Props',
        names: [
          'Jose Altuve',
          'Shohei Ohtani',
          'Jeremy Pena',
          'Nathan Lukes',
          'Yordan Alvarez',
        ],
      },
    ],
  );
});

test('category rows preserve archived probabilities and expose price edge as diagnostic only', async () => {
  const result = await evidence();
  const inputByRank = new Map(
    result.inputs.map((input) => [input.candidate.sourceArchiveRank, input]),
  );

  for (const category of result.output.categories) {
    assert.ok(category.rows.length <= 5);
    assert.equal(
      new Set(category.rows.map((row) => row.playerName)).size,
      category.rows.length,
    );
    category.rows.forEach((row, index) => {
      const source = inputByRank.get(row.sourceArchiveRank);
      assert.ok(source);
      assert.equal(row.rank, index + 1);
      assert.equal(row.pWinGivenGrades, source.candidate.pWinGivenGrades);
      assert.equal(row.pVoid, source.candidate.pVoid);
      assert.equal(row.pBase, source.pBase);
      assert.equal(
        row.contextProbabilityDelta,
        source.contextProbabilityDelta,
      );
      assert.equal(row.americanPrice, source.americanPrice);
      assert.equal(row.multiplier, source.multiplier);
      assert.equal(
        row.postedImpliedProbability,
        source.postedImpliedProbability,
      );
      assert.equal(row.priceEdge, source.priceEdge);
      assert.equal(row.priceEdgeLabel, 'DIAGNOSTIC ONLY');
    });
  }
});

test('each category is ordered only by final probability then void probability and overlap is allowed', async () => {
  const result = await evidence();
  for (const category of result.output.categories) {
    for (let index = 1; index < category.rows.length; index += 1) {
      const previous = category.rows[index - 1];
      const current = category.rows[index];
      assert.ok(previous && current);
      assert.ok(
        previous.pWinGivenGrades > current.pWinGivenGrades ||
          (previous.pWinGivenGrades === current.pWinGivenGrades &&
            previous.pVoid <= current.pVoid),
      );
    }
  }

  const opportunity = result.output.categories[0];
  const baseline = result.output.categories[1];
  assert.ok(opportunity && baseline);
  assert.ok(opportunity.rows.some((row) => row.playerName === 'Grant McCray'));
  assert.ok(baseline.rows.some((row) => row.playerName === 'Grant McCray'));
});

test('the existing CLI prints all required columns without implementing probability or ranking math', async () => {
  const source = await readFile(SCRIPT_PATH, 'utf8');
  const result = await evidence();
  const formatted = formatM10ArchivedCategoryTable(result.output);

  assert.doesNotMatch(source, /compareSettlementResultsForRanking/u);
  assert.doesNotMatch(source, /settleM8|settleM8_5|buildM8_5Validated/u);
  for (const label of [
    'P(WIN|GRADES)',
    'P(VOID)',
    'P_BASE',
    'CONTEXT_DELTA',
    'AMERICAN PRICE',
    'MULTIPLIER',
    'POSTED IMPLIED PROBABILITY',
    'PRICE EDGE [DIAGNOSTIC ONLY]',
  ]) {
    assert.ok(formatted.includes(label));
  }

  process.stdout.write('\n--- M10 REAL ARCHIVE CATEGORY OUTPUT ---\n');
  process.stdout.write(formatted);
  process.stdout.write('--- END M10 REAL ARCHIVE CATEGORY OUTPUT ---\n');
});
