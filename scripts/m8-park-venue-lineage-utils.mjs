import { createHash } from 'node:crypto';

const INCLUDED_PERIODS = Object.freeze(['fit', 'validation']);
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

function validateUntouchedReservation(rawValue, label) {
  const value = assertObject(rawValue, label);
  if (value.rowsIncluded !== false || Object.hasOwn(value, 'rows')) {
    throw new Error(`${label} must keep untouched-test rows excluded.`);
  }
  return Object.freeze({ ...value, rowsIncluded: false });
}

function validateIncludedPeriods(value, label) {
  const periods = assertArray(value, label).map((periodId, index) =>
    assertNonEmptyString(periodId, `${label}[${index}]`),
  );
  if (JSON.stringify(periods) !== JSON.stringify(INCLUDED_PERIODS)) {
    throw new Error(`${label} must equal fit then validation.`);
  }
  return INCLUDED_PERIODS;
}

function lineageIdentity(lineage) {
  return {
    lineageVersion: lineage.lineageVersion,
    provider: lineage.provider,
    activeSeason: lineage.activeSeason,
    sourceCaptureManifestSha256: lineage.sourceCaptureManifestSha256,
    sourceCapturePlanSha256: lineage.sourceCapturePlanSha256,
    sourceResolvedDatasetSha256: lineage.sourceResolvedDatasetSha256,
    includedPeriods: lineage.includedPeriods,
    untouchedTestReservation: lineage.untouchedTestReservation,
    totals: lineage.totals,
    venueCounts: lineage.venueCounts,
    periods: lineage.periods,
  };
}

