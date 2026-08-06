import {
  createProbabilityMassFunction,
  settleDiscreteStatistic,
  sumPerPaOutcomeProbability,
  validatePerPaOutcomeVector,
} from '../../core/index.js';
import type { SelectedSide } from '../../domain/selected-side.js';
import type {
  BatterHhrDirectCompositeArtifact,
  BatterHhrDirectCompositeDistribution,
  BatterHhrDistributionInput,
  NormalizedBatterHhrOffer,
  SettledBatterHhrOffer,
} from './contracts.js';
import {
  BATTER_HHR_DISTRIBUTION_BUILDER_VERSION,
  BATTER_HHR_HIT_CATEGORIES,
  BATTER_HHR_MATHEMATICAL_FAMILY,
  BATTER_HHR_MAXIMUM_EXACT_POSTED_LINE,
  BATTER_HHR_MODEL_VERSION,
  BATTER_HHR_TAIL_COLLAPSE_AT,
} from './contracts.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const FORBIDDEN_MODEL_KEYS = new Set([
  'selectedSide',
  'winProbability',
  'lossProbability',
  'voidProbability',
  'winProbabilityGivenGrades',
]);

function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite.`);
  }
  return value;
}

function assertPositive(value: number, label: string): number {
  if (!(assertFinite(value, label) > 0)) {
    throw new RangeError(`${label} must be positive.`);
  }
  return value;
}

function assertSha256(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 value.`);
  }
}

function assertNoForbiddenModelKeys(value: unknown, path = 'artifact'): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoForbiddenModelKeys(entry, `${path}[${index}]`),
    );
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_MODEL_KEYS.has(key)) {
      throw new Error(`${path}.${key} is prohibited in a side-independent model artifact.`);
    }
    assertNoForbiddenModelKeys(entry, `${path}.${key}`);
  }
}

export function validateBatterHhrDirectCompositeArtifact(
  artifact: BatterHhrDirectCompositeArtifact,
): BatterHhrDirectCompositeArtifact {
  if (artifact.artifactVersion !== 1) {
    throw new Error('Batter HHR artifactVersion must equal 1.');
  }
  if (artifact.modelVersion !== BATTER_HHR_MODEL_VERSION) {
    throw new Error('Batter HHR modelVersion mismatch.');
  }
  if (
    artifact.distributionBuilderVersion !==
    BATTER_HHR_DISTRIBUTION_BUILDER_VERSION
  ) {
    throw new Error('Batter HHR distributionBuilderVersion mismatch.');
  }
  if (artifact.mathematicalFamily !== BATTER_HHR_MATHEMATICAL_FAMILY) {
    throw new Error('Batter HHR mathematical family must be directly fitted composite.');
  }
  if (artifact.officialSettlementStatistic !== 'hits+runs+rbis') {
    throw new Error('Batter HHR settlement statistic mismatch.');
  }
  if (
    artifact.activeSeason !== 2026 ||
    artifact.productionEnabled !== false ||
    artifact.validationStatus !== 'not-production-validated'
  ) {
    throw new Error('Batter HHR artifact must remain 2026, production-disabled, and not production validated.');
  }
  if (artifact.fittingMethod !== 'negative-binomial-log-link-irls-v1') {
    throw new Error('Batter HHR fitting method mismatch.');
  }
  if (
    JSON.stringify(artifact.usedConditioningInputs) !==
    JSON.stringify([
      'context-adjusted-terminal-outcome-vector',
      'expected-plate-appearances',
      'lineup-slot',
    ])
  ) {
    throw new Error('Batter HHR used conditioning inputs are not the approved v1 set.');
  }
  if (
    JSON.stringify(artifact.excludedConditioningInputs) !==
    JSON.stringify([
      'platoon-split-cell',
      'opposing-starter-pooling',
      'team-implied-run-total',
      'preceding-lineup-slots-on-base-quality',
    ])
  ) {
    throw new Error('Batter HHR excluded conditioning inputs must be explicit.');
  }

  assertFinite(artifact.coefficients.intercept, 'artifact intercept');
  assertFinite(
    artifact.coefficients.logExpectedPlateAppearances,
    'artifact log-expected-PA coefficient',
  );
  assertFinite(
    artifact.coefficients.terminalHitProbability,
    'artifact terminal-Hit coefficient',
  );
  assertFinite(
    artifact.coefficients.centeredLineupSlot,
    'artifact lineup-slot coefficient',
  );
  assertPositive(artifact.dispersionAlpha, 'artifact dispersionAlpha');
  if (
    artifact.tailCollapseAt !== BATTER_HHR_TAIL_COLLAPSE_AT ||
    artifact.maximumExactPostedLine !==
      BATTER_HHR_MAXIMUM_EXACT_POSTED_LINE
  ) {
    throw new Error('Batter HHR exact-settlement support mismatch.');
  }
  if (
    artifact.calibrationStatus !== 'step-3-required' ||
    artifact.boxScoreVerificationStatus !== 'step-3-required'
  ) {
    throw new Error('Batter HHR step-3 gates must remain open.');
  }
  if (
    artifact.fitEvidence.provider !== 'BALLDONTLIE MLB API' ||
    artifact.fitEvidence.activeSeason !== 2026 ||
    artifact.fitEvidence.seasonType !== 'regular' ||
    artifact.fitEvidence.chronology !== 'strictly-earlier-date-predictors' ||
    artifact.fitEvidence.gameCount <= 0 ||
    artifact.fitEvidence.rowCount <= 0 ||
    artifact.fitEvidence.excludedRowCount < 0
  ) {
    throw new Error('Batter HHR fit evidence is incomplete.');
  }
  if (
    artifact.providerBoardEvidence.provider !== 'The Odds API' ||
    artifact.providerBoardEvidence.bookmaker !== 'underdog' ||
    artifact.providerBoardEvidence.region !== 'us_dfs' ||
    artifact.providerBoardEvidence.baselineMarketKey !==
      'batter_hits_runs_rbis' ||
    artifact.providerBoardEvidence.alternateMarketKey !==
      'batter_hits_runs_rbis_alternate'
  ) {
    throw new Error('Batter HHR provider-board evidence mismatch.');
  }
  assertSha256(
    artifact.fitEvidence.sourceFixtureSha256,
    'fitEvidence.sourceFixtureSha256',
  );
  assertSha256(
    artifact.providerBoardEvidence.sourceFixtureSha256,
    'providerBoardEvidence.sourceFixtureSha256',
  );
  assertSha256(artifact.artifactSha256, 'artifact.artifactSha256');
  assertNoForbiddenModelKeys(artifact);
  return artifact;
}

