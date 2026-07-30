import {
  lstat,
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
} from 'node:fs/promises';
import path from 'node:path';

import {
  verifyM8ContextPlayGameCapture,
} from './m8-context-play-capture-utils.mjs';
import { sha256 } from './provider-probe-utils.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function digest(value, label) {
  const normalized = string(value, label);
  if (!SHA256_PATTERN.test(normalized)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest.`);
  }
  return normalized;
}

function portablePath(value) {
  return value.split(path.sep).join('/');
}

function captureIdentity(manifest) {
  return {
    activeSeason: manifest.activeSeason,
    sourceDatasetSha256: manifest.sourceDatasetSha256,
    sourceDatasetFileSha256: manifest.sourceDatasetFileSha256,
    sourcePlanSha256: manifest.sourcePlanSha256,
    sourcePlanFileSha256: manifest.sourcePlanFileSha256,
    contextRowCount: manifest.contextRowCount,
    gameCount: manifest.gameCount,
    resultCounts: manifest.resultCounts,
    games: manifest.games,
    totalPageCount: manifest.totalPageCount,
    totalPlayRecordCount: manifest.totalPlayRecordCount,
    untouchedTestReservation: manifest.untouchedTestReservation,
  };
}

function validateSourceCaptureManifest(rawManifest) {
  const manifest = object(rawManifest, 'source context-play capture manifest');
  if (
    manifest.captureVersion !== 1 ||
    manifest.provider !== 'BALLDONTLIE MLB API' ||
    manifest.status !== 'complete' ||
    manifest.error !== null
  ) {
    throw new Error('source context-play capture manifest is not complete and supported.');
  }
  const expectedCaptureSha256 = sha256(JSON.stringify(captureIdentity(manifest)));
  if (digest(manifest.captureSha256, 'source captureSha256') !== expectedCaptureSha256) {
    throw new Error('source context-play capture manifest SHA-256 is invalid.');
  }
  const games = array(manifest.games, 'source capture games');
  if (games.length !== nonNegativeInteger(manifest.gameCount, 'source gameCount')) {
    throw new Error('source context-play capture gameCount does not match games.');
  }
  const byGameId = new Map();
  let pageCount = 0;
  let recordCount = 0;
  for (const [index, rawGame] of games.entries()) {
    const game = object(rawGame, `source capture games[${index}]`);
    const gameId = positiveInteger(game.gameId, `source capture games[${index}].gameId`);
    if (byGameId.has(gameId)) {
      throw new Error(`source context-play capture repeats game ${gameId}.`);
    }
    const normalized = Object.freeze({
      gameId,
      observedDate: string(
        game.observedDate,
        `source capture games[${index}].observedDate`,
      ),
      pageCount: positiveInteger(
        game.pageCount,
        `source capture games[${index}].pageCount`,
      ),
      recordCount: nonNegativeInteger(
        game.recordCount,
        `source capture games[${index}].recordCount`,
      ),
      gameManifestSha256: digest(
        game.gameManifestSha256,
        `source capture games[${index}].gameManifestSha256`,
      ),
    });
    pageCount += normalized.pageCount;
    recordCount += normalized.recordCount;
    byGameId.set(gameId, normalized);
  }
  if (pageCount !== nonNegativeInteger(manifest.totalPageCount, 'source totalPageCount')) {
    throw new Error('source context-play capture totalPageCount does not match games.');
  }
  if (
    recordCount !==
    nonNegativeInteger(manifest.totalPlayRecordCount, 'source totalPlayRecordCount')
  ) {
    throw new Error('source context-play capture totalPlayRecordCount does not match games.');
  }
  const untouched = object(
    manifest.untouchedTestReservation,
    'source untouchedTestReservation',
  );
  if (untouched.rowsIncluded !== false || Object.hasOwn(untouched, 'rows')) {
    throw new Error('source context-play capture exposes untouched-test rows.');
  }
  return Object.freeze({ manifest, byGameId });
}

function validateV5Plan(rawPlan) {
  const plan = object(rawPlan, 'V5 context-play capture plan');
  if (plan.planVersion !== 1 || plan.activeSeason !== 2026) {
    throw new Error('V5 context-play capture plan must be active-season planVersion 1.');
  }
  digest(plan.sourceDatasetSha256, 'V5 sourceDatasetSha256');
  digest(plan.planSha256, 'V5 planSha256');
  const untouched = object(plan.untouchedTestReservation, 'V5 untouched reservation');
  if (untouched.rowsIncluded !== false || Object.hasOwn(untouched, 'rows')) {
    throw new Error('V5 context-play capture plan exposes untouched-test rows.');
  }
  if (untouched.startDate !== '2026-07-30' || untouched.endDate !== '2026-08-04') {
    throw new Error('V5 context-play capture plan untouched reservation drifted.');
  }
  const games = array(plan.games, 'V5 context-play plan games').map(
    (rawGame, index) => {
      const game = object(rawGame, `V5 plan games[${index}]`);
      return Object.freeze({
        gameId: positiveInteger(game.gameId, `V5 plan games[${index}].gameId`),
        observedDate: string(
          game.observedDate,
          `V5 plan games[${index}].observedDate`,
        ),
      });
    },
  );
  if (games.length !== nonNegativeInteger(plan.gameCount, 'V5 plan gameCount')) {
    throw new Error('V5 context-play plan gameCount does not match games.');
  }
  if (new Set(games.map((game) => game.gameId)).size !== games.length) {
    throw new Error('V5 context-play plan repeats a game identity.');
  }
  return Object.freeze({ plan, games, untouched });
}

function reuseIdentity(value) {
  return {
    reuseVersion: value.reuseVersion,
    modelVersion: value.modelVersion,
    productionEnabled: value.productionEnabled,
    sourceV5DatasetSha256: value.sourceV5DatasetSha256,
    sourceV5PlanSha256: value.sourceV5PlanSha256,
    sourceCaptureSha256: value.sourceCaptureSha256,
    sourceCaptureRoot: value.sourceCaptureRoot,
    targetCaptureRoot: value.targetCaptureRoot,
    reusedGameCount: value.reusedGameCount,
    existingVerifiedGameCount: value.existingVerifiedGameCount,
    linkedGameCount: value.linkedGameCount,
    missingGameCount: value.missingGameCount,
    reusedGames: value.reusedGames,
    missingGames: value.missingGames,
    untouchedTestReservation: value.untouchedTestReservation,
  };
}

async function pathState(value) {
  try {
    return await lstat(value);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function createRelativeDirectorySymlink({ sourceDirectory, targetDirectory }) {
  const targetParent = path.dirname(targetDirectory);
  await mkdir(targetParent, { recursive: true });
  const relativeTarget = path.relative(targetParent, sourceDirectory);
  const temporary = `${targetDirectory}.tmp-${process.pid}-${Date.now()}`;
  await symlink(relativeTarget, temporary, 'dir');
  try {
    await rename(temporary, targetDirectory);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return portablePath(relativeTarget);
}

export async function prepareM9BatterHitsV5ContextPlayReuse({
  rawPlan,
  rawSourceCaptureManifest,
  sourceCaptureRoot,
  targetCaptureRoot,
  secret = null,
}) {
  const v5 = validateV5Plan(rawPlan);
  const source = validateSourceCaptureManifest(rawSourceCaptureManifest);
  const sourceRoot = path.resolve(
    string(sourceCaptureRoot, 'sourceCaptureRoot'),
  );
  const targetRoot = path.resolve(
    string(targetCaptureRoot, 'targetCaptureRoot'),
  );
  if (sourceRoot === targetRoot) {
    throw new Error('source and target context-play capture roots must differ.');
  }
  await mkdir(path.join(targetRoot, 'games'), { recursive: true });

  const reusedGames = [];
  const missingGames = [];
  let linkedGameCount = 0;
  let existingVerifiedGameCount = 0;

  for (const plannedGame of v5.games) {
    const sourceGame = source.byGameId.get(plannedGame.gameId);
    if (!sourceGame) {
      missingGames.push(plannedGame);
      continue;
    }
    if (sourceGame.observedDate !== plannedGame.observedDate) {
      throw new Error(
        `source game ${plannedGame.gameId} observedDate differs from the V5 plan.`,
      );
    }
    const sourceDirectory = path.join(sourceRoot, 'games', String(plannedGame.gameId));
    const sourceVerified = await verifyM8ContextPlayGameCapture({
      gameDirectory: sourceDirectory,
      expectedGameId: plannedGame.gameId,
      secret,
    });
    if (
      sourceVerified.gameManifestSha256 !== sourceGame.gameManifestSha256 ||
      sourceVerified.pageCount !== sourceGame.pageCount ||
      sourceVerified.recordCount !== sourceGame.recordCount
    ) {
      throw new Error(
        `source game ${plannedGame.gameId} drifted from its complete root manifest.`,
      );
    }

    const targetDirectory = path.join(targetRoot, 'games', String(plannedGame.gameId));
    const existing = await pathState(targetDirectory);
    let linkTarget = null;
    if (existing === null) {
      linkTarget = await createRelativeDirectorySymlink({
        sourceDirectory,
        targetDirectory,
      });
      linkedGameCount += 1;
    } else {
      const targetVerified = await verifyM8ContextPlayGameCapture({
        gameDirectory: targetDirectory,
        expectedGameId: plannedGame.gameId,
        secret,
      });
      if (
        targetVerified.gameManifestSha256 !== sourceVerified.gameManifestSha256 ||
        targetVerified.pageCount !== sourceVerified.pageCount ||
        targetVerified.recordCount !== sourceVerified.recordCount
      ) {
        throw new Error(
          `existing target game ${plannedGame.gameId} is not equivalent to the verified source capture.`,
        );
      }
      if (existing.isSymbolicLink()) {
        linkTarget = portablePath(await readlink(targetDirectory));
      }
      existingVerifiedGameCount += 1;
    }

    reusedGames.push(
      Object.freeze({
        gameId: plannedGame.gameId,
        observedDate: plannedGame.observedDate,
        pageCount: sourceVerified.pageCount,
        recordCount: sourceVerified.recordCount,
        gameManifestSha256: sourceVerified.gameManifestSha256,
        targetKind: linkTarget === null ? 'existing-equivalent-directory' : 'relative-directory-symlink',
        relativeLinkTarget: linkTarget,
      }),
    );
  }

  const identity = {
    reuseVersion: 1,
    modelVersion: 'm9-batter-hits-v5-context-play-reuse-v1',
    productionEnabled: false,
    sourceV5DatasetSha256: v5.plan.sourceDatasetSha256,
    sourceV5PlanSha256: v5.plan.planSha256,
    sourceCaptureSha256: source.manifest.captureSha256,
    sourceCaptureRoot: portablePath(path.relative(process.cwd(), sourceRoot)),
    targetCaptureRoot: portablePath(path.relative(process.cwd(), targetRoot)),
    reusedGameCount: reusedGames.length,
    existingVerifiedGameCount,
    linkedGameCount,
    missingGameCount: missingGames.length,
    reusedGames: Object.freeze(reusedGames),
    missingGames: Object.freeze(missingGames),
    untouchedTestReservation: Object.freeze({
      startDate: v5.untouched.startDate,
      endDate: v5.untouched.endDate,
      rowsIncluded: false,
    }),
  };
  return Object.freeze({
    ...identity,
    reuseSha256: sha256(JSON.stringify(reuseIdentity(identity))),
  });
}

export function verifyM9BatterHitsV5ContextPlayReuse(rawReuse) {
  const reuse = object(rawReuse, 'V5 context-play reuse manifest');
  if (
    reuse.reuseVersion !== 1 ||
    reuse.modelVersion !== 'm9-batter-hits-v5-context-play-reuse-v1' ||
    reuse.productionEnabled !== false
  ) {
    throw new Error('unsupported V5 context-play reuse manifest contract.');
  }
  if (
    reuse.untouchedTestReservation?.startDate !== '2026-07-30' ||
    reuse.untouchedTestReservation?.endDate !== '2026-08-04' ||
    reuse.untouchedTestReservation?.rowsIncluded !== false
  ) {
    throw new Error('V5 context-play reuse manifest opens or moves untouched evidence.');
  }
  const reusedGames = array(reuse.reusedGames, 'reuse reusedGames');
  const missingGames = array(reuse.missingGames, 'reuse missingGames');
  if (reusedGames.length !== reuse.reusedGameCount) {
    throw new Error('V5 context-play reusedGameCount does not match reusedGames.');
  }
  if (missingGames.length !== reuse.missingGameCount) {
    throw new Error('V5 context-play missingGameCount does not match missingGames.');
  }
  if (
    reuse.linkedGameCount + reuse.existingVerifiedGameCount !==
    reuse.reusedGameCount
  ) {
    throw new Error('V5 context-play reuse accounting does not conserve reused games.');
  }
  if (reuse.reuseSha256 !== sha256(JSON.stringify(reuseIdentity(reuse)))) {
    throw new Error('V5 context-play reuse manifest SHA-256 is invalid.');
  }
  return reuse;
}
