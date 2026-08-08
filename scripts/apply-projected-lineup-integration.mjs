import { readFile, writeFile } from 'node:fs/promises';

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`${label}: source marker not found`);
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: source marker is not unique`);
  }
  return `${text.slice(0, first)}${after}${text.slice(first + before.length)}`;
}

async function patchHits() {
  const filePath = 'scripts/archive-m9-batter-hits-board.mjs';
  let text = await readFile(filePath, 'utf8');

  text = replaceOnce(
    text,
    "import { createBdlAdaptiveRateLimiter } from './bdl-adaptive-rate-limit-utils.mjs';",
    "import {\n  PROJECTED_LINEUP_LOOKBACK_DAYS,\n  resolveProjectedLineupSlot,\n} from '../dist/src/game/index.js';\nimport { createBdlAdaptiveRateLimiter } from './bdl-adaptive-rate-limit-utils.mjs';",
    'Hits shared resolver import',
  );

  text = replaceOnce(
    text,
    'async function capturePlayerIdentityLookups({',
    'export async function capturePlayerIdentityLookups({',
    'Hits player lookup export',
  );

  const projectedResolvers = String.raw`
export function resolveProjectedLineupIdentity({
  game,
  identity: rawIdentity,
  currentLineups,
  historicalLineups,
}) {
  const identity = object(rawIdentity, 'identity');
  const gameId = positiveInteger(game.id, 'game.id');
  const playerId = positiveInteger(identity.providerPlayerId, 'identity.providerPlayerId');
  const teamId = positiveInteger(identity.providerTeamId, 'identity.providerTeamId');
  const currentRows = lineupRows(currentLineups.body);
  const historyRows = historicalLineups === null
    ? []
    : lineupRows(historicalLineups.lineups.body);
  const historicalGameById = new Map(
    (historicalLineups?.games ?? []).map((rawGame) => {
      const historicalGame = object(rawGame, 'historical game');
      return [
        positiveInteger(historicalGame.id, 'historical game.id'),
        historicalGame,
      ];
    }),
  );

  const currentEvidence = currentRows.flatMap((raw, index) => {
    const row = object(raw, `current lineups[${index}]`);
    const slot = battingOrder(row);
    if (
      row.game_id !== gameId ||
      row.is_probable_pitcher !== false ||
      slot === null ||
      lineupPlayer(row, `current lineups[${index}]`).id !== playerId ||
      lineupTeam(row, `current lineups[${index}]`).id !== teamId
    ) {
      return [];
    }
    return [{
      gameId: String(gameId),
      playerId: String(playerId),
      teamId: String(teamId),
      lineupSlot: slot,
      sourceCapturedAt: currentLineups.capturedAt,
      sourceSnapshotSha256: currentLineups.combinedSha256,
    }];
  });

  const historicalEvidence = historyRows.flatMap((raw, index) => {
    const row = object(raw, `historical lineups[${index}]`);
    const slot = battingOrder(row);
    const historicalGame = historicalGameById.get(row.game_id);
    if (
      historicalGame === undefined ||
      row.is_probable_pitcher !== false ||
      slot === null ||
      lineupPlayer(row, `historical lineups[${index}]`).id !== playerId ||
      lineupTeam(row, `historical lineups[${index}]`).id !== teamId
    ) {
      return [];
    }
    return [{
      gameId: String(row.game_id),
      gameDateUtc: normalizedGameDateUtc(historicalGame, `historical game ${row.game_id}`),
      playerId: String(playerId),
      teamId: String(teamId),
      lineupSlot: slot,
      sourceCapturedAt: historicalLineups.lineups.capturedAt,
      sourceSnapshotSha256: historicalLineups.lineups.combinedSha256,
    }];
  });

  const resolution = resolveProjectedLineupSlot({
    targetGameId: String(gameId),
    targetGameDateUtc: normalizedGameDateUtc(game, 'target game'),
    playerId: String(playerId),
    teamId: String(teamId),
    currentGameEvidence: currentEvidence,
    historicalCompletedStarts: historicalEvidence,
    lookbackDays: PROJECTED_LINEUP_LOOKBACK_DAYS,
  });
  if (!resolution.resolved) {
    return Object.freeze({ identity, resolution, row: null });
  }

  const sourceRows = resolution.lineupStatus === 'confirmed' ? currentRows : historyRows;
  const sourceGameId = Number(resolution.sourceGameId);
  const selectedRows = sourceRows.filter((raw, index) => {
    const row = object(raw, `resolved source lineups[${index}]`);
    return (
      row.game_id === sourceGameId &&
      row.is_probable_pitcher === false &&
      battingOrder(row) === resolution.lineupSlot &&
      lineupPlayer(row, `resolved source lineups[${index}]`).id === playerId &&
      lineupTeam(row, `resolved source lineups[${index}]`).id === teamId
    );
  });
  if (selectedRows.length !== 1) {
    throw new Error(
      `Resolved lineup source for ${identity.offerPlayerName} must have exactly one row; found ${selectedRows.length}.`,
    );
  }
  return Object.freeze({
    identity,
    resolution,
    row: selectedRows[0],
  });
}

