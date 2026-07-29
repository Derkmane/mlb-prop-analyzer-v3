import { readFile } from 'node:fs/promises';

import { verifyM8ParkVenueLineage } from './m8-park-venue-lineage-utils.mjs';

const RESOLVED_DATASET_PATH =
  process.env.M8_RESOLVED_CATEGORICAL_DATASET_PATH?.trim() ||
  'artifacts/m8-current-season-pa/m8-resolved-categorical-dataset-v3.json';
const VENUE_LINEAGE_PATH =
  process.env.M8_PARK_VENUE_LINEAGE_PATH?.trim() ||
  'artifacts/m8-park-venue-lineage/m8-park-venue-lineage-v1.json';
const PERIODS = Object.freeze(['fit', 'validation']);
const VALID_BATTER_HANDS = new Set(['L', 'R']);

async function readJson(filePath, label) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(
      `${label} could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function assertObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function increment(object, key, amount = 1) {
  object[key] = (object[key] ?? 0) + amount;
}

function percentile(sortedValues, probability) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor(probability * sortedValues.length)),
  );
  return sortedValues[index];
}

const dataset = assertObject(
  await readJson(RESOLVED_DATASET_PATH, 'resolved categorical dataset'),
  'resolved categorical dataset',
);
const lineage = verifyM8ParkVenueLineage(
  await readJson(VENUE_LINEAGE_PATH, 'park venue lineage'),
);

if (dataset.datasetVersion !== 3) {
  throw new Error('resolved categorical datasetVersion must equal 3.');
}
if (
  dataset.untouchedTestReservation?.rowsIncluded !== false ||
  Object.hasOwn(dataset.untouchedTestReservation ?? {}, 'rows')
) {
  throw new Error('resolved categorical dataset exposes untouched-test rows.');
}
if (dataset.datasetSha256 !== lineage.sourceResolvedDatasetSha256) {
  throw new Error('park venue lineage does not match the resolved categorical dataset.');
}

const lineageByGameId = new Map();
for (const periodId of PERIODS) {
  const period = assertObject(lineage.periods?.[periodId], `lineage.periods.${periodId}`);
  const rows = assertArray(period.rows, `lineage.periods.${periodId}.rows`);
  for (const [index, rawGame] of rows.entries()) {
    const game = assertObject(rawGame, `lineage.periods.${periodId}.rows[${index}]`);
    const gameId = assertPositiveInteger(
      game.providerGameId,
      `lineage.periods.${periodId}.rows[${index}].providerGameId`,
    );
    if (game.periodId !== periodId) {
      throw new Error(`lineage game ${gameId} period identity drifted.`);
    }
    if (lineageByGameId.has(gameId)) throw new Error(`duplicate lineage game ${gameId}.`);
    lineageByGameId.set(gameId, game);
  }
}

const categories = new Set();
const periodSummary = {};
const cellCounts = new Map();
const gamesSeen = new Set();
const unavailableHandExamples = [];

for (const periodId of PERIODS) {
  const period = assertObject(dataset.periods?.[periodId], `periods.${periodId}`);
  const rows = assertArray(period.rows, `periods.${periodId}.rows`);
  const summary = {
    sourceRowCount: rows.length,
    classifiedTerminalCount: 0,
    handednessUsableCount: 0,
    handednessUnavailableCount: 0,
    gameCount: 0,
    venueCount: 0,
    handCounts: {},
    categoryCounts: {},
  };
  const periodGames = new Set();
  const periodVenues = new Set();

  for (const [index, rawRow] of rows.entries()) {
    const row = assertObject(rawRow, `periods.${periodId}.rows[${index}]`);
    if (row.mappingStatus !== 'classified-terminal') continue;
    if (row.includedInOverallOutcomeModel !== true) {
      throw new Error(`${row.rowId ?? `${periodId}:${index}`} classified row is not overall eligible.`);
    }
    const gameId = assertPositiveInteger(row.providerGameId, `${row.rowId}.providerGameId`);
    const game = lineageByGameId.get(gameId);
    if (game === undefined) throw new Error(`missing venue lineage for game ${gameId}.`);
    const observedDate = assertNonEmptyString(row.observedDate, `${row.rowId}.observedDate`);
    if (game.periodId !== periodId || game.observedDate !== observedDate) {
      throw new Error(`venue lineage chronology mismatch for game ${gameId}.`);
    }
    const venue = assertNonEmptyString(game.venue, `game ${gameId}.venue`);
    const category = assertNonEmptyString(row.terminalCategory, `${row.rowId}.terminalCategory`);
    categories.add(category);
    gamesSeen.add(gameId);
    periodGames.add(gameId);
    periodVenues.add(venue);
    summary.classifiedTerminalCount += 1;
    increment(summary.categoryCounts, category);

    const hand = VALID_BATTER_HANDS.has(row.normalizedBatterSide)
      ? row.normalizedBatterSide
      : null;
    if (hand === null) {
      summary.handednessUnavailableCount += 1;
      if (unavailableHandExamples.length < 20) {
        unavailableHandExamples.push({
          rowId: row.rowId,
          rawBatterSide: row.rawBatterSide ?? null,
          normalizedBatterSide: row.normalizedBatterSide ?? null,
          includedInPlatoonModel: row.includedInPlatoonModel ?? null,
        });
      }
      continue;
    }

    summary.handednessUsableCount += 1;
    increment(summary.handCounts, hand);
    const key = `${periodId}|${venue}|${hand}`;
    const cell = cellCounts.get(key) ?? {
      periodId,
      venue,
      hand,
      rowCount: 0,
      gameIds: new Set(),
      categoryCounts: {},
    };
    cell.rowCount += 1;
    cell.gameIds.add(gameId);
    increment(cell.categoryCounts, category);
    cellCounts.set(key, cell);
  }

  summary.gameCount = periodGames.size;
  summary.venueCount = periodVenues.size;
  summary.handednessUsableRate =
    summary.classifiedTerminalCount === 0
      ? null
      : summary.handednessUsableCount / summary.classifiedTerminalCount;
  periodSummary[periodId] = summary;
}

const serializedCells = [...cellCounts.values()]
  .map((cell) => ({
    periodId: cell.periodId,
    venue: cell.venue,
    hand: cell.hand,
    rowCount: cell.rowCount,
    gameCount: cell.gameIds.size,
    supportedCategoryCount: Object.values(cell.categoryCounts).filter((count) => count > 0).length,
    categoryCounts: Object.fromEntries(
      Object.entries(cell.categoryCounts).sort(([left], [right]) => left.localeCompare(right)),
    ),
  }))
  .sort(
    (left, right) =>
      left.periodId.localeCompare(right.periodId) ||
      left.rowCount - right.rowCount ||
      left.venue.localeCompare(right.venue) ||
      left.hand.localeCompare(right.hand),
  );

const fitCounts = serializedCells
  .filter((cell) => cell.periodId === 'fit')
  .map((cell) => cell.rowCount)
  .sort((left, right) => left - right);
const validationKeys = new Set(
  serializedCells
    .filter((cell) => cell.periodId === 'validation')
    .map((cell) => `${cell.venue}|${cell.hand}`),
);
const fitKeys = new Set(
  serializedCells
    .filter((cell) => cell.periodId === 'fit')
    .map((cell) => `${cell.venue}|${cell.hand}`),
);
const unseenValidationCells = [...validationKeys]
  .filter((key) => !fitKeys.has(key))
  .sort();

const report = {
  resolvedDatasetPath: RESOLVED_DATASET_PATH,
  resolvedDatasetSha256: dataset.datasetSha256,
  venueLineagePath: VENUE_LINEAGE_PATH,
  venueLineageSha256: lineage.lineageSha256,
  activeSeason: dataset.activeSeason,
  modeledCategoryCount: categories.size,
  modeledCategories: [...categories].sort(),
  joinedGameCount: gamesSeen.size,
  periodSummary,
  fitVenueHandCellCount: fitCounts.length,
  fitVenueHandRowCountDistribution: {
    minimum: fitCounts[0] ?? null,
    p10: percentile(fitCounts, 0.1),
    median: percentile(fitCounts, 0.5),
    p90: percentile(fitCounts, 0.9),
    maximum: fitCounts.at(-1) ?? null,
  },
  validationVenueHandCellCount: validationKeys.size,
  unseenValidationVenueHandCells: unseenValidationCells,
  smallestFitVenueHandCells: serializedCells
    .filter((cell) => cell.periodId === 'fit')
    .slice(0, 20),
  unavailableHandExamples,
  untouchedTestRowsAccessed: false,
};

console.log('=== M8 PARK HANDEDNESS SUPPORT DIAGNOSTIC ===');
console.log(JSON.stringify(report, null, 2));

if (periodSummary.fit.handednessUsableCount === 0) {
  throw new Error('fit period has no L/R batter-side evidence for handedness-specific park fitting.');
}
if (periodSummary.validation.handednessUsableCount === 0) {
  throw new Error('validation period has no L/R batter-side evidence for park evaluation.');
}
if (unseenValidationCells.length > 0) {
  throw new Error('validation contains venue-hand cells absent from fit evidence.');
}

console.log('Handedness-specific park benchmark support ready: true');
console.log('Park coefficient fitted or applied: false');
console.log('Untouched-test rows accessed: false');