import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import {
  HHR_DISPLAY_APP_CSS,
  HHR_DISPLAY_APP_JS,
  HHR_DISPLAY_SESSION_COOKIE,
} from '../src/adapters/index.js';
import type {
  HhrDisplayArchive,
  HhrDisplayArchiveRepository,
} from '../src/application/index.js';
import {
  createHhrDisplayAppServer,
  resolveHhrDisplayServerPassword,
} from '../src/composition/index.js';

const PASSWORD = 'phase4-test-password';
const SESSION_TOKEN = 'phase4-test-session-token-1234567890';

function fixtureArchive(): HhrDisplayArchive {
  const starter = Object.freeze({
    name: 'Test Starter',
    throwingHand: 'R',
    era: 3.21,
    last10: Object.freeze({
      starts: 10,
      inningsPitched: '61.1',
      earnedRuns: 22,
      strikeouts: 67,
      whip: 1.14,
    }),
    season: Object.freeze({
      inningsPitched: 132.2,
      earnedRuns: 49,
      strikeouts: 141,
      whip: 1.19,
    }),
  });
  return Object.freeze({
    captureKey: '20260811T180000000Z--aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    capturedAt: '2026-08-11T18:00:00.000Z',
    modelVersion: 'hhr-model-v1',
    distributionBuilderVersion: 'hhr-distribution-v1',
    rows: Object.freeze([
      Object.freeze({
        rank: 1,
        providerEventId: 'event-lower',
        providerGameId: 101,
        providerPlayerId: 202,
        providerTeamId: 303,
        playerName: 'Lower Batter',
        teamName: 'Home Club',
        homeTeamName: 'Home Club',
        awayTeamName: 'Away Club',
        eventCommenceTime: '2026-08-12T00:10:00.000Z',
        baseMarketKey: 'batter_hits_runs_rbis',
        providerMarketKey: 'batter_hits_runs_rbis_alternate',
        marketLabel: 'Batter Hits + Runs + RBIs',
        offerType: 'alternate',
        settlementStatistic: 'hits+runs+rbi',
        selectedSide: 'lower',
        postedLine: 2.5,
        americanPrice: -125,
        multiplier: 0.85,
        pWin: 0.716,
        pLoss: 0.264,
        pVoid: 0.02,
        pWinGivenGrades: 0.7306122448979592,
        lineupStatus: 'projected',
      }),
      Object.freeze({
        rank: 2,
        providerEventId: 'event-higher',
        providerGameId: 102,
        providerPlayerId: 203,
        providerTeamId: 304,
        playerName: 'Higher Batter',
        teamName: 'Away Club',
        homeTeamName: 'Home Club',
        awayTeamName: 'Away Club',
        eventCommenceTime: '2026-08-12T00:10:00.000Z',
        baseMarketKey: 'batter_hits_runs_rbis',
        providerMarketKey: 'batter_hits_runs_rbis_alternate',
        marketLabel: 'Batter Hits + Runs + RBIs',
        offerType: 'alternate',
        settlementStatistic: 'hits+runs+rbi',
        selectedSide: 'higher',
        postedLine: 0.5,
        americanPrice: -150,
        multiplier: 0.78,
        pWin: 0.65,
        pLoss: 0.35,
        pVoid: 0,
        pWinGivenGrades: 0.65,
        lineupStatus: 'confirmed',
      }),
    ]),
    enrichmentByGamePlayerKey: Object.freeze({
      '101:202': Object.freeze({
        providerGameId: 101,
        providerPlayerId: 202,
        lastFiveGames: Object.freeze({
          count: 1,
          games: Object.freeze([
            Object.freeze({
              gameDate: '2026-08-10',
              opponentTeamName: 'Previous Opponent',
              opponentAbbreviation: 'PRE',
              homeOrAway: 'away',
              hits: 1,
              runs: 1,
              rbi: 1,
              hrr: 3,
              atBats: 4,
              plateAppearances: 4,
              totalBases: 1,
            }),
          ]),
          failureReason: null,
        }),
        opposingStarter: starter,
      }),
      '102:203': Object.freeze({
        providerGameId: 102,
        providerPlayerId: 203,
        lastFiveGames: Object.freeze({
          count: 1,
          games: Object.freeze([
            Object.freeze({
              gameDate: '2026-08-10',
              opponentTeamName: 'Previous Opponent',
              opponentAbbreviation: 'PRE',
              homeOrAway: 'home',
              hits: 1,
              runs: 0,
              rbi: 0,
              hrr: 1,
              atBats: 4,
              plateAppearances: 4,
              totalBases: 1,
            }),
          ]),
          failureReason: null,
        }),
        opposingStarter: starter,
      }),
    }),
  });
}

