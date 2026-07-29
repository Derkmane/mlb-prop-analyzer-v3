# M8 Park Venue Capability

**Version:** 1.0  
**Status:** VERIFIED CAPTURE LINEAGE — venue identity is available for current-season fit and validation games; park effects are not yet fitted or production approved  
**Repository:** `Derkmane/mlb-prop-analyzer-v3`  
**Evidence date:** 2026-07-29

## Scope

This document records only the provider capability and immutable lineage needed to join a game to its observed venue. It does not define, estimate, approve, or apply a park coefficient.

## Approved-source evidence

BALLDONTLIE game snapshots were captured from:

```text
GET /mlb/v1/games/{gameId}
```

The exact observed venue path is:

```text
gameSnapshot.body.data.venue
```

The preserved current-season capture root is:

```text
artifacts/m8-current-season-pa/m8-stats-lineups-v1/
```

Its capture manifest is:

```text
artifacts/m8-current-season-pa/m8-stats-lineups-v1/capture-manifest.json
```

The manifest is linked to resolved categorical dataset identity:

```text
a40eca0b15e5d69c7c718e807c2ced7b007650f0628dd7761c87f9f56f1d3b59
```

## Direct diagnostic result

A read-only diagnostic inspected every manifest game and its immutable per-game capture.

```text
declared games: 1,346
unique games: 1,346
active season: 2026
status: STATUS_FINAL for all 1,346 games
unique exact venue strings: 32
missing game captures: 0
missing venue values: 0
game identity mismatches: 0
unsupported fit/validation periods: 0
untouched-test rows included: false
```

The observed exact strings include MLB home venues plus current-season special or temporary venues such as `Estadio Alfredo Harp Helú`, `Las Vegas Ballpark`, and `Sutter Health Park`. Exact captured strings must be preserved. No unverified aliasing, stadium renaming, geographic normalization, roof-state inference, or park equivalence is approved.

## Normalization boundary

The first approved normalized object is a versioned game-to-venue lineage row containing:

```text
observedDate
periodId
providerGameId
venue
sourceCaptureSha256
```

Requirements:

- only `fit` and `validation` rows may be present
- untouched-test rows remain excluded
- every game ID is unique
- venue is a non-empty exact provider string
- the capture and manifest hashes survive into the lineage artifact
- malformed, missing, duplicated, or contradictory identity fails closed
- identical evidence produces an identical lineage hash

## Remaining blocker

Park neutralization and application remain incomplete. Before the checklist item can close, the project still needs an explicit current-season-only, handedness- and terminal-outcome-specific candidate model; chronological fixed and walk-forward evaluation; deterministic candidate selection under the canonical proper-score rule where applicable; neutralization/application tests; and proof that no park effect is double-applied.

No real prop is enabled by venue lineage alone.
