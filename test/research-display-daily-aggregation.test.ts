import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createResearchDisplayArchiveRepository } from '../src/adapters/index.js';
import { readResearchProductBoardV2 } from '../src/application/index.js';

const PREVIOUS_CAPTURE_KEY =
  '20260819T030000000Z--aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const EARLY_CAPTURE_KEY =
  '20260819T180000000Z--bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const LATE_CAPTURE_KEY =
  '20260820T010000000Z--cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

interface TestRowInput {
  readonly providerGameId: number;
  readonly providerPlayerId: number;
  readonly playerName: string;
  readonly selectedSide: 'higher' | 'lower';
  readonly pWinGivenGrades: number;
}

function displayRow(input: TestRowInput): Readonly<Record<string, unknown>> {
  return Object.freeze({
    providerEventId: `event-${input.providerGameId}`,
    providerGameId: input.providerGameId,
    providerPlayerId: input.providerPlayerId,
    playerName: input.playerName,
    teamName: 'Home Club',
    homeTeamName: 'Home Club',
    awayTeamName: 'Away Club',
    eventCommenceTime: '2026-08-20T02:35:00.000Z',
    providerMarketKey: 'batter_hits',
    offerType: 'baseline',
    selectedSide: input.selectedSide,
    postedLine: 0.5,
    americanPrice: -110,
    multiplier: 1,
    pWin: input.pWinGivenGrades,
    pLoss: 1 - input.pWinGivenGrades,
    pVoid: 0,
    pWinGivenGrades: input.pWinGivenGrades,
    lineupStatus: 'confirmed',
    analysisContext: Object.freeze({}),
  });
}

async function writeDisplayArchive(
  rootDirectory: string,
  input: Readonly<{
    captureKey: string;
    capturedAt: string;
    captureDateUtc: string;
    rows: readonly Readonly<Record<string, unknown>>[];
  }>,
): Promise<void> {
  const directory = path.join(rootDirectory, 'batter-hits', 'captures');
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${input.captureKey}.json`),
    JSON.stringify({
      displayArchiveVersion: 1,
      displayArchiveContract: 'phase1-trimmed-board-display-v1',
      market: 'batter-hits',
      captureKey: input.captureKey,
      capturedAt: input.capturedAt,
      captureDateUtc: input.captureDateUtc,
      productionEnabled: false,
      productionRankingEnabled: false,
      modelVersion: 'm8-5-batter-hits-successor-freeze-v1',
      distributionBuilderVersion: 'm9-batter-hits-runtime-distribution-v1',
      rows: input.rows,
    }),
    'utf8',
  );
}

test('research display combines the latest Central slate day across UTC rollover and keeps the newest version of each prop', async () => {
  const rootDirectory = await mkdtemp(
    path.join(tmpdir(), 'research-display-daily-aggregation-'),
  );

  try {
    await writeDisplayArchive(rootDirectory, {
      captureKey: PREVIOUS_CAPTURE_KEY,
      capturedAt: '2026-08-19T03:00:00.000Z',
      captureDateUtc: '2026-08-19',
      rows: [
        displayRow({
          providerGameId: 9099,
          providerPlayerId: 99,
          playerName: 'Previous Day Leader',
          selectedSide: 'higher',
          pWinGivenGrades: 0.99,
        }),
      ],
    });
    await writeDisplayArchive(rootDirectory, {
      captureKey: EARLY_CAPTURE_KEY,
      capturedAt: '2026-08-19T18:00:00.000Z',
      captureDateUtc: '2026-08-19',
      rows: [
        displayRow({
          providerGameId: 9001,
          providerPlayerId: 1,
          playerName: 'Recaptured Prop',
          selectedSide: 'higher',
          pWinGivenGrades: 0.61,
        }),
        displayRow({
          providerGameId: 9002,
          providerPlayerId: 2,
          playerName: 'Earlier Best Prop',
          selectedSide: 'higher',
          pWinGivenGrades: 0.92,
        }),
      ],
    });
    await writeDisplayArchive(rootDirectory, {
      captureKey: LATE_CAPTURE_KEY,
      capturedAt: '2026-08-20T01:00:00.000Z',
      captureDateUtc: '2026-08-20',
      rows: [
        displayRow({
          providerGameId: 9001,
          providerPlayerId: 1,
          playerName: 'Recaptured Prop',
          selectedSide: 'lower',
          pWinGivenGrades: 0.74,
        }),
        displayRow({
          providerGameId: 9003,
          providerPlayerId: 3,
          playerName: 'Later Prop',
          selectedSide: 'higher',
          pWinGivenGrades: 0.69,
        }),
      ],
    });

    const repository = createResearchDisplayArchiveRepository({ rootDirectory });
    const archive = await repository.readLatest('batter-hits');
    assert.ok(archive);
    assert.equal(archive.captureKey, LATE_CAPTURE_KEY);
    assert.equal(archive.capturedAt, '2026-08-20T01:00:00.000Z');
    assert.equal(archive.rows.length, 3);
    assert.equal(
      archive.rows.some((row) => row.playerName === 'Previous Day Leader'),
      false,
    );

    const recaptured = archive.rows.find((row) => row.providerPlayerId === 1);
    assert.ok(recaptured);
    assert.equal(recaptured.captureKey, LATE_CAPTURE_KEY);
    assert.equal(recaptured.selectedSide, 'lower');
    assert.equal(recaptured.pWinGivenGrades, 0.74);

    const earlierBest = archive.rows.find((row) => row.providerPlayerId === 2);
    assert.ok(earlierBest);
    assert.equal(earlierBest.captureKey, EARLY_CAPTURE_KEY);
    assert.equal(earlierBest.pWinGivenGrades, 0.92);

    const board = await readResearchProductBoardV2(repository);
    const baseline = board.categories[1];
    assert.ok(baseline);
    assert.equal(baseline.title, 'High Probability Baseline Props');
    assert.equal(baseline.picks[0]?.player, 'Earlier Best Prop');
    assert.equal(baseline.picks[0]?.pWinGivenGrades, 0.92);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
