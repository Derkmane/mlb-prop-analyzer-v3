# MLB Prop Analyzer V3 — Master Project Checklist

**Version:** 2.9
**Status:** Active source of execution truth  
**Repository:** `Derkmane/mlb-prop-analyzer-v3`

This checklist controls execution order and milestone status. It cannot override `PROJECT_RULES.md` or `CANONICAL_MATH_SPEC.md`.

---

## M0 — Foundation and protections

- [x] Repository foundation.
- [x] Strict TypeScript configuration.
- [x] Runtime validation foundation.
- [x] Dependency-cruiser architecture protection.
- [x] Generic disabled-feature fail-closed path.
- [x] Generic immutable saved-prediction contract.
- [x] Historical rendering independent of active feature code.

---

## M1 — Provider access and capability evidence

- [x] Verify The Odds API access without consuming unnecessary quota.
- [x] Verify BALLDONTLIE access through the documented Authorization header.
- [x] Capture sanitized real provider responses.
- [x] Preserve raw-body hashes and secret-safe request metadata.
- [x] Capture verified current Underdog event markets and offer samples.
- [x] Capture BALLDONTLIE games, lineups, stats, plate appearances, and plays where available.
- [x] Record verified provider quirks.
- [x] Create provider capability evidence before provider-shaped contracts.

---

## M2 — Provider contracts and normalized evidence

- [x] Runtime-validated The Odds API contracts from verified fixtures.
- [x] Runtime-validated BALLDONTLIE contracts from verified fixtures.
- [x] Normalized provider boundaries.
- [x] Preserve provider snapshot identity.
- [x] Fail closed for unsupported provider values.
- [x] Keep raw provider objects inside adapters.

---

## M3 — Domain contracts

- [x] Selected-side contract.
- [x] Posted-line contract.
- [x] Event/game identity.
- [x] Player/team identity.
- [x] Market identity.
- [x] Probability contract.
- [x] Settlement result contract.
- [x] Versioned model and settlement identities.

---

## M4 — Deterministic probability core

- [x] Probability validation.
- [x] PMF validation.
- [x] Hitter survival-to-count conversion.
- [x] Exact deterministic convolution.
- [x] Poisson-binomial dynamic programming.
- [x] Opportunity-count mixing.
- [x] Scenario mixing.
- [x] Generic Higher settlement.
- [x] Generic Lower settlement.
- [x] Integer-line tie handling.
- [x] Half-point handling.
- [x] `P(Win)`, `P(Loss)`, `P(Void)`, and `P(Win | grades)`.
- [x] Side-aware ranking by `P(Win | grades)`, then `P(Void)`.
- [x] Exact comparator precision with no epsilon collapse.
- [x] Higher/Lower symmetry and directional-shift tests.

---

## M5 — Registries and removal safety

- [x] Market statuses.
- [x] Feature statuses.
- [x] Planned-market catalog.
- [x] Implemented-market registry.
- [x] Feature registry.
- [x] Versioned settlement registry.
- [x] Exact registry-driven production admission.
- [x] No fallback for unvalidated or disabled markets.
- [x] Single market-key ownership.
- [x] Immutable saved-prediction snapshots.
- [x] Historical rendering remains after feature removal.
- [x] Feature deletion proof.

---

## M6 — Shared game and hitter opportunity foundation

- [x] Shared `GameScenarioSet` contract.
- [x] Shared lineup state.
- [x] Shared home/away state.
- [x] Shared offensive-environment state.
- [x] Shared starter and bullpen assumptions.
- [x] Shared joint pitching-workload path.
- [x] Raw and adjusted hitter PA survival fields.
- [x] Fail closed for invalid survival curves.
- [x] Survival-to-count conversion.
- [x] Exact lineup-slot tails and expectations.
- [x] Scenario-weight conservation.
- [x] Starter/bullpen/total workload consistency.
- [x] Opportunity and outcome use the same shared scenario.
- [x] Reject contradictory scenario references.

---

## M7 — Synthetic Batter Hits vertical slice

