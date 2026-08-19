import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createResearchDisplayArchiveRepository } from '../src/adapters/index.js';
import { BATTER_HHR_MARKET_KEY } from '../src/features/batter-hhr/manifest.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

const MODEL_VERSION = 'm11-batter-hhr-direct-composite-v2';
const DISTRIBUTION_BUILDER_VERSION = 'm11-batter-hhr-negative-binomial-v1';

function row(input: Readonly<{
  eventId: string;
  gameId: number;
  playerId: number;
  probability: number;
}>) {
  return Object.freeze({
    providerEventId: input.eventId,
    providerGameId: input.gameId,
    providerPlayerId: input.playerId,
    playerName: `Player ${input.playerId}`,
    teamName: 'Home Club',
    homeTeamName: 'Home Club',
    awayTeamName: 'Away Club',
    eventCommenceTime: '2026-08-19T23:00:00.000Z',
    providerMarketKey: 'batter_hits_runs_rbis_alternate',
    offerType: 'alternate',
    selectedSide: 'lower',
    postedLine: 1.5,
    americanPrice: -110,
    multiplier: 1,
    pWin: input.probability,
    pLoss: 1 - input.probability,
    pVoid: 0,
    pWinGivenGrades: input.probability,
    lineupStatus: 'confirmed',
    analysisContext: Object.freeze({
      expectedPlateAppearances: 4.2,
      lineupSlot: 3,
      batterSide: 'R',
      opposingStarterHand: 'L',
      venue: 'Daily Aggregate Park',
      teamImpliedRunTotal: 4.5,
    }),
  });
}

function archive(input: Readonly<{
  captureKey: string;
  capturedAt: string;
  captureDateUtc: string;
  rows: readonly ReturnType<typeof row>[];
}>) {
  return Object.freeze({
    displayArchiveVersion: 1,
    displayArchiveContract: 'phase1-trimmed-board-display-v1',
    market: BATTER_HHR_MARKET_KEY,
    captureKey: input.captureKey,
    capturedAt: input.capturedAt,
    captureDateUtc: input.captureDateUtc,
    productionEnabled: false,
    productionRankingEnabled: false,
    modelVersion: MODEL_VERSION,
    distributionBuilderVersion: DISTRIBUTION_BUILDER_VERSION,
    rows: input.rows,
  });
}

async function persistCapture(
  rootDirectory: string,
  capture: ReturnType<typeof archive>,
): Promise<void> {
  const directory = path.join(rootDirectory, BATTER_HHR_MARKET_KEY, 'captures');
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `${capture.captureKey}.json`),
    `${JSON.stringify(capture, null, 2)}\n`,
    'utf8',
  );
}

test('research display repository serves only the single newest capture', async (t) => {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), 'research-display-daily-'));
  t.after(async () => rm(rootDirectory, { recursive: true, force: true }));

  const priorDayCaptureKey = `20260818T200000000Z--${HASH_A}`;
  const earlierCaptureKey = `20260819T150305000Z--${HASH_B}`;
  const latestCaptureKey = `20260819T152838601Z--${HASH_C}`;

  await persistCapture(
    rootDirectory,
    archive({
      captureKey: priorDayCaptureKey,
      capturedAt: '2026-08-18T20:00:00.000Z',
      captureDateUtc: '2026-08-18',
      rows: Object.freeze([
        row({ eventId: 'prior-day', gameId: 7000, playerId: 1000, probability: 0.99 }),
      ]),
    }),
  );
  await persistCapture(
    rootDirectory,
    archive({
      captureKey: earlierCaptureKey,
      capturedAt: '2026-08-19T15:03:05.000Z',
      captureDateUtc: '2026-08-19',
      rows: Object.freeze([
        row({ eventId: 'earlier-unique', gameId: 7001, playerId: 1001, probability: 0.84 }),
        row({ eventId: 'earlier-repeat', gameId: 7002, playerId: 1002, probability: 0.51 }),
      ]),
    }),
  );
  await persistCapture(
    rootDirectory,
    archive({
      captureKey: latestCaptureKey,
      capturedAt: '2026-08-19T15:28:38.601Z',
      captureDateUtc: '2026-08-19',
      rows: Object.freeze([
        row({ eventId: 'latest-repeat', gameId: 7002, playerId: 1002, probability: 0.72 }),
        row({ eventId: 'latest-unique', gameId: 7003, playerId: 1003, probability: 0.69 }),
      ]),
    }),
  );

  const result = await createResearchDisplayArchiveRepository({ rootDirectory }).readLatest(
    BATTER_HHR_MARKET_KEY,
  );

  assert.ok(result);
  assert.equal(result.captureKey, latestCaptureKey);
  assert.equal(result.capturedAt, '2026-08-19T15:28:38.601Z');
  assert.deepEqual(
    result.rows.map((value) => value.providerPlayerId),
    [1002, 1003],
  );
  assert.equal(result.rows.some((value) => value.providerPlayerId === 1000), false);

  const repeated = result.rows.find((value) => value.providerPlayerId === 1002);
  assert.ok(repeated);
  assert.equal(repeated.captureKey, latestCaptureKey);
  assert.equal(repeated.capturedAt, '2026-08-19T15:28:38.601Z');
  assert.equal(repeated.providerEventId, 'latest-repeat');
  assert.equal(repeated.pWinGivenGrades, 0.72);

  assert.equal(result.rows.some((value) => value.providerPlayerId === 1001), false);
});
