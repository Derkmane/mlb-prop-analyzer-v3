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
  BatterHhrPredictorName,
  NormalizedBatterHhrOffer,
  SettledBatterHhrOffer,
} from './contracts.js';
import {
  BATTER_HHR_DISTRIBUTION_BUILDER_VERSION,
  BATTER_HHR_HIT_CATEGORIES,
  BATTER_HHR_MATHEMATICAL_FAMILY,
  BATTER_HHR_MAXIMUM_EXACT_POSTED_LINE,
  BATTER_HHR_MODEL_VERSION,
  BATTER_HHR_PREDICTOR_ORDER,
  BATTER_HHR_TAIL_COLLAPSE_AT,
} from './contracts.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const FORBIDDEN_MODEL_KEYS = new Set(['selectedSide','winProbability','lossProbability','voidProbability','winProbabilityGivenGrades']);
const REQUIRED_INPUTS = [
  'context-adjusted-terminal-outcome-vector','expected-plate-appearances','lineup-slot','platoon-split-cell',
  'opposing-starter-pooling','team-implied-run-total','preceding-lineup-slots-on-base-quality',
] as const;
// This convergence threshold is the second-smallest positive binary64 value.
// It discards no recurrence term larger than the minimum positive subnormal and
// is not used as a tolerance for the analytic-tail validity guard.
const BATTER_HHR_TAIL_TERM_EPSILON = Number.MIN_VALUE * 2;
const BATTER_HHR_MAXIMUM_TAIL_EXTENSION_TERMS = 4096;

function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
  return value;
}
function assertPositive(value: number, label: string): number {
  if (!(assertFinite(value, label) > 0)) throw new RangeError(`${label} must be positive.`);
  return value;
}
function assertSha256(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) throw new Error(`${label} must be a lowercase SHA-256 value.`);
}
function assertNoForbiddenModelKeys(value: unknown, path = 'artifact'): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach((entry, index) => assertNoForbiddenModelKeys(entry, `${path}[${index}]`)); return; }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_MODEL_KEYS.has(key)) throw new Error(`${path}.${key} is prohibited in a side-independent model artifact.`);
    assertNoForbiddenModelKeys(entry, `${path}.${key}`);
  }
}