- [x] Transfer Batter Hits market ownership to the feature manifest.
- [x] Public Batter Hits feature boundary.
- [x] Synthetic-only offer contract.
- [x] Synthetic Hits distribution from shared scenarios.
- [x] Generic core settlement.
- [x] Baseline and alternate lines share one statistic distribution.
- [x] Generic prediction candidate.
- [x] Immutable synthetic saved prediction.
- [x] Deterministic synthetic JSON output.
- [x] Historical view.
- [x] Feature remains disabled and production-ineligible.
- [x] Complete feature-removal proof.
- [x] Historical rendering survives removal.
- [x] Restore exact feature tree after deletion proof.
- [x] Full verification.

---

## M8 — Current-season Batter Hits fitting and runtime freeze

### Current-season evidence

- [x] Preserve complete current-season date shards.
- [x] Preserve complete current-season games and plate appearances.
- [x] Strict chronological fit, validation, and untouched partitions.
- [x] No prior-season or career statistics.
- [x] Deterministic source hashes and tamper checks.

### Terminal plate-appearance model

- [x] Verified terminal-PA classifications.
- [x] Contextual terminal resolution.
- [x] Resolved current-season categorical dataset.
- [x] Current-season recency benchmark.
- [x] Current-season categorical pooling.
- [x] Coherent categorical batter/pitcher matchup.
- [x] Current-season platoon evaluation.
- [x] Rare-outcome sample and uncertainty reporting.
- [x] Hit reliability and probability buckets.
- [x] Overdispersion and half-line tail checks.
- [x] One shrinkage path per parameter.
- [x] Final terminal-PA runtime artifact.

### Workload and shared game

- [x] Current-season lineup/stat capture.
- [x] Starter-retention dataset and artifact.
- [x] Starter-to-bullpen transition model.
- [x] Shared offensive-environment scenarios.
- [x] Hitter PA survival by lineup slot and home/away.
- [x] Define and validate monotonicity handling for fitted hitter PA survival curves — selected curves are monotone by construction, raw and fitted curves are preserved, and no production repair threshold is used.
- [x] Eligibility and participation probability — deferred to the M9 ranking pipeline as a pregame runtime gate and not treated as an M8 fitted current-season component.
- [x] Opportunity/outcome dependence benchmark.
- [x] Treat projected and confirmed versions of an otherwise identical lineup identically in model assumptions and opportunity distributions.

### Validation and calibration

- [x] Earlier current-season fit period.
- [x] Later validation period.
- [x] Reserve and seal an untouched latest current-season test period during candidate selection.
- [x] Preserve the final untouched-test evaluation for one later acceptance session after freeze; M8 close-out did not access the reserved rows.
- [x] Walk-forward evaluation where practical.
- [x] Reliability curves.
- [x] Brier score.
- [x] Log loss.
- [x] Probability-bucket counts and uncertainty.
- [x] Validation-period half-line and altline-tail checks.
- [x] Overdispersion checks.
- [x] Frozen, versioned complete runtime model artifacts — `model-artifacts/m8-batter-hits-runtime-freeze-v1.json`, SHA-256 `e5a660ffc0aefc093dc80aae0169109bd7717605098d790b3257a83fad5bf3de`.
- [x] Runtime application code does not import the offline fitting scripts.

### M8 exit gate

- [x] Batter Hits remains production-disabled and the untouched test remains sealed; M8 fitting and runtime freezing do not authorize real-prop ranking.
- [x] No placeholder or unvalidated coefficient can reach production ranking.
- [x] Frozen runtime manifest records all selected fitted components, all explicit identity/deferred components, settlement/model versions, source hashes, `productionEnabled: false`, and `untouchedTestAccessed: false`.
- [x] Focused freeze tests passed 3 of 3 and the complete repository verification passed 332 of 332 tests with typecheck, script checks, architecture, and build clean.

M8 current-season fitting and runtime-freeze work is closed. The one-time untouched-test evaluation remains a separate later acceptance gate and may not be used for retuning. M9 may integrate the frozen model and runtime eligibility gate, but real ranking remains fail closed until all M9 acceptance requirements and the untouched-test decision are satisfied.

