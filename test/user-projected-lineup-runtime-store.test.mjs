import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  materializeUserProjectedLineupIssueBody,
  restoreUserProjectedLineupRuntimeIssue,
  USER_PROJECTED_LINEUP_RUNTIME_ISSUE_TITLE,
} from '../scripts/user-projected-lineup-runtime-store.mjs';
import { readUserProjectedLineupForGame } from '../scripts/user-projected-lineup-utils.mjs';

const NOW = new Date('2026-08-26T02:30:00.000Z');
const SLATE_DATE = '2026-08-25';

function artifact({ slateDate = SLATE_DATE } = {}) {
  return {
    version: 1,
    contract: 'user-projected-lineup-v1',
    source: 'RotoWire user-supplied lineup screenshot transcription',
    slateDate,
    sourceTimeZone: 'America/New_York',
    importedAt: '2026-08-25T19:15:00.000Z',
    sourceEvidenceIds: ['chatgpt-user-image-2026-08-25-1'],
    games: [
      {
        awayTeamName: 'Houston Astros',
        homeTeamName: 'New York Yankees',
        teams: [
          {
            teamName: 'Houston Astros',
            sourceStatus: 'expected',
            players: [
              { sourcePlayerLabel: 'Jeremy Pena', lineupSlot: 1 },
              { sourcePlayerLabel: 'Y. Alvarez', lineupSlot: 2 },
            ],
          },
        ],
      },
    ],
  };
}

async function withRoot(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mlb-runtime-lineup-'));
  try {
    return await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function issueResponse(body, overrides = {}) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        title: USER_PROJECTED_LINEUP_RUNTIME_ISSUE_TITLE,
        state: 'open',
        body,
        ...overrides,
      };
    },
  };
}

test('current runtime issue payload materializes exact bytes and feeds the existing projected-lineup reader', () =>
  withRoot((root) => {
    const body = JSON.stringify(artifact());
    const restored = materializeUserProjectedLineupIssueBody({ body, now: NOW, root });
    assert.equal(restored.status, 'current');
    assert.equal(restored.games, 1);
    assert.equal(restored.teams, 1);
    assert.equal(restored.players, 2);

    const storedPath = path.join(root, `${SLATE_DATE}.json`);
    assert.equal(readFileSync(storedPath, 'utf8'), body);

    const resolved = readUserProjectedLineupForGame(
      {
        date: '2026-08-25T23:05:00.000Z',
        away_team_name: 'Houston Astros',
        home_team_name: 'New York Yankees',
      },
      { root },
    );
    assert.ok(resolved);
    assert.equal(resolved.slateDate, SLATE_DATE);
    assert.equal(resolved.games[0].teams[0].players[0].sourcePlayerLabel, 'Jeremy Pena');
  }));

test('stale runtime payload is ignored without writing a lineup file', () =>
  withRoot((root) => {
    const body = JSON.stringify(artifact({ slateDate: '2026-08-24' }));
    const restored = materializeUserProjectedLineupIssueBody({ body, now: NOW, root });
    assert.equal(restored.status, 'stale');
    assert.equal(restored.currentSlateDate, SLATE_DATE);
    assert.equal(existsSync(path.join(root, '2026-08-24.json')), false);
  }));

test('malformed runtime payload fails closed and never materializes partial evidence', () =>
  withRoot((root) => {
    const invalid = artifact();
    invalid.games[0].teams[0].players[1].lineupSlot = 1;
    const restored = materializeUserProjectedLineupIssueBody({
      body: JSON.stringify(invalid),
      now: NOW,
      root,
    });
    assert.equal(restored.status, 'invalid');
    assert.match(restored.reason, /duplicate lineup slots/u);
    assert.equal(existsSync(path.join(root, `${SLATE_DATE}.json`)), false);
  }));

test('runtime issue fetch requires the dedicated open issue identity and never exposes the token', () =>
  withRoot(async (root) => {
    const body = JSON.stringify(artifact());
    let request;
    const restored = await restoreUserProjectedLineupRuntimeIssue({
      token: 'secret-token-value',
      repository: 'Derkmane/mlb-prop-analyzer-v3',
      issueNumber: 153,
      now: NOW,
      root,
      fetchImpl: async (url, options) => {
        request = { url, options };
        return issueResponse(body);
      },
    });
    assert.equal(restored.status, 'current');
    assert.equal(request.url, 'https://api.github.com/repos/Derkmane/mlb-prop-analyzer-v3/issues/153');
    assert.equal(request.options.headers.authorization, 'Bearer secret-token-value');
    assert.equal(JSON.stringify(restored).includes('secret-token-value'), false);
  }));

test('unavailable or repurposed runtime issue remains optional and writes nothing', () =>
  withRoot(async (root) => {
    const unavailable = await restoreUserProjectedLineupRuntimeIssue({
      token: 'token',
      repository: 'Derkmane/mlb-prop-analyzer-v3',
      issueNumber: 153,
      now: NOW,
      root,
      fetchImpl: async () => ({ ok: false, status: 404 }),
    });
    assert.equal(unavailable.status, 'unavailable');

    const wrongTitle = await restoreUserProjectedLineupRuntimeIssue({
      token: 'token',
      repository: 'Derkmane/mlb-prop-analyzer-v3',
      issueNumber: 153,
      now: NOW,
      root,
      fetchImpl: async () => issueResponse(JSON.stringify(artifact()), { title: 'Different issue' }),
    });
    assert.equal(wrongTitle.status, 'unavailable');
    assert.equal(existsSync(path.join(root, `${SLATE_DATE}.json`)), false);
  }));
