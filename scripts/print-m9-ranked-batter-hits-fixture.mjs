import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { rankPredictionCandidates } from '../dist/src/application/index.js';
import {
  indicativeImpliedProbabilityFromAmericanPrice,
  selectHighProbabilityAltlinePropsV1,
  selectHighProbabilityBaselinePropsV1,
  selectOpportunityMinerFavoritesV1,
  selectTopFiveV1,
} from '../dist/src/categories/index.js';
import {
  connectFrozenBatterHitsProbabilityOutput,
  PRODUCTION_REGISTRIES,
} from '../dist/src/composition/index.js';
import {
  BATTER_HITS_FEATURE_DATA_FIELD,
  BATTER_HITS_FEATURE_ID,
  BATTER_HITS_MARKET_KEY,
} from '../dist/src/features/batter-hits/index.js';
import {
  m9FinalProbabilityInput,
  m9PregameBoard,
} from '../dist/test/helpers/m9-batter-hits-final-runtime-fixture.js';

const OUTPUT_SCHEMA_VERSION = 1;
const M10_OUTPUT_SCHEMA_VERSION = 1;
const AUTHORIZATION_VERSION = 'm9-ranked-output-fixture-test-only-v1';
const ARCHIVE_CAPTURE_KEY =
  '20260805T160217812Z--235bac8c330999cccfe86b6037a1007eb06f8ec23d1aacdbc3131a70d18db353';
const ARCHIVE_SHA256 =
  'f817216794f98b3c842170507f10fa0c40526f67f1cdc08084188388e5ca5b26';
const ARCHIVE_FILE_SHA256 =
  'a7feb694ee125293aa9e16eadf4bc66085e9d43ea3cc1a9d9721644460c97144';
const ARCHIVE_PRICE_PROJECTION_PATH = path.resolve(
  'fixtures/sanitized/m10/opportunity-miner/20260805T160217812Z--235bac8c-price-projection.json',
);
const ARCHIVE_DIAGNOSTIC_PROJECTION_PATH = path.resolve(
  'fixtures/sanitized/m10/category-output/20260805T160217812Z--235bac8c-diagnostic-projection.json',
);
const TABLE_COLUMNS = Object.freeze([
  'RANK',
  'PLAYER',
  'MARKET',
  'SIDE',
  'LINE',
  'OFFER',
  'P(WIN)',
  'P(LOSS)',
  'P(VOID)',
  'P(WIN|GRADES)',
  'P_BASE [DIAGNOSTIC ONLY]',
  'CONTEXT_DELTA [DIAGNOSTIC ONLY]',
  'MODEL',
  'DISTRIBUTION_BUILDER',
  'SETTLEMENT',
]);
const CATEGORY_TABLE_COLUMNS = Object.freeze([
  'RANK',
  'PLAYER',
  'SIDE',
  'LINE',
  'OFFER TYPE',
  'P(WIN|GRADES)',
  'P(VOID)',
  'P_BASE',
  'CONTEXT_DELTA',
  'AMERICAN PRICE',
  'MULTIPLIER',
  'POSTED IMPLIED PROBABILITY',
  'PRICE EDGE [DIAGNOSTIC ONLY]',
]);

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

function nonemptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  return value;
}

function assertProductionRankingDisabled() {
  const market = PRODUCTION_REGISTRIES.implementedMarkets.find(
    (entry) => entry.baseMarketKey === BATTER_HITS_MARKET_KEY,
  );
  const feature = PRODUCTION_REGISTRIES.features.find(
    (entry) => entry.featureId === BATTER_HITS_FEATURE_ID,
  );
  if (
    market === undefined ||
    feature === undefined ||
    market.status === 'production-enabled' ||
    market.distributionBuilderValidated ||
    feature.enabled ||
    feature.status === 'production-enabled'
  ) {
    throw new Error(
      'The fixture CLI requires the real production Batter Hits market and feature to remain disabled.',
    );
  }
}

