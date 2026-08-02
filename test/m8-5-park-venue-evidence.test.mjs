import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildM8_5ParkVenueEvidenceAudit,
  verifyM8_5ParkVenueEvidenceAudit,
} from '../scripts/m8-5-park-venue-evidence-utils.mjs';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);

function capture({
  gameId,
  observedDate,
  periodId,
  homeTeamId,
  awayTeamId,
  venue,
  season = 2026,
  seasonType = 'regular',
  status = 'STATUS_FINAL',
  untouchedTestReservation = { rowsIncluded: false },
}) {
  return {
    captureVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    sourcePlanSha256: SHA_A,
    plannedGame: {
      gameId,
      observedDate,
      periodId,
      sourceRowCount: 1,
    },
    gameSnapshot: {
      rawBodySha256: SHA_C,
      body: {
        data: {
          id: gameId,
          season,
          season_type: seasonType,
          postseason: false,
          status,
          venue,
          home_team: { id: homeTeamId },
          away_team: { id: awayTeamId },
        },
      },
    },
    untouchedTestReservation,
    captureSha256: SHA_D,
  };
}

function manifest(captures) {
  return {
    manifestVersion: 1,
    provider: 'BALLDONTLIE MLB API',
    sourcePlanSha256: SHA_A,
    sourceResolvedDatasetSha256: SHA_B,
    sourceRowCount: captures.length,
    gameCount: captures.length,
    includedPeriods: ['fit', 'validation'],
    untouchedTestReservation: { rowsIncluded: false },
    totals: {},
    games: captures.map((row) => ({
      gameId: row.plannedGame.gameId,
      observedDate: row.plannedGame.observedDate,
      periodId: row.plannedGame.periodId,
      summarySha256: SHA_B,
    })),
    manifestSha256: SHA_B,
  };
}

function standardCaptures() {
  return [
    capture({
      gameId: 101,
      observedDate: '2026-05-01',
      periodId: 'fit',
      homeTeamId: 1,
      awayTeamId: 2,
      venue: 'Exact Provider Park',
    }),
    capture({
      gameId: 102,
      observedDate: '2026-06-20',
      periodId: 'validation',
      homeTeamId: 3,
      awayTeamId: 4,
      venue: 'Second Provider Park',
    }),
  ];
}

test('preserves exact provider venue identity and authorizes only the evidence path', () => {
  const captures = standardCaptures();
  const audit = buildM8_5ParkVenueEvidenceAudit({
    captureManifest: manifest(captures),
    captures,
  });

  assert.equal(audit.decision, 'VENUE_IDENTITY_AVAILABLE');
  assert.deepEqual(audit.decisionReasons, []);
  assert.equal(audit.totals.capturedGameCount, 2);
  assert.equal(audit.totals.eligibleVenueGameCount, 2);
  assert.equal(audit.totals.uniqueVenueCount, 2);
  assert.deepEqual(
    audit.venueCounts.map((row) => row.venue),
    ['Exact Provider Park', 'Second Provider Park'],
  );
  assert.equal(audit.normalizationPolicy.providerVenueTextPreservedExactly, true);
  assert.equal(audit.normalizationPolicy.homeTeamVenueInferenceAllowed, false);
  assert.equal(audit.normalizationPolicy.venueAliasMergingAllowed, false);
  assert.equal(audit.safety.parkCoefficientsFitted, false);
  assert.equal(audit.safety.selectedSideInputUsed, false);
  assert.equal(audit.safety.directProbabilityAdjustmentUsed, false);
  assert.equal(Object.hasOwn(audit, 'selectedSide'), false);
  verifyM8_5ParkVenueEvidenceAudit(audit);
});

test('keeps multiple exact venue names for one home team separate instead of inventing aliases', () => {
  const captures = [
    capture({
      gameId: 201,
      observedDate: '2026-05-01',
      periodId: 'fit',
      homeTeamId: 10,
      awayTeamId: 11,
      venue: 'Primary Park',
    }),
    capture({
      gameId: 202,
      observedDate: '2026-06-01',
      periodId: 'validation',
      homeTeamId: 10,
      awayTeamId: 12,
      venue: 'Neutral Site Park',
    }),
  ];
  const audit = buildM8_5ParkVenueEvidenceAudit({
    captureManifest: manifest(captures),
    captures,
  });

  assert.equal(audit.decision, 'VENUE_IDENTITY_AVAILABLE');
  assert.equal(audit.totals.multiVenueHomeTeamCount, 1);
  assert.deepEqual(
    audit.homeTeamVenueCoverage[0].venues.map((row) => row.venue),
    ['Neutral Site Park', 'Primary Park'],
  );
});

