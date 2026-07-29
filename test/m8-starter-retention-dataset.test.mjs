import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildM8StarterRetentionDataset,
  verifyM8StarterRetentionDataset,
} from '../scripts/m8-starter-retention-dataset-utils.mjs';
import { sha256 } from '../scripts/provider-probe-utils.mjs';

const SEALED = Object.freeze({
  startDate: '2026-07-06',
  endDate: '2026-07-25',
  shardCount: 20,
  gameCount: 225,
  plateAppearanceCount: 16830,
  rowsIncluded: false,
  allowedUse: 'final-evaluation-only-after-candidate-selection',
});

function starterIds(gameId, side) {
  const base = gameId * 100 + (side === 'home' ? 50 : 0);
  return Array.from({ length: 9 }, (_, index) => base + index + 1);
}

function teamSummary(gameId, side, directBySlot = {}) {
  const ids = starterIds(gameId, side);
  return {
    side,
    teamId: gameId * 10 + (side === 'home' ? 2 : 1),
    completeOfficialSlots: true,
    starters: ids.map((playerId, index) => ({
      battingOrder: index + 1,
      playerId,
      playerName: `${side}-starter-${index + 1}`,
      directPlateAppearances: directBySlot[index + 1] ?? 4,
    })),
  };
}

function sideRows({
  gameId,
  observedDate,
  periodId,
  side,
  replacementAfter = {},
  includeBaserunning = false,
}) {
  const ids = starterIds(gameId, side);
  const rows = [];
  for (let index = 0; index < 36; index += 1) {
    const slot = (index % 9) + 1;
    const turn = Math.floor(index / 9) + 1;
    const starterId = ids[slot - 1];
    const replacementId = gameId * 1000 + (side === 'home' ? 500 : 0) + slot;
    const batterId =
      replacementAfter[slot] !== undefined && turn > replacementAfter[slot]
        ? replacementId
        : starterId;
    rows.push({
      rowId: `${periodId}:${gameId}:${side}:${index + 1}`,
      observedDate,
      providerGameId: gameId,
      providerPaNumber: index * 2 + 1,
      providerBatterId: batterId,
      providerPitcherId: gameId * 10000 + 1,
      halfInning: side === 'away' ? 'top' : 'bottom',
      mappingStatus: 'classified-terminal',
    });
  }
  if (includeBaserunning) {
    rows.push({
      rowId: `${periodId}:${gameId}:${side}:baserunning`,
      observedDate,
      providerGameId: gameId,
      providerPaNumber: 2,
      providerBatterId: ids[0],
      providerPitcherId: gameId * 10000 + 1,
      halfInning: side === 'away' ? 'top' : 'bottom',
      mappingStatus: 'baserunning-only',
    });
  }
  return rows;
}

function gameCapture({
  gameId,
  observedDate,
  periodId,
  awayDirect = {},
  homeDirect = {},
}) {
  return {
    plannedGame: { gameId, observedDate, periodId },
    summary: {
      status: 'STATUS_FINAL',
      seasonType: 'regular',
      season: 2026,
      teams: [
        teamSummary(gameId, 'away', awayDirect),
        teamSummary(gameId, 'home', homeDirect),
      ],
    },
    captureSha256: String(gameId % 10).repeat(64),
    untouchedTestReservation: SEALED,
  };
}

function resolvedIdentity(dataset) {
  return {
    activeSeason: dataset.activeSeason,
    sourceDatasetSha256: dataset.sourceDatasetSha256,
    sourceDatasetFileSha256: dataset.sourceDatasetFileSha256,
    sourceResolutionSha256: dataset.sourceResolutionSha256,
    sourceResolutionFileSha256: dataset.sourceResolutionFileSha256,
    sourcePartitionSha256: dataset.sourcePartitionSha256,
    sourceEvidenceSetSha256: dataset.sourceEvidenceSetSha256,
    periods: dataset.periods,
    untouchedTestReservation: dataset.untouchedTestReservation,
  };
}

function resolvedDataset({ fitRows, validationRows }) {
  const dataset = {
    datasetVersion: 3,
    activeSeason: 2026,
    sourceDatasetSha256: '1'.repeat(64),
    sourceDatasetFileSha256: '2'.repeat(64),
    sourceResolutionSha256: '3'.repeat(64),
    sourceResolutionFileSha256: '4'.repeat(64),
    sourcePartitionSha256: '5'.repeat(64),
    sourceEvidenceSetSha256: '6'.repeat(64),
    periods: {
      fit: { rows: fitRows },
      validation: { rows: validationRows },
    },
    untouchedTestReservation: SEALED,
  };
  dataset.datasetSha256 = sha256(JSON.stringify(resolvedIdentity(dataset)));
  return dataset;
}

