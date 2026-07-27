import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { sha256 } from './provider-probe-utils.mjs';
import {
  countPlateAppearances,
  enumerateCurrentSeasonDates,
  selectFinalGamesForDate,
} from './m8-recency-weighting-utils.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 hex digest.`);
  }
  return value;
}

function assertExactArray(value, expected, label) {
  if (!Array.isArray(value) || JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new RangeError(
      `${label} must equal ${JSON.stringify(expected)}.`,
    );
  }
}

function assertRequest(request, expected, label) {
  const value = assertPlainObject(request, label);
  if (value.origin !== 'https://api.balldontlie.io') {
    throw new RangeError(`${label}.origin is not the approved provider.`);
  }
  if (value.pathname !== expected.pathname) {
    throw new RangeError(`${label}.pathname is not approved.`);
  }
  assertExactArray(value.queryKeys, expected.queryKeys, `${label}.queryKeys`);
  assertExactArray(value.headerNames, ['Authorization'], `${label}.headerNames`);
}

function resolveSnapshotPath(captureRoot, relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new TypeError(`${label} must be a non-empty relative path.`);
  }
  if (path.isAbsolute(relativePath)) {
    throw new RangeError(`${label} must be relative.`);
  }
  const root = path.resolve(captureRoot);
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new RangeError(`${label} escapes the capture directory.`);
  }
  return resolved;
}

