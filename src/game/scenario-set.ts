import {
  PROBABILITY_TOLERANCE,
  validateProbability,
  validateProbabilityMassFunction,
  validateUnitIntervalVector,
} from '../core/index.js';
import type { ProbabilityMassFunction } from '../domain/probability.js';
import type {
  BullpenScenarioState,
  GameScenario,
  GameScenarioSet,
  HitterPASurvivalState,
  HomeAwayState,
  JointHitterScenarioAssumptions,
  LineupEntryState,
  LineupState,
  SharedOffensiveEnvironmentState,
  SharedOutcomeContext,
  SharedScenarioReference,
  StarterScenarioState,
  TeamOffenseScenarioState,
  TeamSide,
} from './contracts.js';
import {
  expectedHitterPlateAppearances,
  hitterOpportunityCountDistribution,
} from './hitter-opportunity.js';

const GAME_CONSISTENCY_TOLERANCE = 1e-9;

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new RangeError(`${label} must not be empty`);
  }
}

function expectedCount(distribution: ProbabilityMassFunction): number {
  return distribution.probabilities.reduce(
    (sum, probability, count) => sum + probability * count,
    0,
  );
}

function cloneDistribution(
  distribution: ProbabilityMassFunction,
  label: string,
): ProbabilityMassFunction {
  return validateProbabilityMassFunction(distribution, label);
}

function cloneHomeAway(state: HomeAwayState): HomeAwayState {
  assertNonEmpty(state.homeTeamId, 'homeTeamId');
  assertNonEmpty(state.awayTeamId, 'awayTeamId');
  if (state.homeTeamId === state.awayTeamId) {
    throw new RangeError('home and away teams must be different');
  }
  return Object.freeze({ ...state });
}

function cloneLineupEntry(entry: LineupEntryState): LineupEntryState {
  assertNonEmpty(entry.playerId, 'lineup playerId');
  if (
    !Number.isInteger(entry.lineupSlot) ||
    entry.lineupSlot < 1 ||
    entry.lineupSlot > 9
  ) {
    throw new RangeError('lineupSlot must be an integer from 1 through 9');
  }
  return Object.freeze({ ...entry });
}

function cloneLineup(
  lineup: LineupState,
  expectedTeamId: string,
  expectedSide: TeamSide,
): LineupState {
  if (lineup.teamId !== expectedTeamId || lineup.side !== expectedSide) {
    throw new RangeError('lineup identity must match its shared team scenario');
  }
  if (lineup.entries.length !== 9) {
    throw new RangeError('a shared lineup must contain exactly nine batting slots');
  }

  const entries = lineup.entries.map(cloneLineupEntry);
  const slots = new Set(entries.map((entry) => entry.lineupSlot));
  const players = new Set(entries.map((entry) => entry.playerId));
  if (slots.size !== 9 || players.size !== 9) {
    throw new RangeError('lineup slots and player identities must each be unique');
  }

  return Object.freeze({
    teamId: lineup.teamId,
    side: lineup.side,
    entries: Object.freeze(entries),
  });
}

function cloneEnvironment(
  environment: SharedOffensiveEnvironmentState,
): SharedOffensiveEnvironmentState {
  assertNonEmpty(environment.environmentId, 'offensive environmentId');
  assertNonEmpty(environment.version, 'offensive environment version');
  return Object.freeze({ ...environment });
}

function cloneStarter(
  starter: StarterScenarioState,
  expectedOpponentTeamId: string,
): StarterScenarioState {
  if (starter.teamId !== expectedOpponentTeamId) {
    throw new RangeError('opposing starter team must match the opponent');
  }
  assertNonEmpty(starter.pitcherId, 'starter pitcherId');
  assertNonEmpty(starter.workloadVersion, 'starter workloadVersion');
  return Object.freeze({
    ...starter,
    battersFacedDistribution: cloneDistribution(
      starter.battersFacedDistribution,
      'starter batters-faced distribution',
    ),
  });
}

function cloneBullpen(
  bullpen: BullpenScenarioState,
  expectedOpponentTeamId: string,
): BullpenScenarioState {
  if (bullpen.teamId !== expectedOpponentTeamId) {
    throw new RangeError('opposing bullpen team must match the opponent');
  }
  assertNonEmpty(bullpen.workloadVersion, 'bullpen workloadVersion');
  return Object.freeze({
    ...bullpen,
    battersFacedDistribution: cloneDistribution(
      bullpen.battersFacedDistribution,
      'bullpen batters-faced distribution',
    ),
  });
}