function sortedVenueCounts(rows) {
  const counts = new Map();
  for (const row of rows) {
    counts.set(row.venue, (counts.get(row.venue) ?? 0) + 1);
  }
  return Object.freeze(
    Object.fromEntries(
      [...counts].sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function periodFromRows(rows) {
  const ordered = rows
    .slice()
    .sort(
      (left, right) =>
        left.observedDate.localeCompare(right.observedDate) ||
        left.providerGameId - right.providerGameId,
    );
  return Object.freeze({
    startDate: ordered[0]?.observedDate ?? null,
    endDate: ordered.at(-1)?.observedDate ?? null,
    rowCount: ordered.length,
    rows: Object.freeze(ordered),
  });
}

export function buildM8ParkVenueLineage({ captureManifest, captures }) {
  const manifest = assertObject(captureManifest, 'captureManifest');
  if (manifest.provider !== 'BALLDONTLIE MLB API') {
    throw new Error('capture manifest provider is not BALLDONTLIE MLB API.');
  }
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
  const includedPeriods = validateIncludedPeriods(
    manifest.includedPeriods,
    'capture manifest includedPeriods',
  );
  const untouchedTestReservation = validateUntouchedReservation(
    manifest.untouchedTestReservation,
    'capture manifest untouchedTestReservation',
  );
  const gameCount = assertPositiveInteger(manifest.gameCount, 'manifest gameCount');
  const manifestGames = assertArray(manifest.games, 'manifest.games');
  if (manifestGames.length !== gameCount) {
    throw new Error('manifest gameCount does not match manifest.games.');
  }

  const manifestGameById = new Map();
  for (const [index, rawGame] of manifestGames.entries()) {
    const game = assertObject(rawGame, `manifest.games[${index}]`);
    const gameId = assertPositiveInteger(game.gameId, `manifest.games[${index}].gameId`);
    if (manifestGameById.has(gameId)) {
      throw new Error(`duplicate manifest game ${gameId}.`);
    }
    const periodId = assertNonEmptyString(
      game.periodId,
      `manifest.games[${index}].periodId`,
    );
    if (!INCLUDED_PERIODS.includes(periodId)) {
      throw new Error(`manifest game ${gameId} has unsupported period ${periodId}.`);
    }
    manifestGameById.set(
      gameId,
      Object.freeze({
        gameId,
        observedDate: assertNonEmptyString(
          game.observedDate,
          `manifest.games[${index}].observedDate`,
        ),
        periodId,
      }),
    );
  }

  const capturedGames = assertArray(captures, 'captures');
  if (capturedGames.length !== gameCount) {
    throw new Error('capture count does not match manifest gameCount.');
  }
  const captureByGameId = new Map();
  for (const [index, rawCapture] of capturedGames.entries()) {
    const capture = assertObject(rawCapture, `captures[${index}]`);
    if (capture.provider !== 'BALLDONTLIE MLB API') {
      throw new Error(`capture ${index} provider is not BALLDONTLIE MLB API.`);
    }
    if (capture.sourcePlanSha256 !== sourceCapturePlanSha256) {
      throw new Error(`capture ${index} source plan SHA-256 mismatch.`);
    }
    validateUntouchedReservation(
      capture.untouchedTestReservation,
      `capture ${index} untouchedTestReservation`,
    );
    const gameId = assertPositiveInteger(
      capture.plannedGame?.gameId,
      `captures[${index}].plannedGame.gameId`,
    );
    if (!manifestGameById.has(gameId)) {
      throw new Error(`capture game ${gameId} is absent from the manifest.`);
    }
    if (captureByGameId.has(gameId)) {
      throw new Error(`duplicate capture game ${gameId}.`);
    }
    captureByGameId.set(gameId, capture);
  }

  const rowsByPeriod = new Map(INCLUDED_PERIODS.map((periodId) => [periodId, []]));
  const activeSeasons = new Set();
  const orderedManifestGames = [...manifestGameById.values()].sort(
    (left, right) =>
      left.observedDate.localeCompare(right.observedDate) ||
      left.gameId - right.gameId,
  );

  for (const manifestGame of orderedManifestGames) {
    const capture = captureByGameId.get(manifestGame.gameId);
    if (capture === undefined) {
      throw new Error(`capture missing for game ${manifestGame.gameId}.`);
    }
    const plannedGame = assertObject(
      capture.plannedGame,
      `game ${manifestGame.gameId} plannedGame`,
    );
    if (
      plannedGame.observedDate !== manifestGame.observedDate ||
      plannedGame.periodId !== manifestGame.periodId
    ) {
      throw new Error(`capture chronology mismatch for game ${manifestGame.gameId}.`);
    }
    const summary = assertObject(capture.summary, `game ${manifestGame.gameId} summary`);
    if (summary.status !== 'STATUS_FINAL' || summary.seasonType !== 'regular') {
      throw new Error(`game ${manifestGame.gameId} is not a final regular-season game.`);
    }
    const season = assertPositiveInteger(summary.season, `game ${manifestGame.gameId} season`);
    activeSeasons.add(season);
    const game = assertObject(
      capture.gameSnapshot?.body?.data,
      `game ${manifestGame.gameId} snapshot`,
    );
    if (
      game.id !== manifestGame.gameId ||
      game.status !== summary.status ||
      game.season !== season ||
      game.season_type !== summary.seasonType
    ) {
      throw new Error(`game ${manifestGame.gameId} snapshot identity or status mismatch.`);
    }
    const venue = assertNonEmptyString(game.venue, `game ${manifestGame.gameId} venue`);
    const sourceCaptureSha256 = assertSha256(
      capture.captureSha256,
      `game ${manifestGame.gameId} capture SHA-256`,
    );
    rowsByPeriod.get(manifestGame.periodId).push(
      Object.freeze({
        rowId: `${manifestGame.periodId}:${manifestGame.observedDate}:${manifestGame.gameId}`,
        observedDate: manifestGame.observedDate,
        periodId: manifestGame.periodId,
        providerGameId: manifestGame.gameId,
        venue,
        sourceCaptureSha256,
      }),
    );
  }

  if (activeSeasons.size !== 1) {
    throw new Error('venue lineage must contain exactly one active season.');
  }
  const [activeSeason] = activeSeasons;
  const periods = Object.freeze(
    Object.fromEntries(
      INCLUDED_PERIODS.map((periodId) => [
        periodId,
        periodFromRows(rowsByPeriod.get(periodId)),
      ]),
    ),
  );
  if (periods.fit.rowCount === 0 || periods.validation.rowCount === 0) {
    throw new Error('fit and validation venue periods must both contain rows.');
  }
  if (periods.fit.endDate >= periods.validation.startDate) {
    throw new Error('venue fit and validation windows must not overlap.');
  }
  const rows = [...periods.fit.rows, ...periods.validation.rows];
  const venueCounts = sortedVenueCounts(rows);
  const totals = Object.freeze({
    gameCount: rows.length,
    fitGameCount: periods.fit.rowCount,
    validationGameCount: periods.validation.rowCount,
    uniqueVenueCount: Object.keys(venueCounts).length,
  });
  if (totals.gameCount !== gameCount) {
    throw new Error('venue lineage game conservation failed.');
  }

  const identity = {
    lineageVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    activeSeason,
    sourceCaptureManifestSha256,
    sourceCapturePlanSha256,
    sourceResolvedDatasetSha256,
    includedPeriods,
    untouchedTestReservation,
    totals,
    venueCounts,
    periods,
  };
  return Object.freeze({
    purpose:
      'Versioned current-season fit-validation BALLDONTLIE game-to-venue lineage for later handedness- and terminal-outcome-specific park research; no park coefficient is fitted or applied.',
    ...identity,
    lineageSha256: sha256(JSON.stringify(identity)),
  });
}

export function verifyM8ParkVenueLineage(rawLineage) {
  const lineage = assertObject(rawLineage, 'park venue lineage');
  if (lineage.lineageVersion !== 1 || lineage.provider !== 'BALLDONTLIE MLB API') {
    throw new Error('unsupported park venue lineage contract.');
  }
  assertPositiveInteger(lineage.activeSeason, 'activeSeason');
  assertSha256(lineage.sourceCaptureManifestSha256, 'sourceCaptureManifestSha256');
  assertSha256(lineage.sourceCapturePlanSha256, 'sourceCapturePlanSha256');
  assertSha256(lineage.sourceResolvedDatasetSha256, 'sourceResolvedDatasetSha256');
  validateIncludedPeriods(lineage.includedPeriods, 'includedPeriods');
  validateUntouchedReservation(
    lineage.untouchedTestReservation,
    'park venue lineage untouchedTestReservation',
  );

  const totals = assertObject(lineage.totals, 'totals');
  const expectedGameCount = assertPositiveInteger(totals.gameCount, 'totals.gameCount');
  const expectedFitCount = assertPositiveInteger(
    totals.fitGameCount,
    'totals.fitGameCount',
  );
  const expectedValidationCount = assertPositiveInteger(
    totals.validationGameCount,
    'totals.validationGameCount',
  );
  const expectedUniqueVenueCount = assertPositiveInteger(
    totals.uniqueVenueCount,
    'totals.uniqueVenueCount',
  );

  const allRows = [];
  const seenGameIds = new Set();
  for (const periodId of INCLUDED_PERIODS) {
    const period = assertObject(lineage.periods?.[periodId], `periods.${periodId}`);
    const rows = assertArray(period.rows, `periods.${periodId}.rows`);
    if (assertNonNegativeInteger(period.rowCount, `${periodId}.rowCount`) !== rows.length) {
      throw new Error(`${periodId} rowCount does not match rows.`);
    }
    if (rows.length === 0) {
      throw new Error(`${periodId} venue period must contain rows.`);
    }
    for (const [index, row] of rows.entries()) {
      const label = `${periodId}.rows[${index}]`;
      const gameId = assertPositiveInteger(row.providerGameId, `${label}.providerGameId`);
      const observedDate = assertNonEmptyString(row.observedDate, `${label}.observedDate`);
      if (
        row.periodId !== periodId ||
        row.rowId !== `${periodId}:${observedDate}:${gameId}`
      ) {
        throw new Error(`${label} identity drifted.`);
      }
      if (seenGameIds.has(gameId)) {
        throw new Error(`duplicate venue lineage game ${gameId}.`);
      }
      seenGameIds.add(gameId);
      assertNonEmptyString(row.venue, `${label}.venue`);
      assertSha256(row.sourceCaptureSha256, `${label}.sourceCaptureSha256`);
      allRows.push(row);
    }
    if (period.startDate !== rows[0].observedDate || period.endDate !== rows.at(-1).observedDate) {
      throw new Error(`${periodId} date bounds do not match rows.`);
    }
  }
  if (lineage.periods.fit.endDate >= lineage.periods.validation.startDate) {
    throw new Error('venue fit and validation windows must not overlap.');
  }
  if (
    allRows.length !== expectedGameCount ||
    lineage.periods.fit.rowCount !== expectedFitCount ||
    lineage.periods.validation.rowCount !== expectedValidationCount
  ) {
    throw new Error('venue lineage totals do not match period rows.');
  }
  const expectedVenueCounts = sortedVenueCounts(allRows);
  if (JSON.stringify(lineage.venueCounts) !== JSON.stringify(expectedVenueCounts)) {
    throw new Error('venue counts do not match lineage rows.');
  }
  if (Object.keys(expectedVenueCounts).length !== expectedUniqueVenueCount) {
    throw new Error('unique venue count does not match venueCounts.');
  }
  const expectedSha256 = sha256(JSON.stringify(lineageIdentity(lineage)));
  if (assertSha256(lineage.lineageSha256, 'lineageSha256') !== expectedSha256) {
    throw new Error('park venue lineage SHA-256 is invalid.');
  }
  return lineage;
}
