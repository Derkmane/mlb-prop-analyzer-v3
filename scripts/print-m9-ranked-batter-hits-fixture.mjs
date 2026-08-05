import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { rankPredictionCandidates } from '../dist/src/application/index.js';
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
const AUTHORIZATION_VERSION = 'm9-ranked-output-fixture-test-only-v1';
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

export async function main(args = process.argv.slice(2)) {
  if (args.length > 1 || (args[0] !== undefined && args[0] !== '--json')) {
    throw new Error(
      'Usage: node scripts/print-m9-ranked-batter-hits-fixture.mjs [--json]',
    );
  }
  const evidence = await buildM9RankedFixtureEvidence();
  process.stdout.write(
    args[0] === '--json'
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
