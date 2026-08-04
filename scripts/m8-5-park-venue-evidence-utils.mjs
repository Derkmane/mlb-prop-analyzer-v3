import { createHash } from 'node:crypto';

export const M8_5_PARK_VENUE_AUDIT_VERSION = 1;
export const M8_5_PARK_ACTIVE_SEASON = 2026;

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

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function sha256Text(value, label) {
  const text = nonEmptyString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(text)) {
    throw new Error(`${label} must be a lowercase SHA-256 value.`);
  }
  return text;
}

function verifyUntouchedReservation(value, label) {
  const reservation = assertObject(value, label);
  if (reservation.rowsIncluded !== false || Object.hasOwn(reservation, 'rows')) {
    throw new Error(`${label} must keep untouched-test rows excluded.`);
  }
  return reservation;
}

function venueIssue(rawVenue) {
  if (typeof rawVenue !== 'string' || rawVenue.length === 0) {
    return 'venue-missing';
  }
  if (rawVenue.trim() !== rawVenue) {
    return 'venue-not-canonical-provider-text';
  }
  if (rawVenue.trim().length === 0) {
    return 'venue-empty';
  }
  return null;
}

function auditIdentity(value) {
  return {
    auditVersion: value.auditVersion,
    provider: value.provider,
    activeSeason: value.activeSeason,
    sourceEvidenceVersion: value.sourceEvidenceVersion,
    sourcePlanSha256: value.sourcePlanSha256,
    sourceCaptureManifestSha256: value.sourceCaptureManifestSha256,
    includedPeriods: value.includedPeriods,
    decision: value.decision,
    decisionReasons: value.decisionReasons,
    totals: value.totals,
    venueCounts: value.venueCounts,
    homeTeamVenueCoverage: value.homeTeamVenueCoverage,
    games: value.games,
    excludedGames: value.excludedGames,
    normalizationPolicy: value.normalizationPolicy,
    safety: value.safety,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

export function buildM8_5ParkVenueEvidenceAudit({
  captureManifest,
  captures,
}) {
  const manifest = assertObject(captureManifest, 'captureManifest');
  const captureRows = assertArray(captures, 'captures');

  if (manifest.manifestVersion !== 1) {
    throw new Error('captureManifest.manifestVersion must equal 1.');
  }
  if (manifest.provider !== 'BALLDONTLIE MLB API') {
    throw new Error('captureManifest provider must be BALLDONTLIE MLB API.');
  }
  verifyUntouchedReservation(
    manifest.untouchedTestReservation,
    'captureManifest.untouchedTestReservation',
  );
  const sourcePlanSha256 = sha256Text(
    manifest.sourcePlanSha256,
    'captureManifest.sourcePlanSha256',
  );
  const sourceCaptureManifestSha256 = sha256Text(
    manifest.manifestSha256,
    'captureManifest.manifestSha256',
  );
  if (!Number.isSafeInteger(manifest.gameCount) || manifest.gameCount < 0) {
    throw new TypeError('captureManifest.gameCount must be a non-negative integer.');
  }
  if (captureRows.length !== manifest.gameCount) {
    throw new Error('capture count must equal captureManifest.gameCount.');
  }

  const manifestGames = assertArray(
    manifest.games,
    'captureManifest.games',
  );
  if (manifestGames.length !== manifest.gameCount) {
    throw new Error('captureManifest.games length must equal gameCount.');
  }
  const manifestByGameId = new Map();
  for (const entry of manifestGames) {
    const row = assertObject(entry, 'captureManifest game');
    const gameId = positiveInteger(row.gameId, 'captureManifest gameId');
    if (manifestByGameId.has(gameId)) {
      throw new Error(`duplicate captureManifest game ${gameId}.`);
    }
    manifestByGameId.set(gameId, row);
  }

  const seenCaptureIds = new Set();
  const games = [];
  const excludedGames = [];
  const venueCountMap = new Map();
  const homeTeamVenueMap = new Map();

  for (const rawCapture of captureRows) {
    const capture = assertObject(rawCapture, 'capture');
    verifyUntouchedReservation(
      capture.untouchedTestReservation,
      'capture.untouchedTestReservation',
    );
    if (capture.sourcePlanSha256 !== sourcePlanSha256) {
      throw new Error('capture source plan does not match the manifest.');
    }
    const plannedGame = assertObject(capture.plannedGame, 'capture.plannedGame');
    const gameId = positiveInteger(plannedGame.gameId, 'capture planned gameId');
    if (seenCaptureIds.has(gameId)) {
      throw new Error(`duplicate capture game ${gameId}.`);
    }
    seenCaptureIds.add(gameId);

    const manifestGame = manifestByGameId.get(gameId);
    if (!manifestGame) {
      throw new Error(`capture game ${gameId} is not in the manifest.`);
    }
    if (
      manifestGame.observedDate !== plannedGame.observedDate ||
      manifestGame.periodId !== plannedGame.periodId
    ) {
      throw new Error(`capture game ${gameId} chronology differs from the manifest.`);
    }

    const gameSnapshot = assertObject(capture.gameSnapshot, 'capture.gameSnapshot');
    const gameSnapshotBody = assertObject(
      gameSnapshot.body,
      'capture.gameSnapshot.body',
    );
    const game = assertObject(
      gameSnapshotBody.data,
      'capture.gameSnapshot.body.data',
    );
    if (game.id !== gameId) {
      throw new Error(`capture game response identity mismatch for ${gameId}.`);
    }
    if (game.season !== M8_5_PARK_ACTIVE_SEASON) {
      throw new Error(`capture game ${gameId} is outside the active season.`);
    }
    if (game.season_type !== 'regular' || game.postseason === true) {
      throw new Error(`capture game ${gameId} is not an active-season regular-season game.`);
    }
    if (game.status !== 'STATUS_FINAL') {
      throw new Error(`capture game ${gameId} is not final.`);
    }

    const homeTeam = assertObject(game.home_team, `game ${gameId} home_team`);
    const awayTeam = assertObject(game.away_team, `game ${gameId} away_team`);
    const homeTeamId = positiveInteger(homeTeam.id, `game ${gameId} home team id`);
    const awayTeamId = positiveInteger(awayTeam.id, `game ${gameId} away team id`);
    const issue = venueIssue(game.venue);
    const baseGame = {
      gameId,
      observedDate: nonEmptyString(plannedGame.observedDate, `game ${gameId} observedDate`),
      periodId: nonEmptyString(plannedGame.periodId, `game ${gameId} periodId`),
      homeTeamId,
      awayTeamId,
      rawVenue: typeof game.venue === 'string' ? game.venue : null,
      gameSnapshotRawBodySha256: sha256Text(
        gameSnapshot.rawBodySha256,
        `game ${gameId} snapshot SHA-256`,
      ),
      captureSha256: sha256Text(
        capture.captureSha256,
        `game ${gameId} capture SHA-256`,
      ),
    };

    if (issue !== null) {
      excludedGames.push({
        ...baseGame,
        reason: issue,
      });
      continue;
    }

    const venue = game.venue;
    games.push({
      ...baseGame,
      venue,
    });
    venueCountMap.set(venue, (venueCountMap.get(venue) ?? 0) + 1);
    if (!homeTeamVenueMap.has(homeTeamId)) {
      homeTeamVenueMap.set(homeTeamId, new Map());
    }
    const teamVenues = homeTeamVenueMap.get(homeTeamId);
    teamVenues.set(venue, (teamVenues.get(venue) ?? 0) + 1);
  }

  games.sort(
    (left, right) =>
      left.observedDate.localeCompare(right.observedDate) ||
      left.gameId - right.gameId,
  );
  excludedGames.sort(
    (left, right) =>
      left.observedDate.localeCompare(right.observedDate) ||
      left.gameId - right.gameId,
  );
  const venueCounts = [...venueCountMap.entries()]
    .map(([venue, gameCount]) => ({ venue, gameCount }))
    .sort((left, right) => left.venue.localeCompare(right.venue));
  const homeTeamVenueCoverage = [...homeTeamVenueMap.entries()]
    .map(([homeTeamId, venues]) => ({
      homeTeamId,
      venues: [...venues.entries()]
        .map(([venue, gameCount]) => ({ venue, gameCount }))
        .sort((left, right) => left.venue.localeCompare(right.venue)),
    }))
    .sort((left, right) => left.homeTeamId - right.homeTeamId);

  const decisionReasons = [];
  if (excludedGames.length > 0) {
    decisionReasons.push('one-or-more-games-lack-exact-provider-venue-identity');
  }
  if (venueCounts.length < 2) {
    decisionReasons.push('fewer-than-two-distinct-venues-observed');
  }
  if (games.length === 0) {
    decisionReasons.push('no-eligible-games');
  }
  const decision =
    decisionReasons.length === 0
      ? 'VENUE_IDENTITY_AVAILABLE'
      : 'INSUFFICIENT_VENUE_IDENTITY';

  const identity = {
    auditVersion: M8_5_PARK_VENUE_AUDIT_VERSION,
    provider: 'BALLDONTLIE MLB API',
    activeSeason: M8_5_PARK_ACTIVE_SEASON,
    sourceEvidenceVersion: 'm8-stats-lineups-v1',
    sourcePlanSha256,
    sourceCaptureManifestSha256,
    includedPeriods: [...new Set(manifestGames.map((game) => game.periodId))].sort(),
    decision,
    decisionReasons,
    totals: {
      capturedGameCount: captureRows.length,
      eligibleVenueGameCount: games.length,
      excludedVenueGameCount: excludedGames.length,
      uniqueVenueCount: venueCounts.length,
      homeTeamCount: homeTeamVenueCoverage.length,
      multiVenueHomeTeamCount: homeTeamVenueCoverage.filter(
        (team) => team.venues.length > 1,
      ).length,
    },
    venueCounts,
    homeTeamVenueCoverage,
    games,
    excludedGames,
    normalizationPolicy: {
      providerVenueTextPreservedExactly: true,
      whitespaceRepairAllowed: false,
      homeTeamVenueInferenceAllowed: false,
      venueAliasMergingAllowed: false,
    },
    safety: {
      parkCoefficientsFitted: false,
      productionEnabled: false,
      rankingEnabled: false,
      selectedSideInputUsed: false,
      directProbabilityAdjustmentUsed: false,
      untouchedTestRowsAccessed: false,
    },
    untouchedTestReservation: { rowsIncluded: false },
  };

  return Object.freeze({
    ...identity,
    auditSha256: sha256(JSON.stringify(identity)),
  });
}

export function verifyM8_5ParkVenueEvidenceAudit(value) {
  const audit = assertObject(value, 'park venue audit');
  if (audit.auditVersion !== M8_5_PARK_VENUE_AUDIT_VERSION) {
    throw new Error('park venue audit version is unsupported.');
  }
  if (audit.provider !== 'BALLDONTLIE MLB API') {
    throw new Error('park venue audit provider is unsupported.');
  }
  if (audit.activeSeason !== M8_5_PARK_ACTIVE_SEASON) {
    throw new Error('park venue audit active season is invalid.');
  }
  verifyUntouchedReservation(
    audit.untouchedTestReservation,
    'park venue audit untouchedTestReservation',
  );
  if (
    audit.safety?.parkCoefficientsFitted !== false ||
    audit.safety?.productionEnabled !== false ||
    audit.safety?.rankingEnabled !== false ||
    audit.safety?.selectedSideInputUsed !== false ||
    audit.safety?.directProbabilityAdjustmentUsed !== false ||
    audit.safety?.untouchedTestRowsAccessed !== false
  ) {
    throw new Error('park venue audit safety boundary is invalid.');
  }
  if (
    audit.normalizationPolicy?.providerVenueTextPreservedExactly !== true ||
    audit.normalizationPolicy?.whitespaceRepairAllowed !== false ||
    audit.normalizationPolicy?.homeTeamVenueInferenceAllowed !== false ||
    audit.normalizationPolicy?.venueAliasMergingAllowed !== false
  ) {
    throw new Error('park venue audit normalization policy is invalid.');
  }
  const expectedSha256 = sha256(JSON.stringify(auditIdentity(audit)));
  if (audit.auditSha256 !== expectedSha256) {
    throw new Error('park venue audit SHA-256 is invalid.');
  }
  const reasons = assertArray(audit.decisionReasons, 'park venue audit decisionReasons');
  if (
    (audit.decision === 'VENUE_IDENTITY_AVAILABLE') !==
    (reasons.length === 0)
  ) {
    throw new Error('park venue audit decision and reasons disagree.');
  }
  if (
    audit.decision !== 'VENUE_IDENTITY_AVAILABLE' &&
    audit.decision !== 'INSUFFICIENT_VENUE_IDENTITY'
  ) {
    throw new Error('park venue audit decision is unsupported.');
  }
  return audit;
}