export function validateBatterHhrDirectCompositeArtifact(
  artifact: BatterHhrDirectCompositeArtifact,
): BatterHhrDirectCompositeArtifact {
  if (artifact.artifactVersion !== 2 || artifact.modelVersion !== BATTER_HHR_MODEL_VERSION) throw new Error('Batter HHR artifact identity mismatch.');
  if (artifact.distributionBuilderVersion !== BATTER_HHR_DISTRIBUTION_BUILDER_VERSION) throw new Error('Batter HHR distributionBuilderVersion mismatch.');
  if (artifact.mathematicalFamily !== BATTER_HHR_MATHEMATICAL_FAMILY || artifact.officialSettlementStatistic !== 'hits+runs+rbis') throw new Error('Batter HHR mathematical contract mismatch.');
  if (artifact.activeSeason !== 2026 || artifact.productionEnabled !== false || artifact.validationStatus !== 'not-production-validated') throw new Error('Batter HHR artifact must remain disabled and not production validated.');
  if (artifact.fittingMethod !== 'negative-binomial-log-link-irls-offset-v1') throw new Error('Batter HHR fitting method mismatch.');
  if (artifact.fittingDetails.expectedPlateAppearancesRole !== 'offset' || artifact.fittingDetails.expectedPlateAppearancesCoefficient !== 1) throw new Error('Batter HHR expected PA must be a fixed unit offset.');
  if (artifact.fittingDetails.coefficientScale !== 'standardized-per-sample-standard-deviation') throw new Error('Batter HHR coefficient scale must be explicit and standardized.');
  if (artifact.fittingDetails.independentMarginalConvolution !== false || artifact.fittingDetails.tripleJointFormed !== false || artifact.fittingDetails.monteCarloRuntime !== false) throw new Error('Batter HHR Family B runtime contract mismatch.');
  if (JSON.stringify(artifact.usedConditioningInputs) !== JSON.stringify(REQUIRED_INPUTS) || artifact.excludedConditioningInputs.length !== 0) throw new Error('Batter HHR must use all seven canonical conditioning inputs.');
  assertFinite(artifact.coefficients.intercept, 'artifact intercept');
  for (const predictor of BATTER_HHR_PREDICTOR_ORDER) {
    assertFinite(artifact.coefficients[predictor], `artifact coefficient ${predictor}`);
    const transform = artifact.predictorTransforms[predictor];
    assertFinite(transform.mean, `artifact transform mean ${predictor}`);
    assertPositive(transform.standardDeviation, `artifact transform standard deviation ${predictor}`);
    if (artifact.fittingDetails.predictorStandardDeviations[predictor] !== transform.standardDeviation) throw new Error(`Batter HHR predictor SD drift for ${predictor}.`);
  }
  assertPositive(artifact.dispersionAlpha, 'artifact dispersionAlpha');
  if (artifact.tailCollapseAt !== BATTER_HHR_TAIL_COLLAPSE_AT || artifact.maximumExactPostedLine !== BATTER_HHR_MAXIMUM_EXACT_POSTED_LINE) throw new Error('Batter HHR exact-settlement support mismatch.');
  if (artifact.calibrationStatus !== 'step-3-required' || artifact.boxScoreVerificationStatus !== 'step-3-required') throw new Error('Batter HHR step-3 gates must remain open.');
  if (artifact.fitEvidence.provider !== 'BALLDONTLIE MLB API' || artifact.fitEvidence.activeSeason !== 2026 || artifact.fitEvidence.seasonType !== 'regular' || artifact.fitEvidence.gameCount <= 0 || artifact.fitEvidence.rowCount <= 0 || artifact.fitEvidence.excludedRowCount < 0) throw new Error('Batter HHR fit evidence is incomplete.');
  if (artifact.providerBoardEvidence.provider !== 'The Odds API' || artifact.providerBoardEvidence.bookmaker !== 'underdog' || artifact.providerBoardEvidence.region !== 'us_dfs' || artifact.providerBoardEvidence.baselineMarketKey !== 'batter_hits_runs_rbis' || artifact.providerBoardEvidence.alternateMarketKey !== 'batter_hits_runs_rbis_alternate') throw new Error('Batter HHR provider-board evidence mismatch.');
  assertSha256(artifact.fitEvidence.sourceFixtureSha256, 'fit fixture SHA-256');
  assertSha256(artifact.fitEvidence.diagnosticsSha256, 'diagnostics SHA-256');
  assertSha256(artifact.providerBoardEvidence.sourceFixtureSha256, 'board fixture SHA-256');
  assertSha256(artifact.artifactSha256, 'artifact SHA-256');
  assertNoForbiddenModelKeys(artifact);
  return artifact;
}

function negativeBinomialSettlementDistribution(mean: number, dispersionAlpha: number) {
  const size = 1 / dispersionAlpha;
  const successProbability = size / (size + mean);
  const continuationProbability = mean / (size + mean);
  const probabilities: number[] = [successProbability ** size];
  let cumulative = probabilities[0] ?? 0;
  for (let count = 1; count < BATTER_HHR_TAIL_COLLAPSE_AT; count += 1) {
    const previous = probabilities[count - 1];
    if (previous === undefined) throw new Error('Batter HHR recurrence indexing failure.');
    const mass = previous * ((count - 1 + size) / count) * continuationProbability;
    if (!Number.isFinite(mass) || mass < 0) throw new Error('Batter HHR negative-binomial recurrence failed.');
    probabilities.push(mass);
    cumulative += mass;
  }
  let previous = probabilities[BATTER_HHR_TAIL_COLLAPSE_AT - 1];
  if (previous === undefined) throw new Error('Batter HHR recurrence indexing failure.');
  let tail = 0;
  let tailConverged = false;
  for (let extension = 0; extension < BATTER_HHR_MAXIMUM_TAIL_EXTENSION_TERMS; extension += 1) {
    const count = BATTER_HHR_TAIL_COLLAPSE_AT + extension;
    const mass = previous * ((count - 1 + size) / count) * continuationProbability;
    if (!Number.isFinite(mass) || mass < 0) throw new Error('Batter HHR negative-binomial recurrence failed.');
    if (mass < BATTER_HHR_TAIL_TERM_EPSILON) {
      tailConverged = true;
      break;
    }
    tail += mass;
    previous = mass;
  }
  if (!tailConverged) throw new Error('Batter HHR analytic tail extension did not converge.');
  if (!Number.isFinite(tail) || tail < 0 || tail > 1) throw new Error('Batter HHR analytic tail mass is invalid.');
  probabilities.push(tail);
  return createProbabilityMassFunction(probabilities, 'Batter HHR direct negative-binomial settlement distribution');
}