async function readVerifiedSnapshot({
  captureRoot,
  snapshot,
  label,
  expectedRequest,
  secret,
}) {
  const value = assertPlainObject(snapshot, label);
  if (value.responseStatus !== 200) {
    throw new RangeError(`${label}.responseStatus must equal 200.`);
  }
  assertSha256(value.rawBodySha256, `${label}.rawBodySha256`);
  const savedBodySha256 = assertSha256(
    value.savedBodySha256,
    `${label}.savedBodySha256`,
  );
  assertRequest(value.request, expectedRequest, `${label}.request`);

  const filePath = resolveSnapshotPath(
    captureRoot,
    value.filePath,
    `${label}.filePath`,
  );
  const text = await readFile(filePath, 'utf8');
  if (secret && text.includes(secret)) {
    throw new Error(`${label} contains the provider secret.`);
  }
  const actualSha256 = sha256(text);
  if (actualSha256 !== savedBodySha256) {
    throw new Error(
      `${label} saved-body hash mismatch: expected ${savedBodySha256}, got ${actualSha256}.`,
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

export async function verifyM8CaptureDirectory({
  captureRoot,
  expectedActiveSeason,
  secret = null,
}) {
  if (typeof captureRoot !== 'string' || captureRoot.trim().length === 0) {
    throw new TypeError('captureRoot must be a non-empty string.');
  }
  assertPositiveInteger(expectedActiveSeason, 'expectedActiveSeason');

  const manifestText = await readFile(
    path.join(captureRoot, 'capture-manifest.json'),
    'utf8',
  );
  if (secret && manifestText.includes(secret)) {
    throw new Error('capture manifest contains the provider secret.');
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error('capture manifest is not valid JSON.');
  }
  assertPlainObject(manifest, 'capture manifest');

  if (manifest.captureVersion !== 1) {
    throw new RangeError('captureVersion must equal 1.');
  }
  if (manifest.provider !== 'BALLDONTLIE MLB API') {
    throw new RangeError('capture provider is not approved.');
  }
  if (manifest.activeSeason !== expectedActiveSeason) {
    throw new RangeError(
      `capture activeSeason ${manifest.activeSeason} does not match expected ${expectedActiveSeason}.`,
    );
  }
  if (manifest.status !== 'complete' || manifest.error !== null) {
    throw new RangeError('capture must be complete with error null.');
  }
  if (manifest.truncated !== false) {
    throw new RangeError('truncated capture evidence cannot be promoted.');
  }
  if (manifest.requiredFinalStatus !== 'STATUS_FINAL') {
    throw new RangeError('requiredFinalStatus must equal STATUS_FINAL.');
  }

  const expectedDates = enumerateCurrentSeasonDates({
    startDate: manifest.requestedStartDate,
    endDate: manifest.requestedEndDate,
    activeSeason: expectedActiveSeason,
  });
  if (!Array.isArray(manifest.dateCaptures)) {
    throw new TypeError('dateCaptures must be an array.');
  }
  assertExactArray(
    manifest.dateCaptures.map((entry) => entry?.date),
    [...expectedDates],
    'captured dates',
  );

  let totalGames = 0;
  let totalPlateAppearances = 0;
  const seenGameIds = new Set();

  for (const [dateIndex, rawDateCapture] of manifest.dateCaptures.entries()) {
    const dateCapture = assertPlainObject(
      rawDateCapture,
      `dateCaptures[${dateIndex}]`,
    );
    const gamesBody = await readVerifiedSnapshot({
      captureRoot,
      snapshot: dateCapture.gamesSnapshot,
      label: `dateCaptures[${dateIndex}].gamesSnapshot`,
      expectedRequest: {
        pathname: '/mlb/v1/games',
        queryKeys: ['dates[]', 'per_page', 'season_type'],
      },
      secret,
    });
    const finalGames = selectFinalGamesForDate(
      gamesBody,
      dateCapture.date,
      expectedActiveSeason,
    );
    const finalGameCount = assertNonNegativeInteger(
      dateCapture.finalGameCount,
      `dateCaptures[${dateIndex}].finalGameCount`,
    );
    if (finalGameCount !== finalGames.length) {
      throw new Error(
        `date ${dateCapture.date} finalGameCount does not match the games snapshot.`,
      );
    }
    if (!Array.isArray(dateCapture.games)) {
      throw new TypeError(`dateCaptures[${dateIndex}].games must be an array.`);
    }
    if (dateCapture.games.length !== finalGames.length) {
      throw new Error(
        `date ${dateCapture.date} does not contain every final game.`,
      );
    }

    const finalById = new Map(finalGames.map((game) => [game.id, game]));
    for (const [gameIndex, rawGame] of dateCapture.games.entries()) {
      const label = `dateCaptures[${dateIndex}].games[${gameIndex}]`;
      const game = assertPlainObject(rawGame, label);
      const gameId = assertPositiveInteger(game.gameId, `${label}.gameId`);
      if (seenGameIds.has(gameId)) {
        throw new Error(`duplicate captured gameId: ${gameId}`);
      }
      seenGameIds.add(gameId);

      const expectedGame = finalById.get(gameId);
      if (!expectedGame) {
        throw new Error(`captured game ${gameId} is not final in the games snapshot.`);
      }
      if (
        game.gameDate !== expectedGame.date ||
        game.status !== expectedGame.status ||
        game.status !== 'STATUS_FINAL'
      ) {
        throw new Error(`captured game ${gameId} metadata does not match the games snapshot.`);
      }

      const plateAppearancesBody = await readVerifiedSnapshot({
        captureRoot,
        snapshot: game.plateAppearancesSnapshot,
        label: `${label}.plateAppearancesSnapshot`,
        expectedRequest: {
          pathname: '/mlb/v1/plate_appearances',
          queryKeys: ['game_id'],
        },
        secret,
      });
      const actualRecordCount = countPlateAppearances(plateAppearancesBody);
      const recordedCount = assertNonNegativeInteger(
        game.plateAppearancesSnapshot.recordCount,
        `${label}.plateAppearancesSnapshot.recordCount`,
      );
      if (actualRecordCount !== recordedCount) {
        throw new Error(
          `game ${gameId} plate-appearance count does not match its snapshot.`,
        );
      }

      totalGames += 1;
      totalPlateAppearances += actualRecordCount;
    }
  }

  if (manifest.capturedGameCount !== totalGames) {
    throw new Error('capturedGameCount does not match verified games.');
  }
  if (manifest.capturedPlateAppearanceCount !== totalPlateAppearances) {
    throw new Error(
      'capturedPlateAppearanceCount does not match verified plate appearances.',
    );
  }

  return Object.freeze({
    status: 'verified',
    activeSeason: expectedActiveSeason,
    startDate: manifest.requestedStartDate,
    endDate: manifest.requestedEndDate,
    gameCount: totalGames,
    plateAppearanceCount: totalPlateAppearances,
  });
}
