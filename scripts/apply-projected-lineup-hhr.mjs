import { readFile, writeFile } from 'node:fs/promises';

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`${label}: source marker not found`);
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: source marker is not unique`);
  }
  return `${text.slice(0, first)}${after}${text.slice(first + before.length)}`;
}

const filePath = 'scripts/archive-m10-batter-hhr-board.mjs';
let text = await readFile(filePath, 'utf8');

text = replaceOnce(
  text,
  "import { resolveExactBallDontLieGameMatch } from './archive-m9-batter-hits-board.mjs';",
  "import {\n  buildBallDontLiePlayerLookupRequest,\n  captureProjectedLineupHistory,\n  resolveExactBallDontLieGameMatch,\n  resolveExactBallDontLiePlayerIdentity,\n  resolveProjectedLineupIdentity,\n} from './archive-m9-batter-hits-board.mjs';",
  'HHR shared lineup imports',
);

text = replaceOnce(
  text,
  "async function fetchSnapshot(url, label, { headers = {}, bdl = false } = {}) {\n  for (let attempt = 0; attempt <= 8; attempt += 1) {",
  "async function fetchSnapshot(url, label, { headers = {}, bdl = false } = {}) {\n  for (let attempt = 0; attempt <= 8; attempt += 1) {\n    const capturedAt = new Date().toISOString();",
  'HHR snapshot capture time',
);
text = replaceOnce(
  text,
  '    return Object.freeze({ body: JSON.parse(text), text, sha256: sha256(text) });',
  '    return Object.freeze({ body: JSON.parse(text), text, sha256: sha256(text), capturedAt });',
  'HHR snapshot return capture time',
);

const fetchAdapter = String.raw`
async function fetchBdlForProjectedLineup({ label, url }) {
  const snapshot = await fetchSnapshot(url, label, {
    headers: { Authorization: bdlKey },
    bdl: true,
  });
  return Object.freeze({
    parsedBody: snapshot.body,
    capturedAt: snapshot.capturedAt,
    rawBody: Object.freeze({
      sha256: snapshot.sha256,
      base64: Buffer.from(snapshot.text).toString('base64'),
    }),
  });
}

