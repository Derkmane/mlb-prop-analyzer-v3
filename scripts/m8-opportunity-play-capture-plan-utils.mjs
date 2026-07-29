import { readFile } from 'node:fs/promises';

import { sha256 } from './provider-probe-utils.mjs';
import {
  assertCurrentSeasonDate,
} from './m8-recency-weighting-utils.mjs';

const SHA256_PATTERN =
  /^[a-f0-9]{64}$/;

const INCLUDED_PERIODS =
  Object.freeze([
    'fit',
    'validation',
  ]);

function assertPlainObject(
  value,
  label,
) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      `${label} must be an object.`,
    );
  }

  return value;
}

function assertArray(
  value,
  label,
) {
  if (!Array.isArray(value)) {
    throw new TypeError(
      `${label} must be an array.`,
    );
  }

  return value;
}

function assertNonEmptyString(
  value,
  label,
) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    throw new TypeError(
      `${label} must be a non-empty string.`,
    );
  }

  return value.trim();
}

function assertInteger(
  value,
  label,
) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(
      `${label} must be an integer.`,
    );
  }

  return value;
}

function assertPositiveInteger(
  value,
  label,
) {
  const integer =
    assertInteger(value, label);

  if (integer <= 0) {
    throw new RangeError(
      `${label} must be positive.`,
    );
  }

  return integer;
}

function assertNonNegativeInteger(
  value,
  label,
) {
  const integer =
    assertInteger(value, label);

  if (integer < 0) {
    throw new RangeError(
      `${label} must be non-negative.`,
    );
  }

  return integer;
}

function assertSha256(
  value,
  label,
) {
  if (
    typeof value !== 'string' ||
    !SHA256_PATTERN.test(value)
  ) {
    throw new TypeError(
      `${label} must be a lowercase SHA-256 digest.`,
    );
  }

  return value;
}

