import { createHash } from 'node:crypto';

const SLOT_SET = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]);

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

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function deriveM8PlateAppearanceCandidate(rawRow) {
  const row = assertObject(rawRow, 'stats row');
  const components = {
    atBats: row.at_bats,
    walks: row.bb,
    hitByPitch: row.hit_by_pitch,
    sacFlies: row.sac_flies,
    sacBunts: row.sac_bunts,
  };

  if (!Object.values(components).every(isNonNegativeInteger)) {
    return Object.freeze({
      available: false,
      value: null,
      components: Object.freeze(components),
    });
  }

  return Object.freeze({
    available: true,
    value:
      components.atBats +
      components.walks +
      components.hitByPitch +
      components.sacFlies +
      components.sacBunts,
    components: Object.freeze(components),
  });
}

function battingActivity(row) {
  return [
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

function playerIdOf(row) {
  const id = row?.player?.id;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function teamIdOf(row) {
  const id = row?.team?.id;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function summarizeTeam({
  gameId,
  side,
  team,
  lineupRows,
  statsByPlayer,
}) {
  const teamId = assertPositiveInteger(team?.id, `${side} team id`);
  const battingRows = lineupRows
    .filter(
      (row) =>
        row.game_id === gameId &&
        teamIdOf(row) === teamId &&
        Number.isSafeInteger(row.batting_order),
    )
    .sort(
      (left, right) =>
        left.batting_order - right.batting_order ||
        playerIdOf(left) - playerIdOf(right),
    );
  const slots = battingRows.map((row) => row.batting_order);
  const missingSlots = SLOT_SET.filter((slot) => !slots.includes(slot));
  const duplicateSlots = [
    ...new Set(
      slots.filter((slot, index) => slots.indexOf(slot) !== index),
    ),
  ].sort((left, right) => left - right);
  const starters = battingRows.map((row) => {
    const playerId = assertPositiveInteger(
      playerIdOf(row),
      'lineup player id',
    );
    const matches = statsByPlayer.get(playerId) ?? [];
    const stats = matches.length === 1 ? matches[0] : null;
    const candidate =
      stats === null
        ? {
            available: false,
            value: null,
          }
        : deriveM8PlateAppearanceCandidate(stats);
    const directPa = stats?.plate_appearances;

    return Object.freeze({
      battingOrder: row.batting_order,
      playerId,
      playerName: row.player?.full_name ?? null,
      statsRowCount: matches.length,
      directPlateAppearances: isNonNegativeInteger(directPa)
        ? directPa
        : null,
      componentCandidate: candidate.available ? candidate.value : null,
      directMatchesCandidate:
        isNonNegativeInteger(directPa) && candidate.available
          ? directPa === candidate.value
          : null,
    });
  });

  return Object.freeze({
    side,
    teamId,
    teamName: team?.display_name ?? null,
    lineupRowCount: lineupRows.filter(
      (row) => row.game_id === gameId && teamIdOf(row) === teamId,
    ).length,
    battingRowCount: battingRows.length,
    slots: Object.freeze(slots),
    missingSlots: Object.freeze(missingSlots),
    duplicateSlots: Object.freeze(duplicateSlots),
    completeOfficialSlots:
      battingRows.length === 9 &&
      missingSlots.length === 0 &&
      duplicateSlots.length === 0,
    starters: Object.freeze(starters),
  });
}

export function summarizeM8StatsLineupGame({
  plannedGame,
  gameBody,
  statsRows,
  lineupRows,
  snapshots,
}) {
  const planGame = assertObject(plannedGame, 'plannedGame');
  const game = assertObject(gameBody, 'gameBody');
  const stats = assertArray(statsRows, 'statsRows');
  const lineups = assertArray(lineupRows, 'lineupRows');

  if (game.id !== planGame.gameId) {
    throw new Error('game response does not match planned game id.');
  }

  const statsForGame = stats.filter((row) => row.game_id === game.id);
  const lineupForGame = lineups.filter((row) => row.game_id === game.id);
  const statsByPlayer = new Map();

  for (const row of statsForGame) {
    const playerId = playerIdOf(row);
    if (playerId === null) {
      continue;
    }
    if (!statsByPlayer.has(playerId)) {
      statsByPlayer.set(playerId, []);
    }
    statsByPlayer.get(playerId).push(row);
  }

  const directPaRows = statsForGame.filter((row) =>
    isNonNegativeInteger(row.plate_appearances),
  );
  const comparableRows = directPaRows.filter(
    (row) => deriveM8PlateAppearanceCandidate(row).available,
  );
  const arithmeticMismatchRows = comparableRows.filter(
    (row) =>
      row.plate_appearances !== deriveM8PlateAppearanceCandidate(row).value,
  );
  const nullPaBattingRows = statsForGame.filter(
    (row) => row.plate_appearances === null && battingActivity(row),
  );
  const teams = Object.freeze([
    summarizeTeam({
      gameId: game.id,
      side: 'away',
      team: game.away_team,
      lineupRows: lineupForGame,
      statsByPlayer,
    }),
    summarizeTeam({
      gameId: game.id,
      side: 'home',
      team: game.home_team,
      lineupRows: lineupForGame,
      statsByPlayer,
    }),
  ]);
  const snapshotIdentity = assertObject(snapshots, 'snapshots');
  const identity = {
    gameId: game.id,
    observedDate: planGame.observedDate,
    periodId: planGame.periodId,
    sourceRowCount: planGame.sourceRowCount,
    status: game.status,
    season: game.season,
    seasonType: game.season_type,
    teams,
    stats: {
      rowCount: statsForGame.length,
      directPaRowCount: directPaRows.length,
      comparableArithmeticRowCount: comparableRows.length,
      arithmeticMismatchCount: arithmeticMismatchRows.length,
      nullPaBattingRowCount: nullPaBattingRows.length,
      nullPaBattingPlayers: nullPaBattingRows.map((row) => {
        const candidate = deriveM8PlateAppearanceCandidate(row);
        return {
          playerId: playerIdOf(row),
          playerName: row.player?.full_name ?? null,
          atBats: row.at_bats,
          componentCandidate: candidate.available ? candidate.value : null,
        };
      }),
    },
    snapshots: snapshotIdentity,
  };

  return Object.freeze({
    ...identity,
    summarySha256: sha256(JSON.stringify(identity)),
  });
}

export function buildM8StatsLineupCaptureManifest({
  plan,
  capturedGames,
}) {
  const capturePlan = assertObject(plan, 'plan');
  const games = assertArray(capturedGames, 'capturedGames')
    .slice()
    .sort(
      (left, right) =>
        left.observedDate.localeCompare(right.observedDate) ||
        left.gameId - right.gameId,
    );

  if (games.length !== capturePlan.gameCount) {
    throw new Error('captured game count does not match plan.');
  }

  const seen = new Set();
  for (const game of games) {
    if (seen.has(game.gameId)) {
      throw new Error(`duplicate captured game ${game.gameId}.`);
    }
    seen.add(game.gameId);
  }

  const totals = games.reduce(
    (summary, game) => {
      summary.completeLineupGames += game.teams.every(
        (team) => team.completeOfficialSlots,
      )
        ? 1
        : 0;
      summary.partialLineupGames +=
        game.teams.some((team) => team.battingRowCount > 0) &&
        !game.teams.every((team) => team.completeOfficialSlots)
          ? 1
          : 0;
      summary.absentLineupGames += game.teams.every(
        (team) => team.battingRowCount === 0,
      )
        ? 1
        : 0;
      summary.directPaRows += game.stats.directPaRowCount;
      summary.nullPaBattingRows += game.stats.nullPaBattingRowCount;
      summary.arithmeticMismatches += game.stats.arithmeticMismatchCount;
      return summary;
    },
    {
      completeLineupGames: 0,
      partialLineupGames: 0,
      absentLineupGames: 0,
      directPaRows: 0,
      nullPaBattingRows: 0,
      arithmeticMismatches: 0,
    },
  );
  const identity = {
    manifestVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    sourcePlanSha256: capturePlan.planSha256,
    sourceResolvedDatasetSha256:
      capturePlan.sourceResolvedDatasetSha256,
    sourceRowCount: capturePlan.sourceRowCount,
    gameCount: capturePlan.gameCount,
    includedPeriods: capturePlan.includedPeriods,
    untouchedTestReservation: capturePlan.untouchedTestReservation,
    totals,
    games: games.map((game) => ({
      gameId: game.gameId,
      observedDate: game.observedDate,
      periodId: game.periodId,
      summarySha256: game.summarySha256,
    })),
  };

  return Object.freeze({
    ...identity,
    manifestSha256: sha256(JSON.stringify(identity)),
  });
}
