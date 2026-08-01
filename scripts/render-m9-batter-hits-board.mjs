import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { compareSettlementResultsForRanking } from '../dist/src/core/index.js';

export const DEFAULT_ARCHIVE_ROOT = path.join(
  'artifacts',
  'board-archives',
  'batter-hits',
);

const ARCHIVE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

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

function string(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

function probability(value, label) {
  const parsed = finiteNumber(value, label);
  if (parsed < 0 || parsed > 1) {
    throw new RangeError(`${label} must be between 0 and 1.`);
  }
  return parsed;
}

export function validateArchiveDate(value) {
  const date = string(value, 'archive date');
  if (!ARCHIVE_DATE_PATTERN.test(date)) {
    throw new TypeError('archive date must use YYYY-MM-DD.');
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new TypeError('archive date must be a real calendar date.');
  }
  return date;
}

export function archivePathForDate({
  archiveDate,
  archiveRoot = DEFAULT_ARCHIVE_ROOT,
}) {
  return path.join(
    string(archiveRoot, 'archive root'),
    `${validateArchiveDate(archiveDate)}.json`,
  );
}

function settlementResultFromRow(rawRow, index) {
  const row = object(rawRow, `archive.rows[${index}]`);
  const market = object(row.market, `archive.rows[${index}].market`);
  const probabilities = object(
    row.probabilities,
    `archive.rows[${index}].probabilities`,
  );
  const candidate = object(
    row.candidate,
    `archive.rows[${index}].candidate`,
  );

  const selectedSide = string(
    market.selectedSide,
    `archive.rows[${index}].market.selectedSide`,
  );
  if (selectedSide !== 'higher' && selectedSide !== 'lower') {
    throw new TypeError(
      `archive.rows[${index}].market.selectedSide must be higher or lower.`,
    );
  }

  const pWinGivenGrades = probabilities.pWinGivenGrades;
  if (pWinGivenGrades === null) {
    throw new RangeError(`archive.rows[${index}] is fully void and not rankable.`);
  }

  return Object.freeze({
    eligibilityProbability: probability(
      candidate.eligibilityProbability,
      `archive.rows[${index}].candidate.eligibilityProbability`,
    ),
    line: finiteNumber(market.line, `archive.rows[${index}].market.line`),
    selectedSide,
    winProbability: probability(
      probabilities.pWin,
      `archive.rows[${index}].probabilities.pWin`,
    ),
    lossProbability: probability(
      probabilities.pLoss,
      `archive.rows[${index}].probabilities.pLoss`,
    ),
    voidProbability: probability(
      probabilities.pVoid,
      `archive.rows[${index}].probabilities.pVoid`,
    ),
    winProbabilityGivenGrades: probability(
      pWinGivenGrades,
      `archive.rows[${index}].probabilities.pWinGivenGrades`,
    ),
  });
}

function displayRow(rawRow, sourceIndex) {
  const row = object(rawRow, `archive.rows[${sourceIndex}]`);
  const player = object(row.player, `archive.rows[${sourceIndex}].player`);
  const market = object(row.market, `archive.rows[${sourceIndex}].market`);
  const probabilities = object(
    row.probabilities,
    `archive.rows[${sourceIndex}].probabilities`,
  );

  settlementResultFromRow(row, sourceIndex);

  return Object.freeze({
    sourceIndex,
    player: string(
      player.playerName,
      `archive.rows[${sourceIndex}].player.playerName`,
    ),
    market: string(
      market.providerMarketKey,
      `archive.rows[${sourceIndex}].market.providerMarketKey`,
    ),
    line: finiteNumber(market.line, `archive.rows[${sourceIndex}].market.line`),
    side: string(
      market.selectedSide,
      `archive.rows[${sourceIndex}].market.selectedSide`,
    ),
    pWin: probability(
      probabilities.pWin,
      `archive.rows[${sourceIndex}].probabilities.pWin`,
    ),
    pLoss: probability(
      probabilities.pLoss,
      `archive.rows[${sourceIndex}].probabilities.pLoss`,
    ),
    pVoid: probability(
      probabilities.pVoid,
      `archive.rows[${sourceIndex}].probabilities.pVoid`,
    ),
    pWinGivenGrades: probability(
      probabilities.pWinGivenGrades,
      `archive.rows[${sourceIndex}].probabilities.pWinGivenGrades`,
    ),
    archivedRow: row,
  });
}

export function buildRankedDisplayRows(rawArchive) {
  const archive = object(rawArchive, 'archive');
  const rows = array(archive.rows, 'archive.rows').map(displayRow);

  rows.sort((left, right) =>
    compareSettlementResultsForRanking(
      settlementResultFromRow(left.archivedRow, left.sourceIndex),
      settlementResultFromRow(right.archivedRow, right.sourceIndex),
    ),
  );

  return Object.freeze(
    rows.map((row, index) =>
      Object.freeze({
        rank: index + 1,
        player: row.player,
        market: row.market,
        line: row.line,
        side: row.side,
        pWin: row.pWin,
        pLoss: row.pLoss,
        pVoid: row.pVoid,
        pWinGivenGrades: row.pWinGivenGrades,
      }),
    ),
  );
}

function percent(value) {
  return `${(value * 100).toFixed(3)}%`;
}

function pad(value, width) {
  return String(value).padEnd(width, ' ');
}

function table(rows) {
  const headers = [
    'Rank',
    'Player',
    'Market',
    'Line',
    'Side',
    'P(Win)',
    'P(Loss)',
    'P(Void)',
    'P(Win | grades)',
  ];
  const values = rows.map((row) => [
    row.rank,
    row.player,
    row.market,
    row.line,
    row.side,
    percent(row.pWin),
    percent(row.pLoss),
    percent(row.pVoid),
    percent(row.pWinGivenGrades),
  ]);
  const widths = headers.map((header, column) =>
    Math.max(
      header.length,
      ...values.map((row) => String(row[column]).length),
    ),
  );
  const format = (row) =>
    row.map((value, column) => pad(value, widths[column])).join(' | ').trimEnd();
  const separator = widths.map((width) => '-'.repeat(width)).join('-|-');
  return [format(headers), separator, ...values.map(format)].join('\n');
}

export function renderArchivedBoard(rawArchive) {
  const archive = object(rawArchive, 'archive');
  const archiveDate = validateArchiveDate(archive.archiveDate);
  const archiveSha256 = string(archive.archiveSha256, 'archive.archiveSha256');
  const rows = buildRankedDisplayRows(archive);

  return [
    '=== M9 BATTER HITS ARCHIVED BOARD ===',
    `Archive date: ${archiveDate}`,
    `Archive SHA-256: ${archiveSha256}`,
    `Rows: ${rows.length}`,
    '',
    table(rows),
  ].join('\n');
}

export async function loadArchivedBoard({
  archiveDate,
  archiveRoot = DEFAULT_ARCHIVE_ROOT,
}) {
  const filePath = archivePathForDate({ archiveDate, archiveRoot });
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Archived Batter Hits board does not exist: ${filePath}`);
    }
    throw error;
  }

  let archive;
  try {
    archive = JSON.parse(text);
  } catch {
    throw new Error(`Archived Batter Hits board is not valid JSON: ${filePath}`);
  }

  return Object.freeze({ filePath, archive });
}

export async function runArchivedBoardDisplay({
  archiveDate,
  archiveRoot = DEFAULT_ARCHIVE_ROOT,
} = {}) {
  const loaded = await loadArchivedBoard({ archiveDate, archiveRoot });
  return Object.freeze({
    filePath: loaded.filePath,
    output: renderArchivedBoard(loaded.archive),
  });
}

function requestedArchiveDate() {
  return process.argv[2]?.trim() ||
    process.env.M9_BATTER_HITS_ARCHIVE_DATE?.trim() ||
    '';
}

async function main() {
  const archiveDate = requestedArchiveDate();
  if (archiveDate.length === 0) {
    throw new Error(
      'Provide an archive date as YYYY-MM-DD or set M9_BATTER_HITS_ARCHIVE_DATE.',
    );
  }
  const archiveRoot =
    process.env.M9_BATTER_HITS_ARCHIVE_ROOT?.trim() || DEFAULT_ARCHIVE_ROOT;
  const result = await runArchivedBoardDisplay({ archiveDate, archiveRoot });
  console.log(`Archive: ${result.filePath}`);
  console.log(result.output);
  console.log('Probability calculations performed: false');
  console.log('Files written: false');
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;

if (entryPoint === import.meta.url) {
  await main();
}
