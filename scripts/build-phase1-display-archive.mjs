import { createHash } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PHASE1_DISPLAY_ARCHIVE_VERSION = 1;
export const PHASE1_DISPLAY_ARCHIVE_CONTRACT = 'phase1-trimmed-board-display-v1';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CAPTURE_KEY_PATTERN = /^\d{8}T\d{9}Z--[a-f0-9]{64}$/u;
const SUPPORTED_MARKETS = new Set(['batter-hits', 'batter-hhr']);

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

function nonemptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  return value;
}

function sha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256.`);
  }
  return value;
}

function isoTimestamp(value, label) {
  nonemptyString(value, label);
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function probability(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${label} must be a finite probability in [0, 1].`);
  }
  return value;
}

function finiteNumberOrNull(value, label) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number or null.`);
  }
  return value;
}

function integerOrNull(value, label) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a safe integer or null.`);
  }
  return value;
}

function stringOrNull(value, label) {
  if (value === null) return null;
  return nonemptyString(value, label);
}

function displayEnrichmentForRows(raw, rows) {
  if (raw === undefined) return undefined;
  const enrichment = object(raw, 'displayEnrichment');
  const source = object(enrichment.byGamePlayerKey, 'displayEnrichment.byGamePlayerKey');
  const selected = {};
  for (const row of rows) {
    const key = `${row.providerGameId}:${row.providerPlayerId}`;
    if (source[key] !== undefined) selected[key] = object(source[key], `displayEnrichment ${key}`);
  }
  return Object.freeze({
    version: enrichment.version,
    contract: nonemptyString(enrichment.contract, 'displayEnrichment.contract'),
    keyFormat: 'providerGameId:providerPlayerId',
    byGamePlayerKey: Object.freeze(selected),
    diagnostics: object(enrichment.diagnostics, 'displayEnrichment.diagnostics'),
  });
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function captureKeyForMarket(market, archive) {
  const value =
    market === 'batter-hits'
      ? object(archive.captureIdentity, 'Batter Hits captureIdentity').captureKey
      : archive.captureKey;
  const captureKey = nonemptyString(value, `${market} captureKey`);
  if (!CAPTURE_KEY_PATTERN.test(captureKey)) {
    throw new Error(`${market} captureKey is not canonical.`);
  }
  return captureKey;
}

function assertProductionDisabled(market, archive) {
  if (market === 'batter-hits') {
    if (archive.productionEnabled !== false || archive.productionRankingEnabled !== false) {
      throw new Error('Batter Hits full archive is not production and ranking disabled.');
    }
    return;
  }
  const safety = object(archive.safety, 'HHR safety');
  if (safety.productionEnabled !== false || safety.rankingEnabled !== false) {
    throw new Error('HHR full archive is not production and ranking disabled.');
  }
}

function oneVersion(rows, readVersion, label) {
  const values = [...new Set(rows.map(readVersion).filter((value) => value !== null && value !== undefined))];
  if (values.length !== 1 || typeof values[0] !== 'string' || values[0].length === 0) {
    throw new Error(`${label} must resolve to exactly one nonempty version.`);
  }
  return values[0];
}

function expectedValueFromPmf(raw, label) {
  if (raw === undefined || raw === null) return null;
  const pmf = object(raw, label);
  const probabilities = array(pmf.probabilities, `${label}.probabilities`);
  let expected = 0;
  probabilities.forEach((value, index) => {
    expected += index * probability(value, `${label}.probabilities[${index}]`);
  });
  return expected;
}

function optionalObject(value, label) {
  if (value === undefined || value === null) return null;
  return object(value, label);
}

function batterHitsFeatureDetails(row, index) {
  const candidate = optionalObject(
    row.candidate,
    `Batter Hits rankedRows[${index}].candidate`,
  );
  if (candidate === null) return null;
  const featureData = optionalObject(
    candidate.featureData,
    `Batter Hits row ${index} featureData`,
  );
  if (featureData === null) return null;
  const values = optionalObject(
    featureData.values,
    `Batter Hits row ${index} featureData.values`,
  );
  if (values === null) return null;
  const detailsEntries = Object.values(values);
  if (detailsEntries.length === 0) return null;
  if (detailsEntries.length !== 1) {
    throw new Error(`Batter Hits row ${index} must have exactly one feature details envelope.`);
  }
  return object(detailsEntries[0], `Batter Hits row ${index} feature details`);
}

function batterHitsAnalysisContext(row, index) {
  const details = batterHitsFeatureDetails(row, index);
  const distribution = optionalObject(
    row.distribution,
    `Batter Hits row ${index} distribution`,
  );
  return Object.freeze({
    expectedPlateAppearances: expectedValueFromPmf(
      distribution?.opportunityDistribution,
      `Batter Hits row ${index} opportunityDistribution`,
    ),
    lineupSlot: finiteNumberOrNull(
      details?.lineupSlot ?? null,
      `Batter Hits row ${index} lineupSlot`,
    ),
    batterSide: stringOrNull(
      details?.batterSide ?? null,
      `Batter Hits row ${index} batterSide`,
    ),
    opposingStarterHand: stringOrNull(
      details?.opposingStarterHand ?? null,
      `Batter Hits row ${index} opposingStarterHand`,
    ),
    venue: null,
    teamImpliedRunTotal: null,
  });
}

function batterHitsDisplayRow(raw, index) {
  const row = object(raw, `Batter Hits rankedRows[${index}]`);
  const offer = object(row.normalizedOffer, `Batter Hits rankedRows[${index}].normalizedOffer`);
  const probabilities = object(row.probabilities, `Batter Hits rankedRows[${index}].probabilities`);
  const lineage = object(row.lineage, `Batter Hits rankedRows[${index}].lineage`);
  if (!Number.isSafeInteger(row.rank) || row.rank <= 0) {
    throw new TypeError(`Batter Hits rankedRows[${index}].rank must be a positive safe integer.`);
  }
  return Object.freeze({
    rank: row.rank,
    providerEventId: nonemptyString(offer.providerEventId, `Batter Hits row ${index} providerEventId`),
    providerGameId: integerOrNull(offer.providerGameId, `Batter Hits row ${index} providerGameId`),
    providerPlayerId: integerOrNull(offer.providerPlayerId, `Batter Hits row ${index} providerPlayerId`),
    providerTeamId: integerOrNull(offer.providerTeamId, `Batter Hits row ${index} providerTeamId`),
    playerName: nonemptyString(offer.playerName, `Batter Hits row ${index} playerName`),
    teamName: nonemptyString(offer.teamName, `Batter Hits row ${index} teamName`),
    homeTeamName: nonemptyString(offer.homeTeamName, `Batter Hits row ${index} homeTeamName`),
    awayTeamName: nonemptyString(offer.awayTeamName, `Batter Hits row ${index} awayTeamName`),
    eventCommenceTime: isoTimestamp(offer.eventCommenceTime, `Batter Hits row ${index} eventCommenceTime`),
    baseMarketKey: nonemptyString(offer.baseMarketKey, `Batter Hits row ${index} baseMarketKey`),
    providerMarketKey: nonemptyString(offer.providerMarketKey, `Batter Hits row ${index} providerMarketKey`),
    marketLabel: 'Batter Hits',
    offerType: nonemptyString(offer.offerType, `Batter Hits row ${index} offerType`),
    settlementStatistic: 'hits',
    selectedSide: nonemptyString(offer.selectedSide, `Batter Hits row ${index} selectedSide`),
    postedLine: finiteNumberOrNull(offer.postedLine, `Batter Hits row ${index} postedLine`),
    americanPrice: finiteNumberOrNull(offer.americanPrice, `Batter Hits row ${index} americanPrice`),
    multiplier: finiteNumberOrNull(offer.multiplier, `Batter Hits row ${index} multiplier`),
    pWin: probability(probabilities.pWin, `Batter Hits row ${index} pWin`),
    pLoss: probability(probabilities.pLoss, `Batter Hits row ${index} pLoss`),
    pVoid: probability(probabilities.pVoid, `Batter Hits row ${index} pVoid`),
    pWinGivenGrades: probability(probabilities.pWinGivenGrades, `Batter Hits row ${index} pWinGivenGrades`),
    lineupStatus: nonemptyString(lineage.lineupStatus, `Batter Hits row ${index} lineupStatus`),
    analysisContext: batterHitsAnalysisContext(row, index),
  });
}

function hhrDisplayRow(raw, gameById, index) {
  const row = object(raw, `HHR rows[${index}]`);
  const game = gameById.get(row.providerGameId);
  if (game === undefined) {
    throw new Error(`HHR rows[${index}] references an unknown providerGameId.`);
  }
  const lineage = object(row.inputLineage, `HHR rows[${index}].inputLineage`);
  return Object.freeze({
    rank: null,
    providerEventId: nonemptyString(row.providerEventId, `HHR row ${index} providerEventId`),
    providerGameId: integerOrNull(row.providerGameId, `HHR row ${index} providerGameId`),
    providerPlayerId: integerOrNull(row.providerPlayerId, `HHR row ${index} providerPlayerId`),
    providerTeamId: integerOrNull(row.providerTeamId, `HHR row ${index} providerTeamId`),
    playerName: nonemptyString(row.playerName, `HHR row ${index} playerName`),
    teamName: nonemptyString(row.teamName, `HHR row ${index} teamName`),
    homeTeamName: nonemptyString(game.homeTeamName, `HHR row ${index} homeTeamName`),
    awayTeamName: nonemptyString(game.awayTeamName, `HHR row ${index} awayTeamName`),
    eventCommenceTime: isoTimestamp(game.date, `HHR row ${index} eventCommenceTime`),
    baseMarketKey: 'batter_hits_runs_rbis',
    providerMarketKey: nonemptyString(row.providerMarketKey, `HHR row ${index} providerMarketKey`),
    marketLabel: 'Batter Hits + Runs + RBIs',
    offerType: nonemptyString(row.offerType, `HHR row ${index} offerType`),
    settlementStatistic: 'hits+runs+rbi',
    selectedSide: nonemptyString(row.selectedSide, `HHR row ${index} selectedSide`),
    postedLine: finiteNumberOrNull(row.postedLine, `HHR row ${index} postedLine`),
    americanPrice: finiteNumberOrNull(row.americanPrice ?? null, `HHR row ${index} americanPrice`),
    multiplier: finiteNumberOrNull(row.multiplier ?? null, `HHR row ${index} multiplier`),
    pWin: probability(row.archivedPWin, `HHR row ${index} pWin`),
    pLoss: probability(row.archivedPLoss, `HHR row ${index} pLoss`),
    pVoid: probability(row.archivedPVoid, `HHR row ${index} pVoid`),
    pWinGivenGrades: probability(row.archivedPWinGivenGrades, `HHR row ${index} pWinGivenGrades`),
    lineupStatus: stringOrNull(row.lineupStatus ?? lineage.lineupStatus ?? null, `HHR row ${index} lineupStatus`),
    analysisContext: Object.freeze({
      expectedPlateAppearances: finiteNumberOrNull(
        lineage.expectedPlateAppearances ?? null,
        `HHR row ${index} expectedPlateAppearances`,
      ),
      lineupSlot: finiteNumberOrNull(lineage.lineupSlot ?? null, `HHR row ${index} lineupSlot`),
      batterSide: stringOrNull(lineage.batterSide ?? null, `HHR row ${index} batterSide`),
      opposingStarterHand: stringOrNull(
        lineage.probableStarterHand ?? null,
        `HHR row ${index} opposingStarterHand`,
      ),
      venue: stringOrNull(game.venue ?? null, `HHR row ${index} venue`),
      teamImpliedRunTotal: finiteNumberOrNull(
        lineage.teamImpliedRunTotal ?? null,
        `HHR row ${index} teamImpliedRunTotal`,
      ),
    }),
  });
}

export function buildPhase1DisplayArchive({ market, fullArchive, fullArchiveFileSha256 }) {
  if (!SUPPORTED_MARKETS.has(market)) {
    throw new Error(`Unsupported display archive market: ${market}`);
  }
  const archive = object(fullArchive, `${market} full archive`);
  assertProductionDisabled(market, archive);
  const captureKey = captureKeyForMarket(market, archive);
  const capturedAt = isoTimestamp(archive.capturedAt, `${market} capturedAt`);
  const captureDateUtc = nonemptyString(archive.captureDateUtc, `${market} captureDateUtc`);
  if (captureDateUtc !== capturedAt.slice(0, 10)) {
    throw new Error(`${market} captureDateUtc does not match capturedAt.`);
  }
  const archiveSha256 = sha256(archive.archiveSha256, `${market} archiveSha256`);
  const fileSha256 = sha256(fullArchiveFileSha256, `${market} fullArchiveFileSha256`);

  let rows;
  let modelVersion;
  let distributionBuilderVersion;
  if (market === 'batter-hits') {
    const sourceRows = array(archive.rankedRows, 'Batter Hits rankedRows');
    rows = Object.freeze(sourceRows.map(batterHitsDisplayRow));
    modelVersion = oneVersion(sourceRows, (row) => row?.lineage?.modelVersion, 'Batter Hits modelVersion');
    distributionBuilderVersion = oneVersion(
      sourceRows,
      (row) => row?.lineage?.distributionBuilderVersion,
      'Batter Hits distributionBuilderVersion',
    );
  } else {
    const games = array(archive.games, 'HHR games').map((game, index) => {
      const value = object(game, `HHR games[${index}]`);
      if (!Number.isSafeInteger(value.gameId)) {
        throw new TypeError(`HHR games[${index}].gameId must be a safe integer.`);
      }
      return value;
    });
    const gameById = new Map(games.map((game) => [game.gameId, game]));
    if (gameById.size !== games.length) {
      throw new Error('HHR games contain duplicate gameId values.');
    }
    const sourceRows = array(archive.rows, 'HHR rows');
    rows = Object.freeze(sourceRows.map((row, index) => hhrDisplayRow(row, gameById, index)));
    modelVersion = oneVersion(sourceRows, (row) => row?.distributionIdentity?.modelVersion, 'HHR modelVersion');
    distributionBuilderVersion = oneVersion(
      sourceRows,
      (row) => row?.distributionIdentity?.distributionBuilderVersion,
      'HHR distributionBuilderVersion',
    );
  }
  if (rows.length === 0) throw new Error(`${market} display archive cannot be empty.`);
  rows = Object.freeze(
    [...rows]
      .sort((left, right) =>
        right.pWinGivenGrades - left.pWinGivenGrades || left.pVoid - right.pVoid,
      )
      .map((row, index) => Object.freeze({ ...row, rank: index + 1 })),
  );

  const displayEnrichment = displayEnrichmentForRows(archive.displayEnrichment, rows);

  return Object.freeze({
    displayArchiveVersion: PHASE1_DISPLAY_ARCHIVE_VERSION,
    displayArchiveContract: PHASE1_DISPLAY_ARCHIVE_CONTRACT,
    market,
    captureKey,
    capturedAt,
    captureDateUtc,
    fullArchiveSha256: archiveSha256,
    fullArchiveFileSha256: fileSha256,
    productionEnabled: false,
    productionRankingEnabled: false,
    modelVersion,
    distributionBuilderVersion,
    ...(displayEnrichment === undefined ? {} : { displayEnrichment }),
    rows,
  });
}

export async function persistImmutablePhase1DisplayArchive({ filePath, displayArchive }) {
  const target = nonemptyString(filePath, 'display filePath');
  const bytes = Buffer.from(`${JSON.stringify(displayArchive, null, 2)}\n`, 'utf8');
  await mkdir(path.dirname(target), { recursive: true });
  const temporaryPath = `${target}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(temporaryPath, 'wx');
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
  try {
    await link(temporaryPath, target);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      throw new Error(`Immutable display archive already exists; duplicate capture identity refused: ${target}`);
    }
    throw error;
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (!(error && typeof error === 'object' && error.code === 'ENOENT')) throw error;
    });
  }
  const persisted = await readFile(target);
  if (!persisted.equals(bytes)) {
    throw new Error(`Persisted display archive bytes failed exact verification: ${target}`);
  }
  return Object.freeze({
    filePath: target,
    byteLength: bytes.length,
    fileSha256: sha256Bytes(bytes),
  });
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 3) {
    throw new Error('Usage: node scripts/build-phase1-display-archive.mjs <batter-hits|batter-hhr> <full-archive-path> <display-output-path>');
  }
  const [market, fullArchivePath, displayOutputPath] = argv;
  const fullBytes = await readFile(fullArchivePath);
  let fullArchive;
  try {
    fullArchive = JSON.parse(fullBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Full archive is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const displayArchive = buildPhase1DisplayArchive({
    market,
    fullArchive,
    fullArchiveFileSha256: sha256Bytes(fullBytes),
  });
  const persisted = await persistImmutablePhase1DisplayArchive({
    filePath: displayOutputPath,
    displayArchive,
  });
  console.log(`DISPLAY MARKET\t${market}`);
  console.log(`DISPLAY CAPTURE KEY\t${displayArchive.captureKey}`);
  console.log(`FULL ARCHIVE SHA-256\t${displayArchive.fullArchiveSha256}`);
  console.log(`FULL ARCHIVE FILE SHA-256\t${displayArchive.fullArchiveFileSha256}`);
  console.log(`DISPLAY ARCHIVE PATH\t${persisted.filePath}`);
  console.log(`DISPLAY ARCHIVE BYTES\t${persisted.byteLength}`);
  console.log(`DISPLAY ARCHIVE FILE SHA-256\t${persisted.fileSha256}`);
  console.log(`DISPLAY ROWS\t${displayArchive.rows.length}`);
  console.log('PRODUCTION\tDISABLED');
  console.log('RANKING\tDISABLED');
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
