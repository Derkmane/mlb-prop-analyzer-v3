import { createHash } from 'node:crypto';

import { verifyM8TeamOffensiveEnvironmentDataset } from './m8-team-offensive-environment-dataset-utils.mjs';

const PERIOD_IDS = Object.freeze(['fit', 'validation']);
const SIDES = Object.freeze(['away', 'home']);
const FEATURE_NAMES = Object.freeze([
  'awayOffensePaPerGame',
  'awayOffenseHitRate',
  'homeOffensePaPerGame',
  'homeOffenseHitRate',
  'awayOpponentPaAllowedPerGame',
  'awayOpponentHitRateAllowed',
  'homeOpponentPaAllowedPerGame',
  'homeOpponentHitRateAllowed',
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

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

function nonEmptyString(value, label) {
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

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function finiteNumber(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
  return value;
}

function sha256String(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 value.`);
  }
  return value;
}

function validateUntouched(value, label) {
  const reservation = object(value, label);
  if (reservation.rowsIncluded !== false || Object.hasOwn(reservation, 'rows')) {
    throw new Error(`${label} must keep untouched-test rows excluded.`);
  }
  return Object.freeze({ ...reservation, rowsIncluded: false });
}

function pairSourceGames(dataset) {
  const byGameId = new Map();
  const rowIds = new Set();
  for (const periodId of PERIOD_IDS) {
    const period = object(dataset.periods?.[periodId], `source periods.${periodId}`);
    const rows = array(period.rows, `source periods.${periodId}.rows`);
    if (period.rowCount !== rows.length) {
      throw new Error(`source ${periodId}.rowCount does not match rows.`);
    }
    for (const rawRow of rows) {
      const row = object(rawRow, `source ${periodId} row`);
      const rowId = nonEmptyString(row.rowId, 'source rowId');
      if (rowIds.has(rowId)) throw new Error(`duplicate source row ${rowId}.`);
      rowIds.add(rowId);
      if (row.periodId !== periodId || !SIDES.includes(row.side)) {
        throw new Error(`${rowId} period or side is invalid.`);
      }
      const gameId = positiveInteger(row.gameId, `${rowId}.gameId`);
      const pair = byGameId.get(gameId) ?? {};
      if (pair[row.side] !== undefined) {
        throw new Error(`game ${gameId} has duplicate ${row.side} source row.`);
      }
      pair[row.side] = row;
      byGameId.set(gameId, pair);
    }
  }

  const games = [];
  for (const [gameId, pair] of byGameId) {
    if (pair.away === undefined || pair.home === undefined) {
      throw new Error(`game ${gameId} must contain both source team sides.`);
    }
    const away = pair.away;
    const home = pair.home;
    if (
      away.observedDate !== home.observedDate ||
      away.periodId !== home.periodId ||
      away.teamId !== home.opponentTeamId ||
      home.teamId !== away.opponentTeamId
    ) {
      throw new Error(`game ${gameId} source sides are not reciprocal.`);
    }
    const awayPa = positiveInteger(away.teamPlateAppearances, `game ${gameId} away PA`);
    const homePa = positiveInteger(home.teamPlateAppearances, `game ${gameId} home PA`);
    const awayHits = nonNegativeInteger(away.teamHits, `game ${gameId} away hits`);
    const homeHits = nonNegativeInteger(home.teamHits, `game ${gameId} home hits`);
    if (awayHits > awayPa || homeHits > homePa) {
      throw new Error(`game ${gameId} hits exceed plate appearances.`);
    }
    games.push(
      Object.freeze({
        gameId,
        observedDate: nonEmptyString(away.observedDate, `game ${gameId} observedDate`),
        periodId: away.periodId,
        awayTeamId: positiveInteger(away.teamId, `game ${gameId} away teamId`),
        homeTeamId: positiveInteger(home.teamId, `game ${gameId} home teamId`),
        awayPa,
        homePa,
        awayHits,
        homeHits,
      }),
    );
  }
  games.sort(
    (left, right) =>
      left.observedDate.localeCompare(right.observedDate) || left.gameId - right.gameId,
  );
  return Object.freeze(games);
}

function emptyHistory() {
  return {
    offenseGames: 0,
    offensePa: 0,
    offenseHits: 0,
    defenseGames: 0,
    paAllowed: 0,
    hitsAllowed: 0,
  };
}

function historyFor(histories, teamId) {
  return histories.get(teamId) ?? emptyHistory();
}

function featureRow(game, histories) {
  const away = historyFor(histories, game.awayTeamId);
  const home = historyFor(histories, game.homeTeamId);
  const missing = [];
  if (away.offenseGames === 0) missing.push('away-offense-no-prior-current-season-game');
  if (home.offenseGames === 0) missing.push('home-offense-no-prior-current-season-game');
  if (home.defenseGames === 0) missing.push('away-opponent-defense-no-prior-current-season-game');
  if (away.defenseGames === 0) missing.push('home-opponent-defense-no-prior-current-season-game');
  if (missing.length > 0) {
    return Object.freeze({
      status: 'excluded',
      gameId: game.gameId,
      observedDate: game.observedDate,
      periodId: game.periodId,
      awayTeamId: game.awayTeamId,
      homeTeamId: game.homeTeamId,
      reasons: Object.freeze(missing),
    });
  }

  const features = Object.freeze({
    awayOffensePaPerGame: away.offensePa / away.offenseGames,
    awayOffenseHitRate: away.offenseHits / away.offensePa,
    homeOffensePaPerGame: home.offensePa / home.offenseGames,
    homeOffenseHitRate: home.offenseHits / home.offensePa,
    awayOpponentPaAllowedPerGame: home.paAllowed / home.defenseGames,
    awayOpponentHitRateAllowed: home.hitsAllowed / home.paAllowed,
    homeOpponentPaAllowedPerGame: away.paAllowed / away.defenseGames,
    homeOpponentHitRateAllowed: away.hitsAllowed / away.paAllowed,
  });
  for (const featureName of FEATURE_NAMES) {
    finiteNumber(features[featureName], `${game.gameId}.features.${featureName}`);
  }
  return Object.freeze({
    status: 'included',
    rowId: `${game.periodId}:${game.observedDate}:${game.gameId}`,
    gameId: game.gameId,
    observedDate: game.observedDate,
    periodId: game.periodId,
    awayTeamId: game.awayTeamId,
    homeTeamId: game.homeTeamId,
    priorEvidence: Object.freeze({
      awayOffenseGames: away.offenseGames,
      homeOffenseGames: home.offenseGames,
      awayOpponentDefenseGames: home.defenseGames,
      homeOpponentDefenseGames: away.defenseGames,
    }),
    features,
    target: Object.freeze({
      awayPlateAppearances: game.awayPa,
      homePlateAppearances: game.homePa,
      awayHits: game.awayHits,
      homeHits: game.homeHits,
    }),
  });
}

function applyDateOutcomes(dateGames, histories) {
  for (const game of dateGames) {
    const away = { ...historyFor(histories, game.awayTeamId) };
    const home = { ...historyFor(histories, game.homeTeamId) };

    away.offenseGames += 1;
    away.offensePa += game.awayPa;
    away.offenseHits += game.awayHits;
    away.defenseGames += 1;
    away.paAllowed += game.homePa;
    away.hitsAllowed += game.homeHits;

    home.offenseGames += 1;
    home.offensePa += game.homePa;
    home.offenseHits += game.homeHits;
    home.defenseGames += 1;
    home.paAllowed += game.awayPa;
    home.hitsAllowed += game.awayHits;

    histories.set(game.awayTeamId, away);
    histories.set(game.homeTeamId, home);
  }
}

function identity(dataset) {
  return {
    datasetVersion: dataset.datasetVersion,
    factorKey: dataset.factorKey,
    provider: dataset.provider,
    activeSeason: dataset.activeSeason,
    sourceTeamEnvironmentDatasetSha256: dataset.sourceTeamEnvironmentDatasetSha256,
    sourceTeamEnvironmentDatasetFileSha256:
      dataset.sourceTeamEnvironmentDatasetFileSha256,
    featureVersion: dataset.featureVersion,
    featureNames: dataset.featureNames,
    historyPolicy: dataset.historyPolicy,
    untouchedTestReservation: dataset.untouchedTestReservation,
    excludedOffensiveStatisticsUsed: dataset.excludedOffensiveStatisticsUsed,
    totals: dataset.totals,
    periods: dataset.periods,
    excludedGames: dataset.excludedGames,
  };
}

export function buildM8_5GameOffensiveEnvironmentFeatureDataset({
  rawTeamEnvironmentDataset,
  sourceTeamEnvironmentDatasetFileSha256,
}) {
  const source = verifyM8TeamOffensiveEnvironmentDataset(rawTeamEnvironmentDataset);
  validateUntouched(
    source.untouchedTestReservation,
    'source team environment untouchedTestReservation',
  );
  const sourceFileSha256 = sha256String(
    sourceTeamEnvironmentDatasetFileSha256,
    'sourceTeamEnvironmentDatasetFileSha256',
  );
  const games = pairSourceGames(source);
  const histories = new Map();
  const periodRows = new Map(PERIOD_IDS.map((periodId) => [periodId, []]));
  const excludedGames = [];

  for (let index = 0; index < games.length; ) {
    const observedDate = games[index].observedDate;
    const dateGames = [];
    while (index < games.length && games[index].observedDate === observedDate) {
      dateGames.push(games[index]);
      index += 1;
    }
    for (const game of dateGames) {
      const built = featureRow(game, histories);
      if (built.status === 'included') periodRows.get(game.periodId).push(built);
      else excludedGames.push(built);
    }
    applyDateOutcomes(dateGames, histories);
  }

  const periods = Object.freeze(
    Object.fromEntries(
      PERIOD_IDS.map((periodId) => {
        const sourcePeriod = object(source.periods[periodId], `source periods.${periodId}`);
        const rows = periodRows.get(periodId);
        return [
          periodId,
          Object.freeze({
            startDate: sourcePeriod.startDate,
            endDate: sourcePeriod.endDate,
            sourceGameCount: sourcePeriod.rowCount / 2,
            rowCount: rows.length,
            rows: Object.freeze(rows),
          }),
        ];
      }),
    ),
  );
  const sourceGameCount = games.length;
  const includedGameCount = PERIOD_IDS.reduce(
    (sum, periodId) => sum + periods[periodId].rowCount,
    0,
  );
  const totals = Object.freeze({
    sourceTeamGameRowCount: sourceGameCount * 2,
    sourceGameCount,
    includedGameCount,
    excludedGameCount: excludedGames.length,
  });
  if (includedGameCount + excludedGames.length !== sourceGameCount) {
    throw new Error('game-specific environment feature conservation failed.');
  }

  const datasetIdentity = Object.freeze({
    datasetVersion: 1,
    factorKey: 'gameSpecificOffensiveEnvironment',
    provider: source.provider,
    activeSeason: source.activeSeason,
    sourceTeamEnvironmentDatasetSha256: sha256String(
      source.datasetSha256,
      'source team environment dataset SHA-256',
    ),
    sourceTeamEnvironmentDatasetFileSha256: sourceFileSha256,
    featureVersion: 'm8-5-game-offensive-environment-features-v1',
    featureNames: FEATURE_NAMES,
    historyPolicy: Object.freeze({
      currentSeasonOnly: true,
      strictlyEarlierObservedDateOnly: true,
      sameDateOutcomesAvailableToEachOther: false,
      minimumPriorGamesPerRequiredTeamRole: 1,
      priorSeasonFallback: false,
      excludedGameOffensiveValuesAllowed: false,
    }),
    untouchedTestReservation: Object.freeze({ rowsIncluded: false }),
    excludedOffensiveStatisticsUsed: false,
    totals,
    periods,
    excludedGames: Object.freeze(
      excludedGames.sort(
        (left, right) =>
          left.observedDate.localeCompare(right.observedDate) || left.gameId - right.gameId,
      ),
    ),
  });
  return Object.freeze({
    purpose:
      'Current-season chronological pregame game features for resolving weights over the one frozen shared offensive-environment scenario set. Features use only strictly earlier included team-game PA and hit evidence; same-date and excluded-game offensive outcomes are unavailable.',
    ...datasetIdentity,
    datasetSha256: sha256(JSON.stringify(datasetIdentity)),
  });
}

export function verifyM8_5GameOffensiveEnvironmentFeatureDataset(rawDataset) {
  const dataset = object(rawDataset, 'game offensive-environment feature dataset');
  if (
    dataset.datasetVersion !== 1 ||
    dataset.factorKey !== 'gameSpecificOffensiveEnvironment' ||
    dataset.provider !== 'BALLDONTLIE MLB API' ||
    dataset.activeSeason !== 2026 ||
    dataset.featureVersion !== 'm8-5-game-offensive-environment-features-v1' ||
    dataset.excludedOffensiveStatisticsUsed !== false
  ) {
    throw new Error('unsupported game offensive-environment feature dataset contract.');
  }
  validateUntouched(dataset.untouchedTestReservation, 'untouchedTestReservation');
  sha256String(dataset.sourceTeamEnvironmentDatasetSha256, 'source dataset SHA-256');
  sha256String(dataset.sourceTeamEnvironmentDatasetFileSha256, 'source file SHA-256');
  if (JSON.stringify(dataset.featureNames) !== JSON.stringify(FEATURE_NAMES)) {
    throw new Error('game offensive-environment feature names drifted.');
  }
  const expectedSha = sha256(JSON.stringify(identity(dataset)));
  if (sha256String(dataset.datasetSha256, 'datasetSha256') !== expectedSha) {
    throw new Error('game offensive-environment feature dataset SHA-256 is invalid.');
  }
  let included = 0;
  for (const periodId of PERIOD_IDS) {
    const period = object(dataset.periods?.[periodId], `periods.${periodId}`);
    const rows = array(period.rows, `periods.${periodId}.rows`);
    if (nonNegativeInteger(period.rowCount, `${periodId}.rowCount`) !== rows.length) {
      throw new Error(`${periodId}.rowCount does not match rows.`);
    }
    included += rows.length;
    for (const row of rows) {
      if (row.periodId !== periodId || Object.hasOwn(row, 'selectedSide')) {
        throw new Error(`${row.rowId} period drifted or contains selected side.`);
      }
      for (const featureName of FEATURE_NAMES) {
        finiteNumber(row.features?.[featureName], `${row.rowId}.features.${featureName}`);
      }
      for (const value of Object.values(row.priorEvidence ?? {})) {
        positiveInteger(value, `${row.rowId}.priorEvidence`);
      }
      const awayPa = positiveInteger(
        row.target?.awayPlateAppearances,
        `${row.rowId}.target.awayPlateAppearances`,
      );
      const homePa = positiveInteger(
        row.target?.homePlateAppearances,
        `${row.rowId}.target.homePlateAppearances`,
      );
      const awayHits = nonNegativeInteger(row.target?.awayHits, `${row.rowId}.target.awayHits`);
      const homeHits = nonNegativeInteger(row.target?.homeHits, `${row.rowId}.target.homeHits`);
      if (awayHits > awayPa || homeHits > homePa) {
        throw new Error(`${row.rowId} target hits exceed plate appearances.`);
      }
    }
  }
  const totals = object(dataset.totals, 'totals');
  const excluded = array(dataset.excludedGames, 'excludedGames');
  if (
    totals.includedGameCount !== included ||
    totals.excludedGameCount !== excluded.length ||
    totals.includedGameCount + totals.excludedGameCount !== totals.sourceGameCount ||
    totals.sourceTeamGameRowCount !== totals.sourceGameCount * 2
  ) {
    throw new Error('game offensive-environment feature totals do not conserve source games.');
  }
  return dataset;
}

export const M8_5_GAME_OFFENSIVE_ENVIRONMENT_FEATURE_NAMES = FEATURE_NAMES;