function fixture({ phaseShift = false } = {}) {
  const fitGameId = 9101;
  const validationGameId = 9201;
  const fitReplacement = phaseShift
    ? Object.fromEntries(Array.from({ length: 9 }, (_, index) => [index + 1, 1]))
    : { 1: 2 };
  const fitAwayDirect = phaseShift
    ? Object.fromEntries(Array.from({ length: 9 }, (_, index) => [index + 1, 1]))
    : { 1: 2 };
  const captures = [
    gameCapture({
      gameId: fitGameId,
      observedDate: '2026-05-01',
      periodId: 'fit',
      awayDirect: fitAwayDirect,
    }),
    gameCapture({
      gameId: validationGameId,
      observedDate: '2026-06-22',
      periodId: 'validation',
    }),
  ];
  const resolved = resolvedDataset({
    fitRows: [
      ...sideRows({
        gameId: fitGameId,
        observedDate: '2026-05-01',
        periodId: 'fit',
        side: 'away',
        replacementAfter: fitReplacement,
        includeBaserunning: true,
      }),
      ...sideRows({
        gameId: fitGameId,
        observedDate: '2026-05-01',
        periodId: 'fit',
        side: 'home',
      }),
    ],
    validationRows: [
      ...sideRows({
        gameId: validationGameId,
        observedDate: '2026-06-22',
        periodId: 'validation',
        side: 'away',
      }),
      ...sideRows({
        gameId: validationGameId,
        observedDate: '2026-06-22',
        periodId: 'validation',
        side: 'home',
      }),
    ],
  });
  const manifest = {
    provider: 'BALLDONTLIE MLB API',
    manifestSha256: 'a'.repeat(64),
    sourceResolvedDatasetSha256: resolved.datasetSha256,
    gameCount: captures.length,
    untouchedTestReservation: SEALED,
    games: captures.map((capture) => capture.plannedGame),
  };
  return { manifest, captures, resolved };
}

test('recovers starter PA prefixes while excluding baserunning-only rows from the batting cycle', () => {
  const { manifest, captures, resolved } = fixture();
  const dataset = buildM8StarterRetentionDataset({
    captureManifest: manifest,
    captures,
    resolvedDataset: resolved,
    sourceResolvedDatasetFileSha256: 'b'.repeat(64),
  });

  assert.equal(dataset.totals.includedTeamGameCount, 4);
  assert.equal(dataset.totals.excludedTeamGameCount, 0);
  assert.equal(dataset.totals.includedSlotObservationCount, 36);
  assert.equal(dataset.totals.ignoredBaserunningRowCount, 1);
  assert.equal(dataset.totals.substitutedSlotObservationCount, 1);
  const replaced = dataset.periods.fit.rows.find(
    (row) => row.side === 'away' && row.lineupSlot === 1,
  );
  assert.equal(replaced.slotTurns, 4);
  assert.equal(replaced.starterPlateAppearances, 2);
  assert.equal(replaced.firstReplacementTurn, 3);
  assert.equal(verifyM8StarterRetentionDataset(dataset), dataset);
});

test('rejects a simultaneous multi-slot phase shift instead of fitting corrupted substitutions', () => {
  const { manifest, captures, resolved } = fixture({ phaseShift: true });
  const dataset = buildM8StarterRetentionDataset({
    captureManifest: manifest,
    captures,
    resolvedDataset: resolved,
    sourceResolvedDatasetFileSha256: 'b'.repeat(64),
  });

  assert.equal(dataset.totals.includedTeamGameCount, 3);
  assert.equal(dataset.totals.excludedTeamGameCount, 1);
  assert.equal(
    dataset.exclusionReasonCounts['simultaneous-multi-slot-phase-shift'],
    1,
  );
  assert.equal(dataset.excludedTeamGames[0].side, 'away');
});

test('fails closed when direct starter PA evidence disagrees with recovered slot occupancy', () => {
  const { manifest, captures, resolved } = fixture();
  captures[0].summary.teams[0].starters[0].directPlateAppearances = 4;
  const dataset = buildM8StarterRetentionDataset({
    captureManifest: manifest,
    captures,
    resolvedDataset: resolved,
    sourceResolvedDatasetFileSha256: 'b'.repeat(64),
  });

  assert.equal(dataset.totals.includedTeamGameCount, 3);
  assert.equal(dataset.totals.excludedTeamGameCount, 1);
  assert.equal(dataset.exclusionReasonCounts['starter-pa-audit-mismatch'], 1);
});
