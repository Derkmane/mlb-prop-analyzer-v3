import {
  verifyM8_5BatterHitsFactorArtifactV1,
  type M8_5BatterHitsFactorArtifactV1,
  type M8_5TerminalOutcomeProbability,
  type M8_5TerminalOutcomeVectorEffect,
} from './context-factor-contract.js';

export type M8_5BullpenPitcherHand = 'L' | 'R';

export type M8_5TeamBullpenOutcomeResolutionV1 =
  | Readonly<{
      status: 'identity';
      factorKey: 'teamSpecificBullpen';
      modelVersion: string;
      artifactSha256: string;
      opposingPitchingTeamId: number;
      bullpenPitcherHand: M8_5BullpenPitcherHand;
    }>
  | Readonly<{
      status: 'validated';
      factorKey: 'teamSpecificBullpen';
      modelVersion: string;
      artifactSha256: string;
      opposingPitchingTeamId: number;
      bullpenPitcherHand: M8_5BullpenPitcherHand;
      categoryProbabilities: readonly M8_5TerminalOutcomeProbability[];
    }>;

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return Number(value);
}

function pitcherHand(value: unknown): M8_5BullpenPitcherHand {
  if (value !== 'L' && value !== 'R') {
    throw new Error('bullpenPitcherHand must be L or R.');
  }
  return value;
}

function parsedTeamHand(
  effect: M8_5TerminalOutcomeVectorEffect,
): Readonly<{ teamId: number; hand: M8_5BullpenPitcherHand }> {
  if (
    effect.scope !== 'bullpen' ||
    effect.applicationStage !==
      'terminal-outcome-before-statistic-distribution'
  ) {
    throw new Error(
      'team-specific bullpen artifacts may contain only bullpen terminal-outcome effects.',
    );
  }
  const match = /^pitching-team:(\d+)\|pitcher-hand:([LR])$/u.exec(
    effect.matchupKey,
  );
  if (match === null) {
    throw new Error('team-specific bullpen effect matchupKey is invalid.');
  }
  return Object.freeze({
    teamId: positiveInteger(Number(match[1]), 'team-specific bullpen teamId'),
    hand: pitcherHand(match[2]),
  });
}

function validatedEffectMap(
  artifact: M8_5BatterHitsFactorArtifactV1,
): ReadonlyMap<string, M8_5TerminalOutcomeVectorEffect> {
  const map = new Map<string, M8_5TerminalOutcomeVectorEffect>();
  const teams = new Map<number, Set<M8_5BullpenPitcherHand>>();
  for (const effect of artifact.effects) {
    if (effect.kind !== 'terminal-outcome-vector') {
      throw new Error(
        'validated team-specific bullpen artifacts may contain only terminal-outcome-vector effects.',
      );
    }
    const identity = parsedTeamHand(effect);
    const key = `${identity.teamId}|${identity.hand}`;
    if (map.has(key)) {
      throw new Error(`duplicate team-specific bullpen effect ${key}.`);
    }
    map.set(key, effect);
    const hands = teams.get(identity.teamId) ?? new Set<M8_5BullpenPitcherHand>();
    hands.add(identity.hand);
    teams.set(identity.teamId, hands);
  }
  for (const [teamId, hands] of teams) {
    if (!hands.has('L') || !hands.has('R')) {
      throw new Error(
        `team-specific bullpen effects for team ${teamId} must contain both L and R pitcher hands.`,
      );
    }
  }
  if (map.size === 0) {
    throw new Error('validated team-specific bullpen artifact contains no effects.');
  }
  return map;
}

export function resolveM8_5TeamBullpenOutcomeV1(
  rawArtifact: unknown,
  input: Readonly<{
    opposingPitchingTeamId: number;
    bullpenPitcherHand: M8_5BullpenPitcherHand;
  }>,
): M8_5TeamBullpenOutcomeResolutionV1 {
  const artifact = verifyM8_5BatterHitsFactorArtifactV1(rawArtifact);
  if (artifact.factorKey !== 'teamSpecificBullpen') {
    throw new Error('factor artifact is not the teamSpecificBullpen factor.');
  }
  const opposingPitchingTeamId = positiveInteger(
    input.opposingPitchingTeamId,
    'opposingPitchingTeamId',
  );
  const bullpenPitcherHand = pitcherHand(input.bullpenPitcherHand);
  const base = {
    factorKey: 'teamSpecificBullpen' as const,
    modelVersion: artifact.modelVersion,
    artifactSha256: artifact.artifactSha256,
    opposingPitchingTeamId,
    bullpenPitcherHand,
  };

  if (artifact.status === 'disabled') {
    return Object.freeze({ status: 'identity' as const, ...base });
  }

  const effects = validatedEffectMap(artifact);
  const selected = effects.get(
    `${opposingPitchingTeamId}|${bullpenPitcherHand}`,
  );
  if (selected === undefined) {
    throw new Error(
      `team-specific bullpen artifact has no effect for team ${opposingPitchingTeamId} and hand ${bullpenPitcherHand}.`,
    );
  }
  return Object.freeze({
    status: 'validated' as const,
    ...base,
    categoryProbabilities: selected.categoryProbabilities,
  });
}
