# BALLDONTLIE MLB — Observed Quirks and Verification Ledger

**Version:** 1.3  
**Status:** Active provider-verification ledger  
**Repository:** `Derkmane/mlb-prop-analyzer-v3`

This file preserves provider knowledge already learned during earlier work so it is not lost in chat history.

These observations are not permanent assumptions. Each must be reverified against a sanitized V3 fixture before implementation relies on it. Once verified, record the endpoint, capture date, exact raw value, normalization rule, and protecting test.

Do not store secrets or unsanitized personal credentials here.

---

## Q1 — Player lookup uses separate name parameters

### Carried-forward observation

Player lookup required separate query parameters:

```text
first_name
last_name
```

Do not assume a combined full-name search parameter exists or behaves equivalently.

### V3 evidence

```text
Verified on: 2026-07-23
Endpoint: GET /mlb/v1/players
Request parameters: first_name=Shohei, last_name=Ohtani, per_page=1
Sanitized fixture path: fixtures/sanitized/provider-access/2026-07-23/balldontlie-player-lookup.json
Original response SHA-256: 1550855075b0321ddc70f18a6614ef014a434c2a3b258ad9462b98e176b1f639
Exact returned identity: id=208, first_name="Shohei", last_name="Ohtani", full_name="Shohei Ohtani"
Pagination evidence: meta.next_cursor=208, meta.per_page=1
```

A second exact lookup used:

```text
first_name=James
last_name=Jarvis
per_page=100
```

and returned zero records.

```text
Sanitized fixture path: fixtures/sanitized/provider-capabilities/2026-07-23/player-identity/balldontlie-player-lookup-james-jarvis.json
Raw response SHA-256: da9b01565b0290e1e9eaf08f39e6716c930dcffe0b679af21254d5fd28c60455
```

### Verified conclusion

The V3 requests using separate `first_name` and `last_name` parameters were accepted. One returned the expected exact player with provider player ID `208`; the other returned zero records.

This does not prove partial-match, duplicate-name, or all pagination behavior. A production lookup contract must preserve the provider player ID, must not assume that `full_name` is a supported equivalent request parameter, and must fail closed when an exact identity cannot be established.

### Required protecting test

A fixture-backed adapter test must prove that a known player lookup uses the verified separate name parameters, preserves the provider player ID, and treats a zero-result lookup as unresolved identity rather than inventing a match.

**V3 fixture:** confirmed for one successful and one zero-result exact lookup  
**Verification status:** partial — exact lookup behavior confirmed; partial/duplicate behavior and adapter test pending

---

## Q2 — Date-of-birth values may contain two-digit years

### Carried-forward observation

At least one earlier BALLDONTLIE response exposed a date-of-birth representation containing a two-digit year.

Do not assume every year is four digits. Do not rely on JavaScript's implicit date parser.

### V3 evidence

```text
Verified on: 2026-07-23
Endpoint: GET /mlb/v1/players
Raw field: dob
Exact raw value: "07/05/94"
Sanitized fixture path: fixtures/sanitized/provider-access/2026-07-23/balldontlie-player-lookup.json
Original response SHA-256: 1550855075b0321ddc70f18a6614ef014a434c2a3b258ad9462b98e176b1f639
```

The committed lineup fixture contains additional slash-delimited two-digit-year values under `data[].player.dob`.

```text
Sanitized fixture path: fixtures/sanitized/provider-capabilities/2026-07-23/player-identity/balldontlie-lineups-5059315.json
Raw response SHA-256: e22f4601fd95c74f2cb692f9f3db322f6a43c3f2b26026bcc23311e3c40ca7cd
```

### Verified conclusion

V3 production responses contain slash-delimited DOB values with two-digit years. Therefore a player or lineup raw contract may not require an ISO date or four-digit year.

No century-resolution or normalized-date rule has been approved. Until that rule is supported by sufficient evidence, preserve the exact raw value and fail closed if a downstream component requires an unambiguous calendar date.

### Required protecting test

A fixture-backed normalization test must preserve the raw value and either parse it through an explicitly versioned rule or fail closed when the century cannot be resolved safely.