function cloneLineupSlotOpportunity(
  state: HitterPASurvivalState,
): HitterPASurvivalState {
  if (
    !Number.isInteger(state.lineupSlot) ||
    state.lineupSlot < 1 ||
    state.lineupSlot > 9
  ) {
    throw new RangeError('opportunity lineupSlot must be an integer from 1 through 9');
  }
  if (
    state.adjustmentMethod !== 'none' &&
    state.adjustmentMethod !== 'weighted-isotonic'
  ) {
    throw new RangeError('unknown survival adjustment method');
  }
  assertNonEmpty(state.adjustmentVersion, 'survival adjustmentVersion');
  if (state.rawSurvival.length !== state.adjustedSurvival.length) {
    throw new RangeError('raw and adjusted survival curves must have equal lengths');
  }

  const rawSurvival = validateUnitIntervalVector(
    state.rawSurvival,
    'raw hitter PA survival',
  );
  const adjustedSurvival = validateUnitIntervalVector(
    state.adjustedSurvival,
    'adjusted hitter PA survival',
  );

  for (let index = 1; index < adjustedSurvival.length; index += 1) {
    const previous = adjustedSurvival[index - 1];
    const current = adjustedSurvival[index];
    if (
      previous === undefined ||
      current === undefined ||
      previous < current
    ) {
      throw new RangeError('adjusted hitter PA survival must be monotone non-increasing');
    }
  }

  return Object.freeze({
    lineupSlot: state.lineupSlot,
    rawSurvival,
    adjustedSurvival,
    adjustmentMethod: state.adjustmentMethod,
    adjustmentVersion: state.adjustmentVersion,
  });
}

function expectedOpponentTeamId(
  side: TeamSide,
  homeAway: HomeAwayState,
): string {
  return side === 'home' ? homeAway.awayTeamId : homeAway.homeTeamId;
}

function expectedOwnTeamId(side: TeamSide, homeAway: HomeAwayState): string {
  return side === 'home' ? homeAway.homeTeamId : homeAway.awayTeamId;
}

function assertExpectedCountsAgree(
  actual: number,
  expected: number,
  message: string,
): void {
  if (Math.abs(actual - expected) > GAME_CONSISTENCY_TOLERANCE) {
    throw new RangeError(`${message}; received ${actual} versus ${expected}`);
  }
}

function cloneTeamScenario(
  team: TeamOffenseScenarioState,
  homeAway: HomeAwayState,
): TeamOffenseScenarioState {
  const ownTeamId = expectedOwnTeamId(team.side, homeAway);
  if (team.teamId !== ownTeamId) {
    throw new RangeError('team scenario identity must match home/away state');
  }

  const opponentTeamId = expectedOpponentTeamId(team.side, homeAway);
  const lineup = cloneLineup(team.lineup, team.teamId, team.side);
  const offensiveEnvironment = cloneEnvironment(team.offensiveEnvironment);
  const opposingStarter = cloneStarter(team.opposingStarter, opponentTeamId);
  const opposingBullpen = cloneBullpen(team.opposingBullpen, opponentTeamId);
  const teamBattersFacedDistribution = cloneDistribution(
    team.teamBattersFacedDistribution,
    'team batters-faced distribution',
  );
  const lineupSlotOpportunities = team.lineupSlotOpportunities.map(
    cloneLineupSlotOpportunity,
  );

  if (lineupSlotOpportunities.length !== 9) {
    throw new RangeError('every batting-order slot must have one shared opportunity curve');
  }

  const opportunityBySlot = new Map(
    lineupSlotOpportunities.map((state) => [state.lineupSlot, state] as const),
  );
  if (opportunityBySlot.size !== 9) {
    throw new RangeError('lineup-slot opportunity identities must be unique');
  }

  for (const entry of lineup.entries) {
    if (!opportunityBySlot.has(entry.lineupSlot)) {
      throw new RangeError('every lineup slot must have a shared opportunity curve');
    }
  }

  const expectedTeamBattersFaced = expectedCount(teamBattersFacedDistribution);
  const expectedFromLineupSlots = lineupSlotOpportunities.reduce(
    (sum, state) => sum + expectedHitterPlateAppearances(state),
    0,
  );
  assertExpectedCountsAgree(
    expectedFromLineupSlots,
    expectedTeamBattersFaced,
    'lineup-slot opportunity expectations must match team batters faced',
  );

  const expectedFromPitchingWorkload =
    expectedCount(opposingStarter.battersFacedDistribution) +
    expectedCount(opposingBullpen.battersFacedDistribution);
  assertExpectedCountsAgree(
    expectedFromPitchingWorkload,
    expectedTeamBattersFaced,
    'starter and bullpen workload expectations must match team batters faced',
  );

  return Object.freeze({
    teamId: team.teamId,
    side: team.side,
    lineup,
    offensiveEnvironment,
    opposingStarter,
    opposingBullpen,
    teamBattersFacedDistribution,
    lineupSlotOpportunities: Object.freeze(lineupSlotOpportunities),
  });
}

function cloneScenario(
  scenario: GameScenario,
  homeAway: HomeAwayState,
): GameScenario {
  assertNonEmpty(scenario.scenarioId, 'scenarioId');
  const weight = validateProbability(scenario.weight, 'scenario weight');
  if (scenario.teams.length !== 2) {
    throw new RangeError('each game scenario must contain home and away team states');
  }

  const home = scenario.teams.find((team) => team.side === 'home');
  const away = scenario.teams.find((team) => team.side === 'away');
  if (home === undefined || away === undefined) {
    throw new RangeError('each game scenario must contain one home and one away team state');
  }

  return Object.freeze({
    scenarioId: scenario.scenarioId,
    weight,
    teams: Object.freeze([
      cloneTeamScenario(home, homeAway),
      cloneTeamScenario(away, homeAway),
    ]) as readonly [TeamOffenseScenarioState, TeamOffenseScenarioState],
  });
}