export function testOnlyRankingAuthorization(candidates) {
  const first = candidates[0];
  if (first === undefined) {
    throw new Error('The committed fixture board produced no candidates.');
  }
  for (const candidate of candidates) {
    if (
      candidate.baseMarketKey !== BATTER_HITS_MARKET_KEY ||
      candidate.distributionBuilderVersion !==
        first.distributionBuilderVersion ||
      candidate.settlementRuleVersion !== first.settlementRuleVersion
    ) {
      throw new Error(
        'Fixture candidates must share one Batter Hits distribution-builder and settlement-rule version.',
      );
    }
  }

  const settlementRule = Object.freeze({
    version: first.settlementRuleVersion,
    baseMarketKey: BATTER_HITS_MARKET_KEY,
    officialSettlementStatistic: 'hits',
    startRequirement: 'committed fixture-backed CLI test-only authorization',
    minimumParticipation:
      'committed fixture-backed CLI test-only authorization',
    reliefAppearanceHandling: 'not applicable',
    intentionalWalkHandling: 'not applicable',
    tieHandling: 'integer ties void',
    postponementHandling:
      'committed fixture-backed CLI test-only authorization',
    suspensionHandling:
      'committed fixture-backed CLI test-only authorization',
    voidConditions: Object.freeze([
      'committed fixture-backed CLI test-only authorization',
    ]),
    effectiveDate: '2026-01-01',
    ruleSourceReference: AUTHORIZATION_VERSION,
  });

  return Object.freeze({
    implementedMarkets: Object.freeze([
      Object.freeze({
        baseMarketKey: BATTER_HITS_MARKET_KEY,
        providerMarketKeys: Object.freeze([
          'batter_hits',
          'batter_hits_alternate',
        ]),
        featureId: BATTER_HITS_FEATURE_ID,
        officialSettlementStatistic: 'hits',
        mathematicalFamily: 'self-contained-hitter-pa',
        requiredNormalizedInputs: Object.freeze([
          'normalized-batter-hits-offer',
        ]),
        requiredSharedScenarioFields: Object.freeze(['GameScenarioSet']),
        distributionBuilderVersion: first.distributionBuilderVersion,
        distributionBuilderValidated: true,
        settlementRuleVersion: first.settlementRuleVersion,
        status: 'production-enabled',
        blocker: null,
      }),
    ]),
    features: Object.freeze([
      Object.freeze({
        featureId: BATTER_HITS_FEATURE_ID,
        enabled: true,
        status: 'production-enabled',
      }),
    ]),
    settlementRegistry: Object.freeze({
      version: AUTHORIZATION_VERSION,
      rules: Object.freeze([settlementRule]),
    }),
  });
}

function batterHitsDetails(candidate) {
  if (candidate.featureData.featureId !== BATTER_HITS_FEATURE_ID) {
    throw new Error('Ranked candidate does not belong to Batter Hits.');
  }
  const values = object(candidate.featureData.values, 'candidate feature values');
  return object(
    values[BATTER_HITS_FEATURE_DATA_FIELD],
    'candidate Batter Hits details',
  );
}

export function rankedOutputRow(candidate, rank) {
  const details = batterHitsDetails(candidate);
  const offerType = nonemptyString(details.offerType, 'offer type');
  if (offerType !== 'baseline' && offerType !== 'alternate') {
    throw new Error(`Unsupported fixture offer type ${offerType}.`);
  }
  const pBase = finiteNumber(details.pBase, 'p_base');
  const pFinal = finiteNumber(details.pFinal, 'p_final');
  const contextProbabilityDelta = finiteNumber(
    details.contextProbabilityDelta,
    'context probability delta',
  );
  if (pFinal !== candidate.pWinGivenGrades) {
    throw new Error(
      'Candidate pWinGivenGrades must remain the exact final probability exposed by composition.',
    );
  }

  return Object.freeze({
    rank,
    playerName: candidate.playerName,
    market: candidate.marketLabel,
    selectedSide: candidate.selectedSide,
    postedLine: candidate.line,
    offerType,
    pWin: candidate.pWin,
    pLoss: candidate.pLoss,
    pVoid: candidate.pVoid,
    pWinGivenGrades: candidate.pWinGivenGrades,
    diagnosticOnly: Object.freeze({
      label: 'DIAGNOSTIC ONLY',
      pBase,
      contextProbabilityDelta,
    }),
    modelVersion: candidate.modelVersion,
    distributionBuilderVersion: candidate.distributionBuilderVersion,
    settlementVersion: candidate.settlementRuleVersion,
  });
}

