/** Public boundary for the game layer. */
export type {
  BullpenScenarioState,
  GameScenario,
  GameScenarioSet,
  HitterPASurvivalState,
  HomeAwayState,
  JointHitterScenarioAssumptions,
  LineupEntryState,
  LineupSlot,
  LineupState,
  SharedOffensiveEnvironmentState,
  SharedOutcomeContext,
  SharedScenarioReference,
  StarterScenarioState,
  SurvivalAdjustmentMethod,
  SurvivalMonotonicityPolicy,
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
  assertSharedScenarioReference,
  ContradictoryGameScenarioError,
  createGameScenarioSet,
  createSharedScenarioReference,
  deriveJointHitterScenarioAssumptions,
  expectedCountFromProbabilityMassFunction,
} from './scenario-set.js';
