import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  formatBallDontLieGameMatchDiagnostic,
  resolveExactBallDontLieGameMatch,
} from '../scripts/archive-m9-batter-hits-board.mjs';
import {
  FUNNEL_STAGE_DEFINITIONS,
} from '../scripts/m9-board-archive-funnel-utils.mjs';

const LIVE_SCRIPT = 'scripts/archive-m9-batter-hits-board.mjs';
const ARCHIVE_UTILS = 'scripts/m9-board-archive-utils.mjs';
const FUNNEL_UTILS = 'scripts/m9-board-archive-funnel-utils.mjs';

function checkSyntax(filePath) {
  const result = spawnSync(process.execPath, ['--check', filePath], {
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    `${filePath} failed node --check:\n${result.stdout}\n${result.stderr}`,
  );
}

test('prospective archive scripts parse and the BDL 429 retry remains reachable without weakening other HTTP failures', async () => {
  checkSyntax(ARCHIVE_UTILS);
  checkSyntax(FUNNEL_UTILS);
  checkSyntax(LIVE_SCRIPT);

  const [source, archiveUtils, funnelUtils, packageText] = await Promise.all([
    readFile(LIVE_SCRIPT, 'utf8'),
    readFile(ARCHIVE_UTILS, 'utf8'),
    readFile(FUNNEL_UTILS, 'utf8'),
    readFile('package.json', 'utf8'),
  ]);
  const archivePathSource = `${source}\n${archiveUtils}\n${funnelUtils}`;
  assert.doesNotMatch(archivePathSource, /America\/Chicago|chicagoDate|ARCHIVE_TIME_ZONE|outside the requested Chicago archive date/u);
  assert.match(source, /eventUtcDates/u);
  assert.match(source, /for \(const date of eventUtcDates\)/u);
  assert.match(
    source,
    /gamesUrl\.searchParams\.append\('dates\[\]', date\)/u,
  );
  assert.doesNotMatch(
    source,
    /eventUtcDates\.forEach\(\(date\) => gamesUrl\.searchParams\.append/u,
  );
  assert.match(source, /resolveExactBallDontLieGameMatch/u);
  assert.match(source, /formatBallDontLieGameMatchDiagnostic/u);
  assert.match(source, /createM9CaptureIdentity/u);
  assert.match(source, /allowNonOk = false/u);
  assert.match(source, /allowNonOk: true/u);
  assert.match(source, /snapshot\.response\.status === 429/u);
  assert.match(source, /await rateLimiter\.waitForRetry\(\);\s*continue;/u);
  assert.match(
    source,
    /snapshot\.response\.status < 200[\s\S]*snapshot\.response\.status >= 300/u,
  );

  const packageJson = JSON.parse(packageText);
  assert.match(
    packageJson.scripts['check:scripts'],
    /node --check scripts\/m9-board-archive-utils\.mjs/u,
  );
  assert.match(
    packageJson.scripts['check:scripts'],
    /node --check scripts\/archive-m9-batter-hits-board\.mjs/u,
  );

  await assert.rejects(
    access('scripts/__apply-m9-board-archive-runtime-fix.mjs'),
    /ENOENT/u,
  );
  await assert.rejects(
    access('.github/workflows/__apply-m9-board-archive-runtime-fix.yml'),
    /ENOENT/u,
  );
  await assert.rejects(
    access('scripts/__apply-m9-game-id-dedupe.mjs'),
    /ENOENT/u,
  );
  await assert.rejects(
    access('.github/workflows/__apply-m9-game-id-dedupe.yml'),
    /ENOENT/u,
  );
});

function fixtureEvent() {
  return Object.freeze({
    id: 'odds-event-1',
    eventId: 'odds-event-1',
    commenceTimeUtc: '2026-08-05T00:06:00.000Z',
    homeTeamName: 'Home Club',
    awayTeamName: 'Away Club',
  });
}

function fixtureGame({ id, date }) {
  return Object.freeze({
    id,
    home_team_name: 'Home Club',
    away_team_name: 'Away Club',
    season: 2026,
    season_type: 'regular',
    postseason: false,
    date,
  });
}

function fixtureQuery(queryDateUtc, games, digestCharacter) {
  return Object.freeze({
    queryDateUtc,
    snapshot: Object.freeze({
      parsedBody: Object.freeze({ data: Object.freeze(games) }),
      rawBody: Object.freeze({ sha256: digestCharacter.repeat(64) }),
      capturedAt: '2026-08-05T02:33:12.849Z',
    }),
  });
}

test('identical provider game IDs returned by overlapping date queries deduplicate with complete provenance', () => {
  const event = fixtureEvent();
  const game = fixtureGame({
    id: 7001,
    date: '2026-08-05T00:06:00.000Z',
  });
  const august4 = fixtureQuery('2026-08-04', [game], 'a');
  const august5 = fixtureQuery('2026-08-05', [game], 'b');
  const resolution = resolveExactBallDontLieGameMatch({
    event,
    gameQuerySnapshots: [august4, august5],
  });

  assert.equal(resolution.status, 'duplicate-fetch-artifact');
  assert.deepEqual(resolution.uniqueProviderGameIds, [7001]);
  assert.deepEqual(resolution.matches, [
    {
      providerGameId: 7001,
      gameDateUtc: '2026-08-05T00:06:00.000Z',
      queryDateUtc: '2026-08-04',
    },
    {
      providerGameId: 7001,
      gameDateUtc: '2026-08-05T00:06:00.000Z',
      queryDateUtc: '2026-08-05',
    },
  ]);
  assert.equal(resolution.game, game);
  assert.equal(resolution.sourceSnapshot, august5.snapshot);

  const diagnostic = formatBallDontLieGameMatchDiagnostic({
    event,
    rawOfferCount: 12,
    resolution,
  });
  assert.match(diagnostic, /providerGameId=7001/u);
  assert.match(diagnostic, /gameDate=2026-08-05T00:06:00.000Z/u);
  assert.match(diagnostic, /queryDate=2026-08-04/u);
  assert.match(diagnostic, /queryDate=2026-08-05/u);
  assert.match(
    diagnostic,
    /DUPLICATE FETCH ARTIFACT — deduplicated by exact provider game ID/u,
  );
});

test('different provider game IDs remain a genuine ambiguity and are never selected', () => {
  const event = fixtureEvent();
  const resolution = resolveExactBallDontLieGameMatch({
    event,
    gameQuerySnapshots: [
      fixtureQuery('2026-08-04', [
        fixtureGame({
          id: 7001,
          date: '2026-08-05T00:06:00.000Z',
        }),
      ], 'a'),
      fixtureQuery('2026-08-05', [
        fixtureGame({
          id: 7002,
          date: '2026-08-05T00:06:00.000Z',
        }),
      ], 'b'),
    ],
  });

  assert.equal(resolution.status, 'genuine-ambiguity');
  assert.deepEqual(resolution.uniqueProviderGameIds, [7001, 7002]);
  assert.equal(resolution.game, null);
  assert.equal(resolution.sourceSnapshot, null);
  const diagnostic = formatBallDontLieGameMatchDiagnostic({
    event,
    rawOfferCount: 12,
    resolution,
  });
  assert.match(diagnostic, /providerGameId=7001/u);
  assert.match(diagnostic, /providerGameId=7002/u);
  assert.match(
    diagnostic,
    /GENUINE AMBIGUITY — no deduplication or arbitrary selection/u,
  );
});

test('funnel stage order follows the live execution sequence', () => {
  assert.deepEqual(
    FUNNEL_STAGE_DEFINITIONS.map((definition) => definition.key),
    [
      'providerEvents',
      'pregameEvents',
      'rawOffers',
      'matchedGameOffers',
      'resolvedIdentityOffers',
      'lineupEvidenceOffers',
      'verifiedStarterOffers',
      'historyOffers',
      'composedCandidates',
      'rankedCandidates',
    ],
  );
});
