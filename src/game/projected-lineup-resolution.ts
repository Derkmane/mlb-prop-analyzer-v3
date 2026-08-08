import type { LineupSlot, LineupSourceStatus } from './contracts.js';

export const PROJECTED_LINEUP_LOOKBACK_DAYS = 14;
export const PROJECTED_LINEUP_EXCLUSION_REASON =
  'no-slot-evidence-within-lookback' as const;

export interface CurrentLineupSlotEvidence {
  readonly gameId: string;
  readonly playerId: string;
  readonly teamId: string;
  readonly lineupSlot: LineupSlot;
  readonly sourceCapturedAt: string;
  readonly sourceSnapshotSha256: string;
}

export interface HistoricalCompletedLineupStartEvidence {
  readonly gameId: string;
  readonly gameDateUtc: string;
  readonly playerId: string;
  readonly teamId: string;
  readonly lineupSlot: LineupSlot;
  readonly sourceCapturedAt: string;
  readonly sourceSnapshotSha256: string;
}

export interface ResolveProjectedLineupSlotInput {
  readonly targetGameId: string;
  readonly targetGameDateUtc: string;
  readonly playerId: string;
  readonly teamId: string;
  readonly currentGameEvidence: readonly CurrentLineupSlotEvidence[];
  readonly historicalCompletedStarts: readonly HistoricalCompletedLineupStartEvidence[];
  readonly lookbackDays?: number;
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

function finiteTimestamp(value: string, label: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return timestamp;
}

function positiveLookbackDays(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('lookbackDays must be a positive integer.');
  }
  return value;
}

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
 * confirmation a model input. Current-game provider evidence wins. Otherwise,
 * the latest strictly-earlier completed start inside the approved lookback is
 * the active projected slot. No default or league-average slot exists.
 */
export function resolveProjectedLineupSlot(
  input: Readonly<ResolveProjectedLineupSlotInput>,
): ProjectedLineupSlotResolution {
  const lookbackDays = positiveLookbackDays(
    input.lookbackDays ?? PROJECTED_LINEUP_LOOKBACK_DAYS,
  );
  const targetTimestamp = finiteTimestamp(
    input.targetGameDateUtc,
    'targetGameDateUtc',
  );

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
      sourceGameId: current.gameId,
      sourceGameDateUtc: null,
      sourceCapturedAt: current.sourceCapturedAt,
      sourceSnapshotSha256: current.sourceSnapshotSha256,
    });
  }

  const maximumAgeMilliseconds = lookbackDays * 86_400_000;
  const historical = input.historicalCompletedStarts
    .filter((evidence) => {
      if (!evidenceMatches(evidence, input.playerId, input.teamId)) return false;
      const timestamp = finiteTimestamp(
        evidence.gameDateUtc,
        `historical game ${evidence.gameId} date`,
      );
      const age = targetTimestamp - timestamp;
      return age > 0 && age <= maximumAgeMilliseconds;
    })
    .sort((left, right) => {
      const dateOrder =
        finiteTimestamp(right.gameDateUtc, 'right.gameDateUtc') -
        finiteTimestamp(left.gameDateUtc, 'left.gameDateUtc');
      return dateOrder || right.gameId.localeCompare(left.gameId);
    });

  const latest = historical[0];
  if (latest === undefined) {
    return Object.freeze({
      resolved: false,
      reason: PROJECTED_LINEUP_EXCLUSION_REASON,
    });
  }

  return Object.freeze({
    resolved: true,
    lineupStatus: 'projected',
    lineupSlot: latest.lineupSlot,
    sourceGameId: latest.gameId,
    sourceGameDateUtc: latest.gameDateUtc,
    sourceCapturedAt: latest.sourceCapturedAt,
    sourceSnapshotSha256: latest.sourceSnapshotSha256,
  });
}
