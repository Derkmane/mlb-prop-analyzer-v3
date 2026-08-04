import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';

import {
  buildM8_5ValidatedFinalDistributionV1,
  createM8BatterHitsBaseDistribution,
  verifyFrozenBatterHitsProbabilityArtifacts,
  verifyM8_5BatterHitsFactorArtifactV1,
  verifyM8_5GameOffensiveEnvironmentModelArtifactV1,
  verifyM8_5ParkFactorArtifactV1,
} from '../dist/src/features/batter-hits/index.js';
import { classifyBallDontLieTerminalPa } from '../dist/src/adapters/providers/balldontlie/index.js';
import {
  buildM8UntouchedGameObservations,
  gradeM8UntouchedPlateAppearance,
} from './m8-untouched-hit-observation-utils.mjs';
import { sha256, writeJsonAtomic } from './provider-probe-utils.mjs';
import {
  M8_5_FROZEN_SUCCESSOR_ARTIFACT_SHA256,
  M8_5_UNTOUCHED_COHORT_IDENTITY_SHA256,
  M8_5_UNTOUCHED_RESERVATION_ARTIFACT_SHA256,
  createM8_5UntouchedAcceptanceArtifact,
  scoreM8_5UntouchedDistributions,
  sha256Value,
  verifyM8_5UntouchedAcceptanceArtifact,
} from './m8-5-untouched-acceptance-utils.mjs';

const ACTIVE_SEASON = 2026;
const RESERVED_START_DATE = '2026-07-26';
const RESERVED_END_DATE = '2026-07-29';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const SHARD_ROOT =
  process.env.M8_CURRENT_SEASON_SHARD_ROOT?.trim() ||
  'artifacts/m8-current-season-pa/shards-2026';
const RESERVATION_PATH =
  process.env.M8_5_UNTOUCHED_RESERVATION_PATH?.trim() ||
  'artifacts/m8-5-untouched-acceptance/m8-5-untouched-cohort-reservation-v1.json';
const OUTPUT_PATH =
  process.env.M8_5_UNTOUCHED_ACCEPTANCE_OUTPUT_PATH?.trim() ||
  'model-artifacts/m8-5-batter-hits-untouched-acceptance-v1.json';
const LOCK_PATH = `${OUTPUT_PATH}.one-time-read-lock`;

const ARTIFACT_PATHS = Object.freeze({
  freeze: 'model-artifacts/m8-5-batter-hits-successor-freeze-v1.json',
  runtimeManifest: 'model-artifacts/m8-batter-hits-runtime-freeze-v1.json',
  completeCandidate: 'model-artifacts/m8-batter-hits-complete-candidate-v1.json',
  sharedEnvironment: 'model-artifacts/m8-shared-offensive-environment-v2.json',
  starterRetention: 'model-artifacts/m8-starter-retention-v1.json',
  terminalOutcome: 'model-artifacts/m8-terminal-pa-outcome-v1.json',
  gameEnvironment: 'model-artifacts/m8-5-game-offensive-environment-model-v1.json',
  teamBullpen: 'model-artifacts/m8-5-team-bullpen-outcome-v1.json',
  park: 'model-artifacts/m8-5-park-transformation-v1.json',
});