export function resolveProjectedLineupIdentities({
  event,
  game,
  currentLineups,
  historicalLineups,
  identities,
}) {
  const resolutions = [];
  const lineupExclusions = [];
  const lineupResolvedPlayerNames = [];
  for (const rawIdentity of identities) {
    const identity = object(rawIdentity, 'identity');
    try {
      const resolved = resolveProjectedLineupIdentity({
        game,
        identity,
        currentLineups,
        historicalLineups,
      });
      if (!resolved.resolution.resolved) {
        lineupExclusions.push(Object.freeze({
          providerEventId: event.id,
          playerName: identity.offerPlayerName,
          reason: resolved.resolution.reason,
          matchCount: 0,
        }));
        continue;
      }
      resolutions.push(resolved);
      lineupResolvedPlayerNames.push(identity.offerPlayerName);
    } catch (error) {
      lineupExclusions.push(Object.freeze({
        providerEventId: event.id,
        playerName: identity.offerPlayerName,
        reason: 'lineup-resolution-failed-closed',
        matchCount: 0,
        detail: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return Object.freeze({
    identities: Object.freeze(resolutions.map((entry) => entry.identity)),
    resolutions: Object.freeze(resolutions),
    lineupExclusions: Object.freeze(lineupExclusions),
    lineupResolvedPlayerNames: Object.freeze(lineupResolvedPlayerNames),
  });
}

`;
  text = replaceOnce(
    text,
    'function runtimeObservation({ offer, game, lineupsSnapshot, lineupSnapshot }) {',
    `${projectedResolvers}function runtimeObservation({ offer, game, lineupsSnapshot, lineupSnapshot, resolvedLineup }) {`,
    'Hits projected resolver insertion',
  );

  const oldHitterBlock = String.raw`  const gameId = positiveInteger(game.id, 'game.id');
  const rows = lineupRows(lineupsSnapshot);
  const hitters = rows.filter((raw, index) => {
    const row = object(raw, `lineups[${index}]`);
    return (
      row.game_id === gameId &&
      row.is_probable_pitcher === false &&
      battingOrder(row) !== null &&
      lineupPlayer(row, `lineups[${index}]`).id === offer.providerPlayerId &&
      lineupTeam(row, `lineups[${index}]`).id === offer.providerTeamId
    );
  });
  if (hitters.length !== 1) {
    throw new Error(
      `Offer ${offer.playerName} requires exactly one active lineup row; found ${hitters.length}.`,
    );
  }
  const hitter = object(hitters[0], `hitter ${offer.playerName}`);
`;
  const newHitterBlock = String.raw`  const gameId = positiveInteger(game.id, 'game.id');
  const rows = lineupRows(lineupsSnapshot);
  const lineup = object(resolvedLineup, `resolved lineup ${offer.playerName}`);
  const resolution = object(lineup.resolution, `resolved lineup ${offer.playerName}.resolution`);
  if (resolution.resolved !== true || lineup.row === null || lineup.row === undefined) {
    throw new Error(`Offer ${offer.playerName} requires one resolved lineup slot.`);
  }
  const hitter = object(lineup.row, `hitter ${offer.playerName}`);
`;
  text = replaceOnce(text, oldHitterBlock, newHitterBlock, 'Hits runtime hitter resolution');
  text = replaceOnce(
    text,
    "    lineupStatus: 'confirmed',",
    '    lineupStatus: resolution.lineupStatus,',
    'Hits runtime lineupStatus',
  );
  text = replaceOnce(
    text,
    '    lineupSlot: battingOrder(hitter),',
    '    lineupSlot: resolution.lineupSlot,',
    'Hits runtime lineup slot',
  );
  text = replaceOnce(
    text,
    '    lineupSourceCapturedAt: lineupSnapshot.capturedAt,\n    lineupSourceSnapshotSha256: lineupSnapshot.combinedSha256,',
    '    lineupSourceCapturedAt: resolution.sourceCapturedAt,\n    lineupSourceSnapshotSha256: resolution.sourceSnapshotSha256,',
    'Hits runtime lineup source lineage',
  );

  const oldCaptureLineupsStart = text.indexOf('async function captureLineups({ gameId, fetchBdl }) {');
  const oldCaptureLineupsEnd = text.indexOf('\nasync function readJsonVerified(', oldCaptureLineupsStart);
  if (oldCaptureLineupsStart < 0 || oldCaptureLineupsEnd < 0) {
    throw new Error('Hits captureLineups block markers not found');
  }
  const newCaptureLineups = String.raw`async function captureLineupsForGameIds({ gameIds, fetchBdl, labelPrefix }) {
  const uniqueGameIds = [...new Set(gameIds)].sort((left, right) => left - right);
  if (uniqueGameIds.length === 0) {
    throw new Error('captureLineupsForGameIds requires at least one game ID.');
  }
  const snapshots = [];
  const rows = [];
  const seenCursors = new Set();
  let cursor = null;
  let page = 1;
  while (true) {
    const url = new URL('https://api.balldontlie.io/mlb/v1/lineups');
    for (const gameId of uniqueGameIds) {
      url.searchParams.append('game_ids[]', String(gameId));
    }
    url.searchParams.set('per_page', '100');
    if (cursor !== null) url.searchParams.set('cursor', String(cursor));
    const snapshot = await fetchBdl({
      label: `${labelPrefix} page ${page}`,
      url,
      requireNonemptyRecords: false,
    });
    snapshots.push(snapshot);
    rows.push(...array(object(snapshot.parsedBody, 'lineup page').data, 'lineup page.data'));
    const nextCursor = snapshot.parsedBody?.meta?.next_cursor ?? null;
    if (nextCursor === null || nextCursor === undefined) break;
    const key = String(nextCursor);
    if (seenCursors.has(key)) {
      throw new Error(`BALLDONTLIE lineup pagination repeated cursor ${key}.`);
    }
    seenCursors.add(key);
    cursor = nextCursor;
    page += 1;
  }
  const combinedBytes = Buffer.concat(
    snapshots.flatMap((snapshot) => {
      const body = Buffer.from(snapshot.rawBody.base64, 'base64');
      const length = Buffer.allocUnsafe(8);
      length.writeBigUInt64BE(BigInt(body.length));
      return [length, body];
    }),
  );
  return Object.freeze({
    snapshots: Object.freeze(snapshots),
    body: Object.freeze({ data: Object.freeze(rows) }),
    capturedAt: snapshots.at(-1).capturedAt,
    combinedSha256: sha256Bytes(combinedBytes),
  });
}

async function captureLineups({ gameId, fetchBdl }) {
  return captureLineupsForGameIds({
    gameIds: [gameId],
    fetchBdl,
    labelPrefix: `BALLDONTLIE lineups game ${gameId}`,
  });
}

export async function captureProjectedLineupHistory({
  game,
  fetchBdl,
  gameSnapshotCache = new Map(),
}) {
  if (!(gameSnapshotCache instanceof Map)) {
    throw new TypeError('gameSnapshotCache must be a Map.');
  }
  const targetGameId = positiveInteger(game.id, 'game.id');
  const targetGameDateUtc = normalizedGameDateUtc(game, 'projected-lineup target game');
  const targetTimestamp = Date.parse(targetGameDateUtc);
  const homeTeamId = positiveInteger(game.home_team?.id, 'game.home_team.id');
  const awayTeamId = positiveInteger(game.away_team?.id, 'game.away_team.id');
  const earliestTimestamp = targetTimestamp - PROJECTED_LINEUP_LOOKBACK_DAYS * 86_400_000;
  const targetDateMidnight = Date.parse(`${targetGameDateUtc.slice(0, 10)}T00:00:00.000Z`);
  const dates = [];
  for (let offset = -PROJECTED_LINEUP_LOOKBACK_DAYS; offset <= 0; offset += 1) {
    dates.push(new Date(targetDateMidnight + offset * 86_400_000).toISOString().slice(0, 10));
  }

  const newSnapshots = [];
  const historicalById = new Map();
  for (const date of dates) {
    let snapshot = gameSnapshotCache.get(date);
    if (snapshot === undefined) {
      const url = new URL('https://api.balldontlie.io/mlb/v1/games');
      url.searchParams.append('dates[]', date);
      url.searchParams.set('season_type', 'regular');
      url.searchParams.set('per_page', '100');
      snapshot = await fetchBdl({
        label: `BALLDONTLIE projected-lineup history games ${date}`,
        url,
        requireNonemptyRecords: false,
      });
      gameSnapshotCache.set(date, snapshot);
      newSnapshots.push(snapshot);
    }
    for (const raw of array(object(snapshot.parsedBody, `history games ${date}`).data, `history games ${date}.data`)) {
      const historicalGame = object(raw, `history game ${date}`);
      const gameId = positiveInteger(historicalGame.id, 'history game.id');
      if (
        gameId === targetGameId ||
        historicalGame.season !== ACTIVE_SEASON ||
        historicalGame.postseason !== false ||
        historicalGame.season_type !== 'regular' ||
        historicalGame.status !== 'STATUS_FINAL'
      ) {
        continue;
      }
      const gameTimestamp = Date.parse(normalizedGameDateUtc(historicalGame, `history game ${gameId}`));
      if (
        gameTimestamp >= targetTimestamp ||
        gameTimestamp < earliestTimestamp
      ) {
        continue;
      }
      const historicalHomeTeamId = positiveInteger(historicalGame.home_team?.id, `history game ${gameId} home team`);
      const historicalAwayTeamId = positiveInteger(historicalGame.away_team?.id, `history game ${gameId} away team`);
      if (
        historicalHomeTeamId !== homeTeamId &&
        historicalAwayTeamId !== homeTeamId &&
        historicalHomeTeamId !== awayTeamId &&
        historicalAwayTeamId !== awayTeamId
      ) {
        continue;
      }
      historicalById.set(gameId, historicalGame);
    }
  }

  const games = [...historicalById.values()].sort(
    (left, right) =>
      Date.parse(normalizedGameDateUtc(left, 'left historical game')) -
        Date.parse(normalizedGameDateUtc(right, 'right historical game')) ||
      left.id - right.id,
  );
  if (games.length === 0) {
    return Object.freeze({
      games: Object.freeze([]),
      lineups: Object.freeze({
        snapshots: Object.freeze([]),
        body: Object.freeze({ data: Object.freeze([]) }),
        capturedAt: targetGameDateUtc,
        combinedSha256: sha256Bytes(Buffer.from('[]')),
      }),
      snapshots: Object.freeze(newSnapshots),
    });
  }

  const lineups = await captureLineupsForGameIds({
    gameIds: games.map((historicalGame) => historicalGame.id),
    fetchBdl,
    labelPrefix: `BALLDONTLIE projected-lineup history for game ${targetGameId}`,
  });
  return Object.freeze({
    games: Object.freeze(games),
    lineups,
    snapshots: Object.freeze([...newSnapshots, ...lineups.snapshots]),
  });
}
`;
  text = `${text.slice(0, oldCaptureLineupsStart)}${newCaptureLineups}${text.slice(oldCaptureLineupsEnd)}`;

  text = replaceOnce(
    text,
    '    const playerLookupDiagnosticState = { printed: 0 };',
    '    const playerLookupDiagnosticState = { printed: 0 };\n    const projectedLineupGameSnapshotCache = new Map();',
    'Hits history cache',
  );

  const oldLineupFlow = String.raw`      const lineupResolution = resolveActiveLineupIdentities({
        event,
        game,
        lineupsSnapshot: lineups.body,
        identities: identities.identities,
      });
      const lineupSurvived = offerCountForNames(
        rawOffers,
        lineupResolution.lineupResolvedPlayerNames,
      );
      funnel.add('lineupEvidenceOffers', {
        entered: identitySurvived,
        survived: lineupSurvived,
      });
      lineupResolution.lineupExclusions.forEach((entry) => {
        funnel.drop(
          'lineupEvidenceOffers',
          'no confirmed or projected active lineup evidence',
          rawOffers.countsByPlayer.get(entry.playerName) ?? 0,
        );
      });
      exclusions.push(...lineupResolution.lineupExclusions);
`;
  const newLineupFlow = String.raw`      const confirmedOnly = resolveActiveLineupIdentities({
        event,
        game,
        lineupsSnapshot: lineups.body,
        identities: identities.identities,
      });
      let historicalLineups = null;
      if (confirmedOnly.identities.length !== identities.identities.length) {
        try {
          historicalLineups = await captureProjectedLineupHistory({
            game,
            fetchBdl,
            gameSnapshotCache: projectedLineupGameSnapshotCache,
          });
          providerSnapshots.push(...historicalLineups.snapshots);
        } catch (error) {
          exclusions.push({
            providerEventId: event.id,
            reason: 'PROJECTED_LINEUP_HISTORY_FAILED_CLOSED',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const lineupResolution = resolveProjectedLineupIdentities({
        event,
        game,
        currentLineups: lineups,
        historicalLineups,
        identities: identities.identities,
      });
      const lineupSurvived = offerCountForNames(
        rawOffers,
        lineupResolution.lineupResolvedPlayerNames,
      );
      funnel.add('lineupEvidenceOffers', {
        entered: identitySurvived,
        survived: lineupSurvived,
      });
      lineupResolution.lineupExclusions.forEach((entry) => {
        funnel.drop(
          'lineupEvidenceOffers',
          entry.reason,
          rawOffers.countsByPlayer.get(entry.playerName) ?? 0,
        );
      });
      exclusions.push(...lineupResolution.lineupExclusions);
`;
  text = replaceOnce(text, oldLineupFlow, newLineupFlow, 'Hits lineup resolution flow');

  text = replaceOnce(
    text,
    '                lineupSnapshot: lineups,\n              }),',
    "                lineupSnapshot: lineups,\n                resolvedLineup: lineupResolution.resolutions.find(\n                  (entry) => entry.identity.providerPlayerId === offer.providerPlayerId,\n                ),\n              }),",
    'Hits runtime resolved lineup argument',
  );

  text = replaceOnce(
    text,
    '    const candidates = Object.freeze(\n      candidateEvaluations.map((entry) => entry.result.candidate),\n    );',
    `    const candidates = Object.freeze(\n      candidateEvaluations.map((entry) => entry.result.candidate),\n    );\n    const lineupStatusCounts = candidateEvaluations.reduce(\n      (counts, entry) => {\n        const status = entry.result.candidate.featureData.values.batterHits?.lineupStatus;\n        if (status !== 'confirmed' && status !== 'projected') {\n          throw new Error(\u0060Unexpected Batter Hits lineupStatus: \${String(status)}\u0060);\n        }\n        counts[status] += 1;\n        return counts;\n      },\n      { confirmed: 0, projected: 0 },\n    );\n    const exclusionCountsByRule = [...exclusions].reduce((counts, entry) => {\n      const reason = String(entry.reason);\n      counts.set(reason, (counts.get(reason) ?? 0) + 1);\n      return counts;\n    }, new Map());`,
    'Hits lineup status counts',
  );

  text = replaceOnce(
    text,
    "        `RANKED CANDIDATES: ${archive.counts.rankedCandidateCount}`,\n        `EXCLUSIONS: ${archive.counts.exclusionCount}`,",
    "        `RANKED CANDIDATES: ${archive.counts.rankedCandidateCount}`,\n        `CONFIRMED SLOT CANDIDATES: ${lineupStatusCounts.confirmed}`,\n        `PROJECTED SLOT CANDIDATES: ${lineupStatusCounts.projected}`,\n        `EXCLUSIONS: ${archive.counts.exclusionCount}`,\n        ...[...exclusionCountsByRule.entries()]\n          .sort(([left], [right]) => left.localeCompare(right))\n          .map(([reason, count]) => `EXCLUSION RULE ${reason}: ${count}`),",
    'Hits live report counts',
  );

  await writeFile(filePath, text);
}

await patchHits();
