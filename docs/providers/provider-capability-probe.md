# V3 Provider Capability Capture

The provider capability capture records real provider availability and response shapes before provider-derived contracts, market adapters, or probability models are written.

It is diagnostic infrastructure only. It does not normalize a board offer, classify an alternate line, map a plate appearance, calculate a probability, or enable a market.

## Required environment variables

```text
THE_ODDS_API_KEY
BALLDONTLIE_API_KEY
```

The script never prints secret values. Response bodies are sanitized before writing, and request metadata records only origins, paths, query-key names, and header names.

## First command

```bash
npm run capture:provider-capabilities
```

The first run:

1. captures current MLB events from The Odds API;
2. examines each still-pregame event's market catalog for bookmaker key `underdog`;
3. captures event-level offers when `batter_hits` or `batter_hits_alternate` is actually observed;
4. requests multipliers and source IDs without assuming either field will be present;
5. captures BALLDONTLIE regular-season games for the prior UTC date by default;
6. captures current-season stats for a known player fixture;
7. writes a report containing raw-body hashes and non-secret request metadata.

Default output:

```text
artifacts/provider-capabilities/<timestamp>/
```

`artifacts/` is excluded from Git. Sanitized fixtures are promoted into version control only after inspection.

## BALLDONTLIE date override

```bash
BDL_PROBE_DATE=2026-07-22 npm run capture:provider-capabilities
```

The date must use `YYYY-MM-DD`.

## BALLDONTLIE game-detail capture

After reviewing the first report, choose one completed current-season regular-season game from `gameCandidates` and rerun:

```bash
BDL_PROBE_DATE=2026-07-22 BDL_GAME_ID=<verified-game-id> npm run capture:provider-capabilities
```

That run additionally captures:

```text
GET /mlb/v1/games/<ID>
GET /mlb/v1/lineups?game_ids[]=<ID>
GET /mlb/v1/plate_appearances?game_id=<ID>
GET /mlb/v1/plays?game_id=<ID>&sort_order=asc&per_page=100
```

The plays capture is explicitly labeled page 1. Pagination must be implemented only after the first real response confirms cursor behavior.

## Optional controls

```text
ODDS_PROBE_MAX_EVENTS
BDL_PROBE_DELAY_MS
BDL_PLAYER_ID
PROVIDER_CAPABILITY_OUTPUT_DIR
```

`BDL_PROBE_DELAY_MS` defaults to 13000 so the diagnostic remains safe for a five-request-per-minute BALLDONTLIE plan. Set it to `0` only when the account's verified rate limit permits that.

## The Odds API evidence targets

The capture looks for these documented keys without assuming they are on the current board:

```text
bookmaker: underdog
baseline market: batter_hits
alternate market: batter_hits_alternate
```

The event-markets endpoint is used first because it reports recently observed market keys for a specific bookmaker. The event-odds endpoint is called only for target keys actually observed on that event.

A `NOT OBSERVED` result is not an implementation failure. It means the requested market was not present in the captured pregame event catalogs at that moment.

## What this capture must answer

### The Odds API

- Is Underdog present on at least one current pregame MLB event?
- Is `batter_hits` observed?
- Is `batter_hits_alternate` observed?
- What exact event, bookmaker, market, outcome, side, line, description, multiplier, and source-ID fields are returned?
- Can baseline and alternate offers be distinguished from actual response data?

### BALLDONTLIE

- What fields identify a current-season regular-season game?
- What exact status values are returned?
- Are pregame lineup and batting-order fields available?
- What raw plate-appearance result values occur?
- Can every result map to exactly one canonical terminal PA category?
- Do plays contain any distinctions that plate appearances omit?
- What current-season statistics are actually exposed?

## Prohibited conclusions

A successful command does not prove:

- that every required market is always available;
- that a market response is complete;
- that a provider schema is stable;
- that the terminal PA vector is fully supported;
- that a normalized contract has been approved;
- that any real probability may be ranked or displayed.