function negativeBinomialSettlementDistribution(
  mean: number,
  dispersionAlpha: number,
) {
  const size = 1 / dispersionAlpha;
  const successProbability = size / (size + mean);
  const continuationProbability = mean / (size + mean);
  const probabilities: number[] = [successProbability ** size];
  let cumulative = probabilities[0] ?? 0;

  for (
    let count = 1;
    count < BATTER_HHR_TAIL_COLLAPSE_AT;
    count += 1
  ) {
    const previous = probabilities[count - 1];
    if (previous === undefined) {
      throw new Error('Batter HHR recurrence indexing failure.');
    }
    const mass =
      previous *
      ((count - 1 + size) / count) *
      continuationProbability;
    if (!Number.isFinite(mass) || mass < 0) {
      throw new Error('Batter HHR negative-binomial recurrence failed.');
    }
    probabilities.push(mass);
    cumulative += mass;
  }

  const tail = 1 - cumulative;
  if (!Number.isFinite(tail) || tail < 0 || tail > 1) {
    throw new Error('Batter HHR analytic tail mass is invalid.');
  }
  probabilities.push(tail);
  return createProbabilityMassFunction(
    probabilities,
    'Batter HHR direct negative-binomial settlement distribution',
  );
}

export function buildBatterHhrDirectCompositeDistribution(
  artifactInput: BatterHhrDirectCompositeArtifact,
  input: BatterHhrDistributionInput,
): BatterHhrDirectCompositeDistribution {
  const artifact = validateBatterHhrDirectCompositeArtifact(artifactInput);
  const vector = validatePerPaOutcomeVector(
    input.contextAdjustedTerminalOutcomeVector,
    input.terminalOutcomeCategories,
    'Batter HHR context-adjusted terminal outcome vector',
  );
  const expectedPlateAppearances = assertPositive(
    input.expectedPlateAppearances,
    'Batter HHR expectedPlateAppearances',
  );
  if (
    !Number.isInteger(input.lineupSlot) ||
    input.lineupSlot < 1 ||
    input.lineupSlot > 9
  ) {
    throw new RangeError('Batter HHR lineupSlot must be an integer from 1 through 9.');
  }

  const hitProbability = sumPerPaOutcomeProbability(
    vector,
    BATTER_HHR_HIT_CATEGORIES,
    'Batter HHR terminal-vector Hit probability',
  );
  const centeredLineupSlot = (input.lineupSlot - 5) / 4;
  const linearPredictor =
    artifact.coefficients.intercept +
    artifact.coefficients.logExpectedPlateAppearances *
      Math.log(expectedPlateAppearances) +
    artifact.coefficients.terminalHitProbability * hitProbability +
    artifact.coefficients.centeredLineupSlot * centeredLineupSlot;
  const mean = Math.exp(linearPredictor);
  assertPositive(mean, 'Batter HHR fitted mean');

  return Object.freeze({
    modelVersion: BATTER_HHR_MODEL_VERSION,
    distributionBuilderVersion: BATTER_HHR_DISTRIBUTION_BUILDER_VERSION,
    mathematicalFamily: BATTER_HHR_MATHEMATICAL_FAMILY,
    officialSettlementStatistic: 'hits+runs+rbis',
    mean,
    dispersionAlpha: artifact.dispersionAlpha,
    statisticDistribution: negativeBinomialSettlementDistribution(
      mean,
      artifact.dispersionAlpha,
    ),
    tailCollapsedAt: BATTER_HHR_TAIL_COLLAPSE_AT,
    maximumExactPostedLine: BATTER_HHR_MAXIMUM_EXACT_POSTED_LINE,
    productionEnabled: false,
  });
}

export function settleBatterHhrDistribution(
  distribution: BatterHhrDirectCompositeDistribution,
  selectedSide: SelectedSide,
  line: number,
  eligibilityProbability = 1,
) {
  if (
    !Number.isFinite(line) ||
    line < 0 ||
    line > distribution.maximumExactPostedLine
  ) {
    throw new RangeError(
      `Batter HHR line must be between 0 and ${distribution.maximumExactPostedLine}.`,
    );
  }
  return settleDiscreteStatistic({
    statisticDistribution: distribution.statisticDistribution,
    eligibilityProbability,
    line,
    selectedSide,
  });
}

export function settleBatterHhrOffers(
  distribution: BatterHhrDirectCompositeDistribution,
  offers: readonly NormalizedBatterHhrOffer[],
  eligibilityProbability = 1,
): readonly SettledBatterHhrOffer[] {
  return Object.freeze(
    offers.map((offer) =>
      Object.freeze({
        offer,
        distribution,
        settlement: settleBatterHhrDistribution(
          distribution,
          offer.selectedSide,
          offer.line,
          eligibilityProbability,
        ),
      }),
    ),
  );
}