async function withAppServer(
  repository: HhrDisplayArchiveRepository,
  check: (origin: string) => Promise<void>,
): Promise<void> {
  const server = createHhrDisplayAppServer({
    repository,
    password: PASSWORD,
    sessionToken: SESSION_TOKEN,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const origin = `http://127.0.0.1:${(address as AddressInfo).port}`;
  try {
    await check(origin);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function login(origin: string, password: string): Promise<Response> {
  return fetch(`${origin}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-forwarded-proto': 'https',
    },
    body: new URLSearchParams({ password }).toString(),
  });
}

function sessionCookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie !== null);
  return setCookie.split(';')[0]!;
}

function expectedCalibrationLabel(
  n: number,
  predicted: number,
  observedMinusPredicted: number,
): 'CALIBRATED' | 'OVERCONFIDENT' | 'UNDERCONFIDENT' {
  const standardError = Math.sqrt((predicted * (1 - predicted)) / n);
  if (Math.abs(observedMinusPredicted) <= 2 * standardError) return 'CALIBRATED';
  return observedMinusPredicted < 0 ? 'OVERCONFIDENT' : 'UNDERCONFIDENT';
}

test('Phase 4 password configuration fails closed with no default credential', () => {
  assert.throws(() => resolveHhrDisplayServerPassword(undefined), /HHR_DISPLAY_PASSWORD/u);
  assert.throws(() => resolveHhrDisplayServerPassword(''), /HHR_DISPLAY_PASSWORD/u);
  assert.equal(resolveHhrDisplayServerPassword(PASSWORD), PASSWORD);
});

test('public health and login assets never read the board while protected routes require authentication', async () => {
  let reads = 0;
  const repository: HhrDisplayArchiveRepository = Object.freeze({
    async readLatest() {
      reads += 1;
      return fixtureArchive();
    },
  });
  await withAppServer(repository, async (origin) => {
    const health = await fetch(`${origin}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const css = await fetch(`${origin}/app.css`);
    assert.equal(css.status, 200);
    assert.equal(await css.text(), HHR_DISPLAY_APP_CSS);

    const root = await fetch(`${origin}/`, { redirect: 'manual' });
    assert.equal(root.status, 303);
    assert.equal(root.headers.get('location'), '/login');

    const api = await fetch(`${origin}/api/hhr-display-board`);
    assert.equal(api.status, 401);
    assert.deepEqual(await api.json(), { error: 'authentication-required' });

    const script = await fetch(`${origin}/app.js`);
    assert.equal(script.status, 401);
    assert.equal(reads, 0);
  });
});

test('login uses an HttpOnly strict session cookie and rejects a wrong password without a session', async () => {
  const repository: HhrDisplayArchiveRepository = Object.freeze({ readLatest: async () => fixtureArchive() });
  await withAppServer(repository, async (origin) => {
    const wrong = await login(origin, 'wrong-password');
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get('set-cookie'), null);
    assert.match(await wrong.text(), /Incorrect password/u);

    const accepted = await login(origin, PASSWORD);
    assert.equal(accepted.status, 303);
    assert.equal(accepted.headers.get('location'), '/');
    const setCookie = accepted.headers.get('set-cookie');
    assert.ok(setCookie !== null);
    assert.match(setCookie, new RegExp(`^${HHR_DISPLAY_SESSION_COOKIE}=`));
    assert.match(setCookie, /HttpOnly/u);
    assert.match(setCookie, /SameSite=Strict/u);
    assert.match(setCookie, /Secure/u);
  });
});

test('authenticated app renders delivered order and API preserves probabilities plus core-derived last-five outcomes', async () => {
  let reads = 0;
  const repository: HhrDisplayArchiveRepository = Object.freeze({
    async readLatest() {
      reads += 1;
      return fixtureArchive();
    },
  });
  await withAppServer(repository, async (origin) => {
    const accepted = await login(origin, PASSWORD);
    const cookie = sessionCookieFrom(accepted);
    const authHeaders = { cookie };

    const root = await fetch(`${origin}/`, { headers: authHeaders });
    assert.equal(root.status, 200);
    const html = await root.text();
    assert.match(html, /High Probability Altline Props/u);
    assert.match(html, /HHR 2\.5 Lower Alt/u);
    assert.match(html, /HHR 0\.5 Higher Alt/u);
    assert.match(html, /id="hhr-25-lower-evidence"/u);
    assert.match(html, /id="hhr-05-higher-evidence"/u);
    assert.match(html, /Board freshness/u);

    const scriptResponse = await fetch(`${origin}/app.js`, { headers: authHeaders });
    assert.equal(scriptResponse.status, 200);
    const script = await scriptResponse.text();
    assert.equal(script, HHR_DISPLAY_APP_JS);
    assert.equal(script.includes('.sort('), false);
    assert.equal(script.includes('selectedSide ==='), false);
    assert.equal(script.includes('hrr >'), false);
    assert.equal(script.includes('hrr <'), false);
    assert.match(script, /selectedSideOutcome/u);
    assert.match(script, /Green = selected side won · Red = selected side lost · Gray = void/u);
    assert.match(script, /Unavailable in current display archive/u);
    assert.match(script, /renderSublistEvidence\(lowerEvidenceNode, board\.cumulativeEvidence, '2\.5\+'\)/u);
    assert.match(script, /renderSublistEvidence\(higherEvidenceNode, board\.cumulativeEvidence, '0\.5'\)/u);
    assert.match(script, /renderList\(lowerList, board\.hhr25LowerAlternates, '2\.5\+', lowerEvidence\)/u);
    assert.match(script, /renderList\(higherList, board\.hhr05HigherAlternates, '0\.5', higherEvidence\)/u);
    assert.match(HHR_DISPLAY_APP_CSS, /@media \(max-width: 650px\)/u);

    const response = await fetch(`${origin}/api/hhr-display-board`, { headers: authHeaders });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'self'/u);
    const board = await response.json() as Record<string, unknown>;
    assert.equal(board['boardVersion'], 'phase4-hhr-display-board-v2');
    assert.match(String(board['rankingRationale']), /P\(Win \| grades\).*P\(Void\)/u);

    const lower = (board['hhr25LowerAlternates'] as Array<Record<string, unknown>>)[0]!;
    assert.equal(lower['player'], 'Lower Batter');
    assert.equal(lower['pWin'], 0.716);
    assert.equal(lower['pLoss'], 0.264);
    assert.equal(lower['pVoid'], 0.02);
    assert.equal(lower['pWinGivenGrades'], 0.7306122448979592);
    const lowerHistory = lower['lastFiveGames'] as Array<Record<string, unknown>>;
    assert.equal(lowerHistory[0]?.['hrr'], 3);
    assert.equal(lowerHistory[0]?.['selectedSideOutcome'], 'loss');

    const higher = (board['hhr05HigherAlternates'] as Array<Record<string, unknown>>)[0]!;
    assert.equal(higher['player'], 'Higher Batter');
    const higherHistory = higher['lastFiveGames'] as Array<Record<string, unknown>>;
    assert.equal(higherHistory[0]?.['hrr'], 1);
    assert.equal(higherHistory[0]?.['selectedSideOutcome'], 'win');
    assert.equal(reads, 1);
  });
});

