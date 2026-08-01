import { createHash } from 'node:crypto';

import {
  settleDiscreteStatistic,
  validateProbabilityMassFunction,
} from '../../core/index.js';
import { BATTER_HITS_MARKET_KEY } from './manifest.js';
import type { NormalizedBatterHitsBoardOffer } from './normalized-board-offer.js';
import {
  BATTER_HITS_COMPLETE_CANDIDATE_MODEL_VERSION,
  BATTER_HITS_RUNTIME_DISTRIBUTION_VERSION,
  buildFrozenBatterHitsRuntimeDistribution,
  type BatterHitsRuntimeObservation,
  type FrozenBatterHitsProbabilityArtifacts,
  type FrozenBatterHitsRuntimeDistribution,
} from './runtime-probability.js';

export const M8_BATTER_HITS_BASE_DISTRIBUTION_CONTRACT =
  'm8-batter-hits-base-distribution-v1' as const;
export const M8_BATTER_HITS_BASE_EVALUATION_CONTRACT =
  'm8-batter-hits-base-evaluation-v1' as const;
export const M8_BATTER_HITS_BASE_DISCOVERY_METHOD_VERSION =
  'm8-batter-hits-audit-only-exact-settlement-v1' as const;
export const M8_BATTER_HITS_BASE_DISCOVERY_DECISION =
  'AUDIT_ONLY_UNTHRESHOLDED' as const;

interface M8BatterHitsBaseIdentity {
  readonly providerEventId: string;
  readonly providerGameId: number;
  readonly providerPlayerId: number;
  readonly providerTeamId: number;
  readonly playerName: string;
  readonly teamName: string;
  readonly homeTeamName: string;
  readonly awayTeamName: string;
  readonly eventCommenceTime: string;
  readonly baseMarketKey: typeof BATTER_HITS_MARKET_KEY;
  readonly settlementStatistic: 'hits';
}

interface M8BatterHitsBaseballInputs {
  readonly lineupStatus: BatterHitsRuntimeObservation['lineupStatus'];
  readonly teamSide: BatterHitsRuntimeObservation['teamSide'];
  readonly lineupSlot: BatterHitsRuntimeObservation['lineupSlot'];
  readonly batterSide: BatterHitsRuntimeObservation['batterSide'];
  readonly opposingStarterPitcherId: number;
  readonly opposingStarterTeamId: number;
  readonly opposingStarterHand: BatterHitsRuntimeObservation['opposingStarterHand'];
  readonly eligibilityProbability: 1;
  readonly lineupSourceCapturedAt: string;
  readonly lineupSourceSnapshotSha256: string;
}

interface M8BatterHitsBaseVersions {
  readonly runtimeManifestModelVersion: string;
  readonly modelVersion: typeof BATTER_HITS_COMPLETE_CANDIDATE_MODEL_VERSION;
  readonly distributionBuilderVersion:
    typeof BATTER_HITS_RUNTIME_DISTRIBUTION_VERSION;
  readonly settlementRuleVersion: string;
}

interface M8BatterHitsBaseProvenance {
  readonly boardSourceCapturedAt: string;
  readonly boardSourceSnapshotSha256: string;
  readonly runtimeManifestArtifactSha256: string;
  readonly completeCandidateArtifactSha256: string;
  readonly sharedEnvironmentArtifactSha256: string;
  readonly starterRetentionArtifactSha256: string;
  readonly terminalOutcomeArtifactSha256: string;
}

export interface M8BatterHitsBaseDistributionV1 {
  readonly baseDistributionContract:
    typeof M8_BATTER_HITS_BASE_DISTRIBUTION_CONTRACT;
  readonly evaluatedAt: string;
  readonly productionEnabled: false;
  readonly hardDiscoveryFilterEnabled: false;
  readonly identity: Readonly<M8BatterHitsBaseIdentity>;
  readonly baseballInputs: Readonly<M8BatterHitsBaseballInputs>;
  readonly dBase: FrozenBatterHitsRuntimeDistribution;
  readonly versions: Readonly<M8BatterHitsBaseVersions>;
  readonly provenance: Readonly<M8BatterHitsBaseProvenance>;
  readonly sharedScenarioIdentity: string;
  readonly baseDistributionSha256: string;
}