**V3 fixture:** confirmed across player and lineup responses  
**Verification status:** raw two-digit-year behavior confirmed; normalization rule and test pending

---

## Q3 — Observed date ordering required month/day/year interpretation

### Carried-forward observation

An earlier field was observed in month/day/year order rather than the ordering previously assumed by implementation code.

Do not infer ordering from separator shape alone. Record the exact field and raw fixture before defining the parser.

### Current V3 evidence

The player and lineup fixtures contain values such as:

```text
dob = "07/05/94"
dob = "01/02/99"
dob = "03/28/01"
```

These confirm slash-delimited two-digit-year behavior. They do not independently prove every player's true calendar date, a provider-wide field-order rule, or consistency across every endpoint.

### V3 verification still required

- independent confirmation of exact calendar dates
- whether all player and lineup records use the same ordering
- whether ISO-formatted alternatives occur
- timezone and date-only semantics

### Required protecting test

A fixture-backed date parser test must assert independently verified normalized calendar dates and reject ambiguous unsupported forms.

**V3 fixture:** multiple ambiguous-format examples preserved  
**Verification status:** pending — do not infer field order yet

---

## Q4 — Game filtering must use verified status and time semantics

### Carried-forward observation

Earlier work found that selecting or excluding games required the provider's status field rather than relying on an assumed date-field filter alone.

Do not infer pregame, active, completed, postponed, suspended, or cancelled state from a calendar date by itself.

### V3 evidence

```text
Verified on: 2026-07-23
Endpoint: GET /mlb/v1/games
Request parameters: dates[]=2026-07-23, season_type=regular, per_page=100
Sanitized fixture path: fixtures/sanitized/provider-capabilities/2026-07-23/player-identity/balldontlie-games-2026-07-23.json
Raw response SHA-256: f794c97cda6ad78e239c2b6efc9efd64ae2414a9c627672d9db166f7b05a3185
Observed raw status values: STATUS_FINAL, STATUS_SCHEDULED
Observed scheduled game: id=5059315, date=2026-07-23T16:15:00.000Z, status=STATUS_SCHEDULED
```

The matching The Odds API event had `commence_time=2026-07-23T16:16:00Z`, one minute later than the observed BALLDONTLIE game timestamp.

### Verified conclusion

The games response exposes explicit `date` and `status` fields. Both must be preserved. One fixture proves scheduled and final states exist, but it does not establish the complete status state machine or a generalized cross-provider time tolerance.

Pregame selection must not be based only on the date string, empty scores, period, or attendance. The production rule remains blocked until active, postponed, suspended, and cancelled behavior is captured or explicitly handled through a fail-closed rule.

### Required protecting test

A fixture-backed game-state test must preserve the raw status, accept a verified future `STATUS_SCHEDULED` game, reject a verified `STATUS_FINAL` game, and fail closed for unknown statuses. Additional fixtures are required before mapping other states.

**V3 fixture:** scheduled and final states confirmed  
**Verification status:** partial — complete status semantics and protecting test pending

---

## Q5 — Lineup absence is not equivalent to unknown player identity

### V3 evidence

The preserved Braves–Padres lineup response contained 20 records with:

```text
data[].game_id
data[].player.id
data[].player.full_name
data[].player.bats_throws
data[].team.id
data[].batting_order
data[].position
data[].is_probable_pitcher
```

```text
Sanitized fixture path: fixtures/sanitized/provider-capabilities/2026-07-23/player-identity/balldontlie-lineups-5059315.json
Raw response SHA-256: e22f4601fd95c74f2cb692f9f3db322f6a43c3f2b26026bcc23311e3c40ca7cd
```

The event-scoped cross-provider diagnostic found:

```text
unique Underdog player labels: 18
unique BALLDONTLIE matches: 17
unmatched: 1
ambiguous: 0
unmatched player: James Jarvis
```

```text
Sanitized report: fixtures/sanitized/provider-capabilities/2026-07-23/player-identity/cross-provider-player-linkage-5059315.json
Raw report SHA-256: 7e5a10dd3109ba6e4ecb301c34df743ed28eb54b6f53ad01d3cee475411ed239
```