async function readJson(filePath, label = filePath) {
  const text = await readFile(filePath, 'utf8');
  try {
    return Object.freeze({ path: filePath, text, value: JSON.parse(text) });
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function assertAbsent(filePath, label) {
  try {
    await access(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`${label} already exists; the one-time evaluation cannot run again: ${filePath}`);
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function validTimestamp(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function increment(counts, reason, amount = 1) {
  counts[reason] = (counts[reason] ?? 0) + amount;
}

function emptyHistory() {
  return {
    offenseGames: 0,
    offensePa: 0,
    offenseHits: 0,
    defenseGames: 0,
    paAllowed: 0,
    hitsAllowed: 0,
  };
}

function historyFor(histories, teamId) {
  return histories.get(teamId) ?? emptyHistory();
}

function applyGameToHistory(histories, game) {
  const away = { ...historyFor(histories, game.awayTeamId) };
  const home = { ...historyFor(histories, game.homeTeamId) };
  away.offenseGames += 1;
  away.offensePa += game.awayPa;
  away.offenseHits += game.awayHits;
  away.defenseGames += 1;
  away.paAllowed += game.homePa;
  away.hitsAllowed += game.homeHits;
  home.offenseGames += 1;
  home.offensePa += game.homePa;
  home.offenseHits += game.homeHits;
  home.defenseGames += 1;
  home.paAllowed += game.awayPa;
  home.hitsAllowed += game.awayHits;
  histories.set(game.awayTeamId, away);
  histories.set(game.homeTeamId, home);
}

function gameFeatures(histories, game) {
  const awayOpponent = historyFor(histories, game.homeTeamId);
  const homeOpponent = historyFor(histories, game.awayTeamId);
  if (
    awayOpponent.defenseGames === 0 ||
    awayOpponent.paAllowed === 0 ||
    homeOpponent.defenseGames === 0 ||
    homeOpponent.paAllowed === 0
  ) {
    return null;
  }
  return Object.freeze({
    awayOpponentPaAllowedPerGame:
      awayOpponent.paAllowed / awayOpponent.defenseGames,
    awayOpponentHitRateAllowed:
      awayOpponent.hitsAllowed / awayOpponent.paAllowed,
    homeOpponentPaAllowedPerGame:
      homeOpponent.paAllowed / homeOpponent.defenseGames,
    homeOpponentHitRateAllowed:
      homeOpponent.hitsAllowed / homeOpponent.paAllowed,
  });
}

function sideTotals(gradedRows, halfInning) {
  const rows = gradedRows.filter((row) => row.halfInning === halfInning);
  const rejected = rows.find((row) => row.kind === 'reject');
  if (rejected) {
    return Object.freeze({
      status: 'excluded',
      reason: `terminal-row-${rejected.reason}`,
    });
  }
  const terminal = rows.filter((row) => row.kind === 'terminal');
  if (terminal.length === 0) {
    return Object.freeze({ status: 'excluded', reason: 'no-terminal-plate-appearances' });
  }
  return Object.freeze({
    status: 'included',
    plateAppearances: terminal.length,
    hits: terminal.reduce((sum, row) => sum + (row.hit ? 1 : 0), 0),
  });
}

function rawGameMap(gamesBody, date) {
  const rows = array(gamesBody.data, `games snapshot ${date}.data`);
  const byId = new Map();
  for (const raw of rows) {
    const game = object(raw, `games snapshot ${date} row`);
    const id = positiveInteger(game.id, `games snapshot ${date} game id`);
    if (byId.has(id)) throw new Error(`duplicate game ${id} in games snapshot ${date}.`);
    if (
      game.season !== ACTIVE_SEASON ||
      game.postseason !== false ||
      game.status !== 'STATUS_FINAL'
    ) {
      throw new Error(`game ${id} is not a final 2026 regular-season game.`);
    }
    byId.set(id, game);
  }
  return byId;
}

async function planManifest(manifestPath, expectedManifestSha256 = null) {
  const manifestRead = await readJson(manifestPath, 'capture manifest');
  if (
    expectedManifestSha256 !== null &&
    sha256(manifestRead.text) !== expectedManifestSha256
  ) {
    throw new Error(`reserved capture manifest hash drifted: ${manifestPath}`);
  }
  const manifest = object(manifestRead.value, `capture manifest ${manifestPath}`);
  if (
    manifest.captureVersion !== 1 ||
    manifest.provider !== 'BALLDONTLIE MLB API' ||
    manifest.activeSeason !== ACTIVE_SEASON ||
    manifest.status !== 'complete' ||
    manifest.truncated !== false ||
    manifest.error !== null ||
    manifest.requiredFinalStatus !== 'STATUS_FINAL'
  ) {
    throw new Error(`manifest is not complete approved current-season evidence: ${manifestPath}`);
  }
  const captures = array(manifest.dateCaptures, `${manifestPath}.dateCaptures`);
  if (captures.length !== 1) {
    throw new Error(`${manifestPath} must contain exactly one date capture.`);
  }
  const capture = object(captures[0], `${manifestPath}.dateCaptures[0]`);
  const date = capture.date;
  if (typeof date !== 'string' || !DATE_PATTERN.test(date)) {
    throw new Error(`${manifestPath} has an invalid date.`);
  }
  if (
    manifest.requestedStartDate !== date ||
    manifest.requestedEndDate !== date
  ) {
    throw new Error(`${manifestPath} requested dates do not match its date capture.`);
  }
  const shardDirectory = path.dirname(manifestPath);
  const gamesSnapshot = object(capture.gamesSnapshot, `${manifestPath}.gamesSnapshot`);
  const gamesPath = path.join(shardDirectory, gamesSnapshot.filePath);
  await access(gamesPath);
  const gamePlans = array(capture.games, `${manifestPath}.games`).map((rawGame) => {
    const game = object(rawGame, `${manifestPath} game`);
    const gameId = positiveInteger(game.gameId, `${manifestPath} gameId`);
    const paSnapshot = object(
      game.plateAppearancesSnapshot,
      `${manifestPath} game ${gameId} PA snapshot`,
    );
    const paPath = path.join(shardDirectory, paSnapshot.filePath);
    return Object.freeze({
      gameId,
      gameDate: validTimestamp(game.gameDate, `${manifestPath} gameDate`),
      paPath,
      paSha256: paSnapshot.savedBodySha256,
      paRecordCount: paSnapshot.recordCount,
    });
  });
  for (const game of gamePlans) await access(game.paPath);
  return Object.freeze({
    manifestPath,
    manifestSha256: sha256(manifestRead.text),
    capturedAt: validTimestamp(manifest.capturedAt, `${manifestPath}.capturedAt`),
    date,
    gamesPath,
    gamesSha256: gamesSnapshot.savedBodySha256,
    finalGameCount: capture.finalGameCount,
    games: Object.freeze(gamePlans),
  });
}

async function readPlannedDate(plan) {
  const gamesRead = await readJson(plan.gamesPath, `games snapshot ${plan.date}`);
  if (sha256(gamesRead.text) !== plan.gamesSha256) {
    throw new Error(`games snapshot hash drifted for ${plan.date}.`);
  }
  const gamesById = rawGameMap(gamesRead.value, plan.date);
  const games = [];
  let rawPlateAppearanceCount = 0;
  for (const gamePlan of plan.games) {
    const rawGame = gamesById.get(gamePlan.gameId);
    if (!rawGame) {
      throw new Error(`games snapshot ${plan.date} is missing game ${gamePlan.gameId}.`);
    }
    if (rawGame.date !== gamePlan.gameDate) {
      throw new Error(`game ${gamePlan.gameId} date drifted from its manifest.`);
    }
    const paRead = await readJson(
      gamePlan.paPath,
      `plate appearances for game ${gamePlan.gameId}`,
    );
    if (sha256(paRead.text) !== gamePlan.paSha256) {
      throw new Error(`plate-appearance snapshot hash drifted for game ${gamePlan.gameId}.`);
    }
    const rawRows = array(paRead.value.data, `game ${gamePlan.gameId} PA data`);
    if (rawRows.length !== gamePlan.paRecordCount) {
      throw new Error(`game ${gamePlan.gameId} PA record count drifted.`);
    }
    rawPlateAppearanceCount += rawRows.length;
    const gradedRows = rawRows.map((rawPlateAppearance) => {
      const classification = classifyBallDontLieTerminalPa({
        plateAppearance: rawPlateAppearance,
        providerGameId: gamePlan.gameId,
        sourceSnapshotSha256: gamePlan.paSha256,
      });
      return gradeM8UntouchedPlateAppearance({
        rawPlateAppearance,
        classification,
      });
    });
    const awayTotals = sideTotals(gradedRows, 'top');
    const homeTotals = sideTotals(gradedRows, 'bottom');
    const historyGame =
      awayTotals.status === 'included' && homeTotals.status === 'included'
        ? Object.freeze({
            awayTeamId: positiveInteger(
              rawGame.away_team?.id,
              `game ${gamePlan.gameId} away team ID`,
            ),
            homeTeamId: positiveInteger(
              rawGame.home_team?.id,
              `game ${gamePlan.gameId} home team ID`,
            ),
            awayPa: awayTotals.plateAppearances,
            awayHits: awayTotals.hits,
            homePa: homeTotals.plateAppearances,
            homeHits: homeTotals.hits,
          })
        : null;
    games.push(
      Object.freeze({
        plan: gamePlan,
        rawGame,
        gradedRows: Object.freeze(gradedRows),
        awayTotals,
        homeTotals,
        historyGame,
      }),
    );
  }
  if (games.length !== plan.finalGameCount) {
    throw new Error(`${plan.date} final game count drifted from its manifest.`);
  }
  return Object.freeze({
    plan,
    games: Object.freeze(games),
    rawPlateAppearanceCount,
  });
}

async function priorPlans() {
  const entries = await readdir(SHARD_ROOT, { withFileTypes: true });
  const dates = entries
    .filter((entry) => entry.isDirectory() && DATE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .filter((date) => date < RESERVED_START_DATE)
    .sort();
  if (dates.length === 0) throw new Error('no prior current-season shard dates exist.');
  return Promise.all(
    dates.map((date) =>
      planManifest(path.join(SHARD_ROOT, date, 'capture-manifest.json')),
    ),
  );
}

function verifyReservation(reservation, text) {
  if (
    reservation.artifactSha256 !== M8_5_UNTOUCHED_RESERVATION_ARTIFACT_SHA256 ||
    reservation.cohortIdentitySha256 !== M8_5_UNTOUCHED_COHORT_IDENTITY_SHA256 ||
    reservation.dateRange?.startDate !== RESERVED_START_DATE ||
    reservation.dateRange?.endDate !== RESERVED_END_DATE ||
    reservation.dateRange?.dateCount !== 4 ||
    reservation.gameCount !== 54 ||
    reservation.plateAppearanceCount !== 4159 ||
    reservation.rowsIncluded !== false ||
    reservation.outcomesRead !== false ||
    reservation.evaluationRunCount !== 0
  ) {
    throw new Error('reservation artifact does not match the approved sealed cohort.');
  }
  const { artifactSha256, ...identity } = reservation;
  if (artifactSha256 !== sha256Value(identity)) {
    throw new Error('reservation artifact internal SHA-256 is invalid.');
  }
  return Object.freeze({ value: reservation, fileSha256: sha256(text) });
}

function verifyFreezeAndArtifacts(files) {
  const freeze = files.freeze.value;
  if (
    freeze.modelVersion !== 'm8-5-batter-hits-successor-freeze-v1' ||
    freeze.artifactSha256 !== M8_5_FROZEN_SUCCESSOR_ARTIFACT_SHA256 ||
    freeze.productionEnabled !== false ||
    freeze.rankingEnabled !== false ||
    freeze.untouchedTestAccessed !== false
  ) {
    throw new Error('frozen successor identity or safety state drifted.');
  }
  const probabilityArtifacts = verifyFrozenBatterHitsProbabilityArtifacts({
    runtimeManifest: files.runtimeManifest.value,
    completeCandidate: files.completeCandidate.value,
    sharedEnvironment: files.sharedEnvironment.value,
    starterRetention: files.starterRetention.value,
    terminalOutcome: files.terminalOutcome.value,
  });
  const gameEnvironment =
    verifyM8_5GameOffensiveEnvironmentModelArtifactV1(
      files.gameEnvironment.value,
    );
  const teamBullpen = verifyM8_5BatterHitsFactorArtifactV1(
    files.teamBullpen.value,
  );
  const park = verifyM8_5ParkFactorArtifactV1(files.park.value);
  const byKey = new Map(freeze.factors.map((factor) => [factor.factorKey, factor]));
  if (
    byKey.get('gameSpecificOffensiveEnvironment')?.factorArtifactSha256 !==
      gameEnvironment.artifactSha256 ||
    byKey.get('teamSpecificBullpen')?.factorArtifactSha256 !==
      teamBullpen.artifactSha256 ||
    byKey.get('park')?.sourceArtifactSha256 !== park.parkArtifactSha256
  ) {
    throw new Error('frozen successor factor identities drifted from supplied artifacts.');
  }
  return Object.freeze({
    freeze,
    probabilityArtifacts,
    gameEnvironment,
    teamBullpen,
    park,
  });
}

function syntheticOffer(game, observation, teamId, sourceCapturedAt, sourceSha256) {
  const homeTeamName = String(game.home_team_name);
  const awayTeamName = String(game.away_team_name);
  const teamName = observation.side === 'away' ? awayTeamName : homeTeamName;
  return Object.freeze({
    provider: 'the-odds-api',
    providerBookmakerKey: 'underdog',
    providerEventId: `m8-5-acceptance:${game.id}`,
    providerGameId: game.id,
    providerPlayerId: observation.batterId,
    providerTeamId: teamId,
    playerName: `provider-player-${observation.batterId}`,
    teamName,
    homeTeamName,
    awayTeamName,
    eventCommenceTime: game.date,
    baseMarketKey: 'batter-hits',
    providerMarketKey: 'batter_hits',
    offerType: 'baseline',
    selectedSide: 'higher',
    rawSide: 'Over',
    line: 0.5,
    americanPrice: -110,
    multiplier: 1,
    marketLastUpdate: sourceCapturedAt,
    providerOutcomeSid: null,
    providerMarketSid: null,
    providerBookmakerSid: null,
    sourceCapturedAt,
    sourceSnapshotSha256: sourceSha256,
  });
}

function runtimeObservation(gameEvidence, observation, teamId, opponentTeamId) {
  return Object.freeze({
    lineupStatus: 'confirmed',
    providerGameId: gameEvidence.rawGame.id,
    providerPlayerId: observation.batterId,
    providerTeamId: teamId,
    teamSide: observation.side,
    lineupSlot: observation.lineupSlot,
    batterSide: observation.batterSide,
    opposingStarterPitcherId: observation.starterPitcherId,
    opposingStarterTeamId: opponentTeamId,
    opposingStarterHand: observation.starterPitcherHand,
    eligibilityProbability: 1,
    lineupSourceCapturedAt: gameEvidence.plan.gameDate,
    lineupSourceSnapshotSha256: gameEvidence.plan.paSha256,
  });
}

async function main() {
  await assertAbsent(OUTPUT_PATH, 'acceptance result');
  await assertAbsent(LOCK_PATH, 'one-time read lock');
  await access(RESERVATION_PATH);
  await access(SHARD_ROOT);
  await Promise.all(Object.values(ARTIFACT_PATHS).map((filePath) => access(filePath)));

  const [reservationRead, ...artifactReads] = await Promise.all([
    readJson(RESERVATION_PATH, 'M8.5 untouched reservation'),
    ...Object.entries(ARTIFACT_PATHS).map(async ([key, filePath]) => [
      key,
      await readJson(filePath, key),
    ]),
  ]);
  const reservation = verifyReservation(
    reservationRead.value,
    reservationRead.text,
  );
  const files = Object.fromEntries(artifactReads);
  const frozen = verifyFreezeAndArtifacts(files);

  const reservedManifestByPath = new Map(
    reservation.value.sourceManifests.map((entry) => [entry.path, entry.sha256]),
  );
  const reservedPlans = [];
  for (const dateMetadata of reservation.value.reservedDateMetadata) {
    const relativePath = `artifacts/m8-current-season-pa/shards-2026/${dateMetadata.date}/capture-manifest.json`;
    const expectedSha = reservedManifestByPath.get(relativePath);
    if (!expectedSha) {
      throw new Error(`reservation is missing source manifest ${relativePath}.`);
    }
    const plan = await planManifest(relativePath, expectedSha);
    if (plan.date !== dateMetadata.date) {
      throw new Error(`reserved plan date drifted for ${dateMetadata.date}.`);
    }
    reservedPlans.push(plan);
  }
  if (
    reservedPlans.length !== 4 ||
    reservedPlans[0].date !== RESERVED_START_DATE ||
    reservedPlans.at(-1).date !== RESERVED_END_DATE
  ) {
    throw new Error('reserved date plans do not match the approved contiguous cohort.');
  }

  console.log('Frozen successor and reservation verified before untouched PA access.');
  console.log(`Frozen successor: ${frozen.freeze.artifactSha256}`);
  console.log(`Reserved cohort: ${reservation.value.cohortIdentitySha256}`);

  const histories = new Map();
  const priorExclusions = {};
  let priorRawPlateAppearanceCount = 0;
  let priorGameCount = 0;
  let priorIncludedHistoryGameCount = 0;
  const priorManifestHashes = [];
  const plannedPrior = await priorPlans();
  for (const plan of plannedPrior) {
    const dateEvidence = await readPlannedDate(plan);
    priorManifestHashes.push(plan.manifestSha256);
    priorRawPlateAppearanceCount += dateEvidence.rawPlateAppearanceCount;
    priorGameCount += dateEvidence.games.length;
    for (const game of dateEvidence.games) {
      if (game.historyGame === null) {
        increment(priorExclusions, 'prior-history-incomplete-terminal-game');
        continue;
      }
      applyGameToHistory(histories, game.historyGame);
      priorIncludedHistoryGameCount += 1;
    }
  }
  console.log(
    `Strictly earlier current-season history prepared through ${plannedPrior.at(-1).date}.`,
  );

  await mkdir(path.dirname(LOCK_PATH), { recursive: true });
  const lock = await open(LOCK_PATH, 'wx');
  await lock.writeFile(
    `${JSON.stringify(
      {
        purpose: 'One-time M8.5 untouched acceptance read lock.',
        cohortIdentitySha256: reservation.value.cohortIdentitySha256,
        reservationArtifactSha256: reservation.value.artifactSha256,
        frozenSuccessorArtifactSha256: frozen.freeze.artifactSha256,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await lock.close();

  let completed = false;
  try {
    const scoredRows = [];
    const exclusionReasonCounts = {};
    let reservedRawPlateAppearanceCount = 0;
    let reservedPayloadReadCount = 0;
    let includedHistoryGameCount = 0;
    let ignoredBaserunningRowCount = 0;
    let terminalPlateAppearanceCount = 0;
    let excludedTeamSideCount = 0;
    let candidateTeamSideCount = 0;

    for (const plan of reservedPlans) {
      const dateEvidence = await readPlannedDate(plan);
      reservedRawPlateAppearanceCount += dateEvidence.rawPlateAppearanceCount;
      reservedPayloadReadCount += dateEvidence.games.length;
      const historyUpdates = [];

      for (const game of dateEvidence.games) {
        ignoredBaserunningRowCount += game.gradedRows.filter(
          (row) => row.kind === 'ignore-baserunning',
        ).length;
        terminalPlateAppearanceCount += game.gradedRows.filter(
          (row) => row.kind === 'terminal',
        ).length;
        const awayTeamId = positiveInteger(
          game.rawGame.away_team?.id,
          `game ${game.rawGame.id} away team ID`,
        );
        const homeTeamId = positiveInteger(
          game.rawGame.home_team?.id,
          `game ${game.rawGame.id} home team ID`,
        );
        const features = gameFeatures(histories, {
          awayTeamId,
          homeTeamId,
        });
        const recovered = buildM8UntouchedGameObservations({
          observedDate: plan.date,
          gameId: game.rawGame.id,
          gradedRows: game.gradedRows,
        });
        candidateTeamSideCount += 2;
        for (const exclusion of recovered.exclusions) {
          excludedTeamSideCount += 1;
          increment(exclusionReasonCounts, exclusion.reason);
        }
        if (features === null) {
          const recoveredSides = new Set(
            recovered.observations.map((observation) => observation.side),
          );
          excludedTeamSideCount += recoveredSides.size;
          increment(
            exclusionReasonCounts,
            'missing-strictly-earlier-opponent-history',
            recoveredSides.size,
          );
        } else {
          for (const observation of recovered.observations) {
            if (
              observation.batterSide !== 'L' &&
              observation.batterSide !== 'R'
            ) {
              increment(exclusionReasonCounts, 'unsupported-batter-side');
              continue;
            }
            if (
              observation.starterPitcherHand !== 'L' &&
              observation.starterPitcherHand !== 'R'
            ) {
              increment(exclusionReasonCounts, 'unsupported-starter-hand');
              continue;
            }
            const teamId = observation.side === 'away' ? awayTeamId : homeTeamId;
            const opponentTeamId =
              observation.side === 'away' ? homeTeamId : awayTeamId;
            const runtime = runtimeObservation(
              game,
              observation,
              teamId,
              opponentTeamId,
            );
            const offer = syntheticOffer(
              game.rawGame,
              observation,
              teamId,
              plan.capturedAt,
              game.plan.paSha256,
            );
            const evaluatedAt = `${plan.date}T00:00:00.000Z`;
            const baseDistribution = createM8BatterHitsBaseDistribution(
              offer,
              runtime,
              frozen.probabilityArtifacts,
              evaluatedAt,
            );
            const finalComposition = buildM8_5ValidatedFinalDistributionV1({
              sourceBaseDistribution: baseDistribution,
              offer,
              observation: runtime,
              artifacts: frozen.probabilityArtifacts,
              rawGameEnvironmentModelArtifact: frozen.gameEnvironment,
              gameEnvironmentResolutionInput: {
                gameId: String(game.rawGame.id),
                sourceSharedEnvironmentModelVersion:
                  frozen.probabilityArtifacts.sharedEnvironment.modelVersion,
                sourceSharedEnvironmentArtifactSha256:
                  frozen.probabilityArtifacts.sharedEnvironment.artifactSha256,
                scenarioIds: frozen.gameEnvironment.scenarioIds,
                features,
              },
              rawTeamBullpenFactorArtifact: frozen.teamBullpen,
              rawParkFactorArtifact: frozen.park,
            });
            scoredRows.push(
              Object.freeze({
                observationId: observation.observationId,
                actualHits: observation.actualHits,
                dBase: baseDistribution.dBase.statisticDistribution,
                dFinal:
                  finalComposition.finalDistribution.dFinal.statisticDistribution,
              }),
            );
          }
        }
        if (game.historyGame !== null) historyUpdates.push(game.historyGame);
        else increment(exclusionReasonCounts, 'history-update-incomplete-terminal-game');
      }

      for (const game of historyUpdates) {
        applyGameToHistory(histories, game);
        includedHistoryGameCount += 1;
      }
      console.log(`Untouched date scored once: ${plan.date}`);
    }

    if (reservedRawPlateAppearanceCount !== reservation.value.plateAppearanceCount) {
      throw new Error(
        `reserved raw PA count ${reservedRawPlateAppearanceCount} does not equal ${reservation.value.plateAppearanceCount}.`,
      );
    }
    if (reservedPayloadReadCount !== reservation.value.gameCount) {
      throw new Error('reserved PA payload read count does not equal reserved game count.');
    }
    const score = scoreM8_5UntouchedDistributions(scoredRows);
    const evidenceCounts = Object.freeze({
      reservedDateCount: reservation.value.dateRange.dateCount,
      reservedGameCount: reservation.value.gameCount,
      sourcePlateAppearanceCount: reservation.value.plateAppearanceCount,
      reservedRawPlateAppearanceCount,
      reservedPayloadReadCount,
      candidateTeamSideCount,
      excludedTeamSideCount,
      scoredObservationCount: scoredRows.length,
      terminalPlateAppearanceCount,
      ignoredBaserunningRowCount,
      reservedHistoryUpdateGameCount: includedHistoryGameCount,
    });
    const sourceEvidence = Object.freeze({
      reservationFileSha256: reservation.fileSha256,
      reservedManifestSha256s: Object.freeze(
        reservedPlans.map((plan) => plan.manifestSha256),
      ),
      priorHistoryPolicy: Object.freeze({
        currentSeasonOnly: true,
        strictlyEarlierObservedDateOnly: true,
        sameDateOutcomesAvailableToEachOther: false,
        priorSeasonFallback: false,
        excludedGameOffensiveValuesAllowed: false,
      }),
      priorHistoryStartDate: plannedPrior[0].date,
      priorHistoryEndDate: plannedPrior.at(-1).date,
      priorHistoryManifestCount: plannedPrior.length,
      priorHistoryGameCount: priorGameCount,
      priorHistoryIncludedGameCount: priorIncludedHistoryGameCount,
      priorHistoryRawPlateAppearanceCount: priorRawPlateAppearanceCount,
      priorHistoryExclusionReasonCounts: Object.freeze({ ...priorExclusions }),
      priorHistoryManifestSetSha256: sha256Value(priorManifestHashes),
      runtimeArtifactFileSha256s: Object.freeze(
        Object.fromEntries(
          Object.entries(files).map(([key, file]) => [key, sha256(file.text)]),
        ),
      ),
    });
    const artifact = createM8_5UntouchedAcceptanceArtifact({
      reservation: reservation.value,
      freeze: frozen.freeze,
      score,
      evidenceCounts,
      exclusionReasonCounts,
      sourceEvidence,
    });
    verifyM8_5UntouchedAcceptanceArtifact(artifact);
    await writeJsonAtomic(OUTPUT_PATH, artifact);
    const written = await readJson(OUTPUT_PATH, 'written acceptance artifact');
    verifyM8_5UntouchedAcceptanceArtifact(written.value);
    if (written.value.artifactSha256 !== artifact.artifactSha256) {
      throw new Error('written acceptance artifact identity changed.');
    }
    completed = true;

    console.log('=== M8.5 ONE-TIME UNTOUCHED ACCEPTANCE COMPLETE ===');
    console.log(`Status: ${artifact.status}`);
    console.log(`Date span: ${artifact.reservedCohort.dateRange.startDate} through ${artifact.reservedCohort.dateRange.endDate}`);
    console.log(`Source PA: ${artifact.reservedCohort.sourcePlateAppearanceCount}`);
    console.log(`Scored hitter-game observations: ${scoredRows.length}`);
    console.log(`Exclusions: ${JSON.stringify(artifact.exclusionReasonCounts)}`);
    console.log(`D_final categorical log loss: ${score.dFinal.categoricalLogLoss}`);
    console.log(`D_base categorical log loss: ${score.dBase.categoricalLogLoss}`);
    console.log(`D_final categorical Brier: ${score.dFinal.categoricalBrier}`);
    console.log(`D_base categorical Brier: ${score.dBase.categoricalBrier}`);
    console.log(`D_final diagnostics only: ${JSON.stringify(score.dFinal.diagnosticOnly)}`);
    console.log(`D_base diagnostics only: ${JSON.stringify(score.dBase.diagnosticOnly)}`);
    console.log(`D_final proper-score dominates D_base: ${score.comparison.dFinalProperScoreDominatesDBase}`);
    console.log(`Cohort identity: ${artifact.reservedCohort.cohortIdentitySha256}`);
    console.log(`Reservation artifact: ${artifact.reservedCohort.reservationArtifactSha256}`);
    console.log(`Frozen successor: ${artifact.frozenSuccessor.artifactSha256}`);
    console.log(`Evaluation run count: ${artifact.evaluationRunCount}`);
    console.log(`Acceptance artifact SHA-256: ${artifact.artifactSha256}`);
    console.log(`Tracked result: ${OUTPUT_PATH}`);
    console.log(`Limitation: ${artifact.limitation}`);
    console.log('Production enabled: false');
    console.log(JSON.stringify(artifact, null, 2));
  } finally {
    if (completed) {
      await unlink(LOCK_PATH);
    } else {
      console.error(
        `The one-time read lock remains at ${LOCK_PATH}. Do not remove it unless an identical-input retry is explicitly authorized and documented.`,
      );
    }
  }
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
