# BALLDONTLIE MLB — Observed Quirks and Verification Ledger

**Version:** 1.1  
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

### Verified conclusion

The V3 request using separate `first_name` and `last_name` parameters was accepted and returned the expected exact player with provider player ID `208`.

This does not yet prove partial-match, duplicate-name, or all pagination behavior. A production lookup contract must preserve the provider player ID and must not assume that `full_name` is a supported equivalent request parameter.

### Required protecting test

A fixture-backed adapter test must prove that a known player lookup uses the verified separate name parameters and preserves the provider player ID.

**V3 fixture:** confirmed for exact lookup  
**Verification status:** partial — exact lookup confirmed; partial/duplicate behavior and adapter test pending

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

### Verified conclusion

A V3 production response contains a slash-delimited DOB with a two-digit year. Therefore a player contract may not require an ISO date or four-digit year at the raw-provider boundary.

No century-resolution or normalized-date rule has been approved. Until that rule is supported by sufficient evidence, preserve the exact raw value and fail closed if a downstream component requires an unambiguous calendar date.

### Required protecting test

A fixture-backed normalization test must preserve the raw value and either parse it through an explicitly versioned rule or fail closed when the century cannot be resolved safely.

**V3 fixture:** confirmed  
**Verification status:** raw two-digit-year behavior confirmed; normalization rule and test pending

---

## Q3 — Observed date ordering required month/day/year interpretation

### Carried-forward observation

An earlier field was observed in month/day/year order rather than the ordering previously assumed by implementation code.

Do not infer ordering from separator shape alone. Record the exact field and raw fixture before defining the parser.

### Current V3 evidence

The player fixture contains:

```text
dob = "07/05/94"
```

This confirms slash-delimited two-digit-year behavior, but the response alone does not prove a provider-wide field-order rule or consistency across players and endpoints. The V3 parser remains unapproved.

### V3 verification still required

- multiple real player fixtures
- independent confirmation of each exact calendar date
- whether player and lineup endpoints use the same representation
- whether ISO-formatted alternatives occur
- timezone and date-only semantics

### Required protecting test

A fixture-backed date parser test must assert the exact normalized calendar date and reject ambiguous unsupported forms.

**V3 fixture:** one ambiguous-format example preserved  
**Verification status:** pending — do not infer field order yet

---

## Q4 — Game filtering must use verified status semantics

### Carried-forward observation

Earlier work found that selecting or excluding games required the provider's status field rather than relying on an assumed date-field filter alone.

Do not infer pregame, active, completed, postponed, suspended, or cancelled state from a calendar date by itself.

### V3 verification required

- games endpoint
- exact status field
- all observed status values
- relationship between status, scheduled date, and start time
- rule for pregame eligibility
- postponed and suspended behavior

### Required protecting test

A fixture-backed game-state test must prove that pregame eligibility uses verified status and start-time semantics and excludes started games.

**V3 fixture:** pending  
**Verification status:** pending

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

### Version 1.1 — 2026-07-23

- Promoted the exact separate-name lookup behavior from chat history to V3 fixture-backed evidence.
- Confirmed a real V3 `dob` value with a two-digit year.
- Preserved the raw response hash, player ID, pagination metadata, and sanitized fixture path.
- Kept month/day/year normalization unapproved because one slash-delimited value is insufficient to establish a provider-wide parser rule.
- Left game-status semantics pending until a real games fixture is captured.

### Version 1.0 — 2026-07-23

- Preserved the four carried-forward BALLDONTLIE observations: separate player-name parameters, two-digit years, month/day/year ordering, and status-based game filtering.
- Marked every observation as pending V3 fixture confirmation rather than silently converting chat history into permanent provider truth.
