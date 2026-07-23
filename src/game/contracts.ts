import type { ProbabilityMassFunction } from '../domain/probability.js';

export type TeamSide = 'home' | 'away';

export type LineupSlot = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

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

export type SurvivalAdjustmentMethod = 'none' | 'weighted-isotonic';

export interface HitterPASurvivalState {
  readonly playerId: string;
  readonly lineupSlot: LineupSlot;
  readonly rawSurvival: readonly number[];
  readonly adjustedSurvival: readonly number[];
  readonly adjustmentMethod: SurvivalAdjustmentMethod;
  readonly adjustmentVersion: string;
}

export interface TeamOffenseScenarioState {
  readonly teamId: string;
  readonly side: TeamSide;
  readonly lineup: LineupState;
  readonly offensiveEnvironment: SharedOffensiveEnvironmentState;
  readonly opposingStarter: StarterScenarioState;
  readonly opposingBullpen: BullpenScenarioState;
  readonly teamBattersFacedDistribution: ProbabilityMassFunction;
  readonly hitterOpportunities: readonly HitterPASurvivalState[];
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
}

export interface JointHitterScenarioAssumptions<TOutcomeAssumption> {
  readonly scenarioSetId: string;
  readonly scenarioSetVersion: string;
  readonly gameId: string;
  readonly scenarioId: string;
  readonly teamId: string;
  readonly playerId: string;
  readonly offensiveEnvironmentId: string;
  readonly opportunityCountDistribution: ProbabilityMassFunction;
  readonly outcomeAssumption: TOutcomeAssumption;
}