function parseJson(
  text,
  label,
) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${label} is not valid JSON.`,
    );
  }
}

function resolvedDatasetIdentity(
  dataset,
) {
  return {
    activeSeason:
      dataset.activeSeason,
    sourceDatasetSha256:
      dataset.sourceDatasetSha256,
    sourceDatasetFileSha256:
      dataset.sourceDatasetFileSha256,
    sourceResolutionSha256:
      dataset.sourceResolutionSha256,
    sourceResolutionFileSha256:
      dataset.sourceResolutionFileSha256,
    sourcePartitionSha256:
      dataset.sourcePartitionSha256,
    sourceEvidenceSetSha256:
      dataset.sourceEvidenceSetSha256,
    periods:
      dataset.periods,
    untouchedTestReservation:
      dataset.untouchedTestReservation,
  };
}

function validateUntouchedReservation({
  rawReservation,
  activeSeason,
}) {
  const reservation =
    assertPlainObject(
      rawReservation,
      'untouchedTestReservation',
    );

  const startDate =
    assertNonEmptyString(
      reservation.startDate,
      'untouched startDate',
    );

  const endDate =
    assertNonEmptyString(
      reservation.endDate,
      'untouched endDate',
    );

  assertCurrentSeasonDate(
    startDate,
    activeSeason,
    'untouched startDate',
  );

  assertCurrentSeasonDate(
    endDate,
    activeSeason,
    'untouched endDate',
  );

  if (
    reservation.rowsIncluded !== false ||
    Object.hasOwn(
      reservation,
      'rows',
    )
  ) {
    throw new Error(
      'untouched-test rows must remain excluded from opportunity-play planning.',
    );
  }

  return Object.freeze({
    startDate,
    endDate,
    shardCount:
      assertNonNegativeInteger(
        reservation.shardCount,
        'untouched shardCount',
      ),
    gameCount:
      assertNonNegativeInteger(
        reservation.gameCount,
        'untouched gameCount',
      ),
    plateAppearanceCount:
      assertNonNegativeInteger(
        reservation.plateAppearanceCount,
        'untouched plateAppearanceCount',
      ),
    rowsIncluded: false,
    allowedUse:
      assertNonEmptyString(
        reservation.allowedUse,
        'untouched allowedUse',
      ),
  });
}

function validateResolvedDataset({
  rawDataset,
  sourceText,
}) {
  const dataset =
    assertPlainObject(
      rawDataset,
      'resolved categorical dataset',
    );

  if (dataset.datasetVersion !== 3) {
    throw new Error(
      'resolved categorical datasetVersion must equal 3.',
    );
  }

  const activeSeason =
    assertPositiveInteger(
      dataset.activeSeason,
      'activeSeason',
    );

  const sourceHashFields = [
    'sourceDatasetSha256',
    'sourceDatasetFileSha256',
    'sourceResolutionSha256',
    'sourceResolutionFileSha256',
    'sourcePartitionSha256',
    'sourceEvidenceSetSha256',
  ];

  for (
    const field of
    sourceHashFields
  ) {
    assertSha256(
      dataset[field],
      field,
    );
  }

  const expectedDatasetSha256 =
    sha256(
      JSON.stringify(
        resolvedDatasetIdentity(
          dataset,
        ),
      ),
    );

  const datasetSha256 =
    assertSha256(
      dataset.datasetSha256,
      'datasetSha256',
    );

  if (
    datasetSha256 !==
    expectedDatasetSha256
  ) {
    throw new Error(
      'resolved categorical dataset identity SHA-256 is invalid.',
    );
  }

  const untouchedTestReservation =
    validateUntouchedReservation({
      rawReservation:
        dataset.untouchedTestReservation,
      activeSeason,
    });

  const periods =
    assertPlainObject(
      dataset.periods,
      'periods',
    );

  const totals =
    assertPlainObject(
      dataset.totals,
      'totals',
    );

  const groupedGames =
    new Map();

  const seenRowIds =
    new Set();

  let sourceRowCount = 0;

  for (
    const periodId of
    INCLUDED_PERIODS
  ) {
    const period =
      assertPlainObject(
        periods[periodId],
        `periods.${periodId}`,
      );

    const startDate =
      assertNonEmptyString(
        period.startDate,
        `${periodId}.startDate`,
      );

    const endDate =
      assertNonEmptyString(
        period.endDate,
        `${periodId}.endDate`,
      );

    assertCurrentSeasonDate(
      startDate,
      activeSeason,
      `${periodId}.startDate`,
    );

    assertCurrentSeasonDate(
      endDate,
      activeSeason,
      `${periodId}.endDate`,
    );

    if (startDate > endDate) {
      throw new Error(
        `${periodId} dates are reversed.`,
      );
    }

    const rows =
      assertArray(
        period.rows,
        `periods.${periodId}.rows`,
      );

    if (
      rows.length !==
      assertNonNegativeInteger(
        period.rowCount,
        `${periodId}.rowCount`,
      )
    ) {
      throw new Error(
        `${periodId}.rowCount does not match rows.`,
      );
    }

    sourceRowCount +=
      rows.length;

    for (
      const [index, rawRow] of
      rows.entries()
    ) {
      const label =
        `periods.${periodId}.rows[${index}]`;

      const row =
        assertPlainObject(
          rawRow,
          label,
        );

      const observedDate =
        assertNonEmptyString(
          row.observedDate,
          `${label}.observedDate`,
        );

      assertCurrentSeasonDate(
        observedDate,
        activeSeason,
        `${label}.observedDate`,
      );

      if (
        observedDate < startDate ||
        observedDate > endDate
      ) {
        throw new Error(
          `${label} falls outside its period.`,
        );
      }

      const gameId =
        assertPositiveInteger(
          row.providerGameId,
          `${label}.providerGameId`,
        );

      const paNumber =
        assertPositiveInteger(
          row.providerPaNumber,
          `${label}.providerPaNumber`,
        );

      const rowId =
        assertNonEmptyString(
          row.rowId,
          `${label}.rowId`,
        );

      const expectedRowId =
        `${observedDate}:` +
        `${gameId}:` +
        `${paNumber}`;

      if (
        rowId !== expectedRowId
      ) {
        throw new Error(
          `${label}.rowId does not match provider identity.`,
        );
      }

      if (
        seenRowIds.has(rowId)
      ) {
        throw new Error(
          `duplicate resolved dataset rowId ${rowId}.`,
        );
      }

      seenRowIds.add(rowId);

      const snapshotPath =
        assertNonEmptyString(
          row.sourceSnapshotPath,
          `${label}.sourceSnapshotPath`,
        );

      const snapshotSha256 =
        assertSha256(
          row.sourceSnapshotSha256,
          `${label}.sourceSnapshotSha256`,
        );

      let game =
        groupedGames.get(gameId);

      if (game === undefined) {
        game = {
          gameId,
          dates: new Set(),
          periods: new Set(),
          rowIds: [],
          snapshotPaths:
            new Set(),
          snapshotSha256s:
            new Set(),
        };

        groupedGames.set(
          gameId,
          game,
        );
      }

      game.dates.add(
        observedDate,
      );

      game.periods.add(
        periodId,
      );

      game.rowIds.push(
        rowId,
      );

      game.snapshotPaths.add(
        snapshotPath,
      );

      game.snapshotSha256s.add(
        snapshotSha256,
      );
    }
  }

  if (
    sourceRowCount !==
    assertNonNegativeInteger(
      totals.includedRowCount,
      'totals.includedRowCount',
    )
  ) {
    throw new Error(
      'totals.includedRowCount does not match fit-validation rows.',
    );
  }

  return Object.freeze({
    activeSeason,
    sourceResolvedDatasetSha256:
      datasetSha256,
    sourceResolvedDatasetFileSha256:
      sha256(sourceText),
    sourceRowCount,
    groupedGames,
    untouchedTestReservation,
  });
}

export async function buildM8OpportunityPlayCapturePlan({
  datasetPath,
}) {
  const inputPath =
    assertNonEmptyString(
      datasetPath,
      'datasetPath',
    );

  const sourceText =
    await readFile(
      inputPath,
      'utf8',
    );

  const source =
    validateResolvedDataset({
      rawDataset:
        parseJson(
          sourceText,
          'resolved categorical dataset',
        ),
      sourceText,
    });

  const games =
    Object.freeze(
      [
        ...source
          .groupedGames
          .values(),
      ]
        .map((game) => {
          const dates =
            [...game.dates]
              .sort();

          const periods =
            [...game.periods]
              .sort();

          const snapshotPaths =
            [...game.snapshotPaths]
              .sort();

          const snapshotSha256s =
            [...game.snapshotSha256s]
              .sort();

          if (
            dates.length !== 1
          ) {
            throw new Error(
              `opportunity game ${game.gameId} appears on multiple observed dates.`,
            );
          }

          if (
            periods.length !== 1
          ) {
            throw new Error(
              `opportunity game ${game.gameId} appears in multiple chronological periods.`,
            );
          }

          if (
            snapshotPaths.length !== 1 ||
            snapshotSha256s.length !== 1
          ) {
            throw new Error(
              `opportunity game ${game.gameId} has inconsistent source snapshot provenance.`,
            );
          }

          return Object.freeze({
            gameId:
              game.gameId,
            observedDate:
              dates[0],
            periodId:
              periods[0],
            sourceRowCount:
              game.rowIds.length,
            sourceSnapshotPath:
              snapshotPaths[0],
            sourceSnapshotSha256:
              snapshotSha256s[0],
            rowIdsSha256:
              sha256(
                JSON.stringify(
                  [...game.rowIds]
                    .sort(),
                ),
              ),
          });
        })
        .sort(
          (left, right) =>
            left.observedDate
              .localeCompare(
                right.observedDate,
              ) ||
            left.gameId -
              right.gameId,
        ),
    );

  const identity = {
    activeSeason:
      source.activeSeason,
    sourceResolvedDatasetSha256:
      source
        .sourceResolvedDatasetSha256,
    sourceResolvedDatasetFileSha256:
      source
        .sourceResolvedDatasetFileSha256,
    includedPeriods:
      INCLUDED_PERIODS,
    sourceRowCount:
      source.sourceRowCount,
    gameCount:
      games.length,
    games,
    untouchedTestReservation:
      source
        .untouchedTestReservation,
  };

  return Object.freeze({
    planVersion: 1,
    purpose:
      'Capture complete paginated BALLDONTLIE plays for every current-season fit-validation game required to construct historical hitter opportunity sequences.',
    ...identity,
    planSha256:
      sha256(
        JSON.stringify(
          identity,
        ),
      ),
  });
}
