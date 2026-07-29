import type { ProbabilityMassFunction } from '../domain/probability.js';

export type TeamSide = 'home' | 'away';

export type LineupSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type LineupSourceStatus = 'projected' | 'confirmed';

export interface HomeAwayState {
  readonly homeTeamId: string;
  readonly awayTeamId: string;
}

export interface LineupEntryState {
  readonly playerId: string;
  readonly lineupSlot: LineupSlot;
}

export interface LineupState {
  readonly teamId: string;
  readonly side: TeamSide;
  /**
   * Source metadata only. Projected and confirmed versions of an otherwise
   * identical lineup must produce identical model distributions and
   * probabilities. Confirmation status is never a probability input.
   */
  readonly sourceStatus?: LineupSourceStatus;
  readonly entries: readonly LineupEntryState[];
}

export interface SharedOffensiveEnvironmentState {
  readonly environmentId: string;
  readonly version: string;
}

export interface StarterScenarioState {
  readonly teamId: string;
  readonly pitcherId: string;
  readonly workloadVersion: string;
  readonly battersFacedDistribution: ProbabilityMassFunction;
}

export interface BullpenScenarioState {
  readonly teamId: string;
  readonly workloadVersion: string;
  readonly battersFacedDistribution: ProbabilityMassFunction;
}

export interface JointPitchingWorkloadPath {
  readonly weight: number;
  readonly starterBattersFaced: number;
  readonly bullpenBattersFaced: number;
}

export interface JointPitchingWorkloadState {
  readonly version: string;
  readonly paths: readonly JointPitchingWorkloadPath[];
}

export type SurvivalAdjustmentMethod = 'none' | 'weighted-isotonic';

/**
 * Opportunity survival for one batting-order slot. This is the number of
 * times the slot comes to the plate, not automatically the number of plate
 * appearances credited to the named starter occupying the slot pregame.
 * Named-player opportunity is derived separately through starter retention.
 *
 * M6 accepts only already-monotone raw curves. The adjusted field is preserved
 * as a separate versioned contract but must equal the raw curve until an
 * evidence-backed projection policy is fitted and validated in M8. The
 * weighted-isotonic method name is reserved for that later validated path and
 * is rejected by the M6 scenario constructor.
 */
export interface HitterPASurvivalState {
  readonly lineupSlot: LineupSlot;
  readonly rawSurvival: readonly number[];
  readonly adjustedSurvival: readonly number[];
  readonly adjustmentMethod: SurvivalAdjustmentMethod;
  readonly adjustmentVersion: string;
}

/**
 * Conditional probability that the named starter still occupies the batting
 * slot for each successive slot turn. Index zero is the first turn and must be
 * exactly 1 because this state is conditional on the player being the active
 * projected or confirmed starter. Pregame eligibility is a separate layer.
 */
export interface StarterRetentionState {
  readonly scenarioSetId: string;
  readonly scenarioSetVersion: string;
  readonly gameId: string;
  readonly scenarioId: string;
  readonly teamId: string;
  readonly lineupSlot: LineupSlot;
  readonly version: string;
  readonly conditionalRetention: readonly number[];
}

export interface TeamOffenseScenarioState {
  readonly teamId: string;
  readonly side: TeamSide;
  readonly lineup: LineupState;
  readonly offensiveEnvironment: SharedOffensiveEnvironmentState;
  readonly opposingStarter: StarterScenarioState;
  readonly opposingBullpen: BullpenScenarioState;
  readonly jointPitchingWorkload: JointPitchingWorkloadState;
  readonly teamBattersFacedDistribution: ProbabilityMassFunction;
  readonly lineupSlotOpportunities: readonly HitterPASurvivalState[];
}

export interface GameScenario {
  readonly scenarioId: string;
  readonly weight: number;
  readonly teams: readonly [TeamOffenseScenarioState, TeamOffenseScenarioState];
}

export interface GameScenarioSet {
  readonly scenarioSetId: string;
  readonly version: string;
  readonly gameId: string;
  readonly homeAway: HomeAwayState;
  readonly scenarios: readonly GameScenario[];
}

export interface SharedScenarioReference {
  readonly scenarioSetId: string;
  readonly scenarioSetVersion: string;
  readonly gameId: string;
}

export interface SharedOutcomeContext {
  readonly scenarioSetId: string;
  readonly scenarioSetVersion: string;
  readonly gameId: string;
  readonly scenarioId: string;
  readonly teamId: string;
  readonly offensiveEnvironment: SharedOffensiveEnvironmentState;
  readonly opposingStarter: StarterScenarioState;
  readonly opposingBullpen: BullpenScenarioState;
  readonly jointPitchingWorkload: JointPitchingWorkloadState;
}

/**
 * Shared slot-level assumptions. opportunityCountDistribution is the batting
 * slot's turn distribution and must not be labeled as the named starter's PA
 * distribution without applying StarterRetentionState.
 */
export interface JointHitterScenarioAssumptions<TOutcomeAssumption> {
  readonly scenarioSetId: string;
  readonly scenarioSetVersion: string;
  readonly gameId: string;
  readonly scenarioId: string;
  readonly teamId: string;
  readonly playerId: string;
  readonly lineupSlot: LineupSlot;
  readonly offensiveEnvironmentId: string;
  readonly opportunityCountDistribution: ProbabilityMassFunction;
  readonly outcomeAssumption: TOutcomeAssumption;
}

export interface JointNamedHitterScenarioAssumptions<TOutcomeAssumption> {
  readonly scenarioSetId: string;
  readonly scenarioSetVersion: string;
  readonly gameId: string;
  readonly scenarioId: string;
  readonly teamId: string;
  readonly playerId: string;
  readonly lineupSlot: LineupSlot;
  readonly offensiveEnvironmentId: string;
  readonly starterRetentionVersion: string;
  readonly slotOpportunityCountDistribution: ProbabilityMassFunction;
  readonly opportunityCountDistribution: ProbabilityMassFunction;
  readonly outcomeAssumption: TOutcomeAssumption;
}