`;
text = replaceOnce(
  text,
  'function eventFromHits(raw) {',
  `${fetchAdapter}function eventFromHits(raw) {`,
  'HHR projected BDL adapter',
);

text = replaceOnce(
  text,
  'const resolvedGames = [];\nconst exclusions = [];',
  'const resolvedGames = [];\nconst rawGameById = new Map();\nconst exclusions = [];',
  'HHR raw game map declaration',
);
text = replaceOnce(
  text,
  '  const raw = resolution.game;\n  resolvedGames.push(Object.freeze({',
  '  const raw = resolution.game;\n  rawGameById.set(raw.id, raw);\n  resolvedGames.push(Object.freeze({',
  'HHR raw game map population',
);

text = replaceOnce(
  text,
  'const lineupRows = Array.isArray(lineupsSnapshot.body?.data) ? lineupsSnapshot.body.data : [];',
  `const lineupRows = Array.isArray(lineupsSnapshot.body?.data) ? lineupsSnapshot.body.data : [];\nconst currentLineups = Object.freeze({\n  body: Object.freeze({ data: Object.freeze(lineupRows) }),\n  capturedAt: lineupsSnapshot.capturedAt ?? capturedAt,\n  combinedSha256: lineupsSnapshot.sha256,\n});\nconst projectedLineupGameSnapshotCache = new Map();\nconst projectedLineupSourceSnapshotSha256s = new Set();`,
  'HHR current lineup evidence wrapper',
);

const oldGameLoopStart = String.raw`  const totals = teamTotals(game, totalSnapshots.get(game.providerEventId));
  const offeredNames = [...new Set(offers.map((offer) => offer.playerName))];
  for (const playerName of offeredNames) {
    const matches = playerByGameName.get(`${game.gameId}:${playerName}`) ?? [];
    if (matches.length !== 1) {
      exclusions.push(Object.freeze({ gameId: game.gameId, playerName, reason: `starting-lineup-name-match-count-${matches.length}` }));
      continue;
    }
    const hitter = matches[0];
    const teamRows = hittersByGameTeam.get(`${game.gameId}:${hitter.teamId}`);
    if (!(teamRows instanceof Map) || teamRows.size !== 9) {
      exclusions.push(Object.freeze({ gameId: game.gameId, playerName, reason: 'starting-nine-incomplete' }));
      continue;
    }
`;
const newGameLoopStart = String.raw`  const totals = teamTotals(game, totalSnapshots.get(game.providerEventId));
  const offeredNames = [...new Set(offers.map((offer) => offer.playerName))];
  const rawGame = rawGameById.get(game.gameId);
  if (!rawGame) {
    throw new Error(`Missing raw BALLDONTLIE game ${game.gameId} for HHR lineup resolution.`);
  }

  const identitiesByName = new Map();
  let needsHistoricalLineups = false;
  for (const playerName of offeredNames) {
    const currentMatches = playerByGameName.get(`${game.gameId}:${playerName}`) ?? [];
    if (currentMatches.length === 1) {
      const current = currentMatches[0];
      const teamName = current.teamId === game.homeTeamId ? game.homeTeamName : game.awayTeamName;
      identitiesByName.set(playerName, Object.freeze({
        providerEventId: game.providerEventId,
        offerPlayerName: playerName,
        providerGameId: game.gameId,
        providerPlayerId: current.playerId,
        providerTeamId: current.teamId,
        playerName,
        teamName,
      }));
      continue;
    }
    if (currentMatches.length > 1) {
      exclusions.push(Object.freeze({
        gameId: game.gameId,
        playerName,
        reason: 'lineup-resolution-failed-closed',
        detail: `Current lineup contains ${currentMatches.length} matches.`,
      }));
      continue;
    }

    needsHistoricalLineups = true;
    try {
      const request = buildBallDontLiePlayerLookupRequest(playerName);
      const snapshot = await fetchBdlForProjectedLineup({
        label: `BALLDONTLIE exact HHR player lookup ${playerName}`,
        url: request.url,
      });
      projectedLineupSourceSnapshotSha256s.add(snapshot.rawBody.sha256);
      const identity = resolveExactBallDontLiePlayerIdentity({
        event: Object.freeze({ id: game.providerEventId }),
        game: rawGame,
        playerName,
        rawPlayersSnapshot: snapshot.parsedBody,
        requestParameters: request.requestParameters,
      });
      if (identity.status !== 'exact') {
        exclusions.push(Object.freeze({
          gameId: game.gameId,
          playerName,
          reason: 'player-identity-unresolved',
          matchCount: identity.candidates.filter((candidate) => candidate.accepted).length,
        }));
        continue;
      }
      identitiesByName.set(playerName, identity.identity);
    } catch (error) {
      exclusions.push(Object.freeze({
        gameId: game.gameId,
        playerName,
        reason: 'player-identity-unresolved',
        detail: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  let historicalLineups = null;
  if (needsHistoricalLineups) {
    try {
      historicalLineups = await captureProjectedLineupHistory({
        game: rawGame,
        fetchBdl: fetchBdlForProjectedLineup,
        gameSnapshotCache: projectedLineupGameSnapshotCache,
      });
      for (const snapshot of historicalLineups.snapshots) {
        projectedLineupSourceSnapshotSha256s.add(snapshot.rawBody.sha256);
      }
    } catch (error) {
      exclusions.push(Object.freeze({
        gameId: game.gameId,
        reason: 'projected-lineup-history-failed-closed',
        detail: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  const resolvedHittersByName = new Map();
  const slotCandidatesByTeam = new Map();
  for (const [playerName, identity] of identitiesByName) {
    let lineup;
    try {
      lineup = resolveProjectedLineupIdentity({
        game: rawGame,
        identity,
        currentLineups,
        historicalLineups,
      });
    } catch (error) {
      exclusions.push(Object.freeze({
        gameId: game.gameId,
        playerName,
        reason: 'lineup-resolution-failed-closed',
        detail: error instanceof Error ? error.message : String(error),
      }));
      continue;
    }
    if (!lineup.resolution.resolved || !lineup.row) {
      exclusions.push(Object.freeze({
        gameId: game.gameId,
        playerName,
        reason: 'no-slot-evidence-within-lookback',
      }));
      continue;
    }
    const rawHitter = lineup.row;
    const hitter = Object.freeze({
      playerId: identity.providerPlayerId,
      playerName,
      lineupSlot: lineup.resolution.lineupSlot,
      lineupStatus: lineup.resolution.lineupStatus,
      lineupSourceCapturedAt: lineup.resolution.sourceCapturedAt,
      lineupSourceSnapshotSha256: lineup.resolution.sourceSnapshotSha256,
      declaredHand: declaredBatterHand(rawHitter.player?.bats_throws),
      teamId: identity.providerTeamId,
    });
    resolvedHittersByName.set(playerName, hitter);
    const teamSlots = slotCandidatesByTeam.get(hitter.teamId) ?? new Map();
    const slotRows = teamSlots.get(hitter.lineupSlot) ?? [];
    slotRows.push(hitter);
    teamSlots.set(hitter.lineupSlot, slotRows);
    slotCandidatesByTeam.set(hitter.teamId, teamSlots);
  }

  for (const playerName of offeredNames) {
    const hitter = resolvedHittersByName.get(playerName);
    if (!hitter) continue;
    const teamRows = slotCandidatesByTeam.get(hitter.teamId) ?? new Map();
`;
text = replaceOnce(text, oldGameLoopStart, newGameLoopStart, 'HHR offered player projected resolution');

const oldPreceding = String.raw`    const precedingSlots = [1, 2, 3].map((distance) => ((hitter.lineupSlot - distance - 1 + 9) % 9) + 1);
    const preceding = precedingSlots.map((slot) => teamRows.get(slot));
    if (preceding.some((row) => !row)) {
      exclusions.push(Object.freeze({ gameId: game.gameId, playerName, reason: 'preceding-lineup-slot-missing' }));
      continue;
    }
`;
const newPreceding = String.raw`    const precedingSlots = [1, 2, 3].map((distance) => ((hitter.lineupSlot - distance - 1 + 9) % 9) + 1);
    const precedingCandidates = precedingSlots.map((slot) => teamRows.get(slot) ?? []);
    if (precedingCandidates.some((rowsForSlot) => rowsForSlot.length !== 1)) {
      exclusions.push(Object.freeze({
        gameId: game.gameId,
        playerName,
        reason: 'preceding-slot-unresolvable',
      }));
      continue;
    }
    const preceding = precedingCandidates.map((rowsForSlot) => rowsForSlot[0]);
`;
text = replaceOnce(text, oldPreceding, newPreceding, 'HHR predecessor gate replacement');

text = replaceOnce(
  text,
  '          lineupSlot: hitter.lineupSlot,\n          expectedPlateAppearances: opportunity.expectedPlateAppearances,',
  '          lineupSlot: hitter.lineupSlot,\n          lineupStatus: hitter.lineupStatus,\n          lineupSourceCapturedAt: hitter.lineupSourceCapturedAt,\n          lineupSourceSnapshotSha256: hitter.lineupSourceSnapshotSha256,\n          expectedPlateAppearances: opportunity.expectedPlateAppearances,',
  'HHR lineup lineage status',
);

text = replaceOnce(
  text,
  '  bdlLineupsSnapshotSha256: lineupsSnapshot.sha256,',
  '  bdlLineupsSnapshotSha256: lineupsSnapshot.sha256,\n  bdlProjectedLineupSnapshotSha256s: Object.freeze([...projectedLineupSourceSnapshotSha256s].sort()),',
  'HHR projected source lineage',
);

text = replaceOnce(
  text,
  "console.log(`EXCLUSIONS\\t${archive.counts.exclusions}`);",
  `const hhrLineupStatusCounts = rows.reduce(\n  (counts, row) => {\n    const status = row.inputLineage.lineupStatus;\n    if (status !== 'confirmed' && status !== 'projected') {\n      throw new Error(\u0060Unexpected HHR lineupStatus: \${String(status)}\u0060);\n    }\n    counts[status] += 1;\n    return counts;\n  },\n  { confirmed: 0, projected: 0 },\n);\nconst hhrExclusionCounts = exclusions.reduce((counts, entry) => {\n  const reason = String(entry.reason);\n  counts.set(reason, (counts.get(reason) ?? 0) + 1);\n  return counts;\n}, new Map());\nconsole.log(\u0060EXCLUSIONS\\t\${archive.counts.exclusions}\u0060);\nconsole.log(\u0060CONFIRMED SLOT CANDIDATES\\t\${hhrLineupStatusCounts.confirmed}\u0060);\nconsole.log(\u0060PROJECTED SLOT CANDIDATES\\t\${hhrLineupStatusCounts.projected}\u0060);\nfor (const [reason, count] of [...hhrExclusionCounts.entries()].sort(([left], [right]) => left.localeCompare(right))) {\n  console.log(\u0060EXCLUSION RULE \${reason}\\t\${count}\u0060);\n}`,
  'HHR live status report',
);

await writeFile(filePath, text);
