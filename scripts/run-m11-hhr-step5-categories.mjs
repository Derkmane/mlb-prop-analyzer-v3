import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  selectHhr05HigherAltV1,
  selectHhr25LowerAltV1,
} from '../dist/src/categories/index.js';
import {
  BATTER_HHR_SETTLEMENT_RULE_VERSION,
} from '../dist/src/features/batter-hhr/index.js';
import { verifyM10HhrArchiveBytes } from './m10-hhr-evidence-utils.mjs';

const HHR_ARCHIVE_ROOT = path.resolve(
  process.env.M10_HHR_ARCHIVE_ROOT?.trim() || 'artifacts/board-archives/batter-hhr',
);
const BDL_KEY = process.env.BALLDONTLIE_API_KEY?.trim();
if (!BDL_KEY) throw new Error('Missing BALLDONTLIE_API_KEY.');

const BDL_MIN_REQUEST_INTERVAL_MS = 13_000;
const EXPECTED_BOARD_MARKETS = Object.freeze([
  'batter_hits_runs_rbis',
  'batter_hits_runs_rbis_alternate',
]);
let lastBdlRequestAt = 0;

function requireNonemptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a nonempty string.`);
  }
  return value;
}

function assertApprovedSourceSet(archive) {
  const odds = archive.source?.theOddsApi;
  const bdl = archive.source?.balldontlie;
  if (
    odds?.provider !== 'The Odds API' ||
    odds?.boardBookmaker !== 'underdog' ||
    odds?.boardRegion !== 'us_dfs' ||
    JSON.stringify(odds?.boardMarkets) !== JSON.stringify(EXPECTED_BOARD_MARKETS)
  ) {
    throw new Error('Step 5 source archive does not preserve the approved Underdog HHR board contract.');
  }
  if (bdl?.provider !== 'BALLDONTLIE MLB API' || bdl?.activeSeason !== 2026) {
    throw new Error('Step 5 source archive does not preserve the approved BALLDONTLIE current-season contract.');
  }
}

function assertRequiredRowFields(row) {
  requireNonemptyString(row.playerName, 'HHR evidence playerName');
  requireNonemptyString(row.distributionIdentity?.modelVersion, 'HHR evidence modelVersion');
  requireNonemptyString(
    row.distributionIdentity?.distributionBuilderVersion,
    'HHR evidence distributionBuilderVersion',
  );
}

function candidateFromArchiveRow(row) {
  assertRequiredRowFields(row);
  return Object.freeze({
    playerId: String(row.providerPlayerId),
    eligibilityProbability: row.archivedPWin + row.archivedPLoss,
    line: row.postedLine,
    selectedSide: row.selectedSide,
    pWin: row.archivedPWin,
    pLoss: row.archivedPLoss,
    pVoid: row.archivedPVoid,
    pWinGivenGrades: row.archivedPWinGivenGrades,
    sourceRow: row,
  });
}

function categoryInputs(archive) {
  return archive.rows.map((row) => Object.freeze({
    candidate: candidateFromArchiveRow(row),
    offerType: row.offerType,
  }));
}

function categorySelections(archive) {
  const inputs = categoryInputs(archive);
  return Object.freeze({
    lower25: selectHhr25LowerAltV1(inputs),
    higher05: selectHhr05HigherAltV1(inputs),
  });
}

function minimumAvailability(selections) {
  return Math.min(
    selections.lower25.availableOfferCount,
    selections.higher05.availableOfferCount,
  );
}

async function verifiedArchivesNewestFirst() {
  const captureDirectory = path.join(HHR_ARCHIVE_ROOT, 'captures');
  const names = (await readdir(captureDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  if (names.length === 0) {
    throw new Error('No immutable HHR prospective captures are available.');
  }

  const archives = [];
  for (const name of names) {
    const archivePath = path.join(captureDirectory, name);
    const bytes = await readFile(archivePath);
    const archive = verifyM10HhrArchiveBytes({ bytes, archivePath });
    assertApprovedSourceSet(archive);
    archives.push(Object.freeze({ archive, selections: categorySelections(archive) }));
  }
  return archives;
}

async function chooseEvidenceArchive() {
  const archives = await verifiedArchivesNewestFirst();
  const complete = archives.find(({ selections }) =>
    selections.lower25.availableOfferCount >= 20 &&
    selections.higher05.availableOfferCount >= 20,
  );
  if (complete) {
    return Object.freeze({
      ...complete,
      selectionPolicy: 'latest verified real capture with at least 20 available offers in both Step 5 categories',
    });
  }

  const best = [...archives].sort((left, right) =>
    minimumAvailability(right.selections) - minimumAvailability(left.selections),
  )[0];
  if (!best) throw new Error('No verified HHR archive could be selected.');
  return Object.freeze({
    ...best,
    selectionPolicy: 'no capture contained 20 in both categories; selected verified real capture maximizing the smaller category without padding or substitution',
  });
}

function exclusionCountsByRule(exclusions) {
  const counts = new Map();
  for (const exclusion of exclusions) {
    const reason = typeof exclusion?.reason === 'string' && exclusion.reason.length > 0
      ? exclusion.reason
      : 'unspecified';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

async function waitForBdlWindow() {
  if (lastBdlRequestAt === 0) return;
  const remaining = BDL_MIN_REQUEST_INTERVAL_MS - (Date.now() - lastBdlRequestAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

async function fetchBdlLineups(gameIds) {
  const rows = [];
  const seenCursors = new Set();
  let cursor = null;
  let page = 1;

  while (true) {
    await waitForBdlWindow();
    const url = new URL('https://api.balldontlie.io/mlb/v1/lineups');
    for (const gameId of gameIds) url.searchParams.append('game_ids[]', String(gameId));
    url.searchParams.set('per_page', '100');
    if (cursor !== null) url.searchParams.set('cursor', String(cursor));

    let response;
    let text;
    for (let attempt = 0; attempt <= 8; attempt += 1) {
      response = await fetch(url, { headers: { Authorization: BDL_KEY } });
      lastBdlRequestAt = Date.now();
      text = await response.text();
      if (response.status !== 429) break;
      if (attempt === 8) throw new Error(`BDL lineups page ${page} exhausted HTTP 429 retries.`);
      const retryAfterSeconds = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfterSeconds)
        ? Math.max(BDL_MIN_REQUEST_INTERVAL_MS, retryAfterSeconds * 1000)
        : BDL_MIN_REQUEST_INTERVAL_MS;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    if (!response?.ok) {
      throw new Error(`BDL lineups page ${page} returned HTTP ${response?.status}: ${String(text).slice(0, 500)}`);
    }
    const body = JSON.parse(text);
    if (!Array.isArray(body?.data)) throw new Error(`BDL lineups page ${page} data must be an array.`);
    rows.push(...body.data);

    const nextCursor = body?.meta?.next_cursor ?? null;
    if (nextCursor === null || nextCursor === undefined) break;
    const key = String(nextCursor);
    if (seenCursors.has(key)) throw new Error(`BDL lineups repeated cursor ${key}.`);
    seenCursors.add(key);
    cursor = nextCursor;
    page += 1;
  }

  return Object.freeze(rows);
}

function gameById(archive) {
  return new Map(archive.games.map((game) => [game.gameId, game]));
}

function lineupIdentityByGamePlayer(lineupRows) {
  const grouped = new Map();
  for (const row of lineupRows) {
    const gameId = row?.game_id;
    const playerId = row?.player?.id;
    const teamId = row?.team?.id;
    const battingOrder = row?.batting_order;
    if (
      !Number.isSafeInteger(gameId) ||
      !Number.isSafeInteger(playerId) ||
      !Number.isSafeInteger(teamId) ||
      !Number.isSafeInteger(battingOrder) ||
      battingOrder < 1 ||
      battingOrder > 9
    ) {
      continue;
    }
    const key = `${gameId}:${playerId}`;
    const values = grouped.get(key) ?? [];
    values.push(Object.freeze({ teamId, battingOrder }));
    grouped.set(key, values);
  }
  return grouped;
}

function displayIdentity(row, games, lineups) {
  const game = games.get(row.providerGameId);
  if (!game) throw new Error(`Missing archived game identity for game ${row.providerGameId}.`);
  const matches = lineups.get(`${row.providerGameId}:${row.providerPlayerId}`) ?? [];
  const unique = [...new Map(matches.map((match) => [`${match.teamId}:${match.battingOrder}`, match])).values()];
  if (unique.length !== 1) {
    throw new Error(
      `Selected player ${row.playerName} (${row.providerPlayerId}) in game ${row.providerGameId} must have one confirmed BDL lineup identity; received ${unique.length}.`,
    );
  }
  const lineup = unique[0];
  let team;
  let opponent;
  if (lineup.teamId === game.homeTeamId) {
    team = game.homeTeamName;
    opponent = game.awayTeamName;
  } else if (lineup.teamId === game.awayTeamId) {
    team = game.awayTeamName;
    opponent = game.homeTeamName;
  } else {
    throw new Error(`Selected player ${row.playerName} has a BDL team outside archived game ${row.providerGameId}.`);
  }
  return Object.freeze({
    team: requireNonemptyString(team, 'display team'),
    opponent: requireNonemptyString(opponent, 'display opponent'),
    lineupStatus: 'confirmed',
  });
}

function selectedSourceRows(selection) {
  return selection.selectedCandidates.map((input) => input.candidate.sourceRow);
}

function formatNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toPrecision(17) : String(value);
}

function printCategory(selection, displayByRowKey) {
  console.log(`CATEGORY\t${selection.categoryTitle}`);
  console.log(`POSTED EXACT OFFERS BEFORE FAIL-CLOSED CHECKS\t${selection.postedExactOfferCount}`);
  console.log(`AVAILABLE OFFERS BEFORE TOP-20 CUT\t${selection.availableOfferCount}`);
  console.log(`SELECTED ROWS\t${selection.selectedCandidates.length}`);
  console.log(`CATEGORY EXCLUSIONS BY RULE\t${JSON.stringify(selection.exclusionCounts)}`);
  console.log([
    'RANK',
    'PLAYER',
    'TEAM',
    'OPPONENT',
    'POSTED LINE',
    'SIDE',
    'P(WIN)',
    'P(LOSS)',
    'P(VOID)',
    'P(WIN|GRADES)',
    'LINEUP STATUS [DISPLAY ONLY]',
    'PAYOUT MULTIPLIER [DISPLAY ONLY]',
    'MODEL VERSION',
    'DISTRIBUTION VERSION',
    'SETTLEMENT VERSION',
  ].join('\t'));

  selectedSourceRows(selection).forEach((row, index) => {
    const key = `${row.providerGameId}:${row.providerPlayerId}`;
    const display = displayByRowKey.get(key);
    if (!display) throw new Error(`Missing display identity for ${row.playerName}.`);
    console.log([
      index + 1,
      row.playerName,
      display.team,
      display.opponent,
      row.postedLine,
      row.selectedSide,
      formatNumber(row.archivedPWin),
      formatNumber(row.archivedPLoss),
      formatNumber(row.archivedPVoid),
      formatNumber(row.archivedPWinGivenGrades),
      display.lineupStatus,
      row.multiplier ?? 'null',
      row.distributionIdentity.modelVersion,
      row.distributionIdentity.distributionBuilderVersion,
      BATTER_HHR_SETTLEMENT_RULE_VERSION,
    ].join('\t'));
  });
}

const evidence = await chooseEvidenceArchive();
const selectedRows = [
  ...selectedSourceRows(evidence.selections.lower25),
  ...selectedSourceRows(evidence.selections.higher05),
];
const selectedGameIds = [...new Set(selectedRows.map((row) => row.providerGameId))].sort((a, b) => a - b);
const lineups = await fetchBdlLineups(selectedGameIds);
const games = gameById(evidence.archive);
const lineupIdentities = lineupIdentityByGamePlayer(lineups);
const displayByRowKey = new Map();
for (const row of selectedRows) {
  const key = `${row.providerGameId}:${row.providerPlayerId}`;
  if (!displayByRowKey.has(key)) {
    displayByRowKey.set(key, displayIdentity(row, games, lineupIdentities));
  }
}

console.log('=== M11 STEP 5 HHR CATEGORY EVIDENCE ===');
console.log(`SOURCE CAPTURE KEY\t${evidence.archive.captureKey}`);
console.log(`SOURCE CAPTURE DATE UTC\t${evidence.archive.captureDateUtc}`);
console.log(`SOURCE ARCHIVE FILE SHA-256\t${evidence.archive.archiveFileSha256}`);
console.log(`SOURCE ROWS\t${evidence.archive.rows.length}`);
console.log(`SOURCE BOARD\tThe Odds API | bookmaker=underdog | region=us_dfs | markets=${EXPECTED_BOARD_MARKETS.join(',')}`);
console.log('SOURCE MLB DATA\tBALLDONTLIE MLB API | activeSeason=2026');
console.log(`ARCHIVE SELECTION POLICY\t${evidence.selectionPolicy}`);
console.log(`UPSTREAM FAIL-CLOSED EXCLUSIONS BY RULE\t${JSON.stringify(exclusionCountsByRule(evidence.archive.exclusions))}`);
console.log('PRODUCTION\tDISABLED');
console.log('RANKING\tDISABLED');
console.log('LINEUP STATUS POLICY\tDISPLAY ONLY; category selection completes before BDL lineup enrichment');
console.log('PAYOUT POLICY\tDISPLAY ONLY; multiplier is never passed to the category selector');
console.log('---');
printCategory(evidence.selections.lower25, displayByRowKey);
console.log('---');
printCategory(evidence.selections.higher05, displayByRowKey);
console.log('=== END M11 STEP 5 HHR CATEGORY EVIDENCE ===');
