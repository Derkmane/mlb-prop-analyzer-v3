import { createHash } from 'node:crypto';

const PERIOD_IDS = Object.freeze(['fit', 'validation']);
const SIDES = Object.freeze(['away', 'home']);
const SLOTS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

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
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
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
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function validateUntouchedReservation(raw, label) {
  const value = assertObject(raw, label);
  if (value.rowsIncluded !== false || Object.hasOwn(value, 'rows')) {
    throw new Error(`${label} must keep untouched-test rows sealed.`);
  }
  return Object.freeze({ ...value, rowsIncluded: false });
}

function resolvedDatasetIdentity(dataset) {
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

function validateResolvedDataset(rawDataset, manifest) {
  const dataset = assertObject(rawDataset, 'resolved categorical dataset');
  if (dataset.datasetVersion !== 3) {
    throw new Error('resolved categorical datasetVersion must equal 3.');
  }
  const datasetSha = assertSha256(dataset.datasetSha256, 'resolved dataset SHA-256');
  if (datasetSha !== manifest.sourceResolvedDatasetSha256) {
    throw new Error('resolved categorical dataset does not match the capture manifest.');
  }
  if (datasetSha !== sha256(JSON.stringify(resolvedDatasetIdentity(dataset)))) {
    throw new Error('resolved categorical dataset internal SHA-256 is invalid.');
  }
  validateUntouchedReservation(
    dataset.untouchedTestReservation,
    'resolved dataset untouchedTestReservation',
  );
  const rowsByGame = new Map();
  const seenRowIds = new Set();
  for (const periodId of PERIOD_IDS) {
    const period = assertObject(dataset.periods?.[periodId], `periods.${periodId}`);
    const rows = assertArray(period.rows, `periods.${periodId}.rows`);
    for (const [index, rawRow] of rows.entries()) {
      const row = assertObject(rawRow, `${periodId}.rows[${index}]`);
      const rowId = assertNonEmptyString(row.rowId, `${periodId}.rows[${index}].rowId`);
      if (seenRowIds.has(rowId)) throw new Error(`duplicate resolved row ${rowId}.`);
      seenRowIds.add(rowId);
      const gameId = assertPositiveInteger(row.providerGameId, `${rowId}.providerGameId`);
      const rowsForGame = rowsByGame.get(gameId) ?? [];
      rowsForGame.push(
        Object.freeze({
          rowId,
          periodId,
          observedDate: assertNonEmptyString(row.observedDate, `${rowId}.observedDate`),
          providerGameId: gameId,
          providerPaNumber: assertPositiveInteger(
            row.providerPaNumber,
            `${rowId}.providerPaNumber`,
          ),
          providerBatterId: assertPositiveInteger(
            row.providerBatterId,
            `${rowId}.providerBatterId`,
          ),
          halfInning: assertNonEmptyString(row.halfInning, `${rowId}.halfInning`).toLowerCase(),
          mappingStatus: assertNonEmptyString(row.mappingStatus, `${rowId}.mappingStatus`),
        }),
      );
      rowsByGame.set(gameId, rowsForGame);
    }
  }
  return Object.freeze({ dataset, rowsByGame });
}

function completeOfficialLineup(team) {
  const starters = assertArray(team.starters, 'team starters')
    .slice()
    .sort((left, right) => left.battingOrder - right.battingOrder);
  const slots = starters.map((starter) => starter.battingOrder);
  return (
    team.completeOfficialSlots === true &&
    starters.length === 9 &&
    SLOTS.every((slot) => slots.includes(slot)) &&
    new Set(slots).size === 9
  );
}

function exclusion(reason, details = {}) {
  return Object.freeze({ reason, ...details });
}

function sideRowsForGame(resolvedRows, side) {
  const expectedHalf = side === 'away' ? 'top' : 'bottom';
  return resolvedRows
    .filter((row) => row.halfInning === expectedHalf)
    .slice()
    .sort(
      (left, right) =>
        left.providerPaNumber - right.providerPaNumber ||
        left.rowId.localeCompare(right.rowId),
    );
}

function recoverSide({ gameId, observedDate, periodId, side, team, resolvedRows, sourceCaptureSha256 }) {
  if (!completeOfficialLineup(team)) {
    return Object.freeze({
      rows: Object.freeze([]),
      excluded: exclusion('incomplete-official-lineup'),
    });
  }
  const allSideRows = sideRowsForGame(resolvedRows, side);
  const unresolved = allSideRows.filter(
    (row) => row.mappingStatus !== 'classified-terminal' && row.mappingStatus !== 'baserunning-only',
  );
  if (unresolved.length > 0) {
    return Object.freeze({
      rows: Object.freeze([]),
      excluded: exclusion('unresolved-terminal-row', { rowCount: unresolved.length }),
    });
  }
  const terminalRows = allSideRows.filter(
    (row) => row.mappingStatus === 'classified-terminal',
  );
  if (terminalRows.length < 9) {
    return Object.freeze({
      rows: Object.freeze([]),
      excluded: exclusion('fewer-than-nine-terminal-plate-appearances'),
    });
  }
  const paNumbers = terminalRows.map((row) => row.providerPaNumber);
  if (new Set(paNumbers).size !== paNumbers.length) {
    return Object.freeze({
      rows: Object.freeze([]),
      excluded: exclusion('duplicate-pa-number'),
    });
  }
  for (let index = 1; index < paNumbers.length; index += 1) {
    if (paNumbers[index] <= paNumbers[index - 1]) {
      return Object.freeze({
        rows: Object.freeze([]),
        excluded: exclusion('non-increasing-pa-order'),
      });
    }
  }

  const starters = assertArray(team.starters, `game ${gameId} ${side} starters`)
    .slice()
    .sort((left, right) => left.battingOrder - right.battingOrder);
  const starterIds = starters.map((starter) =>
    assertPositiveInteger(starter.playerId, `game ${gameId} ${side} starter playerId`),
  );
  const firstCycle = terminalRows.slice(0, 9).map((row) => row.providerBatterId);
  if (JSON.stringify(firstCycle) !== JSON.stringify(starterIds)) {
    return Object.freeze({
      rows: Object.freeze([]),
      excluded: exclusion('lineup-anchor-mismatch', {
        expectedStarterIds: Object.freeze(starterIds),
        observedFirstCycle: Object.freeze(firstCycle),
      }),
    });
  }

  const slotSequences = SLOTS.map((slot) =>
    terminalRows
      .filter((unused, index) => index % 9 === slot - 1)
      .map((row) => row.providerBatterId),
  );
  if (slotSequences.reduce((sum, sequence) => sum + sequence.length, 0) !== terminalRows.length) {
    throw new Error(`game ${gameId} ${side} slot-turn conservation failed.`);
  }

  const recovered = [];
  const firstReplacementTurns = [];
  for (const slot of SLOTS) {
    const starter = starters[slot - 1];
    const starterId = starterIds[slot - 1];
    const sequence = slotSequences[slot - 1];
    let starterPlateAppearances = 0;
    while (sequence[starterPlateAppearances] === starterId) {
      starterPlateAppearances += 1;
    }
    if (sequence.slice(starterPlateAppearances).includes(starterId)) {
      return Object.freeze({
        rows: Object.freeze([]),
        excluded: exclusion('starter-reappears-after-replacement', { lineupSlot: slot }),
      });
    }
    const slotTurns = sequence.length;
    const directPlateAppearances = starter.directPlateAppearances;
    if (!Number.isSafeInteger(directPlateAppearances) || directPlateAppearances < 0) {
      return Object.freeze({
        rows: Object.freeze([]),
        excluded: exclusion('starter-direct-pa-unavailable', { lineupSlot: slot }),
      });
    }
    if (directPlateAppearances !== starterPlateAppearances) {
      return Object.freeze({
        rows: Object.freeze([]),
        excluded: exclusion('starter-pa-audit-mismatch', {
          lineupSlot: slot,
          recoveredStarterPlateAppearances: starterPlateAppearances,
          directPlateAppearances,
        }),
      });
    }
    const substituted = starterPlateAppearances < slotTurns;
    const firstReplacementTurn = substituted ? starterPlateAppearances + 1 : null;
    if (firstReplacementTurn !== null) firstReplacementTurns.push(firstReplacementTurn);
    recovered.push(
      Object.freeze({
        rowId: `${periodId}:${observedDate}:${gameId}:${side}:slot:${slot}`,
        observedDate,
        periodId,
        gameId,
        side,
        homeAway: side,
        teamId: assertPositiveInteger(team.teamId, `game ${gameId} ${side} teamId`),
        playerId: starterId,
        playerName: starter.playerName ?? null,
        lineupSlot: slot,
        slotTurns,
        starterPlateAppearances,
        substituted,
        firstReplacementTurn,
        sourceCaptureSha256,
      }),
    );
  }

  const countsByReplacementTurn = new Map();
  for (const turn of firstReplacementTurns) {
    countsByReplacementTurn.set(turn, (countsByReplacementTurn.get(turn) ?? 0) + 1);
  }
  const phaseShift = [...countsByReplacementTurn.entries()].find(
    (unused) => unused[1] >= 5,
  );
  if (phaseShift !== undefined) {
    return Object.freeze({
      rows: Object.freeze([]),
      excluded: exclusion('simultaneous-multi-slot-phase-shift', {
        replacementTurn: phaseShift[0],
        affectedSlotCount: phaseShift[1],
      }),
    });
  }

  return Object.freeze({
    rows: Object.freeze(recovered),
    excluded: null,
    terminalPlateAppearanceCount: terminalRows.length,
    ignoredBaserunningRowCount: allSideRows.length - terminalRows.length,
  });
}

function datasetIdentity(dataset) {
  return {
    datasetVersion: dataset.datasetVersion,
    provider: dataset.provider,
    activeSeason: dataset.activeSeason,
    sourceCaptureManifestSha256: dataset.sourceCaptureManifestSha256,
    sourceResolvedDatasetSha256: dataset.sourceResolvedDatasetSha256,
    sourceResolvedDatasetFileSha256: dataset.sourceResolvedDatasetFileSha256,
    includedPeriods: dataset.includedPeriods,
    untouchedTestReservation: dataset.untouchedTestReservation,
    exclusionPolicy: dataset.exclusionPolicy,
    totals: dataset.totals,
    exclusionReasonCounts: dataset.exclusionReasonCounts,
    periods: dataset.periods,
    excludedTeamGames: dataset.excludedTeamGames,
  };
}

export function buildM8StarterRetentionDataset({
  captureManifest,
  captures,
  resolvedDataset,
  sourceResolvedDatasetFileSha256,
}) {
  const manifest = assertObject(captureManifest, 'captureManifest');
  const capturedGames = assertArray(captures, 'captures');
  if (manifest.provider !== 'BALLDONTLIE MLB API') {
    throw new Error('capture manifest provider is not BALLDONTLIE MLB API.');
  }
  const untouchedTestReservation = validateUntouchedReservation(
    manifest.untouchedTestReservation,
    'capture manifest untouchedTestReservation',
  );
  const sourceCaptureManifestSha256 = assertSha256(
    manifest.manifestSha256,
    'capture manifest SHA-256',
  );
  const sourceResolvedDatasetSha256 = assertSha256(
    manifest.sourceResolvedDatasetSha256,
    'source resolved dataset SHA-256',
  );
  const resolvedFileSha = assertSha256(
    sourceResolvedDatasetFileSha256,
    'source resolved dataset file SHA-256',
  );
  const resolved = validateResolvedDataset(resolvedDataset, manifest);
  if (capturedGames.length !== manifest.gameCount) {
    throw new Error('capture count does not match manifest game count.');
  }
  const captureByGameId = new Map();
  for (const capture of capturedGames) {
    const gameId = assertPositiveInteger(capture.plannedGame?.gameId, 'capture gameId');
    if (captureByGameId.has(gameId)) throw new Error(`duplicate capture ${gameId}.`);
    validateUntouchedReservation(
      capture.untouchedTestReservation,
      `capture ${gameId} untouchedTestReservation`,
    );
    captureByGameId.set(gameId, capture);
  }

  const periodRows = new Map(PERIOD_IDS.map((periodId) => [periodId, []]));
  const excludedTeamGames = [];
  const exclusionReasonCounts = {};
  const totals = {
    capturedGameCount: capturedGames.length,
    candidateTeamGameCount: capturedGames.length * 2,
    includedTeamGameCount: 0,
    excludedTeamGameCount: 0,
    includedSlotObservationCount: 0,
    terminalPlateAppearanceCount: 0,
    ignoredBaserunningRowCount: 0,
    substitutedSlotObservationCount: 0,
  };
  const activeSeasons = new Set();

  const orderedGames = assertArray(manifest.games, 'manifest.games')
    .slice()
    .sort(
      (left, right) =>
        String(left.observedDate).localeCompare(String(right.observedDate)) ||
        left.gameId - right.gameId,
    );
  for (const manifestGame of orderedGames) {
    const gameId = assertPositiveInteger(manifestGame.gameId, 'manifest gameId');
    const capture = captureByGameId.get(gameId);
    if (capture === undefined) throw new Error(`capture missing for game ${gameId}.`);
    const summary = assertObject(capture.summary, `game ${gameId} summary`);
    const observedDate = assertNonEmptyString(
      capture.plannedGame?.observedDate,
      `game ${gameId} observedDate`,
    );
    const periodId = assertNonEmptyString(
      capture.plannedGame?.periodId,
      `game ${gameId} periodId`,
    );
    if (!PERIOD_IDS.includes(periodId)) {
      throw new Error(`game ${gameId} has unsupported period ${periodId}.`);
    }
    if (summary.status !== 'STATUS_FINAL' || summary.seasonType !== 'regular') {
      throw new Error(`game ${gameId} is not a final regular-season game.`);
    }
    activeSeasons.add(assertPositiveInteger(summary.season, `game ${gameId} season`));
    const resolvedRows = resolved.rowsByGame.get(gameId) ?? [];
    if (resolvedRows.length === 0) {
      throw new Error(`resolved dataset has no rows for game ${gameId}.`);
    }
    const teams = assertArray(summary.teams, `game ${gameId} teams`);
    for (const side of SIDES) {
      const team = teams.find((candidate) => candidate.side === side);
      if (team === undefined) throw new Error(`game ${gameId} is missing ${side} team summary.`);
      const recovered = recoverSide({
        gameId,
        observedDate,
        periodId,
        side,
        team,
        resolvedRows,
        sourceCaptureSha256: assertSha256(
          capture.captureSha256,
          `game ${gameId} capture SHA-256`,
        ),
      });
      if (recovered.excluded !== null) {
        totals.excludedTeamGameCount += 1;
        exclusionReasonCounts[recovered.excluded.reason] =
          (exclusionReasonCounts[recovered.excluded.reason] ?? 0) + 1;
        excludedTeamGames.push(
          Object.freeze({
            gameId,
            observedDate,
            periodId,
            side,
            ...recovered.excluded,
          }),
        );
        continue;
      }
      totals.includedTeamGameCount += 1;
      totals.includedSlotObservationCount += recovered.rows.length;
      totals.terminalPlateAppearanceCount += recovered.terminalPlateAppearanceCount;
      totals.ignoredBaserunningRowCount += recovered.ignoredBaserunningRowCount;
      totals.substitutedSlotObservationCount += recovered.rows.filter(
        (row) => row.substituted,
      ).length;
      periodRows.get(periodId).push(...recovered.rows);
    }
  }
  if (activeSeasons.size !== 1) {
    throw new Error('captured games do not share one active season.');
  }
  if (
    totals.includedTeamGameCount + totals.excludedTeamGameCount !==
    totals.candidateTeamGameCount
  ) {
    throw new Error('team-game accounting does not conserve candidates.');
  }
  if (totals.includedSlotObservationCount !== totals.includedTeamGameCount * 9) {
    throw new Error('included slot observations do not equal nine per team game.');
  }

  const periods = Object.fromEntries(
    PERIOD_IDS.map((periodId) => {
      const rows = periodRows.get(periodId).slice().sort(
        (left, right) =>
          left.observedDate.localeCompare(right.observedDate) ||
          left.gameId - right.gameId ||
          left.side.localeCompare(right.side) ||
          left.lineupSlot - right.lineupSlot,
      );
      return [
        periodId,
        Object.freeze({
          startDate: rows[0]?.observedDate ?? null,
          endDate: rows.at(-1)?.observedDate ?? null,
          rowCount: rows.length,
          rows: Object.freeze(rows),
        }),
      ];
    }),
  );
  if (periods.fit.rowCount === 0 || periods.validation.rowCount === 0) {
    throw new Error('starter retention dataset requires fit and validation rows.');
  }
  if (periods.fit.endDate >= periods.validation.startDate) {
    throw new Error('starter retention periods must be chronological and non-overlapping.');
  }

  const identity = {
    datasetVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    activeSeason: [...activeSeasons][0],
    sourceCaptureManifestSha256,
    sourceResolvedDatasetSha256,
    sourceResolvedDatasetFileSha256: resolvedFileSha,
    includedPeriods: PERIOD_IDS,
    untouchedTestReservation,
    exclusionPolicy: Object.freeze({
      baserunningOnlyRows: 'exclude-before-slot-cycle-recovery',
      unresolvedTerminalRows: 'exclude-team-game',
      incompleteOfficialLineup: 'exclude-team-game',
      lineupAnchorMismatch: 'exclude-team-game',
      starterReappearance: 'exclude-team-game',
      simultaneousMultiSlotPhaseShift: 'exclude-team-game',
      directStarterPaMismatch: 'exclude-team-game',
      repairsOrInterpolation: 'prohibited',
    }),
    totals: Object.freeze(totals),
    exclusionReasonCounts: Object.freeze(
      Object.fromEntries(Object.entries(exclusionReasonCounts).sort()),
    ),
    periods: Object.freeze(periods),
    excludedTeamGames: Object.freeze(
      excludedTeamGames.sort(
        (left, right) =>
          left.observedDate.localeCompare(right.observedDate) ||
          left.gameId - right.gameId ||
          left.side.localeCompare(right.side),
      ),
    ),
  };
  return Object.freeze({
    purpose:
      'Recover current-season batting-slot turns and named-starter plate appearances from terminal PA order, official lineups, and direct PA audit evidence while keeping the untouched test sealed.',
    ...identity,
    datasetSha256: sha256(JSON.stringify(identity)),
  });
}

export function verifyM8StarterRetentionDataset(rawDataset) {
  const dataset = assertObject(rawDataset, 'starter retention dataset');
  validateUntouchedReservation(
    dataset.untouchedTestReservation,
    'starter retention untouchedTestReservation',
  );
  const expected = sha256(JSON.stringify(datasetIdentity(dataset)));
  if (dataset.datasetSha256 !== expected) {
    throw new Error('starter retention dataset SHA-256 is invalid.');
  }
  return dataset;
}
