import { createHash } from 'node:crypto';

const INCLUDED_PERIODS = Object.freeze(['fit', 'validation']);
const OFFICIAL_SLOTS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateUntouchedReservation(rawReservation) {
  const reservation = assertObject(
    rawReservation,
    'untouchedTestReservation',
  );

  if (
    reservation.rowsIncluded !== false ||
    Object.hasOwn(reservation, 'rows')
  ) {
    throw new Error('untouched-test rows must remain excluded.');
  }

  return Object.freeze({ ...reservation, rowsIncluded: false });
}

function completeTeamLineup(team) {
  const value = assertObject(team, 'team summary');
  const starters = assertArray(value.starters, 'team starters');
  const slots = starters.map((starter) => starter.battingOrder);
  return (
    value.completeOfficialSlots === true &&
    starters.length === 9 &&
    OFFICIAL_SLOTS.every((slot) => slots.includes(slot)) &&
    new Set(slots).size === 9
  );
}

function datasetIdentity(dataset) {
  return {
    datasetVersion: dataset.datasetVersion,
    provider: dataset.provider,
    activeSeason: dataset.activeSeason,
    sourceCaptureManifestSha256: dataset.sourceCaptureManifestSha256,
    sourceCapturePlanSha256: dataset.sourceCapturePlanSha256,
    sourceResolvedDatasetSha256: dataset.sourceResolvedDatasetSha256,
    includedPeriods: dataset.includedPeriods,
    untouchedTestReservation: dataset.untouchedTestReservation,
    exclusionPolicy: dataset.exclusionPolicy,
    totals: dataset.totals,
    periods: dataset.periods,
    incompleteLineupGames: dataset.incompleteLineupGames,
    excludedStarterObservations: dataset.excludedStarterObservations,
  };
}

