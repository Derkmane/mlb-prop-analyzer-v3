import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readUserProjectedLineupForGame } from '../scripts/user-projected-lineup-utils.mjs';

test('missing user lineup input is a normal null result, not an application dependency', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mlb-no-user-lineup-'));
  try {
    assert.equal(
      readUserProjectedLineupForGame(
        {
          date: '2026-08-19T23:00:00.000Z',
          away_team_name: 'Seattle Mariners',
          home_team_name: 'Milwaukee Brewers',
        },
        { root },
      ),
      null,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