---

## M9 — Real Batter Hits ranking

- [x] Connect real frozen model artifacts — exact `m8-batter-hits-runtime-freeze-v1` artifact connected through the feature, adapter, and composition public boundaries with SHA-256 `e5a660ffc0aefc093dc80aae0169109bd7717605098d790b3257a83fad5bf3de`; build and 2 focused tests passed, GitHub Actions verify run 402 passed 334 of 334 tests, production ranking remains disabled, and untouched-test rows remain sealed.
- [x] Connect real normalized current board offers — committed fixture-backed The Odds API contracts and normalization preserve exact event, Underdog bookmaker, baseline/alternate market, uniquely linked BALLDONTLIE player, Higher/Lower side, posted line, price, multiplier, market timestamp, and source snapshot identity; 34 offers normalized, both unresolved James Jarvis offers failed closed, 3 focused tests passed, and GitHub Actions verify run 405 passed 337 of 337 tests while probability generation and production ranking remained disabled.
- [x] Exclude started games — fixture-backed BALLDONTLIE game-state normalization and the shared pregame eligibility gate require the matched current-season regular-season game to remain `STATUS_SCHEDULED` and require the evaluation time to be strictly before both preserved provider start timestamps; final, unknown, missing, duplicate, or start-time-reached states fail closed. Four focused tests passed and GitHub Actions verify run 408 passed 341 of 341 tests while side and line remained unchanged and production ranking remained disabled.
- [x] Preserve exact selected side and line — exhaustive fixture-backed regression matched all 34 uniquely linked baseline and alternate offers through both normalized and pregame composition boundaries; raw `Over` remained `Over` and mapped only to `higher`, raw `Under` remained `Under` and mapped only to `lower`, and every numeric provider point survived exactly as the posted line. Final-game exclusion retained the same immutable offer identities. Two focused tests passed and GitHub Actions verify run 413 passed 343 of 343 tests while production ranking remained disabled.
- [x] Produce `P(Win)`, `P(Loss)`, `P(Void)`, and `P(Win | grades)` — the exact frozen complete Batter Hits candidate, SHA-256 `728895ca850c5481cd1f17944e38464f16396becc3622146a1384bba19ce5cde`, now builds deterministic scenario-conditioned nested opportunity-count and Poisson-binomial Hits distributions and settles exact Higher/Lower sides and posted lines through the generic core settlement path. Baseline and alternate examples conserve probability mass, mismatched runtime identity and production authorization fail closed, 3 focused tests passed, and GitHub Actions verify run 417 passed 346 of 346 tests while production ranking remained disabled and untouched-test rows remained sealed.
- [x] Verify baseline and alternate offers use the same statistic distribution — the committed board contains verified baseline and alternate Batter Hits offers but no same-player pair, so one explicit test-only invariant held normalized player, game, team, lineup, opposing starter, shared scenarios, and frozen model artifacts fixed while substituting only provider-observed alternate offer attributes. The complete runtime distribution and candidate statistic distribution remained exactly identical; selected side, posted line, price, multiplier, and settlement probabilities were allowed to differ. One focused test passed and GitHub Actions verify run 420 passed 347 of 347 tests while production ranking remained disabled and untouched-test rows remained sealed.
- [ ] Enable only after all acceptance gates pass.
- [x] Begin prospective board archiving and grading — the live July 31, 2026 Underdog Batter Hits board was captured through the connected frozen M8 runtime into one immutable 30-row archive at `artifacts/board-archives/batter-hits/2026-07-31.json`, archive SHA-256 `ae8803b5625662e483f1b6f52e715f55a671a3c9d777ae7ec1aa65fda1bedc8c`. Exact player, game, market, side, line, probabilities, complete distributions, model versions, settlement version, and provider snapshot hashes were preserved. The official-Hits grader uses exact provider game and player IDs, settles Higher/Lower including integer-line voids, refuses to persist incomplete grading, and reported 30 pending, 0 unresolved rows while the game was not final. Archive and grading tests passed 10 of 10; the integrated focused gate passed 24 of 24 and the complete repository verification passed 360 of 360. Production ranking remained disabled and untouched-test rows remained sealed.

