# M8.5 typed context-factor contract v1

**Status:** Contract design and verification record; no fitted factor enabled  
**Repository:** `Derkmane/mlb-prop-analyzer-v3`  
**Active season:** 2026  
**Production enabled:** false

## Purpose

This contract is the mandatory extension boundary between immutable M8 `D_base` and future M8.5 context factors. It replaces the scalar-only proposal in PR #24. It is infrastructure, not a fitted baseball factor.

A context factor may affect only approved baseball state before settlement:

- terminal plate-appearance outcome vectors
- shared scenario mixture weights
- hitter opportunity survival
- starter/bullpen workload transitions
- handedness- and outcome-specific park transformations
- balls-in-play defensive translation

A factor may not read the posted selected side, add or subtract probability points, settle an offer, rank a prop, or change production enablement.

## Typed effect kinds

The public contract must use a discriminated union with these effect kinds:

1. `identity`
2. `terminal-outcome-vector`
3. `scenario-mixture`
4. `opportunity-survival`
5. `workload-transition`
6. `park-transformation`
7. `batted-ball-translation`

Each non-identity effect must use baseball-unit fields specific to its effect family. There is no universal scalar `coefficient` field.

## Required artifact evidence

Every artifact must preserve:

- contract version
- factor key
- factor status
- model version
- artifact SHA-256
- active MLB season
- validation status
- application stage
- source-evidence version
- required input identities
- explicit `selectedSideInputAllowed: false`
- explicit `directProbabilityEffectAllowed: false`
- one typed effect payload

Every fitted non-identity artifact must carry current-season chronological validation evidence. Unknown factor keys, unsupported effect kinds, missing evidence, wrong-season artifacts, hash drift, selected-side fields, direct probability fields, and silent scalar coefficients fail closed.

## Identity default

Every declared factor starts production-disabled with an explicit `identity` effect. A disabled factor may not carry a non-identity payload. Identity artifacts remain versioned and auditable; they are not silent fallbacks.

## Scope boundary

This contract does not implement team bullpen, game environment, park, times-through-order, or defense calculations. It does not modify M8 `D_base`, build `D_final`, settle an offer, rank a pick, enable production, access the sealed untouched test, or recover July 31 archive evidence.

## Verification gate

Before this contract may merge, focused tests must prove:

- every approved effect kind validates only its own baseball-unit schema
- identity is the only disabled default
- selected-side input is rejected
- direct probability fields and generic scalar coefficients are rejected
- wrong season, missing validation evidence, unknown factor keys, unsupported kinds, malformed payloads, and artifact-hash drift fail closed
- identical versioned inputs validate deterministically
- complete repository verification passes while production remains disabled