export async function buildM9RankedFixtureEvidence() {
  assertProductionRankingDisabled();
  const registryBefore = JSON.stringify(PRODUCTION_REGISTRIES);
  const board = m9PregameBoard();
  const candidateResults = [];
  const fixtureExclusions = [];

  for (const offer of board.offers) {
    const probabilityInput = await m9FinalProbabilityInput(board, offer);
    const result = await connectFrozenBatterHitsProbabilityOutput(
      probabilityInput,
    );
    if (
      result.productionEnabled ||
      result.rankingEnabled ||
      result.hardDiscoveryFilterEnabled
    ) {
      throw new Error(
        'Fixture candidate output must remain production, ranking, and hard-discovery disabled.',
      );
    }
    candidateResults.push(result);
  }

  const candidates = Object.freeze(
    candidateResults.map((result) => result.candidate),
  );
  const ranking = rankPredictionCandidates({
    candidates,
    registries: testOnlyRankingAuthorization(candidates),
  });
  if (ranking.excludedCandidates.length !== 0) {
    throw new Error(
      `The fixture-only ranking authorization excluded ${ranking.excludedCandidates.length} candidates.`,
    );
  }

  assertProductionRankingDisabled();
  if (JSON.stringify(PRODUCTION_REGISTRIES) !== registryBefore) {
    throw new Error('The fixture CLI mutated the production registries.');
  }

  const rows = Object.freeze(
    ranking.rankedCandidates.map((candidate, index) =>
      rankedOutputRow(candidate, index + 1),
    ),
  );
  const frozenFixtureExclusions = Object.freeze(fixtureExclusions);
  if (rows.length + frozenFixtureExclusions.length !== board.offers.length) {
    throw new Error(
      'Every normalized fixture offer must be either ranked or explicitly excluded.',
    );
  }

  const output = Object.freeze({
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    title: 'M9 Ranked Batter Hits Fixture Output',
    productionRankingEnabled: false,
    fixtureBackedEvidence: true,
    liveBoard: false,
    authorizationMode: 'TEST ONLY — EPHEMERAL SNAPSHOT',
    notice:
      'Production ranking is DISABLED. This is committed fixture-backed evidence, not a live board.',
    sourceCapturedAt: board.sourceCapturedAt,
    evaluatedAt: board.asOf,
    normalizedOfferCount: board.offers.length,
    rankedRowCount: rows.length,
    fixtureExclusionCount: frozenFixtureExclusions.length,
    fixtureExclusions: frozenFixtureExclusions,
    rows,
  });

  return Object.freeze({
    output,
    board,
    candidateResults: Object.freeze(candidateResults),
    ranking,
  });
}

function formatProbability(value) {
  return value === null ? 'null' : value.toFixed(12);
}

