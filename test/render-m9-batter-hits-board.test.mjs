import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildRankedDisplayRows,
  renderArchivedBoard,
  runArchivedBoardDisplay,
} from '../scripts/render-m9-batter-hits-board.mjs';

const SHA = 'a'.repeat(64);

function row({
  player,
  market = 'batter_hits',
  line = 0.5,
  side = 'higher',
  pWin,
  pLoss,
  pVoid,
  pWinGivenGrades,
}) {
  return {
    archiveRowVersion: 1,
    event: {
      providerEventId: `event-${player}`,
      providerGameId: 1,
      homeTeamName: 'Home Club',
      awayTeamName: 'Away Club',
      commenceTime: '2026-07-31T18:00:00Z',
    },
    player: {
      providerPlayerId: 1,
      providerTeamId: 1,
      playerName: player,
      teamName: 'Away Club',
    },
    market: {
      baseMarketKey: 'batter_hits',
      providerMarketKey: market,
      offerType: market === 'batter_hits' ? 'baseline' : 'alternate',
      line,
      selectedSide: side,
      rawSide: side === 'higher' ? 'Over' : 'Under',
      americanPrice: -110,
      multiplier: 1,
      marketLastUpdate: '2026-07-31T15:00:00Z',
    },
    probabilities: { pWin, pLoss, pVoid, pWinGivenGrades },
    versions: {
      projectRulesVersion: '2.4',
      mathSpecVersion: '1.5',
      normalizationVersion: 'm9-batter-hits-board-normalization-v1',
      modelVersion: 'm8-batter-hits-complete-candidate-v1',
      distributionBuilderVersion: 'm9-batter-hits-runtime-distribution-v1',
      settlementRuleVersion: 'batter-hits-settlement-not-production-validated',
    },
    source: {
      boardCapturedAt: '2026-07-31T15:01:00Z',
      boardSnapshotSha256: SHA,
      lineupSnapshotSha256: SHA,
    },
    productionRank: null,
    rankStatus: 'NOT_AUTHORIZED_UNTIL_ACCEPTANCE_GATES_PASS',
    candidate: {
      eligibilityProbability: 1,
    },
    distribution: {
      statisticDistribution: [0.5, 0.5],
    },
  };
}

function archive() {
  return {
    archiveVersion: 1,
    archiveContract: 'm9-batter-hits-prospective-board-archive-v1',
    archiveDate: '2026-07-31',
    archiveSha256: SHA,
    rows: [
      row({
        player: 'Fourth Player',
        pWin: 0.7,
        pLoss: 0.2,
        pVoid: 0.1,
        pWinGivenGrades: 0.7777777777777778,
      }),
      row({
        player: 'First Tied Player',
        market: 'batter_hits_alternate',
        line: 1.5,
        side: 'lower',
        pWin: 0.76,
        pLoss: 0.19,
        pVoid: 0.05,
        pWinGivenGrades: 0.8,
      }),
      row({
        player: 'Second Tied Player',
        pWin: 0.8,
        pLoss: 0.2,
        pVoid: 0,
        pWinGivenGrades: 0.8,
      }),
      row({
        player: 'Third Player',
        pWin: 0.64,
        pLoss: 0.16,
        pVoid: 0.2,
        pWinGivenGrades: 0.8,
      }),
    ],
  };
}

test('reads, ranks, and renders the immutable archive without changing it', async () => {
  const source = archive();
  const ranked = buildRankedDisplayRows(source);

  assert.deepEqual(
    ranked.map((entry) => entry.player),
    [
      'Second Tied Player',
      'First Tied Player',
      'Third Player',
      'Fourth Player',
    ],
  );
  assert.deepEqual(ranked[1], {
    rank: 2,
    player: 'First Tied Player',
    market: 'batter_hits_alternate',
    line: 1.5,
    side: 'lower',
    pWin: 0.76,
    pLoss: 0.19,
    pVoid: 0.05,
    pWinGivenGrades: 0.8,
  });

  const rendered = renderArchivedBoard(source);
  assert.match(rendered, /Rank\s+\| Player/u);
  assert.match(rendered, /1\s+\| Second Tied Player/u);
  assert.match(rendered, /2\s+\| First Tied Player\s+\| batter_hits_alternate\s+\| 1\.5\s+\| lower/u);
  assert.match(rendered, /76\.000%\s+\| 19\.000%\s+\| 5\.000%\s+\| 80\.000%/u);

  const root = await mkdtemp(path.join(os.tmpdir(), 'm9-board-display-'));
  const filePath = path.join(root, '2026-07-31.json');
  const originalText = `${JSON.stringify(source, null, 2)}\n`;
  try {
    await writeFile(filePath, originalText, 'utf8');
    const beforeEntries = await readdir(root);
    const result = await runArchivedBoardDisplay({
      archiveDate: '2026-07-31',
      archiveRoot: root,
    });
    const afterEntries = await readdir(root);
    const afterText = await readFile(filePath, 'utf8');

    assert.equal(result.filePath, filePath);
    assert.match(result.output, /M9 BATTER HITS ARCHIVED BOARD/u);
    assert.deepEqual(afterEntries, beforeEntries);
    assert.equal(afterText, originalText);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