export interface M8BatterHitsBaseEvaluationProbabilities {
  readonly pWin: number;
  readonly pLoss: number;
  readonly pVoid: number;
  readonly pBase: number | null;
}

export interface M8BatterHitsBaseEvaluationV1 {
  readonly baseEvaluationContract:
    typeof M8_BATTER_HITS_BASE_EVALUATION_CONTRACT;
  readonly productionEnabled: false;
  readonly hardDiscoveryFilterEnabled: false;
  readonly discoveryMethodVersion:
    typeof M8_BATTER_HITS_BASE_DISCOVERY_METHOD_VERSION;
  readonly discoveryDecision:
    typeof M8_BATTER_HITS_BASE_DISCOVERY_DECISION;
  readonly tauSoft: null;
  readonly softnessMargin: null;
  readonly baseDistribution: M8BatterHitsBaseDistributionV1;
  readonly baseDistributionSha256: string;
  readonly sharedScenarioIdentity: string;
  readonly dBase: FrozenBatterHitsRuntimeDistribution;
  readonly offer: Readonly<NormalizedBatterHitsBoardOffer>;
  readonly probabilities: Readonly<M8BatterHitsBaseEvaluationProbabilities>;
  readonly baseEvaluationSha256: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('M8 Batter Hits base evidence must contain JSON values only.');
}

function assertTimestamp(value: string, label: string): void {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new TypeError(`${label} must be a valid timestamp.`);
  }
}

