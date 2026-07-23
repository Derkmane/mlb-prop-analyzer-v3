# Batter Hits Provider Capability Matrix

**Version:** 1.2  
**Status:** DATA UNDER INVESTIGATION — partial evidence-derived contracts exist; provider mapping and production normalization are not approved  
**Repository:** `Derkmane/mlb-prop-analyzer-v3`  
**Evidence date:** 2026-07-23

This matrix records observed provider capabilities and the limited evidence-derived contract boundaries for the first Batter Hits vertical slice before probability models or production ranking are implemented.

It does not establish provider-wide schema stability. A result observed in one capture is evidence for that capture only. Unknown, missing, ambiguous, or unlinked values must fail closed.

---

## 1. Status meanings

| Status | Meaning |
|---|---|
| `VERIFIED_FIXTURE` | Directly observed and preserved in a committed sanitized fixture with a recorded SHA-256. |
| `PARTIAL` | Some required fields or examples are verified, but a general production rule is not yet supported. |
| `OBSERVED_NOT_PROMOTED` | Directly observed in the ignored capability-artifact directory, but the supporting sanitized fixture has not yet been promoted into version control. Implementation may not rely on it yet. |
| `NOT_OBSERVED` | The required case did not occur in the captured sample. |
| `BLOCKED` | A required production rule or distinction cannot yet be defined from preserved evidence. |

---

## 2. Committed evidence inventory

The following raw SHA-256 values were verified before commit `91d1cf7`.

| Evidence | Committed sanitized fixture | Raw SHA-256 |
|---|---|---|
| Underdog Batter Hits event containing baseline and alternate markets | `fixtures/sanitized/provider-capabilities/2026-07-23/player-identity/the-odds-api-22fc220be6958e93fba4354054d8fd16-underdog-batter-hits.json` | `250c1b9c02bb1334c0dce563d14194cabc404dbb48da08a9d49fcd3f457b7db7` |
| BALLDONTLIE games for 2026-07-23 | `fixtures/sanitized/provider-capabilities/2026-07-23/player-identity/balldontlie-games-2026-07-23.json` | `f794c97cda6ad78e239c2b6efc9efd64ae2414a9c627672d9db166f7b05a3185` |
| BALLDONTLIE lineup for game `5059315` | `fixtures/sanitized/provider-capabilities/2026-07-23/player-identity/balldontlie-lineups-5059315.json` | `e22f4601fd95c74f2cb692f9f3db322f6a43c3f2b26026bcc23311e3c40ca7cd` |
| Exact BALLDONTLIE player lookup for James Jarvis | `fixtures/sanitized/provider-capabilities/2026-07-23/player-identity/balldontlie-player-lookup-james-jarvis.json` | `da9b01565b0290e1e9eaf08f39e6716c930dcffe0b679af21254d5fd28c60455` |
| Cross-provider player-linkage report | `fixtures/sanitized/provider-capabilities/2026-07-23/player-identity/cross-provider-player-linkage-5059315.json` | `7e5a10dd3109ba6e4ecb301c34df743ed28eb54b6f53ad01d3cee475411ed239` |

The Git blob SHA returned by GitHub is not a substitute for the raw response SHA-256 above.

The terminal-PA evidence bundle was promoted in commit `5850fa0`:

```text
fixtures/sanitized/provider-capabilities/2026-07-23/terminal-pa/
```

The directory contains 49 committed JSON fixtures plus `SHA256SUMS`. The manifest records the raw SHA-256 for every JSON fixture.

The fixture-integrity and context-evidence test was committed in `40b0bb8`:

```text
test/terminal-pa-fixtures.test.mjs
```

The focused test verifies all 49 checksums, JSON validity, absence of secret-like content, and preserved context needed to distinguish observed batter outcomes from runner events.

The first evidence-derived terminal-PA contract slice was committed across `03176da` through `f5c81a7`:

```text
src/domain/terminal-pa.ts
src/adapters/providers/balldontlie/contracts.ts
src/adapters/providers/balldontlie/index.ts
test/balldontlie-terminal-pa-contracts.test.ts
```

Direct verification passed typecheck, dependency architecture, build, and five focused tests. The raw schemas parsed all 607 promoted PA rows and 3,497 promoted play rows, preserved unknown provider fields, accepted observed nullable play fields, and rejected malformed required data. The strict normalized boundary requires canonical terminal categories and explicit provider/game/player/PA identity plus the source snapshot SHA-256. It does not map raw provider results into canonical categories.

---

## 3. The Odds API and Underdog offer identity

Observed request path:

```text
GET /v4/sports/baseball_mlb/events/{eventId}/odds
```

Observed request query keys in the capability capture:

```text
apiKey
bookmakers=underdog
markets=<observed target market keys>
dateFormat=iso
oddsFormat=american
includeMultipliers=true
includeSids=true
```

### Offer matrix

| Required component | Exact observed JSON path | Captured evidence | Status | Normalization constraint and blocker |
|---|---|---|---|---|
| Underdog source identity | `bookmakers[].key` | Exact value `underdog`; `bookmakers[].title` was `Underdog`. | `VERIFIED_FIXTURE` | Accept only the verified bookmaker key. Do not infer Underdog from title text alone. |
| Provider event identity | root `id` | `22fc220be6958e93fba4354054d8fd16` | `VERIFIED_FIXTURE` | Preserve the provider event ID and fixture hash. |
| Sport identity | root `sport_key` | `baseball_mlb` | `VERIFIED_FIXTURE` | Reject an unexpected sport key. |
| Event teams | root `home_team`, `away_team` | `Atlanta Braves`, `San Diego Padres` | `VERIFIED_FIXTURE` | Preserve raw team strings for the cross-provider join; do not use them as permanent team IDs. |
| Pregame start time | root `commence_time` | `2026-07-23T16:16:00Z` | `VERIFIED_FIXTURE` | Parse as an explicit timestamp. Started-game exclusion still requires a verified clock/status rule. |
| Market identity | `bookmakers[].markets[].key` | `batter_hits`, `batter_hits_alternate` | `VERIFIED_FIXTURE` | Market key, not line value or multiplier, determines baseline versus alternate offer type. |
| Baseline identity | market key `batter_hits` | Six observed outcomes in the committed event fixture. | `VERIFIED_FIXTURE` | A `0.5` line is not sufficient to classify a baseline offer. |
| Alternate identity | market key `batter_hits_alternate` | Thirty observed outcomes in the committed event fixture, including both `0.5` and `1.5` lines. | `VERIFIED_FIXTURE` | Alternate offers may use the same numerical line as a baseline offer. Preserve the raw market key. |
| Player label | `bookmakers[].markets[].outcomes[].description` | Player names such as `Gavin Sheets` and `Fernando Tatis Jr.` | `PARTIAL` | No outcome-level player ID was observed. Name-only linkage requires a verified event-scoped BALLDONTLIE join and must fail closed on zero or multiple matches. |
| Raw side | `bookmakers[].markets[].outcomes[].name` | Exact values `Over` and `Under` | `VERIFIED_FIXTURE` | Preserve the raw value and translate only through an explicit contract: `Over` → Higher, `Under` → Lower. Never lose the selected side. |
| Posted line | `bookmakers[].markets[].outcomes[].point` | Observed `0.5` and `1.5` | `VERIFIED_FIXTURE` | Preserve the numeric line unchanged through normalization, settlement, saving, and grading. |
| American price | `bookmakers[].markets[].outcomes[].price` | Observed values including `-563` and `136` | `VERIFIED_FIXTURE` | Price is offer metadata only. It may not control ranking. |
| Multiplier | `bookmakers[].markets[].outcomes[].multiplier` | Observed values including `0.68`, `1`, and `1.36` | `VERIFIED_FIXTURE` | Multiplier is display/offer metadata only. It may not control ranking. |
| Outcome source ID | `bookmakers[].markets[].outcomes[].sid` | Key present; value `null` in every committed outcome. | `PARTIAL` | A persistent offer ID was not supplied in this fixture. Do not invent one. |
| Market source ID | `bookmakers[].markets[].sid` | Key present; value `null`. | `PARTIAL` | Cannot identify an offer from market `sid`. |
| Bookmaker source ID | `bookmakers[].sid` | Key present; value `null`. | `PARTIAL` | Cannot identify an offer from bookmaker `sid`. |
| Market freshness | `bookmakers[].markets[].last_update` | `2026-07-23T15:11:47Z` for both observed markets. | `VERIFIED_FIXTURE` | Preserve the market timestamp; no outcome-level timestamp was observed. |
| Direct offer link | No field observed | No `link` key was present in the observed outcome schema. | `NOT_OBSERVED` | Do not invent a deep link. |

### Snapshot-scoped offer identity

Because all observed `sid` values were null, the minimum observed snapshot-scoped identity is:

```text
eventId
+ bookmakerKey
+ marketKey
+ playerDescription
+ point
+ rawSide
+ providerSnapshotHash
```