export function createGameScenarioSet(input: GameScenarioSet): GameScenarioSet {
  assertNonEmpty(input.scenarioSetId, 'scenarioSetId');
  assertNonEmpty(input.version, 'scenario-set version');
  assertNonEmpty(input.gameId, 'gameId');
  if (input.scenarios.length === 0) {
    throw new RangeError('a GameScenarioSet must contain at least one scenario');
  }

  const homeAway = cloneHomeAway(input.homeAway);
  const scenarios = input.scenarios.map((scenario) =>
    cloneScenario(scenario, homeAway),
  );
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.scenarioId));
  if (scenarioIds.size !== scenarios.length) {
    throw new RangeError('scenario IDs must be unique within a GameScenarioSet');
  }

  const totalWeight = scenarios.reduce(
    (sum, scenario) => sum + scenario.weight,
    0,
  );
  if (Math.abs(totalWeight - 1) > PROBABILITY_TOLERANCE) {
    throw new RangeError(`scenario weights must sum to 1; received ${totalWeight}`);
  }

  return Object.freeze({
    scenarioSetId: input.scenarioSetId,
    version: input.version,
    gameId: input.gameId,
    homeAway,
    scenarios: Object.freeze(scenarios),
  });
}

export function expectedCountFromProbabilityMassFunction(
  distribution: ProbabilityMassFunction,
): number {
  return expectedCount(validateProbabilityMassFunction(distribution));
}

export function createSharedScenarioReference(
  scenarioSet: GameScenarioSet,
): SharedScenarioReference {
  return Object.freeze({
    scenarioSetId: scenarioSet.scenarioSetId,
    scenarioSetVersion: scenarioSet.version,
    gameId: scenarioSet.gameId,
  });
}

export class ContradictoryGameScenarioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContradictoryGameScenarioError';
  }
}

export function assertSharedScenarioReference(
  scenarioSet: GameScenarioSet,
  reference: SharedScenarioReference,
): void {
  if (
    reference.scenarioSetId !== scenarioSet.scenarioSetId ||
    reference.scenarioSetVersion !== scenarioSet.version ||
    reference.gameId !== scenarioSet.gameId
  ) {
    throw new ContradictoryGameScenarioError(
      'feature input must reference the exact shared GameScenarioSet',
    );
  }
}

export function deriveJointHitterScenarioAssumptions<TOutcomeAssumption>(
  scenarioSet: GameScenarioSet,
  scenarioId: string,
  teamId: string,
  playerId: string,
  deriveOutcomeAssumption: (
    context: SharedOutcomeContext,
  ) => TOutcomeAssumption,
): JointHitterScenarioAssumptions<TOutcomeAssumption> {
  const scenario = scenarioSet.scenarios.find(
    (candidate) => candidate.scenarioId === scenarioId,
  );
  if (scenario === undefined) {
    throw new RangeError(`unknown shared scenario ${scenarioId}`);
  }

  const team = scenario.teams.find((candidate) => candidate.teamId === teamId);
  if (team === undefined) {
    throw new RangeError(`team ${teamId} is not present in scenario ${scenarioId}`);
  }

  const lineupEntry = team.lineup.entries.find(
    (candidate) => candidate.playerId === playerId,
  );
  if (lineupEntry === undefined) {
    throw new RangeError(`player ${playerId} is not present in the shared lineup`);
  }

  const opportunity = team.lineupSlotOpportunities.find(
    (candidate) => candidate.lineupSlot === lineupEntry.lineupSlot,
  );
  if (opportunity === undefined) {
    throw new RangeError(`lineup slot ${lineupEntry.lineupSlot} has no shared opportunity state`);
  }

  const context: SharedOutcomeContext = Object.freeze({
    scenarioSetId: scenarioSet.scenarioSetId,
    scenarioSetVersion: scenarioSet.version,
    gameId: scenarioSet.gameId,
    scenarioId: scenario.scenarioId,
    teamId: team.teamId,
    offensiveEnvironment: team.offensiveEnvironment,
    opposingStarter: team.opposingStarter,
    opposingBullpen: team.opposingBullpen,
  });

  return Object.freeze({
    scenarioSetId: scenarioSet.scenarioSetId,
    scenarioSetVersion: scenarioSet.version,
    gameId: scenarioSet.gameId,
    scenarioId: scenario.scenarioId,
    teamId: team.teamId,
    playerId: lineupEntry.playerId,
    lineupSlot: lineupEntry.lineupSlot,
    offensiveEnvironmentId: team.offensiveEnvironment.environmentId,
    opportunityCountDistribution: hitterOpportunityCountDistribution(opportunity),
    outcomeAssumption: deriveOutcomeAssumption(context),
  });
}