An exact `/players` lookup for James Jarvis also returned zero records.

### Verified conclusion

A lineup record can verify a player's provider ID, event team, batting order, handedness field, and confirmed lineup presence for that snapshot.

Absence from the lineup proves only that the player was not confirmed in the captured starting-lineup response. The lineup endpoint has not been established as a complete roster directory, so absence alone cannot prove that the player does not exist.

When both event-scoped lineup matching and the approved exact player lookup fail to establish one unique provider player ID, the offer identity is unresolved and must fail closed.

### Required protecting test

A fixture-backed join test must prove:

1. exactly one event-scoped match preserves the BALLDONTLIE player ID;
2. zero matches reject the offer;
3. multiple matches reject the offer;
4. lineup absence is not silently converted into a bench-player, starter, or unknown-player assumption.

**V3 fixture:** confirmed for 17 unique matches and one zero-match example  
**Verification status:** capability rule confirmed; normalized contract and protecting test pending

---

## Q6 — Plate-appearance numbering and baserunning events require sequence-aware normalization

### V3 committed fixture evidence

```text
Fixture directory:
fixtures/sanitized/provider-capabilities/2026-07-23/terminal-pa/

Checksum manifest:
fixtures/sanitized/provider-capabilities/2026-07-23/terminal-pa/SHA256SUMS

Fixture commit:
5850fa0

Protecting test:
test/terminal-pa-fixtures.test.mjs

Test commit:
40b0bb8
```

Observed findings:

1. A raw `Caught Stealing 2B` row ended on a pitch recorded as `Ball`. Matching caught-stealing play records had `batter_id=null`. This is a separate `CS` event, not a completed terminal PA.
2. An observed `Strikeout Double Play` ended on `Swinging Strike`; the play text recorded the batter striking out while a runner was separately caught stealing. The terminal outcome is `K`, with the runner event remaining separate.
3. One captured sequence showed that `pa_number` cannot be assumed to be a contiguous completed-PA count.
4. The raw `outs` value showed timing behavior that was not reliable as a universal pre-PA-state field.
5. Complete plays pagination was required to inspect rare and compound events.

### Verified conclusion

No production normalizer may treat every plate-appearance endpoint row as a completed terminal PA. Baserunning events must remain separate from the canonical terminal PA vector, and compound events require sequence or play context.

### Protecting-test status

The committed test currently proves:

- all promoted terminal-PA fixture hashes match;
- every promoted fixture is valid JSON;
- no secret-like content is present;
- caught-stealing evidence is preserved as a separate runner event;
- strikeout-double-play evidence preserves both the batter strikeout and separate caught stealing.

The production normalizer, explicit `pa_number` behavior test, raw-`outs` behavior test, pagination-completeness assertion, and unknown-event fail-closed test remain pending.

**V3 fixture:** committed and checksum-protected  
**Verification status:** fixture-backed evidence confirmed; normalization contract and remaining behavior tests pending

---

## Q7 — Compound result labels cannot always determine whether the batter was retired

### V3 committed fixture evidence

The promoted fixtures and focused test preserve these observed contexts:

- `Fielders Choice`: the batter reached and all runners were safe.
- `Fielders Choice Out`: the batter reached while another runner was retired.
- `Forceout`: the batter reached while another runner was retired.
- `Double Play`: the batter was retired along with another runner.
- `Triple Play`: the batter was retired as part of the triple play.
- `Field Error`: the batter reached on an error.
- `GIDP`: the batter was retired.

```text
Fixture directory:
fixtures/sanitized/provider-capabilities/2026-07-23/terminal-pa/

Protecting test:
test/terminal-pa-fixtures.test.mjs
```

### Verified conclusion

Strings containing `Out`, `Double Play`, `Forceout`, or `Fielders Choice` cannot be mapped safely by substring or label alone in every case.

The normalizer must use verified batter-result or play context and must fail closed when the batter's terminal result cannot be established.

### Protecting-test status

The focused test preserves both batter-reaches and batter-out examples for the observed compound labels. It does not yet implement the normalized mapping or test unknown compound strings.

