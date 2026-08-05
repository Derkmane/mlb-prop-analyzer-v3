import type { BallDontLieOfficialFinalHitsEvidenceV1 } from '../adapters/providers/balldontlie/index.js';
import {
  settleObservedDiscreteStatisticV1,
  type ObservedSettlementOutcome,
} from '../core/index.js';
import type {
  SavedRunCategoryId,
  SavedRunPickSnapshotV1,
  SavedRunSnapshotV1,
} from '../domain/saved-run.js';
import type { SelectedSide } from '../domain/selected-side.js';

export const SAVED_RUN_HITS_GRADING_VERSION =
  'm10-saved-run-batter-hits-grading-v1' as const;

export interface SavedRunGradeSummaryV1 {
  readonly graded: number;
  readonly wins: number;
  readonly losses: number;
  readonly voids: number;
  readonly winRateGivenGrades: number | null;
}

export interface SavedRunPickGradeV1 {
  readonly runId: string;
  readonly snapshotId: string;
  readonly categoryId: SavedRunCategoryId;
  readonly categoryRank: number;
  readonly playerName: string;
  readonly providerGameId: number;
  readonly providerPlayerId: number;
  readonly selectedSide: SelectedSide;
  readonly line: number;
  readonly officialHits: number;
  readonly outcome: ObservedSettlementOutcome;
  readonly archivedPWin: number;
  readonly archivedPLoss: number;
  readonly archivedPVoid: number;
  readonly archivedPWinGivenGrades: number | null;
  readonly modelVersion: string;
  readonly distributionBuilderVersion: string;
  readonly archivedSettlementRuleVersion: string;
  readonly observedSettlementVersion: string;
  readonly evidenceVersion: string;
  readonly gameSnapshotId: string;
  readonly gameSnapshotSha256: string;
  readonly statsSnapshotId: string;
  readonly statsSnapshotSha256: string;
}

export interface SavedRunCategoryGradeV1 {
  readonly categoryId: SavedRunCategoryId;
  readonly summary: SavedRunGradeSummaryV1;
  readonly picks: readonly SavedRunPickGradeV1[];
}

export interface SavedRunGradeReportV1 {
  readonly schemaVersion: 1;
  readonly gradingVersion: typeof SAVED_RUN_HITS_GRADING_VERSION;
  readonly runId: string;
  readonly savedAt: string;
  readonly gradedAt: string;
  readonly provider: 'balldontlie-mlb';
  readonly productionEnabled: false;
  readonly rankingEnabled: false;
  readonly summary: SavedRunGradeSummaryV1;
  readonly categories: readonly SavedRunCategoryGradeV1[];
}

function identityKey(providerGameId: number, providerPlayerId: number): string {
  return `${providerGameId}:${providerPlayerId}`;
}

function summary(
  picks: readonly SavedRunPickGradeV1[],
): SavedRunGradeSummaryV1 {
  const wins = picks.filter((pick) => pick.outcome === 'win').length;
  const losses = picks.filter((pick) => pick.outcome === 'loss').length;
  const voids = picks.filter((pick) => pick.outcome === 'void').length;
  const graded = wins + losses + voids;
  return Object.freeze({
    graded,
    wins,
    losses,
    voids,
    winRateGivenGrades: wins + losses === 0 ? null : wins / (wins + losses),
  });
}

function gradePick(
  runId: string,
  pick: SavedRunPickSnapshotV1,
  evidence: BallDontLieOfficialFinalHitsEvidenceV1,
): SavedRunPickGradeV1 {
  if (
    pick.baseMarketKey !== 'batter-hits' ||
    pick.settlementStatistic !== 'hits'
  ) {
    throw new Error(
      `Saved pick ${pick.snapshotId} is not an exact Batter Hits settlement.`,
    );
  }
  const observed = settleObservedDiscreteStatisticV1({
    observedStatistic: evidence.officialHits,
    line: pick.line,
    selectedSide: pick.selectedSide,
  });
  return Object.freeze({
    runId,
    snapshotId: pick.snapshotId,
    categoryId: pick.categoryId,
    categoryRank: pick.categoryRank,
    playerName: pick.playerName,
    providerGameId: pick.providerGameId,
    providerPlayerId: pick.providerPlayerId,
    selectedSide: pick.selectedSide,
    line: pick.line,
    officialHits: evidence.officialHits,
    outcome: observed.outcome,
    archivedPWin: pick.pWin,
    archivedPLoss: pick.pLoss,
    archivedPVoid: pick.pVoid,
    archivedPWinGivenGrades: pick.pWinGivenGrades,
    modelVersion: pick.modelVersion,
    distributionBuilderVersion: pick.distributionBuilderVersion,
    archivedSettlementRuleVersion: pick.settlementRuleVersion,
    observedSettlementVersion: observed.version,
    evidenceVersion: evidence.evidenceVersion,
    gameSnapshotId: evidence.gameSnapshotId,
    gameSnapshotSha256: evidence.gameSnapshotSha256,
    statsSnapshotId: evidence.statsSnapshotId,
    statsSnapshotSha256: evidence.statsSnapshotSha256,
  });
}

/**
 * Creates a separate immutable grade report. Saved predictions remain
 * untouched, and exact archived provider game/player identities are the only
 * join keys.
 */
export function gradeSavedRunBatterHitsV1(input: Readonly<{
  run: SavedRunSnapshotV1;
  evidence: readonly BallDontLieOfficialFinalHitsEvidenceV1[];
  gradedAt: string;
}>): SavedRunGradeReportV1 {
  if (!Number.isFinite(Date.parse(input.gradedAt))) {
    throw new TypeError('gradedAt must be an ISO timestamp.');
  }
  const evidenceByIdentity = new Map<
    string,
    BallDontLieOfficialFinalHitsEvidenceV1
  >();
  for (const item of input.evidence) {
    const key = identityKey(item.providerGameId, item.providerPlayerId);
    if (evidenceByIdentity.has(key)) {
      throw new Error(`Duplicate final-Hits evidence ${key}.`);
    }
    evidenceByIdentity.set(key, item);
  }
  const expectedKeys = new Set<string>();
  for (const category of input.run.categories) {
    for (const pick of category.picks) {
      expectedKeys.add(identityKey(pick.providerGameId, pick.providerPlayerId));
    }
  }
  for (const key of expectedKeys) {
    if (!evidenceByIdentity.has(key)) {
      throw new Error(`Missing final-Hits evidence ${key}.`);
    }
  }
  for (const key of evidenceByIdentity.keys()) {
    if (!expectedKeys.has(key)) {
      throw new Error(`Unexpected final-Hits evidence ${key}.`);
    }
  }

  const categories = Object.freeze(
    input.run.categories.map((category) => {
      const picks = Object.freeze(
        category.picks.map((pick) =>
          gradePick(
            input.run.runId,
            pick,
            evidenceByIdentity.get(
              identityKey(pick.providerGameId, pick.providerPlayerId),
            )!,
          ),
        ),
      );
      return Object.freeze({
        categoryId: category.categoryId,
        summary: summary(picks),
        picks,
      });
    }),
  );
  const allPicks = categories.flatMap((category) => category.picks);
  return Object.freeze({
    schemaVersion: 1 as const,
    gradingVersion: SAVED_RUN_HITS_GRADING_VERSION,
    runId: input.run.runId,
    savedAt: input.run.savedAt,
    gradedAt: input.gradedAt,
    provider: 'balldontlie-mlb' as const,
    productionEnabled: false as const,
    rankingEnabled: false as const,
    summary: summary(allPicks),
    categories,
  });
}
