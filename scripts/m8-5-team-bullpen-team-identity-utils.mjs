import { createHash } from 'node:crypto';

const PERIODS = Object.freeze(['fit', 'validation']);
const SIDES = Object.freeze(['away', 'home']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function string(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sourceSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 value.`);
  }
  return value;
}

function side(value, label) {
  const result = string(value, label);
  if (!SIDES.includes(result)) throw new Error(`${label} must be away or home.`);
  return result;
}

function keyFor({ periodId, observedDate, gameId, battingSide }) {
  return `${periodId}:${observedDate}:${gameId}:${battingSide}`;
}

function registerIdentity(map, rawIdentity, source) {
  const periodId = string(rawIdentity.periodId, `${source}.periodId`);
  if (!PERIODS.includes(periodId)) {
    throw new Error(`${source}.periodId is unsupported.`);
  }
  const observedDate = string(rawIdentity.observedDate, `${source}.observedDate`);
  const gameId = positiveInteger(rawIdentity.gameId, `${source}.gameId`);
  const battingSide = side(rawIdentity.side, `${source}.side`);
  const teamId = positiveInteger(rawIdentity.teamId, `${source}.teamId`);
  const opponentTeamId = positiveInteger(
    rawIdentity.opponentTeamId,
    `${source}.opponentTeamId`,
  );
  if (teamId === opponentTeamId) {
    throw new Error(`${source} team and opponent identities must differ.`);
  }
  const key = keyFor({ periodId, observedDate, gameId, battingSide });
  if (map.has(key)) throw new Error(`duplicate team identity ${key}.`);
  map.set(
    key,
    Object.freeze({
      rowId: `${key}:${teamId}`,
      periodId,
      observedDate,
      gameId,
      side: battingSide,
      teamId,
      opponentTeamId,
      identitySource: source.startsWith('excludedGames[')
        ? 'excluded-game-team-identity-only'
        : 'included-team-environment-row',
    }),
  );
}

function assertExcludedGamePair(rawGame, index) {
  const game = object(rawGame, `excludedGames[${index}]`);
  const periodId = string(game.periodId, `excludedGames[${index}].periodId`);
  if (!PERIODS.includes(periodId)) {
    throw new Error(`excludedGames[${index}].periodId is unsupported.`);
  }
  const observedDate = string(
    game.observedDate,
    `excludedGames[${index}].observedDate`,
  );
  const gameId = positiveInteger(game.gameId, `excludedGames[${index}].gameId`);
  const reasons = array(game.reasons, `excludedGames[${index}].reasons`);
  if (reasons.length === 0) {
    throw new Error(`excludedGames[${index}] must preserve its exclusion reason.`);
  }
  const teams = array(game.teams, `excludedGames[${index}].teams`);
  if (teams.length !== 2) {
    throw new Error(`excludedGames[${index}] must preserve exactly two team identities.`);
  }
  const bySide = new Map();
  for (const [teamIndex, rawTeam] of teams.entries()) {
    const team = object(rawTeam, `excludedGames[${index}].teams[${teamIndex}]`);
    const battingSide = side(
      team.side,
      `excludedGames[${index}].teams[${teamIndex}].side`,
    );
    if (bySide.has(battingSide)) {
      throw new Error(`excludedGames[${index}] duplicates ${battingSide} identity.`);
    }
    bySide.set(battingSide, {
      periodId,
      observedDate,
      gameId,
      side: battingSide,
      teamId: positiveInteger(
        team.teamId,
        `excludedGames[${index}].teams[${teamIndex}].teamId`,
      ),
      opponentTeamId: positiveInteger(
        team.opponentTeamId,
        `excludedGames[${index}].teams[${teamIndex}].opponentTeamId`,
      ),
    });
  }
  const away = bySide.get('away');
  const home = bySide.get('home');
  if (
    away === undefined ||
    home === undefined ||
    away.teamId !== home.opponentTeamId ||
    home.teamId !== away.opponentTeamId
  ) {
    throw new Error(`excludedGames[${index}] team identities are not reciprocal.`);
  }
  return Object.freeze({ away: Object.freeze(away), home: Object.freeze(home) });
}

function projectionIdentity(value) {
  return {
    projectionVersion: value.projectionVersion,
    sourceTeamEnvironmentDatasetSha256:
      value.sourceTeamEnvironmentDatasetSha256,
    policy: value.policy,
    counts: value.counts,
    periods: value.periods,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

export function buildM8_5TeamBullpenTeamIdentityProjection(rawDataset) {
  const dataset = object(rawDataset, 'team offensive-environment dataset');
  if (
    dataset.datasetVersion !== 2 ||
    dataset.provider !== 'BALLDONTLIE MLB API' ||
    dataset.activeSeason !== 2026
  ) {
    throw new Error('unsupported team offensive-environment identity source.');
  }
  const sourceTeamEnvironmentDatasetSha256 = sourceSha256(
    dataset.datasetSha256,
    'team offensive-environment dataset SHA-256',
  );
  const reservation = object(
    dataset.untouchedTestReservation,
    'team offensive-environment untouched reservation',
  );
  if (reservation.rowsIncluded !== false || Object.hasOwn(reservation, 'rows')) {
    throw new Error('team identity projection must keep untouched rows sealed.');
  }

  const identities = new Map();
  let includedIdentityRowCount = 0;
  for (const periodId of PERIODS) {
    const rows = array(dataset.periods?.[periodId]?.rows, `${periodId} rows`);
    for (const [index, row] of rows.entries()) {
      registerIdentity(
        identities,
        { ...object(row, `${periodId}.rows[${index}]`), periodId },
        `${periodId}.rows[${index}]`,
      );
      includedIdentityRowCount += 1;
    }
  }

  let excludedGameIdentityRowCount = 0;
  for (const [index, rawGame] of array(
    dataset.excludedGames ?? [],
    'excludedGames',
  ).entries()) {
    const pair = assertExcludedGamePair(rawGame, index);
    registerIdentity(identities, pair.away, `excludedGames[${index}].teams[away]`);
    registerIdentity(identities, pair.home, `excludedGames[${index}].teams[home]`);
    excludedGameIdentityRowCount += 2;
  }

  const projectedPeriods = Object.freeze(
    Object.fromEntries(
      PERIODS.map((periodId) => {
        const rows = [...identities.values()]
          .filter((row) => row.periodId === periodId)
          .sort(
            (left, right) =>
              left.observedDate.localeCompare(right.observedDate) ||
              left.gameId - right.gameId ||
              left.side.localeCompare(right.side),
          );
        if (rows.length === 0) {
          throw new Error(`${periodId} team identity projection is empty.`);
        }
        return [
          periodId,
          Object.freeze({
            startDate: rows[0].observedDate,
            endDate: rows.at(-1).observedDate,
            rowCount: rows.length,
            rows: Object.freeze(rows),
          }),
        ];
      }),
    ),
  );

  const withoutHash = Object.freeze({
    projectionVersion: 1,
    sourceTeamEnvironmentDatasetSha256,
    policy: Object.freeze({
      includedEnvironmentRows:
        'use verified teamId and opponentTeamId only',
      excludedEnvironmentGames:
        'use preserved game-snapshot teamId and opponentTeamId only; rejected offensive statistics remain excluded',
      missingIdentity: 'fail-closed',
      duplicateOrContradictoryIdentity: 'fail-closed',
    }),
    counts: Object.freeze({
      includedIdentityRowCount,
      excludedGameIdentityRowCount,
      totalIdentityRowCount: identities.size,
    }),
    periods: projectedPeriods,
    untouchedTestReservation: Object.freeze({ rowsIncluded: false }),
  });
  const evidence = Object.freeze({
    ...withoutHash,
    projectionSha256: sha256(JSON.stringify(projectionIdentity(withoutHash))),
  });
  const projectedDataset = Object.freeze({
    ...dataset,
    periods: projectedPeriods,
  });
  return Object.freeze({ dataset: projectedDataset, evidence });
}
