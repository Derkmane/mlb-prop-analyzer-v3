# BALLDONTLIE MLB — Observed Quirks and Verification Ledger

**Version:** 1.0  
**Status:** Carried-forward observations requiring V3 fixture confirmation  
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

### V3 verification required

- endpoint: players lookup
- exact query parameters accepted
- behavior for exact and partial matches
- pagination behavior
- duplicate-name behavior
- player ID returned

### Required protecting test

A fixture-backed adapter test must prove that a known player lookup uses the verified separate name parameters and preserves the provider player ID.

**V3 fixture:** pending  
**Verification status:** pending

---

## Q2 — Date-of-birth values may contain two-digit years

### Carried-forward observation

At least one earlier BALLDONTLIE response exposed a date-of-birth representation containing a two-digit year.

Do not assume every year is four digits. Do not rely on JavaScript's implicit date parser.

### V3 verification required

- endpoint and raw field name
- exact raw date string
- observed separator and field order
- provider behavior across multiple players
- century-resolution rule, if DOB remains a required field

### Required protecting test

A fixture-backed normalization test must preserve the raw value and either parse it through an explicitly versioned rule or fail closed when the century cannot be resolved safely.

**V3 fixture:** pending  
**Verification status:** pending

---

## Q3 — Observed date ordering required month/day/year interpretation

### Carried-forward observation

An earlier field was observed in month/day/year order rather than the ordering previously assumed by implementation code.

Do not infer ordering from separator shape alone. Record the exact field and raw fixture before defining the parser.

### V3 verification required

- endpoint
- field name
- exact raw examples
- whether the field is consistently month/day/year
- whether ISO-formatted alternatives exist
- timezone and date-only semantics

### Required protecting test

A fixture-backed date parser test must assert the exact normalized calendar date and reject ambiguous unsupported forms.

**V3 fixture:** pending  
**Verification status:** pending

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

### Version 1.0 — 2026-07-23

- Preserved the four carried-forward BALLDONTLIE observations: separate player-name parameters, two-digit years, month/day/year ordering, and status-based game filtering.
- Marked every observation as pending V3 fixture confirmation rather than silently converting chat history into permanent provider truth.