A local diagnostic across five captured events found 178 outcomes, 89 complete Over/Under player-line pairs, zero incomplete pairs, zero duplicate exact tuples, and zero baseline/alternate overlaps. That diagnostic has not yet been promoted as a committed sanitized fixture, so the uniqueness result remains `OBSERVED_NOT_PROMOTED` and may not be treated as a provider-wide guarantee.

---

## 4. BALLDONTLIE game, lineup, and player joins

Observed request paths:

```text
GET /mlb/v1/games?dates[]=2026-07-23&season_type=regular&per_page=100
GET /mlb/v1/lineups?game_ids[]=5059315&per_page=100
GET /mlb/v1/players?first_name=James&last_name=Jarvis&per_page=100
```

| Required component | Exact observed JSON path | Captured evidence | Status | Normalization constraint and blocker |
|---|---|---|---|---|
| BALLDONTLIE game ID | `data[].id` | `5059315` | `VERIFIED_FIXTURE` | Preserve the provider game ID. |
| Current-season guard | `data[].season`, `data[].season_type`, `data[].postseason` | `2026`, `regular`, `false` for game `5059315` | `VERIFIED_FIXTURE` | Production performance data must additionally enforce the active season; this fixture verifies the game fields only. |
| Game teams and opponent | `data[].home_team`, `data[].away_team`, `data[].home_team_name`, `data[].away_team_name` | Team IDs `2` and `23`; exact display names matched the Odds event. | `VERIFIED_FIXTURE` | Prefer provider team IDs after a verified join. Preserve home/away orientation. |
| BALLDONTLIE scheduled time | `data[].date` | `2026-07-23T16:15:00.000Z` | `VERIFIED_FIXTURE` | The matching Odds event began one minute later. No general cross-provider time tolerance is approved. |
| Game status | `data[].status` | `STATUS_SCHEDULED` for `5059315`; `STATUS_FINAL` also occurred in the same games fixture. | `PARTIAL` | Preserve the raw status. Pregame eligibility, started, postponed, suspended, and cancelled mappings require broader evidence and a focused test. |
| Home/away state | `data[].home_team.id`, `data[].away_team.id` | Braves home, Padres away | `VERIFIED_FIXTURE` | Do not infer home/away from display ordering outside these fields. |
| Lineup game identity | `data[].game_id` | `5059315` | `VERIFIED_FIXTURE` | Every lineup record must match the joined game ID. |
| Lineup player identity | `data[].player.id`, `data[].player.full_name` | Provider player IDs and full names were present. | `VERIFIED_FIXTURE` | Preserve the BALLDONTLIE player ID after a unique match. |
| Lineup team identity | `data[].team.id`, `data[].team.display_name` | Team IDs and names were present on each lineup row. | `VERIFIED_FIXTURE` | A matched player must belong to one of the event teams in the captured event context. |
| Batting order | `data[].batting_order` | Starting positions `1` through `9` were observed for both teams. | `VERIFIED_FIXTURE` | Preserve integer order; do not use array position as batting order. |
| Lineup position | `data[].position` | Examples include `RF`, `C`, `2B`, and `DH`. | `VERIFIED_FIXTURE` | Preserve the raw position string. |
| Probable-pitcher flag | `data[].is_probable_pitcher` | Field present on lineup records. | `PARTIAL` | The field path is verified, but the production opposing-starter selection rule and replacement handling are not yet approved. |
| Handedness | `data[].player.bats_throws` | Examples include `R/R`, `L/R`, `L/L`, and `B/R`. | `VERIFIED_FIXTURE` | Preserve the raw combined value until a validated handedness contract is defined. |
| Exact player lookup | `/players` response `data[]` | Exact James Jarvis lookup returned zero records. | `VERIFIED_FIXTURE` | Zero matches cannot be converted into an invented player ID. |

### Observed event join

For the preserved Braves–Padres example:

```text
The Odds API event ID: 22fc220be6958e93fba4354054d8fd16
The Odds API commence_time: 2026-07-23T16:16:00Z
BALLDONTLIE game ID: 5059315
BALLDONTLIE date: 2026-07-23T16:15:00.000Z
Home team: Atlanta Braves
Away team: San Diego Padres
BALLDONTLIE status at capture: STATUS_SCHEDULED
```

This verifies one join. It does not approve a generalized team-name normalizer or start-time tolerance.

### Observed player linkage

The event-scoped diagnostic produced:

```text
unique Underdog player labels: 18
unique BALLDONTLIE matches: 17
unmatched: 1
ambiguous: 0
```

The unmatched player was `James Jarvis`. He was absent from the captured starting lineup, and a separate exact BALLDONTLIE player lookup returned zero records.