test('fails the park path closed when exact provider venue identity is missing or repaired text would be required', () => {
  const captures = [
    capture({
      gameId: 301,
      observedDate: '2026-05-01',
      periodId: 'fit',
      homeTeamId: 20,
      awayTeamId: 21,
      venue: 'Valid Park',
    }),
    capture({
      gameId: 302,
      observedDate: '2026-06-01',
      periodId: 'validation',
      homeTeamId: 22,
      awayTeamId: 23,
      venue: ' Needs Repair ',
    }),
  ];
  const audit = buildM8_5ParkVenueEvidenceAudit({
    captureManifest: manifest(captures),
    captures,
  });

  assert.equal(audit.decision, 'INSUFFICIENT_VENUE_IDENTITY');
  assert.deepEqual(audit.decisionReasons, [
    'one-or-more-games-lack-exact-provider-venue-identity',
    'fewer-than-two-distinct-venues-observed',
  ]);
  assert.equal(audit.excludedGames[0].reason, 'venue-not-canonical-provider-text');
  assert.equal(audit.excludedGames[0].rawVenue, ' Needs Repair ');
  assert.equal(audit.games[0].venue, 'Valid Park');
  verifyM8_5ParkVenueEvidenceAudit(audit);
});

test('is deterministic regardless of capture and manifest ordering', () => {
  const captures = standardCaptures();
  const first = buildM8_5ParkVenueEvidenceAudit({
    captureManifest: manifest(captures),
    captures,
  });
  const reversed = [...captures].reverse();
  const second = buildM8_5ParkVenueEvidenceAudit({
    captureManifest: manifest(reversed),
    captures: reversed,
  });

  assert.equal(first.auditSha256, second.auditSha256);
  assert.deepEqual(first, second);
});

test('rejects wrong-season, nonfinal, and identity-drifted games', () => {
  const wrongSeason = standardCaptures();
  wrongSeason[1] = capture({
    gameId: 102,
    observedDate: '2026-06-20',
    periodId: 'validation',
    homeTeamId: 3,
    awayTeamId: 4,
    venue: 'Second Provider Park',
    season: 2025,
  });
  assert.throws(
    () =>
      buildM8_5ParkVenueEvidenceAudit({
        captureManifest: manifest(wrongSeason),
        captures: wrongSeason,
      }),
    /outside the active season/,
  );

  const nonfinal = standardCaptures();
  nonfinal[1] = capture({
    gameId: 102,
    observedDate: '2026-06-20',
    periodId: 'validation',
    homeTeamId: 3,
    awayTeamId: 4,
    venue: 'Second Provider Park',
    status: 'STATUS_SCHEDULED',
  });
  assert.throws(
    () =>
      buildM8_5ParkVenueEvidenceAudit({
        captureManifest: manifest(nonfinal),
        captures: nonfinal,
      }),
    /is not final/,
  );

  const drifted = standardCaptures();
  drifted[1].gameSnapshot.body.data.id = 999;
  assert.throws(
    () =>
      buildM8_5ParkVenueEvidenceAudit({
        captureManifest: manifest(drifted),
        captures: drifted,
      }),
    /identity mismatch/,
  );
});

test('rejects any manifest or capture that exposes untouched-test rows', () => {
  const captures = standardCaptures();
  const badManifest = manifest(captures);
  badManifest.untouchedTestReservation = { rowsIncluded: false, rows: [] };
  assert.throws(
    () =>
      buildM8_5ParkVenueEvidenceAudit({
        captureManifest: badManifest,
        captures,
      }),
    /untouched-test rows excluded/,
  );

  const badCaptures = standardCaptures();
  badCaptures[1] = capture({
    gameId: 102,
    observedDate: '2026-06-20',
    periodId: 'validation',
    homeTeamId: 3,
    awayTeamId: 4,
    venue: 'Second Provider Park',
    untouchedTestReservation: { rowsIncluded: false, rows: [] },
  });
  assert.throws(
    () =>
      buildM8_5ParkVenueEvidenceAudit({
        captureManifest: manifest(badCaptures),
        captures: badCaptures,
      }),
    /untouched-test rows excluded/,
  );
});
