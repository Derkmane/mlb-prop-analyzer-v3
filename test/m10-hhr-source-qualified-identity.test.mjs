import assert from 'node:assert/strict';
import test from 'node:test';

import { buildM10HhrProspectiveArchive } from '../scripts/m10-hhr-evidence-utils.mjs';

const CAPTURED_AT = '2026-08-25T23:04:09.886Z';
const SOURCE_SET_SHA256 = 'a'.repeat(64);

function row({ boardSource, providerBookmakerKey, providerRegion }) {
  return Object.freeze({
    boardSource,
    providerBookmakerKey,
    providerRegion,
    settlementRuleVersion:
      boardSource === 'pick6'
        ? 'draftkings-pick6-batter-hhr-2026-08-25-v1'
        : 'draftkings-sportsbook-batter-hhr-2026-08-24-v1',
    providerEventId: 'event-a',
    providerGameId: 5001,
    providerPlayerId: 1001,
    providerTeamId: 10,
    providerMarketKey: 'batter_hits_runs_rbis_alternate',
    offerType: 'alternate',
    offerTypeReason: 'provider-market-key',
    playerName: 'Player 1001',
    teamName: 'Example Team',
    lineupStatus: 'confirmed',
    selectedSide: 'lower',
    postedLine: 1.5,
    americanPrice: -120,
    multiplier: null,
    archivedPWin: 0.6,
    archivedPLoss: 0.4,
    archivedPVoid: 0,
    archivedPWinGivenGrades: 0.6,
    distributionIdentity: Object.freeze({
      mean: 1.5,
      dispersionAlpha: 0.5,
      modelVersion: 'm11-batter-hhr-direct-composite-v2',
      distributionBuilderVersion: 'm11-batter-hhr-negative-binomial-v1',
    }),
    inputLineage: Object.freeze({ fixture: true }),
  });
}

function archive(rows) {
  return buildM10HhrProspectiveArchive({
    capturedAt: CAPTURED_AT,
    sourceSetSha256: SOURCE_SET_SHA256,
    source: Object.freeze({ fixture: true }),
    games: Object.freeze([{ gameId: 5001 }]),
    rows,
    exclusions: Object.freeze([]),
    diagnosticsPath: 'artifacts/workflow-logs/test-hhr-source-qualified-identity.json',
  });
}

test('HHR exact offer identity keeps Pick6 and DraftKings rows distinct', () => {
  const pick6 = row({
    boardSource: 'pick6',
    providerBookmakerKey: 'pick6',
    providerRegion: 'us_dfs',
  });
  const draftkings = row({
    boardSource: 'draftkings',
    providerBookmakerKey: 'draftkings',
    providerRegion: 'us',
  });

  const result = archive([pick6, draftkings]);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(
    result.rows.map((entry) => entry.boardSource).sort(),
    ['draftkings', 'pick6'],
  );
});

test('HHR exact offer identity still rejects a true same-source duplicate', () => {
  const pick6 = row({
    boardSource: 'pick6',
    providerBookmakerKey: 'pick6',
    providerRegion: 'us_dfs',
  });

  assert.throws(
    () => archive([pick6, { ...pick6 }]),
    /duplicate exact offer identities/u,
  );
});
