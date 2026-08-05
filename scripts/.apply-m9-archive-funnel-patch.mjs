import { execFileSync } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';

const ARCHIVE_PATH = 'scripts/archive-m9-batter-hits-board.mjs';
const PACKAGE_PATH = 'package.json';
const EXPECTED_ARCHIVE_BLOB = '976af008508d56839637db5c54f43c1045598b0d';
const EXPECTED_PACKAGE_BLOB = '7b041c264c41c3afcc335480bac88f1e6cabe9fc';

function blobSha(filePath) {
  return execFileSync('git', ['hash-object', filePath], {
    encoding: 'utf8',
  }).trim();
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing patch marker: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Patch marker is not unique: ${label}`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

if (blobSha(ARCHIVE_PATH) !== EXPECTED_ARCHIVE_BLOB) {
  throw new Error('Archive CLI blob drifted before funnel integration.');
}
if (blobSha(PACKAGE_PATH) !== EXPECTED_PACKAGE_BLOB) {
  throw new Error('package.json blob drifted before funnel integration.');
}

let source = await readFile(ARCHIVE_PATH, 'utf8');

source = replaceOnce(
  source,
  "import { requireSecret } from './provider-probe-utils.mjs';\n",
  "import {\n  createM9ArchiveFunnel,\n  persistM9ArchiveForMode,\n  printM9ArchiveFunnelReport,\n} from './m9-board-archive-funnel-utils.mjs';\nimport { requireSecret } from './provider-probe-utils.mjs';\n",
  'funnel import',
);

const prospectiveStart = source.indexOf('function prospectiveEvents(');
const prospectiveEnd = source.indexOf('\nfunction matchGame(', prospectiveStart);
if (prospectiveStart < 0 || prospectiveEnd < 0) {
  throw new Error('Could not locate prospectiveEvents block.');
}
const prospectiveReplacement = `function prospectiveEvents(rawEvents, archiveDate, asOf) {
  const rows = array(rawEvents, 'The Odds API events');
  const asOfMilliseconds = Date.parse(asOf);
  const events = [];
  const dropCounts = new Map();
  const recordDrop = (reason) =>
    dropCounts.set(reason, (dropCounts.get(reason) ?? 0) + 1);

  rows.forEach((raw, index) => {
    const event = object(raw, \`events[\${index}]\`);
    const normalized = Object.freeze({
      id: nonemptyString(event.id, \`events[\${index}].id\`),
      sportKey: nonemptyString(
        event.sport_key,
        \`events[\${index}].sport_key\`,
      ),
      commenceTime: nonemptyString(
        event.commence_time,
        \`events[\${index}].commence_time\`,
      ),
      homeTeamName: exactName(
        event.home_team,
        \`events[\${index}].home_team\`,
      ),
      awayTeamName: exactName(
        event.away_team,
        \`events[\${index}].away_team\`,
      ),
    });
    if (normalized.sportKey !== 'baseball_mlb') {
      recordDrop('unexpected sport key');
      return;
    }
    if (chicagoDate(normalized.commenceTime) !== archiveDate) {
      recordDrop('outside the requested Chicago archive date');
      return;
    }
    if (Date.parse(normalized.commenceTime) <= asOfMilliseconds) {
      recordDrop('game already in progress');
      return;
    }
    events.push(normalized);
  });

  events.sort(
    (left, right) =>
      left.commenceTime.localeCompare(right.commenceTime) ||
      left.id.localeCompare(right.id),
  );
  return Object.freeze({
    providerEventCount: rows.length,
    events: Object.freeze(events),
    drops: Object.freeze(
      [...dropCounts.entries()]
        .map(([reason, count]) => Object.freeze({ reason, count }))
        .sort((left, right) => left.reason.localeCompare(right.reason)),
    ),
  });
}
`;
source = `${source.slice(0, prospectiveStart)}${prospectiveReplacement}${source.slice(prospectiveEnd)}`;

const playerNamesStart = source.indexOf('function offerPlayerNames(');
const playerNamesEnd = source.indexOf('\nfunction lineupRows(', playerNamesStart);
if (playerNamesStart < 0 || playerNamesEnd < 0) {
  throw new Error('Could not locate offerPlayerNames block.');
}
const offerSummaryReplacement = `function rawOfferSummary(rawOdds) {
  const countsByPlayer = new Map();
  let count = 0;
  for (const rawMarket of underdogMarkets(rawOdds)) {
    const market = object(rawMarket, 'market');
    for (const rawOutcome of array(market.outcomes, \`\${market.key}.outcomes\`)) {
      const playerName = exactName(
        object(rawOutcome, 'outcome').description,
        'outcome.description',
      );
      count += 1;
      countsByPlayer.set(
        playerName,
        (countsByPlayer.get(playerName) ?? 0) + 1,
      );
    }
  }
  return Object.freeze({
    count,
    playerNames: Object.freeze([...countsByPlayer.keys()].sort()),
    countsByPlayer,
  });
}

function offerCountForNames(summary, playerNames) {
  return playerNames.reduce(
    (total, playerName) => total + (summary.countsByPlayer.get(playerName) ?? 0),
    0,
  );
}
`;
source = `${source.slice(0, playerNamesStart)}${offerSummaryReplacement}${source.slice(playerNamesEnd)}`;

const identityStart = source.indexOf('function buildPlayerIdentities(');
const identityEnd = source.indexOf('\nfunction runtimeObservation(', identityStart);
if (identityStart < 0 || identityEnd < 0) {
  throw new Error('Could not locate buildPlayerIdentities block.');
}
const identityReplacement = `function buildPlayerIdentities({ event, game, lineupsSnapshot, playerNames }) {
  const gameId = positiveInteger(game.id, 'game.id');
  const rows = lineupRows(lineupsSnapshot);
  const identities = [];
  const identityExclusions = [];
  const lineupExclusions = [];
  const identityResolvedPlayerNames = [];
  const lineupResolvedPlayerNames = [];

  for (const playerName of playerNames) {
    const matches = rows.filter((raw, index) => {
      const row = object(raw, \`lineups[\${index}]\`);
      return (
        row.game_id === gameId &&
        row.is_probable_pitcher === false &&
        lineupPlayer(row, \`lineups[\${index}]\`).fullName === playerName
      );
    });
    if (matches.length !== 1) {
      identityExclusions.push(
        Object.freeze({
          providerEventId: event.id,
          playerName,
          reason: matches.length === 0 ? 'ZERO_MATCHES' : 'MULTIPLE_MATCHES',
          matchCount: matches.length,
        }),
      );
      continue;
    }

    identityResolvedPlayerNames.push(playerName);
    const row = object(matches[0], \`lineup identity \${playerName}\`);
    if (battingOrder(row) === null) {
      lineupExclusions.push(
        Object.freeze({
          providerEventId: event.id,
          playerName,
          reason: 'NO_ACTIVE_LINEUP_EVIDENCE',
        }),
      );
      continue;
    }

    const player = lineupPlayer(row, \`lineup identity \${playerName}\`);
    const team = lineupTeam(row, \`lineup identity \${playerName}\`);
    lineupResolvedPlayerNames.push(playerName);
    identities.push(
      Object.freeze({
        providerEventId: event.id,
        offerPlayerName: playerName,
        providerGameId: gameId,
        providerPlayerId: player.id,
        providerTeamId: team.id,
        playerName: player.fullName,
        teamName: team.displayName,
      }),
    );
  }
  return Object.freeze({
    identities: Object.freeze(identities),
    identityExclusions: Object.freeze(identityExclusions),
    lineupExclusions: Object.freeze(lineupExclusions),
    identityResolvedPlayerNames: Object.freeze(identityResolvedPlayerNames),
    lineupResolvedPlayerNames: Object.freeze(lineupResolvedPlayerNames),
  });
}
`;
source = `${source.slice(0, identityStart)}${identityReplacement}${source.slice(identityEnd)}`;

const runStart = source.indexOf('export async function runM9ProspectiveBoardArchive(');
const runEnd = source.indexOf('\nconst invokedPath = process.argv[1];', runStart);
if (runStart < 0 || runEnd < 0) {
  throw new Error('Could not locate live archive run block.');
}
const runReplacement = `export async function runM9ProspectiveBoardArchive({
  now = new Date(),
  outputRoot = path.join('artifacts', 'board-archives', 'batter-hits'),
  shardRoot =
    process.env.M8_CURRENT_SEASON_SHARD_ROOT?.trim() ||
    'artifacts/m8-current-season-pa/shards-2026',
  dryRun = false,
  output = process.stdout,
} = {}) {
  if (typeof dryRun !== 'boolean') {
    throw new TypeError('dryRun must be a boolean.');
  }
  if (output === null || typeof output.write !== 'function') {
    throw new TypeError('output must expose write(text).');
  }

  assertProductionDisabled();
  const registryBefore = JSON.stringify(PRODUCTION_REGISTRIES);
  const capturedAt = now.toISOString();
  const archiveDate = chicagoDate(now);
  const filePath = m9ArchiveFilePath(outputRoot, archiveDate);
  const funnel = createM9ArchiveFunnel({ archiveDate, dryRun });
  let reportPrinted = false;
  const write = (text) => output.write(text);
  const printFunnel = (status) => {
    if (reportPrinted) return;
    printM9ArchiveFunnelReport({ funnel, status, write });
    reportPrinted = true;
  };

  try {
    if (!dryRun) await assertArchiveAbsent(filePath);

    const oddsApiKey = requireSecret('THE_ODDS_API_KEY');
    const bdlApiKey = requireSecret('BALLDONTLIE_API_KEY');
    const rateLimiter = createBdlAdaptiveRateLimiter({
      fallbackDelayMs: 13_000,
      utilization: 0.9,
    });
    const fetchOdds = (request) =>
      fetchExactJsonSnapshot({
        provider: 'The Odds API',
        ...request,
      });
    const fetchBdl = async (request) => {
      for (let attempt = 0; attempt <= 8; attempt += 1) {
        const snapshot = await fetchExactJsonSnapshot({
          provider: 'BALLDONTLIE MLB API',
          ...request,
          headers: { Authorization: bdlApiKey },
          beforeRequest: () => rateLimiter.beforeRequest(),
          afterResponse: (response) => rateLimiter.afterResponse(response),
          allowNonOk: true,
        });
        if (snapshot.response.status === 429) {
          if (attempt === 8) {
            throw new Error(\`\${request.label} exceeded eight HTTP 429 retries.\`);
          }
          await rateLimiter.waitForRetry();
          continue;
        }
        if (
          snapshot.response.status < 200 ||
          snapshot.response.status >= 300
        ) {
          throw new Error(
            \`\${request.label} returned HTTP \${snapshot.response.status} \${snapshot.response.statusText}.\`,
          );
        }
        return snapshot;
      }
      throw new Error(\`Unreachable retry state for \${request.label}.\`);
    };

    const histories = await buildStrictlyEarlierTeamHistories({
      archiveDate,
      shardRoot,
    });
    const providerSnapshots = [];
    const normalizedOffers = [];
    const candidateEvaluations = [];
    const exclusions = [];
    const environmentEvidence = [];

    const eventsUrl = new URL(
      'https://api.the-odds-api.com/v4/sports/baseball_mlb/events',
    );
    eventsUrl.searchParams.set('apiKey', oddsApiKey);
    eventsUrl.searchParams.set('dateFormat', 'iso');
    const eventsSnapshot = await fetchOdds({
      label: 'The Odds API MLB events',
      url: eventsUrl,
      requireNonemptyRecords: true,
    });
    providerSnapshots.push(eventsSnapshot);
    const eventSelection = prospectiveEvents(
      eventsSnapshot.parsedBody,
      archiveDate,
      capturedAt,
    );
    funnel.add('providerEvents', {
      entered: eventSelection.providerEventCount,
      survived: eventSelection.providerEventCount,
    });
    funnel.add('pregameEvents', {
      entered: eventSelection.providerEventCount,
      survived: eventSelection.events.length,
    });
    eventSelection.drops.forEach((drop) =>
      funnel.drop('pregameEvents', drop.reason, drop.count),
    );
    if (eventSelection.events.length === 0) {
      throw new Error(
        \`No pregame MLB events survived the started-game gate for \${archiveDate}.\`,
      );
    }

    const gamesUrl = new URL('https://api.balldontlie.io/mlb/v1/games');
    gamesUrl.searchParams.append('dates[]', archiveDate);
    gamesUrl.searchParams.set('season_type', 'regular');
    gamesUrl.searchParams.set('per_page', '100');
    const gamesSnapshot = await fetchBdl({
      label: \`BALLDONTLIE games \${archiveDate}\`,
      url: gamesUrl,
      requireNonemptyRecords: true,
    });
    providerSnapshots.push(gamesSnapshot);

    for (const event of eventSelection.events) {
      let oddsSnapshot;
      let rawOffers;
      try {
        const oddsUrl = new URL(
          \`https://api.the-odds-api.com/v4/sports/baseball_mlb/events/\${event.id}/odds\`,
        );
        oddsUrl.searchParams.set('apiKey', oddsApiKey);
        oddsUrl.searchParams.set('bookmakers', 'underdog');
        oddsUrl.searchParams.set('markets', TARGET_MARKETS.join(','));
        oddsUrl.searchParams.set('dateFormat', 'iso');
        oddsUrl.searchParams.set('oddsFormat', 'american');
        oddsUrl.searchParams.set('includeMultipliers', 'true');
        oddsUrl.searchParams.set('includeSids', 'true');
        oddsSnapshot = await fetchOdds({
          label: \`Underdog Batter Hits \${event.id}\`,
          url: oddsUrl,
          requireNonemptyRecords: true,
        });
        providerSnapshots.push(oddsSnapshot);
        rawOffers = rawOfferSummary(oddsSnapshot.parsedBody);
      } catch (error) {
        exclusions.push({
          providerEventId: event.id,
          reason: 'EVENT_ODDS_FAILED_CLOSED',
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      funnel.add('rawOffers', {
        entered: rawOffers.count,
        survived: rawOffers.count,
      });
      if (rawOffers.count === 0) {
        exclusions.push({
          providerEventId: event.id,
          reason: 'NO_BATTER_HITS_OFFERS',
        });
        continue;
      }

      funnel.add('matchedGameOffers', { entered: rawOffers.count });
      let game;
      try {
        game = matchGame(event, gamesSnapshot.parsedBody);
      } catch (error) {
        const reason = /found 0\./u.test(
          error instanceof Error ? error.message : String(error),
        )
          ? 'no exact current-season game match'
          : 'multiple exact current-season game matches';
        funnel.drop('matchedGameOffers', reason, rawOffers.count);
        exclusions.push({
          providerEventId: event.id,
          homeTeamName: event.homeTeamName,
          awayTeamName: event.awayTeamName,
          reason: 'GAME_MATCH_FAILED_CLOSED',
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      let lineups;
      try {
        lineups = await captureLineups({ gameId: game.id, fetchBdl });
        providerSnapshots.push(...lineups.snapshots);
      } catch (error) {
        funnel.add('matchedGameOffers', { survived: rawOffers.count });
        funnel.add('resolvedIdentityOffers', {
          entered: rawOffers.count,
          survived: 0,
        });
        funnel.drop(
          'resolvedIdentityOffers',
          'lineup evidence unavailable for identity resolution',
          rawOffers.count,
        );
        exclusions.push({
          providerEventId: event.id,
          reason: 'LINEUP_EVIDENCE_FAILED_CLOSED',
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const identities = buildPlayerIdentities({
        event,
        game,
        lineupsSnapshot: lineups.body,
        playerNames: rawOffers.playerNames,
      });
      const identitySurvived = offerCountForNames(
        rawOffers,
        identities.identityResolvedPlayerNames,
      );
      funnel.add('resolvedIdentityOffers', {
        entered: rawOffers.count,
        survived: identitySurvived,
      });
      identities.identityExclusions.forEach((entry) => {
        funnel.drop(
          'resolvedIdentityOffers',
          entry.reason === 'ZERO_MATCHES' ? 'zero matches' : 'multiple matches',
          rawOffers.countsByPlayer.get(entry.playerName) ?? 0,
        );
      });
      const lineupSurvived = offerCountForNames(
        rawOffers,
        identities.lineupResolvedPlayerNames,
      );
      funnel.add('lineupEvidenceOffers', {
        entered: identitySurvived,
        survived: lineupSurvived,
      });
      identities.lineupExclusions.forEach((entry) => {
        funnel.drop(
          'lineupEvidenceOffers',
          'no confirmed or projected active lineup evidence',
          rawOffers.countsByPlayer.get(entry.playerName) ?? 0,
        );
      });
      exclusions.push(...identities.identityExclusions, ...identities.lineupExclusions);

      const board = connectPregameBatterHitsBoard({
        rawEventSnapshot: oddsSnapshot.parsedBody,
        sourceSnapshotSha256: oddsSnapshot.rawBody.sha256,
        sourceCapturedAt: oddsSnapshot.capturedAt,
        playerIdentities: identities.identities,
        rawGamesSnapshot: gamesSnapshot.parsedBody,
        gameSourceSnapshotSha256: gamesSnapshot.rawBody.sha256,
        gameSourceCapturedAt: gamesSnapshot.capturedAt,
        asOf: capturedAt,
      });
      const pregameExcludedCount = board.excludedOffers.length;
      funnel.add('matchedGameOffers', {
        survived: rawOffers.count - pregameExcludedCount,
      });
      board.excludedOffers.forEach((entry) => {
        const reason =
          entry.reason === 'GAME_START_REACHED'
            ? 'game already in progress'
            : entry.reason === 'GAME_STATUS_NOT_SCHEDULED'
              ? 'game status not scheduled'
              : 'game state unresolved';
        funnel.drop('matchedGameOffers', reason, 1);
      });
      normalizedOffers.push(...board.offers);
      exclusions.push(
        ...board.rejectedOffers.map((entry) => ({
          providerEventId: event.id,
          reason: entry.reason,
          playerName: entry.playerDescription,
          side: entry.rawSide,
          postedLine: entry.line,
          matchCount: entry.matchCount,
        })),
        ...board.excludedOffers.map((entry) => ({
          providerEventId: event.id,
          reason: entry.reason,
          playerName: entry.offer.playerName,
          side: entry.offer.selectedSide,
          postedLine: entry.offer.line,
        })),
      );

      const observations = [];
      funnel.add('verifiedStarterOffers', { entered: board.offers.length });
      for (const offer of board.offers) {
        try {
          observations.push(
            Object.freeze({
              offer,
              observation: runtimeObservation({
                offer,
                game,
                lineupsSnapshot: lineups.body,
                lineupSnapshot: lineups,
              }),
            }),
          );
          funnel.add('verifiedStarterOffers', { survived: 1 });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          funnel.drop(
            'verifiedStarterOffers',
            /verified opposing starter/u.test(detail)
              ? 'no verified opposing starter'
              : 'runtime observation failed before starter verification',
            1,
          );
          exclusions.push({
            providerEventId: event.id,
            playerName: offer.playerName,
            side: offer.selectedSide,
            postedLine: offer.line,
            reason: 'RUNTIME_OBSERVATION_FAILED_CLOSED',
            detail,
          });
        }
      }
      if (observations.length === 0) continue;

      funnel.add('historyOffers', { entered: observations.length });
      let environment;
      try {
        environment = await gameEnvironmentResolutionInput(
          game,
          histories.histories,
        );
        funnel.add('historyOffers', { survived: observations.length });
      } catch (error) {
        funnel.drop(
          'historyOffers',
          'insufficient strictly-earlier current-season history',
          observations.length,
        );
        observations.forEach(({ offer }) =>
          exclusions.push({
            providerEventId: event.id,
            playerName: offer.playerName,
            side: offer.selectedSide,
            postedLine: offer.line,
            reason: 'HISTORY_FAILED_CLOSED',
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
        continue;
      }
      environmentEvidence.push(
        Object.freeze({
          providerGameId: game.id,
          input: environment.input,
          evidence: environment.evidence,
        }),
      );

      funnel.add('composedCandidates', { entered: observations.length });
      for (const { offer, observation } of observations) {
        try {
          const result = await connectFrozenBatterHitsProbabilityOutput({
            pregameBoard: board,
            offer,
            observation,
            gameEnvironmentResolutionInput: environment.input,
          });
          candidateEvaluations.push(Object.freeze({ offer, result }));
          funnel.add('composedCandidates', { survived: 1 });
        } catch (error) {
          funnel.drop(
            'composedCandidates',
            'D_final composition failed closed',
            1,
          );
          exclusions.push({
            providerEventId: event.id,
            playerName: offer.playerName,
            side: offer.selectedSide,
            postedLine: offer.line,
            reason: 'CANDIDATE_FAILED_CLOSED',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const candidates = Object.freeze(
      candidateEvaluations.map((entry) => entry.result.candidate),
    );
    let ranking = Object.freeze({
      rankedCandidates: Object.freeze([]),
      excludedCandidates: Object.freeze([]),
    });
    if (candidates.length > 0) {
      ranking = rankPredictionCandidates({
        candidates,
        registries: testOnlyRankingAuthorization(candidates),
      });
    }
    funnel.add('rankedCandidates', {
      entered: candidates.length,
      survived: ranking.rankedCandidates.length,
    });
    ranking.excludedCandidates.forEach((entry) =>
      funnel.drop('rankedCandidates', entry.reason, 1),
    );

    if (
      normalizedOffers.length === 0 ||
      candidateEvaluations.length === 0 ||
      ranking.rankedCandidates.length === 0
    ) {
      throw new Error(
        'Live provider evidence produced no rankable Batter Hits candidates; see the funnel report above.',
      );
    }

    assertProductionDisabled();
    if (JSON.stringify(PRODUCTION_REGISTRIES) !== registryBefore) {
      throw new Error('Live archive execution mutated the production registries.');
    }

    const archive = buildM9ProspectiveBoardArchive({
      archiveDate,
      capturedAt,
      providerSnapshots,
      normalizedOffers,
      candidateEvaluations,
      ranking,
      exclusions,
      evidence: Object.freeze({
        liveBoard: true,
        fixtureBackedEvidence: false,
        productionRegistryUnchanged: true,
        historicalGameEnvironment: histories.evidence,
        gameEnvironmentInputs: Object.freeze(environmentEvidence),
      }),
    });
    const persisted = await persistM9ArchiveForMode({
      dryRun,
      filePath,
      archive,
      persist: persistImmutableM9BoardArchive,
    });

    printFunnel('SUCCESS');
    write(
      [
        'M9 Prospective Batter Hits Board Archive',
        'PRODUCTION RANKING: DISABLED',
        \`MODE: \${dryRun ? 'DRY RUN — NO ARCHIVE WRITTEN' : 'IMMUTABLE ARCHIVE'}\`,
        \`ARCHIVE: \${persisted === null ? 'NOT WRITTEN (--dry-run)' : persisted.filePath}\`,
        \`ARCHIVE SHA-256: \${archive.archiveSha256}\`,
        ...(persisted === null
          ? []
          : [\`FILE SHA-256: \${persisted.fileSha256}\`]),
        \`RAW PROVIDER SNAPSHOTS: \${archive.counts.providerSnapshotCount}\`,
        \`NORMALIZED OFFERS: \${archive.counts.normalizedOfferCount}\`,
        \`RANKED CANDIDATES: \${archive.counts.rankedCandidateCount}\`,
        \`EXCLUSIONS: \${archive.counts.exclusionCount}\`,
        '',
      ].join('\\n'),
    );
    return Object.freeze({
      archive,
      persisted,
      dryRun,
      funnel: funnel.snapshot(),
    });
  } catch (error) {
    printM9ArchiveFunnelReport({
      funnel,
      status: 'FAILED CLOSED',
      write,
    });
    reportPrinted = true;
    throw error;
  }
}

export async function main(args = process.argv.slice(2)) {
  const dryRun = args.length === 1 && args[0] === '--dry-run';
  if (!(args.length === 0 || dryRun)) {
    throw new Error(
      'Usage: node scripts/archive-m9-batter-hits-board.mjs [--dry-run]',
    );
  }
  await runM9ProspectiveBoardArchive({ dryRun });
}
`;
source = `${source.slice(0, runStart)}${runReplacement}${source.slice(runEnd)}`;

let packageSource = await readFile(PACKAGE_PATH, 'utf8');
packageSource = replaceOnce(
  packageSource,
  'node --check scripts/m9-board-archive-utils.mjs && node --check scripts/archive-m9-batter-hits-board.mjs',
  'node --check scripts/m9-board-archive-utils.mjs && node --check scripts/m9-board-archive-funnel-utils.mjs && node --check scripts/archive-m9-batter-hits-board.mjs',
  'check:scripts archive entries',
);

await writeFile(ARCHIVE_PATH, source);
await writeFile(PACKAGE_PATH, packageSource);
await rm('scripts/.apply-m9-archive-funnel-patch.mjs');
await rm('.github/workflows/apply-m9-archive-funnel-patch.yml');
