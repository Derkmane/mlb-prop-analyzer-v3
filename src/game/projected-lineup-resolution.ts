import type { LineupSlot, LineupSourceStatus } from './contracts.js';

export const PROJECTED_LINEUP_EXCLUSION_REASON =
  'no-current-or-projected-lineup-slot' as const;

export interface CurrentLineupSlotEvidence {
  readonly gameId: string;
  readonly playerId: string;
  readonly teamId: string;
  readonly lineupSlot: LineupSlot;
  readonly sourceGameId?: string;
  readonly sourceGameDateUtc?: string | null;
  readonly sourceCapturedAt: string;
  readonly sourceSnapshotSha256: string;
}

export interface ProjectedLineupSlotEvidence {
  readonly sourceGameId: string;
  readonly sourceGameDateUtc: string;
  readonly playerId: string;
  readonly teamId: string;
  readonly lineupSlot: LineupSlot;
  readonly sourceCapturedAt: string;
  readonly sourceSnapshotSha256: string;
}

export interface ResolveProjectedLineupSlotInput {
  readonly targetGameId: string;
  readonly playerId: string;
  readonly teamId: string;
  readonly currentGameEvidence: readonly CurrentLineupSlotEvidence[];
  readonly projectedGameEvidence: readonly ProjectedLineupSlotEvidence[];
}

export interface ResolvedLineupSlot {
  readonly resolved: true;
  readonly lineupStatus: LineupSourceStatus;
  readonly lineupSlot: LineupSlot;
  readonly sourceGameId: string;
  readonly sourceGameDateUtc: string | null;
  readonly sourceCapturedAt: string;
  readonly sourceSnapshotSha256: string;
}

export interface UnresolvedLineupSlot {
  readonly resolved: false;
  readonly reason: typeof PROJECTED_LINEUP_EXCLUSION_REASON;
}

export type ProjectedLineupSlotResolution =
  | ResolvedLineupSlot
  | UnresolvedLineupSlot;

function evidenceMatches(
  evidence: Readonly<{
    playerId: string;
    teamId: string;
  }>,
  playerId: string,
  teamId: string,
): boolean {
  return evidence.playerId === playerId && evidence.teamId === teamId;
}

/**
 * Resolves one expected starter's batting-order slot without making lineup
 * confirmation a model input. Exact current-game confirmed evidence wins.
 * Otherwise, the active approved projected-lineup source may supply the slot.
 * No prior-game, default, or league-average slot fallback exists.
 */
export function resolveProjectedLineupSlot(
  input: Readonly<ResolveProjectedLineupSlotInput>,
): ProjectedLineupSlotResolution {
  const currentMatches = input.currentGameEvidence.filter(
    (evidence) =>
      evidence.gameId === input.targetGameId &&
      evidenceMatches(evidence, input.playerId, input.teamId),
  );
  if (currentMatches.length > 1) {
    throw new Error(
      `Current lineup evidence is ambiguous for player ${input.playerId} in game ${input.targetGameId}.`,
    );
  }
  const current = currentMatches[0];
  if (current !== undefined) {
    return Object.freeze({
      resolved: true,
      lineupStatus: 'confirmed',
      lineupSlot: current.lineupSlot,
      sourceGameId: current.sourceGameId ?? current.gameId,
      sourceGameDateUtc: current.sourceGameDateUtc ?? null,
      sourceCapturedAt: current.sourceCapturedAt,
      sourceSnapshotSha256: current.sourceSnapshotSha256,
    });
  }

  const projectedMatches = input.projectedGameEvidence.filter((evidence) =>
    evidenceMatches(evidence, input.playerId, input.teamId),
  );
  if (projectedMatches.length > 1) {
    throw new Error(
      `Projected lineup evidence is ambiguous for player ${input.playerId} in game ${input.targetGameId}.`,
    );
  }
  const projected = projectedMatches[0];
  if (projected === undefined) {
    return Object.freeze({
      resolved: false,
      reason: PROJECTED_LINEUP_EXCLUSION_REASON,
    });
  }

  return Object.freeze({
    resolved: true,
    lineupStatus: 'projected',
    lineupSlot: projected.lineupSlot,
    sourceGameId: projected.sourceGameId,
    sourceGameDateUtc: projected.sourceGameDateUtc,
    sourceCapturedAt: projected.sourceCapturedAt,
    sourceSnapshotSha256: projected.sourceSnapshotSha256,
  });
}