test('Phase 4 separates sample sufficiency from calibration agreement using written cohort values', () => {
  assert.equal(
    expectedCalibrationLabel(85, 0.6553639332128363, -0.114187462624601),
    'OVERCONFIDENT',
  );
  assert.equal(
    expectedCalibrationLabel(322, 0.5550014111353789, 0.004004800044745238),
    'CALIBRATED',
  );
  assert.equal(
    expectedCalibrationLabel(11, 0.6723403336973839, -0.3996130609701112),
    'OVERCONFIDENT',
  );

  assert.match(HHR_DISPLAY_APP_JS, /const COIN_FLIP_LOG_LOSS = 0\.693/u);
  assert.match(HHR_DISPLAY_APP_JS, /Math\.sqrt\(\(predicted \* \(1 - predicted\)\) \/ n\)/u);
  assert.match(HHR_DISPLAY_APP_JS, /Math\.abs\(gap\) <= twoStandardErrors/u);
  assert.match(HHR_DISPLAY_APP_JS, /Sample: /u);
  assert.match(HHR_DISPLAY_APP_JS, /Calibration: /u);
  assert.match(HHR_DISPLAY_APP_JS, /Observed − predicted/u);
  assert.match(HHR_DISPLAY_APP_JS, /coin flip 0\.693/u);
  assert.match(HHR_DISPLAY_APP_JS, /COHORT · SAMPLE/u);
  assert.match(HHR_DISPLAY_APP_JS, /CALIBRATION /u);
  assert.equal(HHR_DISPLAY_APP_JS.includes("'Line ' + cohort + ' · '"), false);
  assert.equal(HHR_DISPLAY_APP_JS.includes('.sort('), false);
  assert.equal(HHR_DISPLAY_APP_JS.includes('selectedSide ==='), false);
  assert.equal(HHR_DISPLAY_APP_JS.includes('hrr >'), false);
  assert.equal(HHR_DISPLAY_APP_JS.includes('hrr <'), false);
});

test('logout expires the session cookie and redirects to login without touching board evidence', async () => {
  let reads = 0;
  const repository: HhrDisplayArchiveRepository = Object.freeze({
    async readLatest() {
      reads += 1;
      return fixtureArchive();
    },
  });
  await withAppServer(repository, async (origin) => {
    const accepted = await login(origin, PASSWORD);
    const cookie = sessionCookieFrom(accepted);
    const response = await fetch(`${origin}/logout`, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie },
    });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/login');
    assert.match(response.headers.get('set-cookie') ?? '', /Max-Age=0/u);
    assert.equal(reads, 0);
  });
});