export function buildM8PaSurvivalDataset({
  captureManifest,
  captures,
}) {
  const manifest = assertObject(captureManifest, 'captureManifest');
  const capturedGames = assertArray(captures, 'captures');

  if (manifest.provider !== 'BALLDONTLIE MLB API') {
    throw new Error('capture manifest provider is not BALLDONTLIE MLB API.');
  }

  const untouchedTestReservation = validateUntouchedReservation(
    manifest.untouchedTestReservation,
  );
  const gameCount = assertPositiveInteger(manifest.gameCount, 'gameCount');
  const sourceCaptureManifestSha256 = assertSha256(
    manifest.manifestSha256,
    'manifestSha256',
  );
  const sourceCapturePlanSha256 = assertSha256(
    manifest.sourcePlanSha256,
    'sourcePlanSha256',
  );
  const sourceResolvedDatasetSha256 = assertSha256(
    manifest.sourceResolvedDatasetSha256,
    'sourceResolvedDatasetSha256',
  );

  if (capturedGames.length !== gameCount) {
    throw new Error('capture count does not match the manifest game count.');
  }

  const captureByGameId = new Map();
  for (const rawCapture of capturedGames) {
    const capture = assertObject(rawCapture, 'capture');
    const gameId = assertPositiveInteger(
      capture.plannedGame?.gameId,
      'capture gameId',
    );
    if (captureByGameId.has(gameId)) {
      throw new Error(`duplicate capture for game ${gameId}.`);
    }
    if (capture.sourcePlanSha256 !== sourceCapturePlanSha256) {
      throw new Error(`capture ${gameId} plan SHA-256 mismatch.`);
    }
    validateUntouchedReservation(capture.untouchedTestReservation);
    captureByGameId.set(gameId, capture);
  }

  const periodRows = new Map(
    INCLUDED_PERIODS.map((periodId) => [periodId, []]),
  );
  const incompleteLineupGames = [];
  const excludedStarterObservations = [];
  const totals = {
    capturedGameCount: gameCount,
    completeLineupGameCount: 0,
    incompleteLineupGameCount: 0,
    officialStarterSlotCount: 0,
    includedObservationCount: 0,
    excludedMissingStatsCount: 0,
    excludedDuplicateStatsCount: 0,
    excludedNullDirectPaCount: 0,
    componentAuditExactCount: 0,
    componentAuditMismatchCount: 0,
    componentAuditUnavailableCount: 0,
  };
  const seenRows = new Set();
  const activeSeasons = new Set();

  const orderedManifestGames = assertArray(manifest.games, 'manifest.games')
    .slice()
    .sort(
      (left, right) =>
        String(left.observedDate).localeCompare(String(right.observedDate)) ||
        left.gameId - right.gameId,
    );

  for (const manifestGame of orderedManifestGames) {
    const gameId = assertPositiveInteger(manifestGame.gameId, 'manifest gameId');
    const capture = captureByGameId.get(gameId);
    if (capture === undefined) {
      throw new Error(`capture is missing for game ${gameId}.`);
    }

    const observedDate = assertNonEmptyString(
      capture.plannedGame?.observedDate,
      `game ${gameId} observedDate`,
    );
    const periodId = assertNonEmptyString(
      capture.plannedGame?.periodId,
      `game ${gameId} periodId`,
    );
    if (!INCLUDED_PERIODS.includes(periodId)) {
      throw new Error(`game ${gameId} has unsupported period ${periodId}.`);
    }

    const summary = assertObject(capture.summary, `game ${gameId} summary`);
    if (summary.status !== 'STATUS_FINAL') {
      throw new Error(`game ${gameId} is not final.`);
    }
    if (summary.seasonType !== 'regular') {
      throw new Error(`game ${gameId} is not a regular-season game.`);
    }
    activeSeasons.add(
      assertPositiveInteger(summary.season, `game ${gameId} season`),
    );
    const teams = assertArray(summary.teams, `game ${gameId} teams`);
    if (teams.length !== 2) {
      throw new Error(`game ${gameId} must contain exactly two team summaries.`);
    }

    const completeLineup = teams.every(completeTeamLineup);
    if (!completeLineup) {
      totals.incompleteLineupGameCount += 1;
      incompleteLineupGames.push({
        gameId,
        observedDate,
        periodId,
        teams: teams.map((team) => ({
          side: team.side,
          teamId: team.teamId,
          teamName: team.teamName,
          battingRowCount: team.battingRowCount,
          slots: team.slots,
          missingSlots: team.missingSlots,
          duplicateSlots: team.duplicateSlots,
        })),
      });
      continue;
    }

    totals.completeLineupGameCount += 1;

    for (const team of teams) {
      const side = assertNonEmptyString(team.side, `game ${gameId} side`);
      if (side !== 'home' && side !== 'away') {
        throw new Error(`game ${gameId} side must be home or away.`);
      }
      const teamId = assertPositiveInteger(team.teamId, `game ${gameId} teamId`);
      const starters = assertArray(team.starters, `game ${gameId} starters`)
        .slice()
        .sort((left, right) => left.battingOrder - right.battingOrder);

      for (const starter of starters) {
        totals.officialStarterSlotCount += 1;
        const lineupSlot = assertPositiveInteger(
          starter.battingOrder,
          `game ${gameId} lineup slot`,
        );
        if (!OFFICIAL_SLOTS.includes(lineupSlot)) {
          throw new Error(`game ${gameId} lineup slot ${lineupSlot} is invalid.`);
        }
        const playerId = assertPositiveInteger(
          starter.playerId,
          `game ${gameId} playerId`,
        );
        const statsRowCount = assertNonNegativeInteger(
          starter.statsRowCount,
          `game ${gameId} statsRowCount`,
        );
        const exclusionBase = {
          gameId,
          observedDate,
          periodId,
          side,
          teamId,
          playerId,
          playerName: starter.playerName ?? null,
          lineupSlot,
          sourceCaptureSha256: assertSha256(
            capture.captureSha256,
            `game ${gameId} captureSha256`,
          ),
        };

        if (statsRowCount === 0) {
          totals.excludedMissingStatsCount += 1;
          excludedStarterObservations.push({
            ...exclusionBase,
            reason: 'missing-stats-row',
          });
          continue;
        }

        if (statsRowCount !== 1) {
          totals.excludedDuplicateStatsCount += 1;
          excludedStarterObservations.push({
            ...exclusionBase,
            reason: 'duplicate-stats-rows',
            statsRowCount,
          });
          continue;
        }

        const directPlateAppearances = starter.directPlateAppearances;
        if (!isNonNegativeInteger(directPlateAppearances)) {
          totals.excludedNullDirectPaCount += 1;
          excludedStarterObservations.push({
            ...exclusionBase,
            reason: 'null-direct-plate-appearances',
            componentCandidate: isNonNegativeInteger(starter.componentCandidate)
              ? starter.componentCandidate
              : null,
          });
          continue;
        }

        let componentAuditStatus;
        if (starter.directMatchesCandidate === true) {
          componentAuditStatus = 'exact';
          totals.componentAuditExactCount += 1;
        } else if (starter.directMatchesCandidate === false) {
          componentAuditStatus = 'mismatch';
          totals.componentAuditMismatchCount += 1;
        } else {
          componentAuditStatus = 'unavailable';
          totals.componentAuditUnavailableCount += 1;
        }

        const rowId = [
          periodId,
          observedDate,
          gameId,
          side,
          lineupSlot,
          playerId,
        ].join(':');
        if (seenRows.has(rowId)) {
          throw new Error(`duplicate PA-survival row ${rowId}.`);
        }
        seenRows.add(rowId);

        periodRows.get(periodId).push({
          rowId,
          observedDate,
          periodId,
          gameId,
          side,
          homeAway: side,
          teamId,
          playerId,
          playerName: starter.playerName ?? null,
          lineupSlot,
          plateAppearances: directPlateAppearances,
          sourceField: 'stats.plate_appearances',
          componentCandidate: isNonNegativeInteger(starter.componentCandidate)
            ? starter.componentCandidate
            : null,
          componentAuditStatus,
          sourceCaptureSha256: exclusionBase.sourceCaptureSha256,
          sourceStatsRawBodySha256s: summary.snapshots?.statsRawBodySha256s ?? [],
          sourceLineupRawBodySha256s:
            summary.snapshots?.lineupRawBodySha256s ?? [],
        });
        totals.includedObservationCount += 1;
      }
    }
  }

  if (
    totals.includedObservationCount +
      totals.excludedMissingStatsCount +
      totals.excludedDuplicateStatsCount +
      totals.excludedNullDirectPaCount !==
    totals.officialStarterSlotCount
  ) {
    throw new Error('starter observation conservation failed.');
  }

  const periods = Object.fromEntries(
    INCLUDED_PERIODS.map((periodId) => {
      const rows = periodRows
        .get(periodId)
        .slice()
        .sort(
          (left, right) =>
            left.observedDate.localeCompare(right.observedDate) ||
            left.gameId - right.gameId ||
            left.side.localeCompare(right.side) ||
            left.lineupSlot - right.lineupSlot ||
            left.playerId - right.playerId,
        );
      return [
        periodId,
        {
          rowCount: rows.length,
          rows,
        },
      ];
    }),
  );

  if (activeSeasons.size !== 1) {
    throw new Error('captured games do not share one active season.');
  }
  const [activeSeason] = activeSeasons;

  const identity = {
    datasetVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    activeSeason,
    sourceCaptureManifestSha256,
    sourceCapturePlanSha256,
    sourceResolvedDatasetSha256,
    includedPeriods: INCLUDED_PERIODS,
    untouchedTestReservation,
    exclusionPolicy: {
      incompleteOfficialLineupGame: 'exclude-entire-game',
      missingStarterStatsRow: 'exclude-starter-observation',
      duplicateStarterStatsRows: 'exclude-starter-observation',
      nullDirectPlateAppearances: 'exclude-starter-observation',
      componentArithmeticMismatch:
        'retain-direct-stats.plate_appearances-and-preserve-audit-flag',
      componentArithmeticFallback: 'prohibited',
    },
    totals,
    periods,
    incompleteLineupGames: incompleteLineupGames.sort(
      (left, right) =>
        left.observedDate.localeCompare(right.observedDate) ||
        left.gameId - right.gameId,
    ),
    excludedStarterObservations: excludedStarterObservations.sort(
      (left, right) =>
        left.observedDate.localeCompare(right.observedDate) ||
        left.gameId - right.gameId ||
        left.side.localeCompare(right.side) ||
        left.lineupSlot - right.lineupSlot ||
        left.playerId - right.playerId,
    ),
  };

  return Object.freeze({
    purpose:
      'Frozen current-season fit-validation hitter plate-appearance observations using official pregame lineup slots and direct BALLDONTLIE stats.plate_appearances totals.',
    ...identity,
    datasetSha256: sha256(JSON.stringify(identity)),
  });
}

export function verifyM8PaSurvivalDataset(rawDataset) {
  const dataset = assertObject(rawDataset, 'PA-survival dataset');
  validateUntouchedReservation(dataset.untouchedTestReservation);
  const expected = sha256(JSON.stringify(datasetIdentity(dataset)));
  if (dataset.datasetSha256 !== expected) {
    throw new Error('PA-survival dataset SHA-256 is invalid.');
  }
  return dataset;
}
