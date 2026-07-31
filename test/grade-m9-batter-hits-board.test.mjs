import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildProspectiveGradeReport,
  gradeArchiveRow,
  persistCompleteGrade,
  settleOfficialHits,
} from '../scripts/grade-m9-batter-hits-board.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

function row(selectedSide = 'higher', line = 0.5) {
  return {
    event: {
      providerEventId: 'event-1',
      providerGameId: 1,
      homeTeamName: 'Home',
      awayTeamName: 'Away',
      commenceTime: '2026-07-31T18:00:00Z',
    },
    player: {
      providerPlayerId: 10,
      providerTeamId: 20,
      playerName: 'Test Player',
      teamName: 'Home',
    },
    market: {
      baseMarketKey: 'batter-hits',
      providerMarketKey: 'batter_hits',
      offerType: 'baseline',
      line,
      selectedSide,
      rawSide: selectedSide === 'higher' ? 'Over' : 'Under',
    },
    probabilities: {
      pWin: 0.6,
      pLoss: 0.4,
      pVoid: 0,
      pWinGivenGrades: 0.6,
    },
    versions: {
      projectRulesVersion: '2.3',
      mathSpecVersion: '1.5',
      modelVersion: 'm8-test',
      distributionBuilderVersion: 'distribution-test',
      settlementRuleVersion: 'settlement-test',
    },
  };
}

function archive(rows) {
  const identity = {
    archiveVersion: 1,
    archiveContract: 'm9-batter-hits-prospective-board-archive-v1',
    archiveDate: '2026-07-31',
    archivedAt: '2026-07-31T16:00:00Z',
    asOf: '2026-07-31T16:00:00Z',
    timeZone: 'America/Chicago',
    projectRulesVersion: '2.3',
    mathSpecVersion: '1.5',
    normalizationVersion: 'normalization-test',
    configurationVersion: 'configuration-test',
    connectedArtifacts: [],
    productionEnabled: false,
    productionRankingAuthorized: false,
    gradingPerformed: false,
    untouchedTestAccessed: false,
    providerSnapshots: [],
    counts: { archivedRowCount: rows.length },
    excludedEvents: [],
    excludedOffers: [],
    rows,
  };
  return {
    ...identity,
    archiveSha256: sha256(JSON.stringify(identity)),
  };
}

const finalGame = {
  id: 1,
  season: 2026,
  season_type: 'regular',
  postseason: false,
  status: 'STATUS_FINAL',
};
const scheduledGame = {
  ...finalGame,
  status: 'STATUS_SCHEDULED',
};
const officialStats = [
  {
    game_id: 1,
    player: { id: 10 },
    team: { id: 20 },
    hits: 1,
  },
];

test('settles exact Higher and Lower sides including integer-line voids', () => {
  assert.equal(
    settleOfficialHits({ selectedSide: 'higher', line: 0.5, actualHits: 1 }),
    'WIN',
  );
  assert.equal(
    settleOfficialHits({ selectedSide: 'lower', line: 0.5, actualHits: 1 }),
    'LOSS',
  );
  assert.equal(
    settleOfficialHits({ selectedSide: 'higher', line: 1, actualHits: 1 }),
    'VOID',
  );
  assert.equal(
    settleOfficialHits({ selectedSide: 'lower', line: 1, actualHits: 1 }),
    'VOID',
  );
});

test('grades only one exact final-game official Hits row', () => {
  const graded = gradeArchiveRow({
    row: row(),
    game: finalGame,
    statsRows: officialStats,
  });
  assert.equal(graded.status, 'GRADED');
  assert.equal(graded.result, 'WIN');
  assert.equal(graded.actualHits, 1);

  const pending = gradeArchiveRow({
    row: row(),
    game: scheduledGame,
    statsRows: [],
  });
  assert.equal(pending.status, 'PENDING');
  assert.equal(pending.reason, 'GAME_NOT_FINAL');

  const unresolved = gradeArchiveRow({
    row: row(),
    game: finalGame,
    statsRows: [],
  });
  assert.equal(unresolved.status, 'UNRESOLVED');
  assert.equal(unresolved.reason, 'OFFICIAL_STATS_ROW_NOT_UNIQUE');
});

test('builds one deterministic Higher and Lower grade identity across observation times', () => {
  const source = archive([row('higher'), row('lower')]);
  const evidence = new Map([
    [1, { game: finalGame, statsRows: officialStats }],
  ]);
  const input = {
    archive: source,
    archivePath: 'archive.json',
    gradedAt: '2026-08-01T05:00:00Z',
    gameEvidenceById: evidence,
  };
  const report = buildProspectiveGradeReport(input);
  const laterReport = buildProspectiveGradeReport({
    ...input,
    gradedAt: '2026-08-01T06:00:00Z',
  });
  assert.equal(report.complete, true);
  assert.deepEqual(report.counts, {
    total: 2,
    graded: 2,
    pending: 0,
    unresolved: 0,
    wins: 1,
    losses: 1,
    voids: 0,
  });
  assert.equal(laterReport.gradeSha256, report.gradeSha256);
  assert.notEqual(laterReport.gradedAt, report.gradedAt);
});

test('does not persist incomplete grading and keeps pending identity deterministic', async () => {
  const input = {
    archive: archive([row()]),
    archivePath: 'archive.json',
    gradedAt: '2026-07-31T17:00:00Z',
    gameEvidenceById: new Map([
      [1, { game: scheduledGame, statsRows: [] }],
    ]),
  };
  const report = buildProspectiveGradeReport(input);
  const laterReport = buildProspectiveGradeReport({
    ...input,
    gradedAt: '2026-07-31T17:30:00Z',
  });
  assert.equal(laterReport.gradeSha256, report.gradeSha256);

  let wrote = false;
  const result = await persistCompleteGrade({
    filePath: '/tmp/never-written-grade.json',
    report,
    writeJson: async () => {
      wrote = true;
    },
  });
  assert.equal(result.persisted, false);
  assert.equal(wrote, false);
});

test('persists one immutable completed grade and reuses a later identical rerun', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm9-grade-'));
  const filePath = path.join(directory, 'grade.json');
  const input = {
    archive: archive([row()]),
    archivePath: 'archive.json',
    gradedAt: '2026-08-01T05:00:00Z',
    gameEvidenceById: new Map([
      [1, { game: finalGame, statsRows: officialStats }],
    ]),
  };
  const report = buildProspectiveGradeReport(input);
  const laterReport = buildProspectiveGradeReport({
    ...input,
    gradedAt: '2026-08-01T06:00:00Z',
  });
  const writeJson = async (target, value) => {
    await writeFile(target, JSON.stringify(value), 'utf8');
  };

  const first = await persistCompleteGrade({ filePath, report, writeJson });
  assert.equal(first.persisted, true);
  assert.equal(first.reused, false);

  const second = await persistCompleteGrade({
    filePath,
    report: laterReport,
    writeJson,
  });
  assert.equal(second.reused, true);

  await assert.rejects(
    () =>
      persistCompleteGrade({
        filePath,
        report: { ...report, gradeSha256: '0'.repeat(64) },
        writeJson,
      }),
    /different identity/u,
  );
  const persisted = JSON.parse(await readFile(filePath, 'utf8'));
  assert.equal(persisted.gradeSha256, report.gradeSha256);
  assert.equal(persisted.gradedAt, report.gradedAt);
});
