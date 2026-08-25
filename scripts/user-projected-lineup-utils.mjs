import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const USER_PROJECTED_LINEUP_CONTRACT = 'user-projected-lineup-v1';
export const USER_PROJECTED_LINEUP_SOURCE_TIME_ZONE = 'America/New_York';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function nonemptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  return value.trim().replace(/\s+/gu, ' ');
}

function isoTimestamp(value, label) {
  const timestamp = nonemptyString(value, label);
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return new Date(milliseconds).toISOString();
}

function lineupSlot(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 9) {
    throw new TypeError(`${label} must be an integer from 1 through 9.`);
  }
  return value;
}

function normalizeText(value) {
  return nonemptyString(value, 'text')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[.'’\-]/gu, ' ')
    .replace(/[^a-z0-9 ]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizedNameTokens(value) {
  const tokens = normalizeText(value).split(' ').filter(Boolean);
  while (tokens.length > 1 && SUFFIXES.has(tokens.at(-1))) tokens.pop();
  return tokens;
}

export function userProjectionPlayerLabelMatches(sourcePlayerLabel, playerName) {
  const sourceTokens = normalizedNameTokens(sourcePlayerLabel);
  const playerTokens = normalizedNameTokens(playerName);
  if (sourceTokens.length === 0 || playerTokens.length === 0) return false;
  if (sourceTokens.join(' ') === playerTokens.join(' ')) return true;
  if (sourceTokens[0].length !== 1 || playerTokens[0][0] !== sourceTokens[0]) {
    return false;
  }
  return sourceTokens.slice(1).join(' ') === playerTokens.slice(1).join(' ');
}

function localDate(timestamp, timeZone) {
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError('game.date must be an ISO timestamp.');
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(milliseconds));
  const values = Object.fromEntries(
    parts.filter((entry) => entry.type !== 'literal').map((entry) => [entry.type, entry.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function validateTeam(raw, label) {
  const team = object(raw, label);
  const teamName = nonemptyString(team.teamName, `${label}.teamName`);
  const sourceStatus = nonemptyString(team.sourceStatus, `${label}.sourceStatus`);
  if (sourceStatus !== 'expected' && sourceStatus !== 'confirmed') {
    throw new Error(`${label}.sourceStatus must be expected or confirmed.`);
  }
  const players = array(team.players, `${label}.players`).map((rawPlayer, index) => {
    const player = object(rawPlayer, `${label}.players[${index}]`);
    return Object.freeze({
      sourcePlayerLabel: nonemptyString(
        player.sourcePlayerLabel,
        `${label}.players[${index}].sourcePlayerLabel`,
      ),
      lineupSlot: lineupSlot(
        player.lineupSlot,
        `${label}.players[${index}].lineupSlot`,
      ),
    });
  });
  if (players.length === 0 || players.length > 9) {
    throw new Error(`${label}.players must contain between one and nine readable projected starters.`);
  }
  const slots = new Set(players.map((player) => player.lineupSlot));
  if (slots.size !== players.length) {
    throw new Error(`${label}.players contains duplicate lineup slots.`);
  }
  const labels = players.map((player) => normalizeText(player.sourcePlayerLabel));
  if (new Set(labels).size !== labels.length) {
    throw new Error(`${label}.players contains duplicate source player labels.`);
  }
  players.sort((left, right) => left.lineupSlot - right.lineupSlot);
  return Object.freeze({ teamName, sourceStatus, players: Object.freeze(players) });
}

function validateArtifact(raw, filePath, bytes) {
  const value = object(raw, 'user projected lineup artifact');
  if (value.version !== 1 || value.contract !== USER_PROJECTED_LINEUP_CONTRACT) {
    throw new Error('User projected lineup artifact has the wrong version or contract.');
  }
  const source = nonemptyString(value.source, 'artifact.source');
  const slateDate = nonemptyString(value.slateDate, 'artifact.slateDate');
  if (!DATE_PATTERN.test(slateDate)) {
    throw new TypeError('artifact.slateDate must be YYYY-MM-DD.');
  }
  const sourceTimeZone = nonemptyString(
    value.sourceTimeZone,
    'artifact.sourceTimeZone',
  );
  if (sourceTimeZone !== USER_PROJECTED_LINEUP_SOURCE_TIME_ZONE) {
    throw new Error(
      `artifact.sourceTimeZone must be ${USER_PROJECTED_LINEUP_SOURCE_TIME_ZONE}.`,
    );
  }
  const importedAt = isoTimestamp(value.importedAt, 'artifact.importedAt');
  const evidenceIds = array(
    value.sourceEvidenceIds,
    'artifact.sourceEvidenceIds',
  ).map((entry, index) =>
    nonemptyString(entry, `artifact.sourceEvidenceIds[${index}]`),
  );
  if (evidenceIds.length === 0 || new Set(evidenceIds).size !== evidenceIds.length) {
    throw new Error('artifact.sourceEvidenceIds must contain unique source identities.');
  }

  const games = array(value.games, 'artifact.games').map((rawGame, gameIndex) => {
    const game = object(rawGame, `artifact.games[${gameIndex}]`);
    const awayTeamName = nonemptyString(
      game.awayTeamName,
      `artifact.games[${gameIndex}].awayTeamName`,
    );
    const homeTeamName = nonemptyString(
      game.homeTeamName,
      `artifact.games[${gameIndex}].homeTeamName`,
    );
    if (normalizeText(awayTeamName) === normalizeText(homeTeamName)) {
      throw new Error(`artifact.games[${gameIndex}] must contain two different teams.`);
    }
    const teams = array(game.teams, `artifact.games[${gameIndex}].teams`).map(
      (team, teamIndex) =>
        validateTeam(team, `artifact.games[${gameIndex}].teams[${teamIndex}]`),
    );
    if (teams.length === 0 || teams.length > 2) {
      throw new Error(`artifact.games[${gameIndex}].teams must contain one or two readable teams.`);
    }
    const expectedTeams = new Set([
      normalizeText(awayTeamName),
      normalizeText(homeTeamName),
    ]);
    const actualTeams = teams.map((team) => normalizeText(team.teamName));
    if (
      new Set(actualTeams).size !== teams.length ||
      actualTeams.some((teamName) => !expectedTeams.has(teamName))
    ) {
      throw new Error(
        `artifact.games[${gameIndex}].teams must uniquely match the away or home team.`,
      );
    }
    return Object.freeze({
      awayTeamName,
      homeTeamName,
      teams: Object.freeze(teams),
    });
  });
  if (games.length === 0) {
    throw new Error('artifact.games must contain at least one game.');
  }
  const gameKeys = games.map(
    (game) => `${normalizeText(game.awayTeamName)}\u0000${normalizeText(game.homeTeamName)}`,
  );
  if (new Set(gameKeys).size !== gameKeys.length) {
    throw new Error('artifact.games contains duplicate matchup identities.');
  }

  const expectedFilename = `${slateDate}.json`;
  if (path.basename(filePath) !== expectedFilename) {
    throw new Error(
      `User projected lineup artifact filename must be ${expectedFilename}.`,
    );
  }

  return Object.freeze({
    version: 1,
    contract: USER_PROJECTED_LINEUP_CONTRACT,
    source,
    slateDate,
    sourceTimeZone,
    importedAt,
    sourceEvidenceIds: Object.freeze(evidenceIds),
    snapshotSha256: createHash('sha256').update(bytes).digest('hex'),
    games: Object.freeze(games),
  });
}

export function validateUserProjectedLineupArtifactBytes(bytes, filePath) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let parsed;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new Error(`User projected lineup artifact is not valid JSON: ${filePath}`);
  }
  return validateArtifact(parsed, filePath, buffer);
}

function configuredRoot() {
  return path.resolve(
    process.env.USER_PROJECTED_LINEUP_ROOT?.trim() ||
      'artifacts/user-projected-lineups',
  );
}

function gameDateUtc(game) {
  if (typeof game?.date !== 'string' || game.date.trim().length === 0) return null;
  return isoTimestamp(game.date, 'game.date');
}

function gameTeamName(game, side) {
  const direct = game[`${side}_team_name`];
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return nonemptyString(direct, `game.${side}_team_name`);
  }
  return nonemptyString(game[`${side}_team`]?.display_name, `game.${side}_team.display_name`);
}

export function readUserProjectedLineupForGame(game, { root = configuredRoot() } = {}) {
  const dateUtc = gameDateUtc(game);
  if (dateUtc === null) return null;
  const targetDate = localDate(
    dateUtc,
    USER_PROJECTED_LINEUP_SOURCE_TIME_ZONE,
  );
  const filePath = path.join(root, `${targetDate}.json`);
  let bytes;
  try {
    bytes = readFileSync(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const artifact = validateUserProjectedLineupArtifactBytes(bytes, filePath);
  if (artifact.slateDate !== targetDate) return null;
  return artifact;
}

export function userProjectedLineupEvidenceForIdentity({
  game,
  identity: rawIdentity,
  root,
}) {
  const artifact = readUserProjectedLineupForGame(
    game,
    root === undefined ? undefined : { root },
  );
  if (artifact === null) return Object.freeze([]);

  const identity = object(rawIdentity, 'identity');
  const targetAway = gameTeamName(game, 'away');
  const targetHome = gameTeamName(game, 'home');
  const gameMatches = artifact.games.filter(
    (entry) =>
      normalizeText(entry.awayTeamName) === normalizeText(targetAway) &&
      normalizeText(entry.homeTeamName) === normalizeText(targetHome),
  );
  if (gameMatches.length === 0) return Object.freeze([]);
  if (gameMatches.length !== 1) {
    throw new Error('User projected lineup matchup evidence is ambiguous.');
  }

  const teamName = nonemptyString(identity.teamName, 'identity.teamName');
  const teams = gameMatches[0].teams.filter(
    (entry) => normalizeText(entry.teamName) === normalizeText(teamName),
  );
  if (teams.length === 0) return Object.freeze([]);
  if (teams.length !== 1) {
    throw new Error(`User projected lineup team evidence is ambiguous for ${teamName}.`);
  }

  const playerName = nonemptyString(identity.playerName, 'identity.playerName');
  const matches = teams[0].players.filter((entry) =>
    userProjectionPlayerLabelMatches(entry.sourcePlayerLabel, playerName),
  );
  if (matches.length === 0) return Object.freeze([]);
  if (matches.length !== 1) {
    throw new Error(`User projected lineup player evidence is ambiguous for ${playerName}.`);
  }

  const providerPlayerId = identity.providerPlayerId;
  const providerTeamId = identity.providerTeamId;
  if (!Number.isSafeInteger(providerPlayerId) || providerPlayerId <= 0) {
    throw new TypeError('identity.providerPlayerId must be a positive integer.');
  }
  if (!Number.isSafeInteger(providerTeamId) || providerTeamId <= 0) {
    throw new TypeError('identity.providerTeamId must be a positive integer.');
  }
  const dateUtc = gameDateUtc(game);
  if (dateUtc === null) return Object.freeze([]);

  return Object.freeze([
    Object.freeze({
      sourceGameId: `user-projection:${artifact.slateDate}:${targetAway}:${targetHome}`,
      sourceGameDateUtc: dateUtc,
      playerId: String(providerPlayerId),
      teamId: String(providerTeamId),
      lineupSlot: matches[0].lineupSlot,
      sourceCapturedAt: artifact.importedAt,
      sourceSnapshotSha256: artifact.snapshotSha256,
    }),
  ]);
}