Approved capability conclusion:

```text
exactly one event-scoped BALLDONTLIE player match
→ identity verified for this snapshot

zero or multiple matches
→ identity unresolved
→ offer fails closed
→ no probability and no ranking
```

Absence from the starting lineup alone does not prove that a player is unknown, because the lineup endpoint is not established as a complete roster directory. It does prove that a start was not confirmed in that lineup snapshot.

---

## 5. Terminal plate-appearance capability

The canonical terminal categories are:

```text
K
UBB
IBB
HBP
1B
2B
3B
HR
ROE
FC
SF
SH
BIP_OUT
CATCHER_INTERFERENCE
OTHER_PA
```

Observed request paths:

```text
GET /mlb/v1/plate_appearances?game_id={gameId}
GET /mlb/v1/plays?game_id={gameId}&sort_order=asc&per_page=100
```

The promoted evidence is preserved under:

```text
fixtures/sanitized/provider-capabilities/2026-07-23/terminal-pa/
```

The observed category evidence below is `VERIFIED_FIXTURE`, except `OTHER_PA`, which remains `NOT_OBSERVED`.

`VERIFIED_FIXTURE` means only that the listed raw result and context occurred in the preserved sample. It does not approve a provider-wide mapping or production normalizer.

| Canonical category | Observed raw result or play evidence | Provisional observed mapping constraint |
|---|---|---|
| `K` | `Strikeout`; one `Strikeout Double Play` ended on `Swinging Strike` while a runner was separately caught stealing. | `Strikeout Double Play` contributes terminal `K`; the separate runner event belongs in the baserunning layer. |
| `UBB` | `Walk` occurred separately from `Intent Walk`. | Candidate mapping is `Walk` → `UBB`; the production mapping remains pending. |
| `IBB` | `Intent Walk` | Candidate mapping is `Intent Walk` → `IBB`. |
| `HBP` | Exact raw result `Hit By Pitch` | Candidate mapping is `Hit By Pitch` → `HBP`. |
| `1B` | `Single` | Candidate mapping is `Single` → `1B`. |
| `2B` | `Double` | Candidate mapping is `Double` → `2B`. |
| `3B` | `Triple` | Candidate mapping is `Triple` → `3B`. |
| `HR` | Diagnostics reported `HR` in the full-date summary and `Home Run` in game-level evidence. | Preserve and explicitly map every verified raw spelling; do not assume one provider-wide label. |
| `ROE` | `Field Error`; play text showed the batter reaching safely on an error. | Candidate mapping is `Field Error` → `ROE`. |
| `FC` | `Fielders Choice`, `Fielders Choice Out`, and `Forceout` instances where the batter reached and another runner was retired or all runners were safe. | Compound labels require batter-result or play evidence. Do not map every string containing `Out` to `BIP_OUT`. |
| `SF` | `Sac Fly` | Candidate mapping is `Sac Fly` → `SF`. |
| `SH` | `Sac Bunt` | Candidate mapping is `Sac Bunt` → `SH`; separate `Bunt Groundout` and `Bunt Pop Out` results were observed. |
| `BIP_OUT` | `Flyout`, `Groundout`, `Lineout`, `Pop Out`, `Bunt Groundout`, `Bunt Pop Out`, `GIDP`, an observed batter-out `Double Play`, and an observed batter-out `Triple Play`. | Ambiguous compound-play labels require play context confirming whether the batter was retired. |
| `CATCHER_INTERFERENCE` | Exact PA result `Catcher Interference`; play text stated that the batter reached first on catcher's interference after an overturned challenge. | Candidate mapping is exact result → `CATCHER_INTERFERENCE`. Evidence report: `balldontlie-catcher-interference-5059159-report.json`. |
| `OTHER_PA` | No generic other terminal result was observed. | `NOT_OBSERVED`; an unknown future terminal string must be preserved and fail closed until explicitly mapped. |

### Required sequence-aware protections

Promoted evidence and diagnostics established:

1. `Caught Stealing 2B` occurred on a pitch recorded as `Ball`, and matching caught-stealing play records had `batter_id=null`. It is a separate `CS` event, not a completed terminal PA.
2. `Strikeout Double Play` ended on `Swinging Strike`; play text recorded the batter striking out while a runner was separately caught stealing.
3. `pa_number` was not contiguous in one captured game while pitch counts continued across the gap. It is an ordering identifier, not a completed-PA count.
4. The raw `outs` value showed timing behavior that was not reliable as a universal pre-PA-state field.
5. `Double Play`, `Fielders Choice Out`, `Forceout`, and similar compound strings cannot be normalized safely from the result label alone in every case.
6. Plays pagination was required to inspect complete games; a first-page-only capture is insufficient for rare outcomes.

