export type ProjectionLineOfferType = 'baseline' | 'alternate';

export interface ProjectionLineEvidence {
  readonly providerMarketKey: string;
  readonly postedLine: number;
}

function isProviderBaselineMarket(providerMarketKey: string): boolean {
  return !providerMarketKey.endsWith('_alternate');
}

/**
 * Resolves product baseline/altline identity from numerical posted projections.
 *
 * A product baseline exists only when the same source exposes exactly one
 * numerical line for the player's exact base provider market. Rows from an
 * `_alternate` market never create a baseline by themselves. Once the unique
 * same-source base line is known, every captured rung at that exact number is a
 * product baseline and every numerically different rung is a product altline.
 * Ambiguous or alternate-only groups fail closed and are omitted.
 *
 * Source identity belongs in identityForRow. This helper intentionally owns no
 * active-source constants so historical/read-only consumers remain independent
 * of active provider code.
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
    const baselineLines = new Set(
      group
        .filter((row) => isProviderBaselineMarket(row.providerMarketKey))
        .map((row) => row.postedLine),
    );
    if (baselineLines.size !== 1) continue;
    const baselineLine = [...baselineLines][0];
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