function assertSha256(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 value.`);
  }
}

function assertExact(value: unknown, expected: unknown, label: string): void {
  if (value !== expected) {
    throw new Error(`${label} must equal ${String(expected)}.`);
  }
}

function sharedScenarioIdentity(
  providerGameId: number,
  versions: M8BatterHitsBaseVersions,
  provenance: M8BatterHitsBaseProvenance,
): string {
  return sha256(
    stableJson({
      providerGameId,
      sharedEnvironmentArtifactSha256:
        provenance.sharedEnvironmentArtifactSha256,
      completeCandidateArtifactSha256:
        provenance.completeCandidateArtifactSha256,
      modelVersion: versions.modelVersion,
      distributionBuilderVersion: versions.distributionBuilderVersion,
    }),
  );
}

function baseDistributionIdentity(
  input: Omit<M8BatterHitsBaseDistributionV1, 'baseDistributionSha256'>,
): string {
  return sha256(stableJson(input));
}

function baseEvaluationIdentity(
  input: Omit<M8BatterHitsBaseEvaluationV1, 'baseEvaluationSha256'>,
): string {
  return sha256(stableJson(input));
}

export function createM8BatterHitsBaseDistribution(
  offer: NormalizedBatterHitsBoardOffer,
  observation: BatterHitsRuntimeObservation,
  artifacts: FrozenBatterHitsProbabilityArtifacts,
  evaluatedAt: string,
): M8BatterHitsBaseDistributionV1 {
  assertTimestamp(evaluatedAt, 'base evaluation timestamp');
  const dBase = buildFrozenBatterHitsRuntimeDistribution(
    offer,
    observation,
    artifacts,
  );
  const identity = Object.freeze({
    providerEventId: offer.providerEventId,
    providerGameId: offer.providerGameId,
    providerPlayerId: offer.providerPlayerId,
    providerTeamId: offer.providerTeamId,
    playerName: offer.playerName,
    teamName: offer.teamName,
    homeTeamName: offer.homeTeamName,
    awayTeamName: offer.awayTeamName,
    eventCommenceTime: offer.eventCommenceTime,
    baseMarketKey: BATTER_HITS_MARKET_KEY,
    settlementStatistic: 'hits' as const,
  });
  const baseballInputs = Object.freeze({
    lineupStatus: observation.lineupStatus,
    teamSide: observation.teamSide,
    lineupSlot: observation.lineupSlot,
    batterSide: observation.batterSide,
    opposingStarterPitcherId: observation.opposingStarterPitcherId,
    opposingStarterTeamId: observation.opposingStarterTeamId,
    opposingStarterHand: observation.opposingStarterHand,
    eligibilityProbability: observation.eligibilityProbability,
    lineupSourceCapturedAt: observation.lineupSourceCapturedAt,
    lineupSourceSnapshotSha256: observation.lineupSourceSnapshotSha256,
  });
  const versions = Object.freeze({
    runtimeManifestModelVersion: artifacts.runtimeManifest.modelVersion,
    modelVersion: artifacts.completeCandidate.modelVersion,
    distributionBuilderVersion: dBase.distributionBuilderVersion,
    settlementRuleVersion: artifacts.runtimeManifest.settlementVersion,
  });
  const provenance = Object.freeze({
    boardSourceCapturedAt: offer.sourceCapturedAt,
    boardSourceSnapshotSha256: offer.sourceSnapshotSha256,
    runtimeManifestArtifactSha256: artifacts.runtimeManifest.artifactSha256,
    completeCandidateArtifactSha256: artifacts.completeCandidate.artifactSha256,
    sharedEnvironmentArtifactSha256:
      artifacts.sharedEnvironment.artifactSha256,
    starterRetentionArtifactSha256:
      artifacts.starterRetention.artifactSha256,
    terminalOutcomeArtifactSha256: artifacts.terminalOutcome.artifactSha256,
  });
  const withoutHash = Object.freeze({
    baseDistributionContract: M8_BATTER_HITS_BASE_DISTRIBUTION_CONTRACT,
    evaluatedAt,
    productionEnabled: false as const,
    hardDiscoveryFilterEnabled: false as const,
    identity,
    baseballInputs,
    dBase,
    versions,
    provenance,
    sharedScenarioIdentity: sharedScenarioIdentity(
      offer.providerGameId,
      versions,
      provenance,
    ),
  });
  return Object.freeze({
    ...withoutHash,
    baseDistributionSha256: baseDistributionIdentity(withoutHash),
  });
}

export function verifyM8BatterHitsBaseDistribution(
  rawBaseDistribution: M8BatterHitsBaseDistributionV1,
): M8BatterHitsBaseDistributionV1 {
  assertExact(
    rawBaseDistribution.baseDistributionContract,
    M8_BATTER_HITS_BASE_DISTRIBUTION_CONTRACT,
    'base distribution contract',
  );
  assertExact(
    rawBaseDistribution.productionEnabled,
    false,
    'base distribution productionEnabled',
  );
  assertExact(
    rawBaseDistribution.hardDiscoveryFilterEnabled,
    false,
    'base distribution hardDiscoveryFilterEnabled',
  );
  assertTimestamp(rawBaseDistribution.evaluatedAt, 'base evaluation timestamp');
  assertExact(
    rawBaseDistribution.identity.baseMarketKey,
    BATTER_HITS_MARKET_KEY,
    'base distribution market key',
  );
  assertExact(
    rawBaseDistribution.identity.settlementStatistic,
    'hits',
    'base distribution settlement statistic',
  );
  assertExact(
    rawBaseDistribution.versions.modelVersion,
    BATTER_HITS_COMPLETE_CANDIDATE_MODEL_VERSION,
    'base distribution model version',
  );
  assertExact(
    rawBaseDistribution.versions.distributionBuilderVersion,
    BATTER_HITS_RUNTIME_DISTRIBUTION_VERSION,
    'base distribution builder version',
  );
  assertExact(
    rawBaseDistribution.dBase.distributionBuilderVersion,
    BATTER_HITS_RUNTIME_DISTRIBUTION_VERSION,
    'D_base distribution builder version',
  );
  validateProbabilityMassFunction(
    rawBaseDistribution.dBase.statisticDistribution,
    'M8 Batter Hits D_base statistic distribution',
  );
  assertSha256(
    rawBaseDistribution.baseDistributionSha256,
    'base distribution SHA-256',
  );
  assertSha256(
    rawBaseDistribution.sharedScenarioIdentity,
    'shared scenario identity',
  );
  const {
    baseDistributionSha256,
    ...withoutHash
  } = rawBaseDistribution;
  const expectedHash = baseDistributionIdentity(withoutHash);
  assertExact(
    baseDistributionSha256,
    expectedHash,
    'base distribution SHA-256',
  );
  assertExact(
    rawBaseDistribution.sharedScenarioIdentity,
    sharedScenarioIdentity(
      rawBaseDistribution.identity.providerGameId,
      rawBaseDistribution.versions,
      rawBaseDistribution.provenance,
    ),
    'shared scenario identity',
  );
  return rawBaseDistribution;
}

function assertOfferMatchesBaseDistribution(
  offer: NormalizedBatterHitsBoardOffer,
  baseDistribution: M8BatterHitsBaseDistributionV1,
): void {
  assertExact(
    offer.providerEventId,
    baseDistribution.identity.providerEventId,
    'offer/base event ID',
  );
  assertExact(
    offer.providerGameId,
    baseDistribution.identity.providerGameId,
    'offer/base game ID',
  );
  assertExact(
    offer.providerPlayerId,
    baseDistribution.identity.providerPlayerId,
    'offer/base player ID',
  );
  assertExact(
    offer.providerTeamId,
    baseDistribution.identity.providerTeamId,
    'offer/base team ID',
  );
  assertExact(
    offer.playerName,
    baseDistribution.identity.playerName,
    'offer/base player name',
  );
  assertExact(
    offer.teamName,
    baseDistribution.identity.teamName,
    'offer/base team name',
  );
  assertExact(
    offer.baseMarketKey,
    baseDistribution.identity.baseMarketKey,
    'offer/base market key',
  );
}

export function settleM8BatterHitsBaseOffer(
  rawBaseDistribution: M8BatterHitsBaseDistributionV1,
  offer: NormalizedBatterHitsBoardOffer,
): M8BatterHitsBaseEvaluationV1 {
  const baseDistribution = verifyM8BatterHitsBaseDistribution(
    rawBaseDistribution,
  );
  assertOfferMatchesBaseDistribution(offer, baseDistribution);
  const settlement = settleDiscreteStatistic({
    statisticDistribution: validateProbabilityMassFunction(
      baseDistribution.dBase.statisticDistribution,
      'M8 Batter Hits D_base statistic distribution',
    ),
    eligibilityProbability:
      baseDistribution.baseballInputs.eligibilityProbability,
    line: offer.line,
    selectedSide: offer.selectedSide,
  });
  const probabilities = Object.freeze({
    pWin: settlement.winProbability,
    pLoss: settlement.lossProbability,
    pVoid: settlement.voidProbability,
    pBase: settlement.winProbabilityGivenGrades,
  });
  const withoutHash = Object.freeze({
    baseEvaluationContract: M8_BATTER_HITS_BASE_EVALUATION_CONTRACT,
    productionEnabled: false as const,
    hardDiscoveryFilterEnabled: false as const,
    discoveryMethodVersion:
      M8_BATTER_HITS_BASE_DISCOVERY_METHOD_VERSION,
    discoveryDecision: M8_BATTER_HITS_BASE_DISCOVERY_DECISION,
    tauSoft: null,
    softnessMargin: null,
    baseDistribution,
    baseDistributionSha256: baseDistribution.baseDistributionSha256,
    sharedScenarioIdentity: baseDistribution.sharedScenarioIdentity,
    dBase: baseDistribution.dBase,
    offer: Object.freeze({ ...offer }),
    probabilities,
  });
  return Object.freeze({
    ...withoutHash,
    baseEvaluationSha256: baseEvaluationIdentity(withoutHash),
  });
}

export function createM8BatterHitsBaseEvaluation(
  offer: NormalizedBatterHitsBoardOffer,
  observation: BatterHitsRuntimeObservation,
  artifacts: FrozenBatterHitsProbabilityArtifacts,
  evaluatedAt: string,
): M8BatterHitsBaseEvaluationV1 {
  return settleM8BatterHitsBaseOffer(
    createM8BatterHitsBaseDistribution(
      offer,
      observation,
      artifacts,
      evaluatedAt,
    ),
    offer,
  );
}