---

## M10 — Categories, saved runs, grading, and presentation

- [ ] Opportunity Miner eligibility.
- [ ] High Probability Baseline eligibility.
- [ ] High Probability Altline eligibility.
- [ ] One prop per player per category.
- [ ] Category overlap allowed.
- [ ] Sort by `P(Win | grades)`, then `P(Void)`.
- [ ] Top Five selection.
- [ ] Complete immutable saved-run storage.
- [ ] Atomic persistence.
- [ ] Historical-only rendering.
- [ ] Versioned grading.
- [ ] API entrypoints.
- [ ] UI display with no probability logic in the UI.
- [ ] Deployment and public-link verification.

---

## Future planned markets

These are intended investigations, not abandoned markets. No empty feature folders are created before implementation begins.

### Batter Total Bases

- [ ] Verify provider market availability and settlement definition.
- [ ] Reuse the shared terminal PA vector.
- [ ] Build the exact Total Bases distribution.
- [ ] Validate chronologically.

### Batter Hits + Runs + RBIs

- [ ] Verify approved-source data sufficiency.
- [ ] Build tagged-player base-out joint distribution.
- [ ] Preserve player identity through runs and RBI transitions.
- [ ] Validate chronologically.

### Pitcher Strikeouts

- [ ] Verify required provider fields.
- [ ] Build sequential pitcher workload/outcome state model.
- [ ] Fit continuation/removal hazard.
- [ ] Derive strikeout marginal from the joint process.
- [ ] Validate chronologically.

---

## Changelog

### Version 2.9 — 2026-07-31

- Began prospective live Underdog Batter Hits board archiving through the connected frozen M8 runtime.
- Preserved one immutable 30-row July 31 archive with SHA-256 `ae8803b5625662e483f1b6f52e715f55a671a3c9d777ae7ec1aa65fda1bedc8c`.
- Added official BALLDONTLIE final-game Hits grading using exact archived game and player identities and exact Higher/Lower settlement.
- Verified that incomplete games remain pending and do not create a permanent grade sidecar; the initial live run reported 30 pending and 0 unresolved rows.
- Recorded 10-of-10 archive/grading tests, 24-of-24 integrated focused tests, and 360-of-360 complete repository tests passing.
- Preserved the connected M8 model, production-disabled status, and sealed untouched-test boundary.

### Version 2.8 — 2026-07-30

- Added a fixture-backed test-only invariant proving baseline and alternate Batter Hits offer attributes do not create different baseball distributions.

### Version 2.7 — 2026-07-30

- Recorded deterministic frozen Batter Hits probability generation through exact scenario-conditioned opportunity and Hits distributions.

### Version 2.6 — 2026-07-30

- Recorded exact selected-side and posted-line preservation through the normalized and pregame board boundaries.

### Version 2.5 — 2026-07-30

- Recorded started-game exclusion through the shared pregame game-state gate.

### Version 2.4 — 2026-07-30

- Recorded real normalized current Underdog Batter Hits board offers.

### Version 2.3 — 2026-07-30

- Recorded exact frozen Batter Hits runtime artifact connection.

### Version 2.2 — 2026-07-30

- Closed M8 fitting and runtime freezing while preserving the untouched-test and production-disabled boundaries.

### Version 2.1 — 2026-07-29

- Recorded the selected starter-to-bullpen workload candidate under the canonical nondominated-set rule.

### Version 2.0 — 2026-07-29

- Recorded the complete M8 fitting and validation framework.

### Version 1.9 — 2026-07-26

- Recorded verified M7 completion.

### Version 1.8 — 2026-07-23

- Recorded verified M6 completion.

### Version 1.7 — 2026-07-23

- Recorded verified M5 completion.

### Version 1.6 — 2026-07-23

- Recorded verified M4 completion.