**V3 fixture:** committed and checksum-protected  
**Verification status:** observed contexts fixture-tested; normalization and unknown-value fail-closed tests pending

---

## Q8 — Catcher interference is exposed as an exact terminal PA result

### V3 committed fixture evidence

```text
Game ID: 5059159
Plate-appearance result: Catcher Interference
Play text: Sosa reached first base on catcher's interference. Philadelphia Phillies challenged: call on the field was overturned.
Committed evidence report:
fixtures/sanitized/provider-capabilities/2026-07-23/terminal-pa/balldontlie-catcher-interference-5059159-report.json
Complete plays captured: 655 records across 7 pages
Fixture commit: 5850fa0
Protecting test: test/terminal-pa-fixtures.test.mjs
Test commit: 40b0bb8
```

### Verified conclusion

The observed exact PA result supports canonical `CATCHER_INTERFERENCE`. The play feed independently confirmed that the batter reached first and that the overturned challenge produced the final official result.

This remains one observed fixture-backed case, not a provider-wide schema guarantee.

### Protecting-test status

The focused test verifies that the exact catcher-interference PA evidence, batter identity, and non-BIP-out flag remain preserved. The production mapping and unknown-interference-spelling rejection test remain pending.

**V3 fixture:** committed and checksum-protected  
**Verification status:** fixture evidence confirmed; normalization mapping test pending

---

## Confirmed access-capture metadata

```text
Captured at: 2026-07-23T14:40:38.454Z
Access report: fixtures/sanitized/provider-access/2026-07-23/provider-access-report.json
Authentication result: HTTP 200
Response top-level keys: data, meta
Returned records: 1
```

This record proves access and the observed response only. It does not define a production player schema.

---

## Related capability matrix

```text
docs/providers/batter-hits-capability-matrix.md
```

The matrix distinguishes committed fixture evidence from remaining local unpromoted observations and records the blocking consequence for every incomplete capability.

---

## Verification record template

For each confirmed quirk, append:

```text
Verified on:
Endpoint:
Request parameters:
Sanitized fixture path:
Fixture SHA-256:
Exact raw field/value:
Normalized result:
Versioned rule:
Protecting test:
Notes:
```

---

## Changelog

### Version 1.3 — 2026-07-23

- Recorded the committed 49-file terminal-PA fixture bundle and checksum manifest from commit `5850fa0`.
- Recorded the focused fixture-integrity and context-evidence test from commit `40b0bb8`.
- Promoted sequence-aware PA, compound-play, and catcher-interference observations from unpromoted evidence to fixture-backed evidence.
- Kept production normalization, unknown-value rejection, `pa_number`, raw-`outs`, and pagination behavior tests explicitly pending.
- Did not convert the limited fixtures into provider-wide schema guarantees.

### Version 1.2 — 2026-07-23

- Added the zero-result James Jarvis player lookup to the verified separate-name behavior.
- Extended the two-digit-year evidence to the committed lineup fixture without approving a date parser.
- Partially verified game status semantics with preserved `STATUS_SCHEDULED` and `STATUS_FINAL` examples.
- Recorded that lineup absence is not equivalent to unknown player identity and required zero/multiple matches to fail closed.
- Recorded sequence-aware PA, compound-play, and catcher-interference observations as unpromoted evidence that implementation may not yet use.
- Linked the dedicated Batter Hits capability matrix.

### Version 1.1 — 2026-07-23

- Promoted the exact separate-name lookup behavior from chat history to V3 fixture-backed evidence.
- Confirmed a real V3 `dob` value with a two-digit year.
- Preserved the raw response hash, player ID, pagination metadata, and sanitized fixture path.
- Kept month/day/year normalization unapproved because one slash-delimited value is insufficient to establish a provider-wide parser rule.
- Left game-status semantics pending until a real games fixture is captured.

### Version 1.0 — 2026-07-23

- Preserved the four carried-forward observations: separate player-name parameters, two-digit years, month/day/year ordering, and status-based game filtering.
- Marked every observation as pending V3 fixture confirmation rather than silently converting chat history into permanent provider truth.
