import { createHash } from 'node:crypto';

const INCLUDED_PERIODS = Object.freeze(['fit', 'validation']);
const SIDES = Object.freeze(['away', 'home']);
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
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateUntouchedReservation(rawValue, label) {
  const value = assertObject(rawValue, label);
  if (value.rowsIncluded !== false || Object.hasOwn(value, 'rows')) {
    throw new Error(`${label} must keep untouched-test rows excluded.`);
  }
  return Object.freeze({ ...value, rowsIncluded: false });
}

function playerIdOf(row) {
  const value = row?.player?.id;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function teamNameOf(row) {
  const value = row?.team_name;
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function hasBattingActivity(row) {
  return [
    row.plate_appearances,
    row.at_bats,
    row.bb,
    row.hit_by_pitch,
    row.sac_flies,
    row.sac_bunts,
    row.hits,
    row.runs,
    row.rbi,
  ].some((value) => isNonNegativeInteger(value) && value > 0);
}

function completeOfficialLineup(team) {
  const value = assertObject(team, 'team summary');
  const starters = assertArray(value.starters, 'team starters');
  const slots = starters.map((starter) => starter.battingOrder);
  return (
    value.completeOfficialSlots === true &&
    starters.length === 9 &&
    slots.length === new Set(slots).size &&
    [1, 2, 3, 4, 5, 6, 7, 8, 9].every((slot) => slots.includes(slot))
  );
}

function sourceIdentity(dataset) {
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
    excludedGames: dataset.excludedGames,
  };
}

function gameStatsRows(capture, gameId) {
  const pages = assertArray(capture.statsPages, `game ${gameId} statsPages`);
  const rows = pages.flatMap((page, pageIndex) => {
    const body = assertObject(page.body, `game ${gameId} stats page ${pageIndex} body`);
    return assertArray(body.data, `game ${gameId} stats page ${pageIndex} data`);
  });
  for (const [index, row] of rows.entries()) {
    if (row.game_id !== gameId) {
      throw new Error(`game ${gameId} stats row ${index} belongs to another game.`);
    }
  }
  return rows;
}

function teamEvidence({ gameId, side, team, teamSummary, statsRows }) {
  const teamId = assertPositiveInteger(team?.id, `game ${gameId} ${side} teamId`);
  const teamName = assertNonEmptyString(
    team?.display_name,
    `game ${gameId} ${side} team display_name`,
  );
  const opponentSide = side === 'home' ? 'away' : 'home';
  const teamRows = statsRows.filter((row) => teamNameOf(row) === teamName);
  const activeRows = teamRows.filter(hasBattingActivity);
  const reasons = [];

  const seenPlayerIds = new Set();
  for (const row of activeRows) {
    const playerId = playerIdOf(row);
    if (playerId === null) {
      reasons.push('missing-player-identity');
      continue;
    }
    if (seenPlayerIds.has(playerId)) {
      reasons.push('duplicate-player-stats-rows');
    }
    seenPlayerIds.add(playerId);
  }

  if (activeRows.length === 0) {
    reasons.push('no-batting-activity');
  }

  const starters = assertArray(teamSummary.starters, `game ${gameId} ${side} starters`);
  if (starters.some((starter) => starter.statsRowCount !== 1)) {
    reasons.push('starter-stats-row-count-not-one');
  }
  if (starters.some((starter) => !isNonNegativeInteger(starter.directPlateAppearances))) {
    reasons.push('starter-direct-pa-unavailable');
  }
  if (activeRows.some((row) => !isNonNegativeInteger(row.plate_appearances))) {
    reasons.push('active-player-direct-pa-unavailable');
  }
  if (activeRows.some((row) => !isNonNegativeInteger(row.hits))) {
    reasons.push('active-player-hits-unavailable');
  }

  const uniqueReasons = [...new Set(reasons)].sort();
  if (uniqueReasons.length > 0) {
    return Object.freeze({
      side,
      opponentSide,
      teamId,
      teamName,
      reasons: Object.freeze(uniqueReasons),
    });
  }

  const totalPlateAppearances = activeRows.reduce(
    (total, row) => total + row.plate_appearances,
    0,
  );
  const totalHits = activeRows.reduce((total, row) => total + row.hits, 0);
  const totalRuns = activeRows.every((row) => isNonNegativeInteger(row.runs))
    ? activeRows.reduce((total, row) => total + row.runs, 0)
    : null;

  if (!(totalPlateAppearances > 0)) {
    return Object.freeze({
      side,
      opponentSide,
      teamId,
      teamName,
      reasons: Object.freeze(['non-positive-team-pa-total']),
    });
  }
  if (totalHits > totalPlateAppearances) {
    throw new Error(`game ${gameId} ${side} team hits exceed team plate appearances.`);
  }

  return Object.freeze({
    side,
    opponentSide,
    teamId,
    teamName,
    reasons: Object.freeze([]),
    activePlayerCount: activeRows.length,
    totalPlateAppearances,
    totalHits,
    totalRuns,
  });
}

export function buildM8TeamOffensiveEnvironmentDataset({
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
    'capture manifest untouchedTestReservation',
  );
  const sourceCaptureManifestSha256 = assertSha256(
    manifest.manifestSha256,
    'capture manifest SHA-256',
  );
  const sourceCapturePlanSha256 = assertSha256(
    manifest.sourcePlanSha256,
    'capture plan SHA-256',
  );
  const sourceResolvedDatasetSha256 = assertSha256(
    manifest.sourceResolvedDatasetSha256,
    'resolved dataset SHA-256',
  );
  const gameCount = assertPositiveInteger(manifest.gameCount, 'manifest gameCount');
  if (capturedGames.length !== gameCount) {
    throw new Error('capture count does not match manifest game count.');
  }

  const captureByGameId = new Map();
  for (const rawCapture of capturedGames) {
    const capture = assertObject(rawCapture, 'capture');
    validateUntouchedReservation(
      capture.untouchedTestReservation,
      `game ${capture.plannedGame?.gameId ?? 'unknown'} untouchedTestReservation`,
    );
    const gameId = assertPositiveInteger(capture.plannedGame?.gameId, 'capture gameId');
    if (captureByGameId.has(gameId)) {
      throw new Error(`duplicate capture for game ${gameId}.`);
    }
    if (capture.sourcePlanSha256 !== sourceCapturePlanSha256) {
      throw new Error(`capture ${gameId} plan SHA-256 mismatch.`);
    }
    captureByGameId.set(gameId, capture);
  }

  const periodRows = new Map(INCLUDED_PERIODS.map((periodId) => [periodId, []]));
  const excludedGames = [];
  const activeSeasons = new Set();
  const totals = {
    capturedGameCount: gameCount,
    candidateTeamGameCount: gameCount * 2,
    includedGameCount: 0,
    includedTeamGameCount: 0,
    excludedGameCount: 0,
    excludedTeamGameCount: 0,
    totalIncludedPlateAppearances: 0,
    totalIncludedHits: 0,
  };

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
    if (capture === undefined) {
      throw new Error(`capture missing for game ${gameId}.`);
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
    if (summary.status !== 'STATUS_FINAL' || summary.seasonType !== 'regular') {
      throw new Error(`game ${gameId} is not a final regular-season game.`);
    }
    activeSeasons.add(assertPositiveInteger(summary.season, `game ${gameId} season`));
    const teams = assertArray(summary.teams, `game ${gameId} teams`);
    if (teams.length !== 2 || !teams.every(completeOfficialLineup)) {
      totals.excludedGameCount += 1;
      totals.excludedTeamGameCount += 2;
      excludedGames.push({
        gameId,
        observedDate,
        periodId,
        reasons: Object.freeze(['incomplete-official-lineup']),
        teams: teams.map((team) => ({
          side: team.side,
          teamId: team.teamId,
          completeOfficialSlots: team.completeOfficialSlots,
          missingSlots: team.missingSlots,
          duplicateSlots: team.duplicateSlots,
        })),
      });
      continue;
    }

    const game = assertObject(capture.gameSnapshot?.body?.data, `game ${gameId} snapshot`);
    if (game.id !== gameId) {
      throw new Error(`game ${gameId} snapshot identity mismatch.`);
    }
    const statsRows = gameStatsRows(capture, gameId);
    const expectedTeamNames = new Set([
      assertNonEmptyString(game.away_team?.display_name, `game ${gameId} away display_name`),
      assertNonEmptyString(game.home_team?.display_name, `game ${gameId} home display_name`),
    ]);
    const unmatchedActiveRows = statsRows.filter(
      (row) => hasBattingActivity(row) && !expectedTeamNames.has(teamNameOf(row)),
    );
    if (unmatchedActiveRows.length > 0) {
      totals.excludedGameCount += 1;
      totals.excludedTeamGameCount += 2;
      excludedGames.push({
        gameId,
        observedDate,
        periodId,
        reasons: Object.freeze(['unmatched-active-stats-team-name']),
        teams: Object.freeze([]),
      });
      continue;
    }
    const teamSummaryBySide = new Map(teams.map((team) => [team.side, team]));
    const evidence = SIDES.map((side) => {
      const team = side === 'home' ? game.home_team : game.away_team;
      const teamSummary = teamSummaryBySide.get(side);
      if (teamSummary === undefined) {
        throw new Error(`game ${gameId} missing ${side} team summary.`);
      }
      return teamEvidence({ gameId, side, team, teamSummary, statsRows });
    });

    const failureReasons = evidence.flatMap((team) =>
      team.reasons.map((reason) => `${team.side}:${reason}`),
    );
    if (failureReasons.length > 0) {
      totals.excludedGameCount += 1;
      totals.excludedTeamGameCount += 2;
      excludedGames.push({
        gameId,
        observedDate,
        periodId,
        reasons: Object.freeze([...new Set(failureReasons)].sort()),
        teams: evidence,
      });
      continue;
    }

    const bySide = new Map(evidence.map((team) => [team.side, team]));
    totals.includedGameCount += 1;
    totals.includedTeamGameCount += 2;
    for (const team of evidence) {
      const opponent = bySide.get(team.opponentSide);
      const row = Object.freeze({
        rowId: `${periodId}:${observedDate}:${gameId}:${team.side}:${team.teamId}`,
        observedDate,
        periodId,
        gameId,
        side: team.side,
        homeAway: team.side,
        teamId: team.teamId,
        teamName: team.teamName,
        opponentTeamId: opponent.teamId,
        opponentTeamName: opponent.teamName,
        teamPlateAppearances: team.totalPlateAppearances,
        opponentPlateAppearances: opponent.totalPlateAppearances,
        gamePlateAppearances:
          team.totalPlateAppearances + opponent.totalPlateAppearances,
        teamHits: team.totalHits,
        teamRuns: team.totalRuns,
        activePlayerCount: team.activePlayerCount,
        sourceCaptureSha256: assertSha256(
          capture.captureSha256,
          `game ${gameId} capture SHA-256`,
        ),
        sourceStatsRawBodySha256s: summary.snapshots?.statsRawBodySha256s ?? [],
      });
      periodRows.get(periodId).push(row);
      totals.totalIncludedPlateAppearances += team.totalPlateAppearances;
      totals.totalIncludedHits += team.totalHits;
    }
  }

  if (totals.includedGameCount + totals.excludedGameCount !== gameCount) {
    throw new Error('game conservation failed.');
  }
  if (
    totals.includedTeamGameCount + totals.excludedTeamGameCount !==
    totals.candidateTeamGameCount
  ) {
    throw new Error('team-game conservation failed.');
  }
  if (totals.includedTeamGameCount !== totals.includedGameCount * 2) {
    throw new Error('included games must preserve both team sides.');
  }
  if (activeSeasons.size !== 1) {
    throw new Error('captures do not share one active season.');
  }
  const [activeSeason] = activeSeasons;

  const periods = Object.fromEntries(
    INCLUDED_PERIODS.map((periodId) => {
      const rows = periodRows
        .get(periodId)
        .slice()
        .sort(
          (left, right) =>
            left.observedDate.localeCompare(right.observedDate) ||
            left.gameId - right.gameId ||
            left.side.localeCompare(right.side),
        );
      const seen = new Set();
      for (const row of rows) {
        if (seen.has(row.rowId)) {
          throw new Error(`duplicate environment row ${row.rowId}.`);
        }
        seen.add(row.rowId);
      }
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
    throw new Error('fit and validation environment periods must both contain rows.');
  }
  if (periods.fit.endDate >= periods.validation.startDate) {
    throw new Error('environment fit and validation windows must not overlap.');
  }

  const identity = {
    datasetVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    activeSeason,
    sourceCaptureManifestSha256,
    sourceCapturePlanSha256,
    sourceResolvedDatasetSha256,
    includedPeriods: INCLUDED_PERIODS,
    untouchedTestReservation,
    exclusionPolicy: Object.freeze({
      incompleteOfficialLineupGame: 'exclude-entire-game',
      incompleteDirectTeamPaEvidence: 'exclude-entire-game',
      incompleteTeamHitEvidence: 'exclude-entire-game',
      directPlateAppearances: 'authoritative-stats.plate_appearances',
      statsTeamJoin: 'exact-stats.team_name-to-game-team.display_name',
      componentArithmeticFallback: 'prohibited',
      pairedTeamGameRequirement: 'both-sides-or-neither',
    }),
    totals: Object.freeze(totals),
    periods: Object.freeze(periods),
    excludedGames: Object.freeze(
      excludedGames.sort(
        (left, right) =>
          left.observedDate.localeCompare(right.observedDate) ||
          left.gameId - right.gameId,
      ),
    ),
  };

  return Object.freeze({
    purpose:
      'Frozen current-season fit-validation team-game offensive-environment observations using authoritative direct team PA totals and team hits for shared opportunity/outcome modeling.',
    ...identity,
    datasetSha256: sha256(JSON.stringify(identity)),
  });
}

export function verifyM8TeamOffensiveEnvironmentDataset(rawDataset) {
  const dataset = assertObject(rawDataset, 'team offensive-environment dataset');
  validateUntouchedReservation(
    dataset.untouchedTestReservation,
    'team offensive-environment untouchedTestReservation',
  );
  if (dataset.datasetVersion !== 1 || dataset.provider !== 'BALLDONTLIE MLB API') {
    throw new Error('unsupported team offensive-environment dataset contract.');
  }
  assertPositiveInteger(dataset.activeSeason, 'activeSeason');
  assertSha256(dataset.sourceCaptureManifestSha256, 'sourceCaptureManifestSha256');
  assertSha256(dataset.sourceCapturePlanSha256, 'sourceCapturePlanSha256');
  assertSha256(dataset.sourceResolvedDatasetSha256, 'sourceResolvedDatasetSha256');
  const expected = sha256(JSON.stringify(sourceIdentity(dataset)));
  if (assertSha256(dataset.datasetSha256, 'datasetSha256') !== expected) {
    throw new Error('team offensive-environment dataset SHA-256 is invalid.');
  }
  for (const periodId of INCLUDED_PERIODS) {
    const period = assertObject(dataset.periods?.[periodId], `periods.${periodId}`);
    const rows = assertArray(period.rows, `periods.${periodId}.rows`);
    if (assertNonNegativeInteger(period.rowCount, `${periodId}.rowCount`) !== rows.length) {
      throw new Error(`${periodId} rowCount does not match rows.`);
    }
    for (const row of rows) {
      if (row.periodId !== periodId || row.homeAway !== row.side) {
        throw new Error(`${row.rowId} period or side identity drifted.`);
      }
      assertPositiveInteger(row.teamPlateAppearances, `${row.rowId}.teamPlateAppearances`);
      assertNonNegativeInteger(row.teamHits, `${row.rowId}.teamHits`);
      if (row.teamHits > row.teamPlateAppearances) {
        throw new Error(`${row.rowId} teamHits exceed teamPlateAppearances.`);
      }
      assertPositiveInteger(row.opponentPlateAppearances, `${row.rowId}.opponentPlateAppearances`);
      if (
        row.gamePlateAppearances !==
        row.teamPlateAppearances + row.opponentPlateAppearances
      ) {
        throw new Error(`${row.rowId} game PA total is inconsistent.`);
      }
    }
  }
  return dataset;
}
