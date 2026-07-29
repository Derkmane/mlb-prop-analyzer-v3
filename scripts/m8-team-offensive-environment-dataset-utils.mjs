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

function normalizedHalfInning(value, label) {
  const normalized = assertNonEmptyString(value, label).toLowerCase();
  if (normalized !== 'top' && normalized !== 'bottom') {
    throw new Error(`${label} must be top or bottom.`);
  }
  return normalized;
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

function playerIdOf(row) {
  const value = row?.player?.id;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function teamNameOf(row) {
  const value = row?.team_name;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
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

function optionalDirectBatterPaComparator({ statsRows, teamName }) {
  const activeRows = statsRows.filter(
    (row) => teamNameOf(row) === teamName && hasBattingActivity(row),
  );
  if (activeRows.length === 0) {
    return Object.freeze({ available: false, reason: 'no-exact-team-name-batting-cohort' });
  }
  const seenPlayerIds = new Set();
  for (const row of activeRows) {
    const playerId = playerIdOf(row);
    if (playerId === null || seenPlayerIds.has(playerId)) {
      return Object.freeze({
        available: false,
        reason: playerId === null ? 'batting-player-identity-unavailable' : 'duplicate-batting-player-row',
      });
    }
    seenPlayerIds.add(playerId);
    if (!isNonNegativeInteger(row.plate_appearances)) {
      return Object.freeze({ available: false, reason: 'direct-batter-pa-incomplete' });
    }
  }
  return Object.freeze({
    available: true,
    playerCount: activeRows.length,
    totalPlateAppearances: activeRows.reduce(
      (sum, row) => sum + row.plate_appearances,
      0,
    ),
  });
}

function validateResolvedDataset(rawDataset, manifest) {
  const dataset = assertObject(rawDataset, 'resolved categorical dataset');
  if (dataset.datasetVersion !== 3) {
    throw new Error('resolved categorical datasetVersion must equal 3.');
  }
  const datasetSha256 = assertSha256(dataset.datasetSha256, 'resolved dataset SHA-256');
  if (datasetSha256 !== manifest.sourceResolvedDatasetSha256) {
    throw new Error('resolved categorical dataset does not match the capture manifest.');
  }
  validateUntouchedReservation(
    dataset.untouchedTestReservation,
    'resolved categorical dataset untouchedTestReservation',
  );
  const activeSeason = assertPositiveInteger(dataset.activeSeason, 'resolved activeSeason');
  const rowsByGame = new Map();
  const seenRowIds = new Set();
  for (const periodId of INCLUDED_PERIODS) {
    const period = assertObject(dataset.periods?.[periodId], `resolved periods.${periodId}`);
    const rows = assertArray(period.rows, `resolved periods.${periodId}.rows`);
    for (const [index, row] of rows.entries()) {
      const label = `resolved ${periodId}.rows[${index}]`;
      const rowId = assertNonEmptyString(row.rowId, `${label}.rowId`);
      if (seenRowIds.has(rowId)) {
        throw new Error(`duplicate resolved row ${rowId}.`);
      }
      seenRowIds.add(rowId);
      const gameId = assertPositiveInteger(row.providerGameId, `${label}.providerGameId`);
      const pitcherId = assertPositiveInteger(
        row.providerPitcherId,
        `${label}.providerPitcherId`,
      );
      const halfInning = normalizedHalfInning(row.halfInning, `${label}.halfInning`);
      const mappingStatus = assertNonEmptyString(row.mappingStatus, `${label}.mappingStatus`);
      if (!['classified-terminal', 'baserunning-only', 'unresolved'].includes(mappingStatus)) {
        throw new Error(`${label}.mappingStatus is unsupported.`);
      }
      const rowsForGame = rowsByGame.get(gameId) ?? [];
      rowsForGame.push(
        Object.freeze({
          rowId,
          periodId,
          observedDate: assertNonEmptyString(row.observedDate, `${label}.observedDate`),
          providerGameId: gameId,
          providerPitcherId: pitcherId,
          halfInning,
          mappingStatus,
        }),
      );
      rowsByGame.set(gameId, rowsForGame);
    }
  }
  return Object.freeze({ dataset, datasetSha256, activeSeason, rowsByGame });
}

function pitcherEvidenceForSide({ side, statsRows, resolvedRows }) {
  const expectedHalf = side === 'away' ? 'top' : 'bottom';
  const sideRows = resolvedRows.filter((row) => row.halfInning === expectedHalf);
  const evidenceRows = sideRows.filter((row) => row.mappingStatus !== 'baserunning-only');
  const ignoredBaserunningRows = sideRows.length - evidenceRows.length;
  const pitcherIds = [...new Set(evidenceRows.map((row) => row.providerPitcherId))].sort(
    (left, right) => left - right,
  );
  const reasons = [];
  if (evidenceRows.length === 0 || pitcherIds.length === 0) {
    reasons.push('no-terminal-or-unresolved-pa-evidence');
  }
  const statsByPlayerId = new Map();
  for (const row of statsRows) {
    const playerId = playerIdOf(row);
    if (playerId === null) continue;
    const matches = statsByPlayerId.get(playerId) ?? [];
    matches.push(row);
    statsByPlayerId.set(playerId, matches);
  }
  const pitcherRows = [];
  for (const pitcherId of pitcherIds) {
    const matches = statsByPlayerId.get(pitcherId) ?? [];
    if (matches.length !== 1) {
      reasons.push(matches.length === 0 ? 'pitcher-stats-row-missing' : 'pitcher-stats-row-duplicate');
      pitcherRows.push(Object.freeze({ pitcherId, statsRowCount: matches.length }));
      continue;
    }
    const row = matches[0];
    if (!isNonNegativeInteger(row.batters_faced)) {
      reasons.push('pitcher-batters-faced-unavailable');
    }
    if (!isNonNegativeInteger(row.p_hits)) {
      reasons.push('pitcher-hits-allowed-unavailable');
    }
    pitcherRows.push(
      Object.freeze({
        pitcherId,
        playerName:
          typeof row.player?.full_name === 'string' && row.player.full_name.trim().length > 0
            ? row.player.full_name.trim()
            : null,
        battersFaced: row.batters_faced,
        hitsAllowed: row.p_hits,
      }),
    );
  }
  const uniqueReasons = [...new Set(reasons)].sort();
  if (uniqueReasons.length > 0) {
    return Object.freeze({
      side,
      reasons: Object.freeze(uniqueReasons),
      pitcherIds: Object.freeze(pitcherIds),
      pitcherRows: Object.freeze(pitcherRows),
      resolvedRowCount: sideRows.length,
      evidenceRowCount: evidenceRows.length,
      ignoredBaserunningRowCount: ignoredBaserunningRows,
    });
  }
  const teamPlateAppearances = pitcherRows.reduce(
    (sum, row) => sum + row.battersFaced,
    0,
  );
  const pitchingHitsAllowed = pitcherRows.reduce(
    (sum, row) => sum + row.hitsAllowed,
    0,
  );
  if (!(teamPlateAppearances > 0)) {
    return Object.freeze({
      side,
      reasons: Object.freeze(['non-positive-team-pa-total']),
      pitcherIds: Object.freeze(pitcherIds),
      pitcherRows: Object.freeze(pitcherRows),
      resolvedRowCount: sideRows.length,
      evidenceRowCount: evidenceRows.length,
      ignoredBaserunningRowCount: ignoredBaserunningRows,
    });
  }
  return Object.freeze({
    side,
    reasons: Object.freeze([]),
    pitcherIds: Object.freeze(pitcherIds),
    pitcherRows: Object.freeze(pitcherRows),
    resolvedRowCount: sideRows.length,
    evidenceRowCount: evidenceRows.length,
    ignoredBaserunningRowCount: ignoredBaserunningRows,
    teamPlateAppearances,
    pitchingHitsAllowed,
  });
}

function teamEvidence({ gameId, side, game, statsRows, resolvedRows }) {
  const team = side === 'away' ? game.away_team : game.home_team;
  const opponent = side === 'away' ? game.home_team : game.away_team;
  const teamData = side === 'away' ? game.away_team_data : game.home_team_data;
  const teamId = assertPositiveInteger(team?.id, `game ${gameId} ${side} teamId`);
  const teamName = assertNonEmptyString(
    team?.display_name,
    `game ${gameId} ${side} team display_name`,
  );
  const opponentTeamId = assertPositiveInteger(
    opponent?.id,
    `game ${gameId} ${side} opponent teamId`,
  );
  const opponentTeamName = assertNonEmptyString(
    opponent?.display_name,
    `game ${gameId} ${side} opponent display_name`,
  );
  const reasons = [];
  const teamHits = teamData?.hits;
  const teamRuns = teamData?.runs;
  if (!isNonNegativeInteger(teamHits)) reasons.push('game-team-hits-unavailable');
  if (!isNonNegativeInteger(teamRuns)) reasons.push('game-team-runs-unavailable');
  const pitching = pitcherEvidenceForSide({ side, statsRows, resolvedRows });
  reasons.push(...pitching.reasons);
  const directComparator = optionalDirectBatterPaComparator({ statsRows, teamName });
  if (pitching.reasons.length === 0 && isNonNegativeInteger(teamHits)) {
    if (pitching.pitchingHitsAllowed !== teamHits) {
      reasons.push('pitcher-hits-vs-game-team-hits-mismatch');
    }
  }
  if (pitching.reasons.length === 0 && directComparator.available) {
    if (pitching.teamPlateAppearances !== directComparator.totalPlateAppearances) {
      reasons.push('pitcher-bf-vs-direct-batter-pa-mismatch');
    }
  }
  const uniqueReasons = [...new Set(reasons)].sort();
  const base = {
    side,
    opponentSide: side === 'away' ? 'home' : 'away',
    teamId,
    teamName,
    opponentTeamId,
    opponentTeamName,
    reasons: Object.freeze(uniqueReasons),
    pitcherIds: pitching.pitcherIds,
    pitcherRows: pitching.pitcherRows,
    resolvedRowCount: pitching.resolvedRowCount,
    evidenceRowCount: pitching.evidenceRowCount,
    ignoredBaserunningRowCount: pitching.ignoredBaserunningRowCount,
    directBatterPaComparator: directComparator,
  };
  if (uniqueReasons.length > 0) {
    return Object.freeze(base);
  }
  if (teamHits > pitching.teamPlateAppearances) {
    throw new Error(`game ${gameId} ${side} team hits exceed team plate appearances.`);
  }
  return Object.freeze({
    ...base,
    teamPlateAppearances: pitching.teamPlateAppearances,
    teamHits,
    teamRuns,
    pitchingHitsAllowed: pitching.pitchingHitsAllowed,
  });
}

function sourceIdentity(dataset) {
  return {
    datasetVersion: dataset.datasetVersion,
    provider: dataset.provider,
    activeSeason: dataset.activeSeason,
    sourceCaptureManifestSha256: dataset.sourceCaptureManifestSha256,
    sourceCapturePlanSha256: dataset.sourceCapturePlanSha256,
    sourceResolvedDatasetSha256: dataset.sourceResolvedDatasetSha256,
    sourceResolvedDatasetFileSha256: dataset.sourceResolvedDatasetFileSha256,
    includedPeriods: dataset.includedPeriods,
    untouchedTestReservation: dataset.untouchedTestReservation,
    exclusionPolicy: dataset.exclusionPolicy,
    totals: dataset.totals,
    exclusionReasonCounts: dataset.exclusionReasonCounts,
    periods: dataset.periods,
    excludedGames: dataset.excludedGames,
  };
}

export function buildM8TeamOffensiveEnvironmentDataset({
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
  const sourceCapturePlanSha256 = assertSha256(
    manifest.sourcePlanSha256,
    'capture plan SHA-256',
  );
  const sourceResolvedDatasetSha256 = assertSha256(
    manifest.sourceResolvedDatasetSha256,
    'resolved dataset SHA-256',
  );
  const resolvedFileSha256 = assertSha256(
    sourceResolvedDatasetFileSha256,
    'resolved dataset file SHA-256',
  );
  const resolved = validateResolvedDataset(resolvedDataset, manifest);
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
  const exclusionReasonCounts = {};
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
    totalIncludedRuns: 0,
    ignoredBaserunningRowCount: 0,
    optionalDirectPaComparatorSideCount: 0,
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
    if (capture === undefined) throw new Error(`capture missing for game ${gameId}.`);
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
    const game = assertObject(capture.gameSnapshot?.body?.data, `game ${gameId} snapshot`);
    if (game.id !== gameId) throw new Error(`game ${gameId} snapshot identity mismatch.`);
    const statsRows = gameStatsRows(capture, gameId);
    const resolvedRows = resolved.rowsByGame.get(gameId) ?? [];
    if (resolvedRows.length === 0) {
      throw new Error(`resolved categorical dataset has no rows for game ${gameId}.`);
    }
    if (resolvedRows.some((row) => row.periodId !== periodId || row.observedDate !== observedDate)) {
      throw new Error(`resolved rows disagree with capture chronology for game ${gameId}.`);
    }
    const evidence = SIDES.map((side) =>
      teamEvidence({ gameId, side, game, statsRows, resolvedRows }),
    );
    for (const team of evidence) {
      totals.ignoredBaserunningRowCount += team.ignoredBaserunningRowCount;
      if (team.directBatterPaComparator.available) {
        totals.optionalDirectPaComparatorSideCount += 1;
      }
    }
    const failureReasons = evidence.flatMap((team) =>
      team.reasons.map((reason) => `${team.side}:${reason}`),
    );
    if (failureReasons.length > 0) {
      totals.excludedGameCount += 1;
      totals.excludedTeamGameCount += 2;
      for (const reason of [...new Set(failureReasons)]) {
        exclusionReasonCounts[reason] = (exclusionReasonCounts[reason] ?? 0) + 1;
      }
      excludedGames.push(
        Object.freeze({
          gameId,
          observedDate,
          periodId,
          reasons: Object.freeze([...new Set(failureReasons)].sort()),
          teams: Object.freeze(evidence),
        }),
      );
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
        opponentTeamId: team.opponentTeamId,
        opponentTeamName: team.opponentTeamName,
        teamPlateAppearances: team.teamPlateAppearances,
        opponentPlateAppearances: opponent.teamPlateAppearances,
        gamePlateAppearances: team.teamPlateAppearances + opponent.teamPlateAppearances,
        teamHits: team.teamHits,
        teamRuns: team.teamRuns,
        pitcherIds: team.pitcherIds,
        pitcherCount: team.pitcherIds.length,
        resolvedRowCount: team.resolvedRowCount,
        paEvidenceRowCount: team.evidenceRowCount,
        ignoredBaserunningRowCount: team.ignoredBaserunningRowCount,
        directBatterPaComparator: team.directBatterPaComparator,
        sourceCaptureSha256: assertSha256(
          capture.captureSha256,
          `game ${gameId} capture SHA-256`,
        ),
        sourceStatsRawBodySha256s: summary.snapshots?.statsRawBodySha256s ?? [],
      });
      periodRows.get(periodId).push(row);
      totals.totalIncludedPlateAppearances += team.teamPlateAppearances;
      totals.totalIncludedHits += team.teamHits;
      totals.totalIncludedRuns += team.teamRuns;
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
  if (activeSeasons.size !== 1 || !activeSeasons.has(resolved.activeSeason)) {
    throw new Error('captures and resolved dataset do not share one active season.');
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
        if (seen.has(row.rowId)) throw new Error(`duplicate environment row ${row.rowId}.`);
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
    datasetVersion: 2,
    provider: 'BALLDONTLIE MLB API',
    activeSeason,
    sourceCaptureManifestSha256,
    sourceCapturePlanSha256,
    sourceResolvedDatasetSha256,
    sourceResolvedDatasetFileSha256: resolvedFileSha256,
    includedPeriods: INCLUDED_PERIODS,
    untouchedTestReservation,
    exclusionPolicy: Object.freeze({
      teamIdentitySource: 'games.home_team-and-games.away_team',
      battingSideSource: 'resolved-plate-appearances.halfInning',
      pitcherIdentitySource:
        'unique-resolved-providerPitcherId-excluding-mappingStatus-baserunning-only',
      teamPlateAppearanceSource: 'sum-stats.batters_faced-for-observed-opponent-pitchers',
      teamHitsSource: 'games.home_team_data.hits-and-games.away_team_data.hits',
      teamRunsSource: 'games.home_team_data.runs-and-games.away_team_data.runs',
      pitchingHitsCrossCheck: 'sum-stats.p_hits-must-equal-game-team-hits',
      directBatterPaCrossCheck:
        'optional-only-when-exact-team-name-cohort-has-complete-direct-stats.plate_appearances',
      statsTeamNameRole: 'optional-cross-check-only-never-team-identity-or-primary-join',
      lineupRequirement: 'none',
      componentArithmeticFallback: 'prohibited',
      incompleteOrContradictoryEvidence: 'exclude-entire-game',
      pairedTeamGameRequirement: 'both-sides-or-neither',
    }),
    totals: Object.freeze(totals),
    exclusionReasonCounts: Object.freeze(
      Object.fromEntries(
        Object.entries(exclusionReasonCounts).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    ),
    periods: Object.freeze(periods),
    excludedGames: Object.freeze(
      excludedGames.sort(
        (left, right) =>
          left.observedDate.localeCompare(right.observedDate) || left.gameId - right.gameId,
      ),
    ),
  };
  return Object.freeze({
    purpose:
      'Frozen current-season fit-validation team-game offensive-environment observations using game team identity and outcomes plus identity-based opponent pitcher batters-faced totals, while excluding baserunning-only rows from pitcher discovery and failing closed on incomplete or contradictory evidence.',
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
  if (dataset.datasetVersion !== 2 || dataset.provider !== 'BALLDONTLIE MLB API') {
    throw new Error('unsupported team offensive-environment dataset contract.');
  }
  assertPositiveInteger(dataset.activeSeason, 'activeSeason');
  assertSha256(dataset.sourceCaptureManifestSha256, 'sourceCaptureManifestSha256');
  assertSha256(dataset.sourceCapturePlanSha256, 'sourceCapturePlanSha256');
  assertSha256(dataset.sourceResolvedDatasetSha256, 'sourceResolvedDatasetSha256');
  assertSha256(dataset.sourceResolvedDatasetFileSha256, 'sourceResolvedDatasetFileSha256');
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
      assertNonNegativeInteger(row.teamRuns, `${row.rowId}.teamRuns`);
      if (row.teamHits > row.teamPlateAppearances) {
        throw new Error(`${row.rowId} teamHits exceed teamPlateAppearances.`);
      }
      assertPositiveInteger(row.opponentPlateAppearances, `${row.rowId}.opponentPlateAppearances`);
      if (
        row.gamePlateAppearances !== row.teamPlateAppearances + row.opponentPlateAppearances
      ) {
        throw new Error(`${row.rowId} game PA total is inconsistent.`);
      }
      const pitcherIds = assertArray(row.pitcherIds, `${row.rowId}.pitcherIds`);
      if (pitcherIds.length === 0 || pitcherIds.length !== new Set(pitcherIds).size) {
        throw new Error(`${row.rowId} pitcher identities are empty or duplicated.`);
      }
      assertNonNegativeInteger(
        row.ignoredBaserunningRowCount,
        `${row.rowId}.ignoredBaserunningRowCount`,
      );
    }
  }
  return dataset;
}
