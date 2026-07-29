/** Public boundary for the game layer. */
export type {
  BullpenScenarioState,
  GameScenario,
  GameScenarioSet,
  HitterPASurvivalState,
  HomeAwayState,
  JointHitterScenarioAssumptions,
  JointNamedHitterScenarioAssumptions,
  JointPitchingWorkloadPath,
  JointPitchingWorkloadState,
  LineupEntryState,
  LineupSlot,
  LineupSourceStatus,
  LineupState,
  SharedOffensiveEnvironmentState,
  SharedOutcomeContext,
  SharedScenarioReference,
  StarterRetentionState,
  StarterScenarioState,
  SurvivalAdjustmentMethod,
  TeamOffenseScenarioState,
  TeamSide,
} from './contracts.js';
export {
  createHitterPASurvivalState,
  deriveLineupSlotSurvivalFromTeamBattersFaced,
  expectedHitterPlateAppearances,
  hitterOpportunityCountDistribution,
} from './hitter-opportunity.js';
export type { HitterPASurvivalInput } from './hitter-opportunity.js';
export {
  createStarterRetentionState,
  deriveJointNamedHitterScenarioAssumptions,
  deriveNamedHitterOpportunityCountDistribution,
} from './named-hitter-opportunity.js';
export {
  assertSharedScenarioReference,
  ContradictoryGameScenarioError,
  createGameScenarioSet,
  createSharedScenarioReference,
  deriveJointHitterScenarioAssumptions,
  expectedCountFromProbabilityMassFunction,
} from './scenario-set.js';
