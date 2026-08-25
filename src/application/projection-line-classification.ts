export type ProjectionLineOfferType = 'baseline' | 'alternate';

export interface ProjectionLineEvidence {
  readonly providerMarketKey: string;
  readonly postedLine: number;
}

function isStandardMultiplierBucket(providerMarketKey: string): boolean {
  return !providerMarketKey.endsWith('_alternate');
}

/**
 * Resolves product baseline/altline identity from numerical posted projections.
 *
 * The Odds API's Underdog `_alternate` market is a non-default-multiplier
 * provider bucket, not product proof of an alternate projection. Therefore:
 * - one unique numerical line for a player/stat is the current baseline line,
 *   regardless of provider bucket;
 * - when multiple numerical lines exist, exactly one line from the provider's
 *   standard-multiplier bucket must identify the baseline;
 * - only numerically different posted lines are product alternate lines;
 * - ambiguous multi-line groups fail closed and are omitted from the result.
 *
 * Supported provider-market identity is validated upstream by the provider or
 * archive contract. This helper intentionally owns no active-feature constants
 * so historical/read-only consumers remain independent of active feature code.
 */
export function classifyProjectionLineOffersV1<
  TRow extends ProjectionLineEvidence,
>(
  rows: readonly TRow[],
  identityForRow: (row: TRow) => string,
): ReadonlyMap<TRow, ProjectionLineOfferType> {
  const groups = new Map<string, TRow[]>();
  for (const row of rows) {
    if (!Number.isFinite(row.postedLine) || row.postedLine < 0) {
      throw new Error('Projection postedLine must be finite and non-negative.');
    }
    const identity = identityForRow(row);
    const group = groups.get(identity) ?? [];
    group.push(row);
    groups.set(identity, group);
  }

  const classified = new Map<TRow, ProjectionLineOfferType>();
  for (const group of groups.values()) {
    const allLines = new Set(group.map((row) => row.postedLine));
    let baselineLine: number | undefined;

    if (allLines.size === 1) {
      baselineLine = [...allLines][0];
    } else {
      const standardLines = new Set(
        group
          .filter((row) => isStandardMultiplierBucket(row.providerMarketKey))
          .map((row) => row.postedLine),
      );
      if (standardLines.size === 1) baselineLine = [...standardLines][0];
    }

    if (baselineLine === undefined) continue;
    for (const row of group) {
      classified.set(
        row,
        row.postedLine === baselineLine ? 'baseline' : 'alternate',
      );
    }
  }

  return classified;
}