### Terminal-PA gate status

```text
+ named terminal categories preserved in committed fixtures
+ complete play context preserved for selected compound events
+ catcher interference preserved
+ fixture hashes and JSON validity protected by a focused test
+ caught stealing preserved as a separate baserunning event
+ canonical terminal and baserunning domain category sets are separate
+ raw PA/play schemas preserve unknown fields and reject malformed required fields
+ strict NormalizedTerminalPA boundary requires canonical categories and explicit snapshot context
- raw provider results are not yet mapped into canonical categories
- OTHER_PA not observed
- future unknown strings are not exhaustively enumerable
- unknown and context-insufficient normalization is not implementation-tested
- exact-one mapping, mutual exclusivity, and collective exhaustiveness are not normalization-tested
```

The raw-schema and normalized-boundary blockers are closed. The overall terminal-PA capability gate remains open until the evidence-backed mapping function and its fail-closed, context-aware, exact-one-category, exclusivity, and exhaustiveness tests are complete.

---

## 6. Current blockers before broader provider-derived contracts

1. Promote the five-event offer-pair and tuple-uniqueness diagnostic if it will support identity validation.
2. Define and test the generalized cross-provider game join; the observed one-minute difference is not an approved tolerance.
3. Verify complete game-status semantics for scheduled, active, final, postponed, suspended, and cancelled states before pregame eligibility is implemented.
4. Define player matching so zero or multiple matches fail closed; never use fuzzy matching without separately approved evidence and tests.
5. Implement terminal-PA mapping from the promoted fixtures, including context-aware handling for compound events and separate terminal/baserunning layers.
6. Add focused mapping tests proving exact-one-category behavior, unknown-value rejection, context-insufficient rejection, mutual exclusivity, and collective exhaustiveness.
7. Keep `OTHER_PA` unavailable until a supported raw provider result is observed or an explicitly approved rule is established.
8. Preserve raw provider IDs, timestamps when available, market key, selected side, line, and snapshot hash through every later contract.

---

## 7. Production-ranking impact

These capabilities protect the Golden Rule by ensuring that only the correct posted player, market, line, and selected side can reach the Batter Hits distribution and settlement process.

```text
unverified event or player identity
→ ineligible offer
→ no P(Win), P(Loss), P(Void), or P(Win | grades)
→ no category ranking
```

Price, multiplier, player reputation, and raw expected performance are not ranking inputs.

---

## Changelog

### Version 1.2 — 2026-07-23

- Recorded the evidence-derived canonical terminal-PA and separate baserunning domain category sets.
- Recorded runtime-validated raw BALLDONTLIE PA/play schemas that parse all promoted fixtures, preserve unknown fields, and reject malformed required fields.
- Recorded the strict `NormalizedTerminalPA` boundary with explicit provider/game/player/PA identity and snapshot SHA-256.
- Recorded direct typecheck, architecture, build, and five-test verification.
- Closed the raw-schema and normalized-boundary blockers while keeping raw-result mapping, `OTHER_PA`, unknown/context-insufficient handling, exact-one mapping, mutual exclusivity, and collective exhaustiveness open.

### Version 1.1 — 2026-07-23

- Recorded terminal-PA fixture promotion in commit `5850fa0`.
- Recorded the focused fixture-integrity and context-evidence test in commit `40b0bb8`.
- Promoted observed terminal, compound-play, sequence, and catcher-interference evidence from `OBSERVED_NOT_PROMOTED` to `VERIFIED_FIXTURE`.
- Corrected the observed HBP raw label to `Hit By Pitch`.
- Closed the fixture-promotion blocker while keeping normalization, `OTHER_PA`, unknown-value handling, mutual exclusivity, and collective exhaustiveness open.
- Did not define provider-derived contracts or production mappings.

### Version 1.0 — 2026-07-23

- Recorded the committed Underdog Batter Hits, game, lineup, player-lookup, and cross-provider-linkage fixtures.
- Verified observed baseline and alternate market keys, selected-side fields, lines, prices, multipliers, timestamps, and null source IDs.
- Recorded the one-event game join and the 17-of-18 player linkage result.
- Required James Jarvis and every future zero- or multi-match player identity to fail closed.
- Recorded provisional terminal-PA and sequence findings while keeping them blocked until sanitized fixture promotion and focused tests.
- Explicitly prohibited provider-wide guarantees from the limited captured samples.