export function formatM9RankedFixtureTable(output) {
  const lines = [
    output.title,
    'PRODUCTION RANKING: DISABLED',
    'SOURCE: COMMITTED FIXTURE-BACKED EVIDENCE — NOT A LIVE BOARD',
    `AUTHORIZATION: ${output.authorizationMode}`,
    `CAPTURED: ${output.sourceCapturedAt} | EVALUATED: ${output.evaluatedAt}`,
    `NORMALIZED OFFERS: ${output.normalizedOfferCount}`,
    `RANKED OFFERS: ${output.rankedRowCount}`,
    `FIXTURE EXCLUSIONS: ${output.fixtureExclusionCount}`,
    '',
    TABLE_COLUMNS.join('\t'),
  ];

  for (const row of output.rows) {
    lines.push(
      [
        row.rank,
        row.playerName,
        row.market,
        row.selectedSide,
        row.postedLine,
        row.offerType,
        formatProbability(row.pWin),
        formatProbability(row.pLoss),
        formatProbability(row.pVoid),
        formatProbability(row.pWinGivenGrades),
        formatProbability(row.diagnosticOnly.pBase),
        formatProbability(row.diagnosticOnly.contextProbabilityDelta),
        row.modelVersion,
        row.distributionBuilderVersion,
        row.settlementVersion,
      ].join('\t'),
    );
  }

  if (output.fixtureExclusions.length > 0) {
    lines.push('', 'EXCLUDED FIXTURE OFFERS (NOT RANKED)');
    for (const exclusion of output.fixtureExclusions) {
      lines.push(
        [
          exclusion.playerName,
          exclusion.market,
          exclusion.selectedSide,
          exclusion.postedLine,
          exclusion.offerType,
          exclusion.reason,
          exclusion.explanation,
        ].join('\t'),
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

async function readJsonFile(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Unable to read ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return object(parsed, label);
}

function assertExactArchiveIdentity(fixture, label) {
  if (
    fixture.synthetic !== false ||
    fixture.sourceCaptureKey !== ARCHIVE_CAPTURE_KEY ||
    fixture.sourceArchiveSha256 !== ARCHIVE_SHA256 ||
    fixture.sourceFileSha256 !== ARCHIVE_FILE_SHA256
  ) {
    throw new Error(`${label} does not match the exact approved live archive.`);
  }
}

function archiveCategoryCandidate(row, diagnostic) {
  const [
    sourceRank,
    providerEventId,
    providerGameId,
    providerPlayerId,
    playerName,
    offerType,
    selectedSide,
    postedLine,
    americanPrice,
    multiplier,
    pWin,
    pLoss,
    pVoid,
    pWinGivenGrades,
  ] = row;
  if (offerType !== 'baseline' && offerType !== 'alternate') {
    throw new Error(`Unsupported archive offer type at source rank ${sourceRank}.`);
  }
  if (selectedSide !== 'higher' && selectedSide !== 'lower') {
    throw new Error(`Unsupported selected side at source rank ${sourceRank}.`);
  }
  const archivedPWin = finiteNumber(pWin, 'archive pWin');
  const archivedPLoss = finiteNumber(pLoss, 'archive pLoss');
  const archivedPVoid = finiteNumber(pVoid, 'archive pVoid');
  const pFinal = finiteNumber(
    pWinGivenGrades,
    'archive P(Win | grades)',
  );
  if (Math.abs(archivedPWin + archivedPLoss + archivedPVoid - 1) > 1e-12) {
    throw new Error(
      `Archive probabilities do not conserve mass at source rank ${sourceRank}.`,
    );
  }
  const candidate = Object.freeze({
    eventId: nonemptyString(providerEventId, 'provider event ID'),
    gameId: String(providerGameId),
    playerId: String(providerPlayerId),
    playerName: nonemptyString(playerName, 'player name'),
    line: finiteNumber(postedLine, 'posted line'),
    selectedSide,
    eligibilityProbability: 1 - archivedPVoid,
    pWin: archivedPWin,
    pLoss: archivedPLoss,
    pVoid: archivedPVoid,
    pWinGivenGrades: pFinal,
    sourceArchiveRank: sourceRank,
  });
  const postedImpliedProbability =
    indicativeImpliedProbabilityFromAmericanPrice(americanPrice);
  const priceEdge = pFinal - postedImpliedProbability;

  return Object.freeze({
    candidate,
    offerType,
    americanPrice,
    multiplier,
    postedImpliedProbability,
    priceEdge,
    pBase: diagnostic.pBase,
    contextProbabilityDelta: diagnostic.contextProbabilityDelta,
  });
}

async function readArchiveCategoryInputs() {
  const priceProjection = await readJsonFile(
    ARCHIVE_PRICE_PROJECTION_PATH,
    'archive price projection',
  );
  const diagnosticProjection = await readJsonFile(
    ARCHIVE_DIAGNOSTIC_PROJECTION_PATH,
    'archive diagnostic projection',
  );
  assertExactArchiveIdentity(priceProjection, 'Archive price projection');
  assertExactArchiveIdentity(
    diagnosticProjection,
    'Archive diagnostic projection',
  );
  if (
    priceProjection.fixtureVersion !== 1 ||
    priceProjection.evidenceType !== 'real-live-board-archive-price-projection' ||
    diagnosticProjection.fixtureVersion !== 1 ||
    diagnosticProjection.evidenceType !==
      'real-live-board-archive-category-diagnostic-projection'
  ) {
    throw new Error('Unsupported archive category projection version.');
  }
  if (
    !Array.isArray(priceProjection.rows) ||
    !Array.isArray(diagnosticProjection.rows) ||
    priceProjection.rows.length !== diagnosticProjection.rows.length
  ) {
    throw new Error('Archive category projections must have matching rows.');
  }

  const diagnosticsByRank = new Map();
  for (const row of diagnosticProjection.rows) {
    if (!Array.isArray(row) || row.length !== 3) {
      throw new Error('Malformed archive diagnostic projection row.');
    }
    const [rank, pBase, contextProbabilityDelta] = row;
    diagnosticsByRank.set(
      rank,
      Object.freeze({
        pBase: finiteNumber(pBase, 'p_base'),
        contextProbabilityDelta: finiteNumber(
          contextProbabilityDelta,
          'context probability delta',
        ),
      }),
    );
  }

  return Object.freeze(
    priceProjection.rows.map((row) => {
      if (!Array.isArray(row) || row.length !== 14) {
        throw new Error('Malformed archive price projection row.');
      }
      const sourceRank = row[0];
      const diagnostic = diagnosticsByRank.get(sourceRank);
      if (diagnostic === undefined) {
        throw new Error(`Missing diagnostics for source rank ${sourceRank}.`);
      }
      return archiveCategoryCandidate(row, diagnostic);
    }),
  );
}

function outputCategoryRow(input, rank) {
  return Object.freeze({
    rank,
    playerName: input.candidate.playerName,
    selectedSide: input.candidate.selectedSide,
    postedLine: input.candidate.line,
    offerType: input.offerType,
    pWinGivenGrades: input.candidate.pWinGivenGrades,
    pVoid: input.candidate.pVoid,
    pBase: input.pBase,
    contextProbabilityDelta: input.contextProbabilityDelta,
    americanPrice: input.americanPrice,
    multiplier: input.multiplier,
    postedImpliedProbability: input.postedImpliedProbability,
    priceEdgeLabel: 'DIAGNOSTIC ONLY',
    priceEdge: input.priceEdge,
    sourceArchiveRank: input.candidate.sourceArchiveRank,
  });
}

function categoryOutput(categoryId, title, inputs) {
  return Object.freeze({
    categoryId,
    title,
    eligibleCount: inputs.length,
    topFiveCount: Math.min(inputs.length, 5),
    rows: Object.freeze(
      selectTopFiveV1(inputs).map((input, index) =>
        outputCategoryRow(input, index + 1),
      ),
    ),
  });
}

export async function buildM10ArchivedCategoryEvidence() {
  assertProductionRankingDisabled();
  const registryBefore = JSON.stringify(PRODUCTION_REGISTRIES);
  const inputs = await readArchiveCategoryInputs();

  const opportunitySelection = selectOpportunityMinerFavoritesV1(
    inputs.map((input) =>
      Object.freeze({
        candidate: input.candidate,
        americanPrice: input.americanPrice,
        multiplier: input.multiplier,
      }),
    ),
  );
  const bySourceRank = new Map(
    inputs.map((input) => [input.candidate.sourceArchiveRank, input]),
  );
  const opportunityInputs = opportunitySelection.eligibleCandidates.map(
    (candidate) => {
      const input = bySourceRank.get(candidate.sourceArchiveRank);
      if (input === undefined) {
        throw new Error('Opportunity Miner output lost archive row identity.');
      }
      return input;
    },
  );
  const baselineSelection = selectHighProbabilityBaselinePropsV1(inputs);
  const altlineSelection = selectHighProbabilityAltlinePropsV1(inputs);

  assertProductionRankingDisabled();
  if (JSON.stringify(PRODUCTION_REGISTRIES) !== registryBefore) {
    throw new Error('The category CLI mutated the production registries.');
  }

  const categories = Object.freeze([
    categoryOutput(
      opportunitySelection.categoryId,
      'Opportunity Miner Favorites',
      opportunityInputs,
    ),
    categoryOutput(
      baselineSelection.categoryId,
      'High Probability Baseline Props',
      baselineSelection.eligibleCandidates,
    ),
    categoryOutput(
      altlineSelection.categoryId,
      'High Probability Altline Props',
      altlineSelection.eligibleCandidates,
    ),
  ]);

  return Object.freeze({
    output: Object.freeze({
      schemaVersion: M10_OUTPUT_SCHEMA_VERSION,
      title: 'M10 Category Top Five — Real Archived Board',
      sourceCaptureKey: ARCHIVE_CAPTURE_KEY,
      sourceArchiveSha256: ARCHIVE_SHA256,
      sourceFileSha256: ARCHIVE_FILE_SHA256,
      sourceOfferCount: inputs.length,
      productionRankingEnabled: false,
      notice:
        'Production ranking is DISABLED. priceEdge is DIAGNOSTIC ONLY and never affects category order.',
      categories,
    }),
    inputs,
  });
}

export function formatM10ArchivedCategoryTable(output) {
  const lines = [
    output.title,
    'PRODUCTION RANKING: DISABLED',
    `SOURCE CAPTURE: ${output.sourceCaptureKey}`,
    `SOURCE ARCHIVE SHA-256: ${output.sourceArchiveSha256}`,
    `SOURCE OFFERS: ${output.sourceOfferCount}`,
    'PRICE EDGE: DIAGNOSTIC ONLY — NEVER A RANKING OR TIEBREAK QUANTITY',
  ];

  for (const category of output.categories) {
    lines.push(
      '',
      category.title,
      `ELIGIBLE: ${category.eligibleCount} | TOP FIVE RETURNED: ${category.topFiveCount}`,
      CATEGORY_TABLE_COLUMNS.join('\t'),
    );
    for (const row of category.rows) {
      lines.push(
        [
          row.rank,
          row.playerName,
          row.selectedSide,
          row.postedLine,
          row.offerType,
          formatProbability(row.pWinGivenGrades),
          formatProbability(row.pVoid),
          formatProbability(row.pBase),
          formatProbability(row.contextProbabilityDelta),
          row.americanPrice,
          row.multiplier,
          formatProbability(row.postedImpliedProbability),
          formatProbability(row.priceEdge),
        ].join('\t'),
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

export async function main(args = process.argv.slice(2)) {
  const mode = args[0];
  if (
    args.length > 1 ||
    ![undefined, '--json', '--categories', '--categories-json'].includes(mode)
  ) {
    throw new Error(
      'Usage: node scripts/print-m9-ranked-batter-hits-fixture.mjs [--json|--categories|--categories-json]',
    );
  }
  if (mode === '--categories' || mode === '--categories-json') {
    const evidence = await buildM10ArchivedCategoryEvidence();
    process.stdout.write(
      mode === '--categories-json'
        ? `${JSON.stringify(evidence.output, null, 2)}\n`
        : formatM10ArchivedCategoryTable(evidence.output),
    );
    return;
  }

  const evidence = await buildM9RankedFixtureEvidence();
  process.stdout.write(
    mode === '--json'
      ? `${JSON.stringify(evidence.output, null, 2)}\n`
      : formatM9RankedFixtureTable(evidence.output),
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(invokedPath)).href
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
