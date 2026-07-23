import path from 'node:path';

import {
  fetchJsonSnapshot,
  requireSecret,
  sanitizeText,
  timestampForPath,
  writeJsonAtomic,
  writeTextAtomic,
} from './provider-probe-utils.mjs';

const startedAt = new Date();
const outputRoot =
  process.env.PROVIDER_PROBE_OUTPUT_DIR?.trim() ||
  path.join('artifacts', 'provider-access', timestampForPath(startedAt));

const oddsApiKey = requireSecret('THE_ODDS_API_KEY');
const balldontlieApiKey = requireSecret('BALLDONTLIE_API_KEY');
const secrets = [oddsApiKey, balldontlieApiKey];

const oddsEventsUrl = new URL(
  'https://api.the-odds-api.com/v4/sports/baseball_mlb/events',
);
oddsEventsUrl.searchParams.set('apiKey', oddsApiKey);
oddsEventsUrl.searchParams.set('dateFormat', 'iso');

const balldontliePlayersUrl = new URL(
  'https://api.balldontlie.io/mlb/v1/players',
);
balldontliePlayersUrl.searchParams.set('first_name', 'Shohei');
balldontliePlayersUrl.searchParams.set('last_name', 'Ohtani');
balldontliePlayersUrl.searchParams.set('per_page', '1');

async function capture({ label, fileName, url, headers }) {
  try {
    const snapshot = await fetchJsonSnapshot({
      label,
      url,
      headers,
      secrets,
    });
    const bodyPath = path.join(outputRoot, fileName);
    await writeTextAtomic(bodyPath, snapshot.sanitizedBodyText);

    return {
      label: snapshot.label,
      ok: snapshot.ok,
      request: snapshot.request,
      response: snapshot.response,
      sanitizedBodyPath: bodyPath,
      error: snapshot.ok
        ? null
        : `Provider returned HTTP ${snapshot.response.status}.`,
    };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const message = sanitizeText(rawMessage, secrets);
    return {
      label,
      ok: false,
      request: {
        origin: url.origin,
        pathname: url.pathname,
        queryKeys: [...url.searchParams.keys()].sort(),
        headerNames: Object.keys(headers ?? {}).sort(),
      },
      response: null,
      sanitizedBodyPath: null,
      error: message,
    };
  }
}

const theOddsApi = await capture({
  label: 'the-odds-api-mlb-events-access',
  fileName: 'the-odds-api-mlb-events.json',
  url: oddsEventsUrl,
  headers: {},
});

const balldontlie = await capture({
  label: 'balldontlie-player-lookup-access',
  fileName: 'balldontlie-player-lookup.json',
  url: balldontliePlayersUrl,
  headers: { Authorization: balldontlieApiKey },
});

const report = {
  probeVersion: 1,
  capturedAt: startedAt.toISOString(),
  purpose:
    'Verify provider authentication and preserve sanitized raw evidence before provider-derived contracts.',
  providers: {
    theOddsApi,
    balldontlie,
  },
};

const reportPath = path.join(outputRoot, 'provider-access-report.json');
await writeJsonAtomic(reportPath, report);

console.log('=== V3 PROVIDER ACCESS PROBE ===');
console.log(`Report: ${reportPath}`);
console.log(`The Odds API: ${theOddsApi.ok ? 'PASS' : 'FAIL'}`);
console.log(`BALLDONTLIE: ${balldontlie.ok ? 'PASS' : 'FAIL'}`);

if (!theOddsApi.ok || !balldontlie.ok) {
  process.exitCode = 1;
}