function logit(value: number): number {
  const probability = Math.min(1 - 1e-12, Math.max(1e-12, value));
  return Math.log(probability / (1 - probability));
}
function standardized(artifact: BatterHhrDirectCompositeArtifact, predictor: BatterHhrPredictorName, value: number): number {
  const transform = artifact.predictorTransforms[predictor];
  return (assertFinite(value, `Batter HHR ${predictor}`) - transform.mean) / transform.standardDeviation;
}

export function buildBatterHhrDirectCompositeDistribution(
  artifactInput: BatterHhrDirectCompositeArtifact,
  input: BatterHhrDistributionInput,
): BatterHhrDirectCompositeDistribution {
  const artifact = validateBatterHhrDirectCompositeArtifact(artifactInput);
  const vector = validatePerPaOutcomeVector(input.contextAdjustedTerminalOutcomeVector, input.terminalOutcomeCategories, 'Batter HHR context-adjusted terminal outcome vector');
  const expectedPlateAppearances = assertPositive(input.expectedPlateAppearances, 'Batter HHR expectedPlateAppearances');
  if (!Number.isInteger(input.lineupSlot) || input.lineupSlot < 1 || input.lineupSlot > 9) throw new RangeError('Batter HHR lineupSlot must be an integer from 1 through 9.');
  const contextHitQualityLogit = logit(sumPerPaOutcomeProbability(vector, BATTER_HHR_HIT_CATEGORIES, 'Batter HHR terminal-vector Hit probability'));
  const raw: Readonly<Record<BatterHhrPredictorName, number>> = Object.freeze({
    contextHitQualityLogit,
    centeredLineupSlot: (input.lineupSlot - 5) / 4,
    platoonSplitCell: input.platoonSplitCell,
    opposingStarterPooling: input.opposingStarterPooling,
    teamImpliedRunTotal: input.teamImpliedRunTotal,
    precedingLineupSlotsOnBaseQuality: input.precedingLineupSlotsOnBaseQuality,
  });
  const linearPredictor = artifact.coefficients.intercept + BATTER_HHR_PREDICTOR_ORDER.reduce(
    (sum, predictor) => sum + artifact.coefficients[predictor] * standardized(artifact, predictor, raw[predictor]), 0,
  );
  const mean = expectedPlateAppearances * Math.exp(linearPredictor);
  assertPositive(mean, 'Batter HHR fitted mean');
  return Object.freeze({
    modelVersion: BATTER_HHR_MODEL_VERSION,
    distributionBuilderVersion: BATTER_HHR_DISTRIBUTION_BUILDER_VERSION,
    mathematicalFamily: BATTER_HHR_MATHEMATICAL_FAMILY,
    officialSettlementStatistic: 'hits+runs+rbis',
    mean,
    dispersionAlpha: artifact.dispersionAlpha,
    statisticDistribution: negativeBinomialSettlementDistribution(mean, artifact.dispersionAlpha),
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
  if (!Number.isFinite(line) || line < 0 || line > distribution.maximumExactPostedLine) throw new RangeError(`Batter HHR line must be between 0 and ${distribution.maximumExactPostedLine}.`);
  return settleDiscreteStatistic({ statisticDistribution: distribution.statisticDistribution, eligibilityProbability, line, selectedSide });
}

export function settleBatterHhrOffers(
  distribution: BatterHhrDirectCompositeDistribution,
  offers: readonly NormalizedBatterHhrOffer[],
  eligibilityProbability = 1,
): readonly SettledBatterHhrOffer[] {
  return Object.freeze(offers.map((offer) => Object.freeze({
    offer,
    distribution,
    settlement: settleBatterHhrDistribution(distribution, offer.selectedSide, offer.line, eligibilityProbability),
  })));
}
