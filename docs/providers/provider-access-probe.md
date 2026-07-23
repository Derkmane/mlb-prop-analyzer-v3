# V3 Provider Access Probe

The provider access probe verifies authentication and preserves sanitized raw evidence before any provider-derived contract or production adapter is written.

## Required environment variables

```text
THE_ODDS_API_KEY
BALLDONTLIE_API_KEY
```

The script never prints secret values. It records only request origin, path, query-key names, header names, response status, selected quota headers, response-shape summaries, and SHA-256 hashes of the original response bodies.

## Command

```bash
npm run verify:provider-access
```

Optional output override:

```bash
PROVIDER_PROBE_OUTPUT_DIR=/absolute/or/relative/path npm run verify:provider-access
```

Default output location:

```text
artifacts/provider-access/<timestamp>/
```

`artifacts/` is excluded from Git.

## Requests

### The Odds API

```text
GET https://api.the-odds-api.com/v4/sports/baseball_mlb/events
```

The API key is sent through the documented `apiKey` query parameter. This endpoint is used only to verify access and capture current MLB event evidence; it does not define an Underdog market contract.

### BALLDONTLIE MLB

```text
GET https://api.balldontlie.io/mlb/v1/players
```

The API key is sent through the documented `Authorization` header. The request deliberately uses the documented `first_name` and `last_name` query parameters to reverify that carried-forward provider observation.

## Output

```text
provider-access-report.json
the-odds-api-mlb-events.json
balldontlie-player-lookup.json
```

Bodies are sanitized before writing. The report stores the SHA-256 hash of each original response body so later captures can be identified without preserving secrets.

## What PASS proves

- the environment contains both secrets;
- each provider accepted the request;
- the documented authentication mechanism worked;
- a sanitized response fixture was preserved;
- request metadata was recorded without secret values.

## What PASS does not prove

- Underdog is present on the current board;
- Batter Hits or alternate markets are currently available;
- provider response fields are stable or sufficient;
- any market model is production-ready;
- any real probability may be ranked or displayed.

Those questions belong to the later board-capture and Batter Hits capability gates.
