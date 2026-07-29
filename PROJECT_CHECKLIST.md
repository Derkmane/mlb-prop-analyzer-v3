# MLB Prop Analyzer V3 — Master Project Checklist

**Version:** 2.1
**Status:** Active source of execution truth  
**Repository:** `Derkmane/mlb-prop-analyzer-v3`

This checklist is evidence-driven. A box is checked only after direct verification. There are no daily caps or time estimates.

---

## M0 — Authority and modular foundation

- [x] Create and approve complete `PROJECT_RULES.md` for V3.
- [x] Create and approve complete `CANONICAL_MATH_SPEC.md` for V3 terminology.
- [x] Create this master checklist.
- [x] Create `docs/providers/balldontlie-quirks.md` with carried-forward observations and V3 verification requirements.
- [x] Confirm strict TypeScript as the implementation language.
- [x] Select and version the supported Node LTS runtime after environment verification.
- [x] Create the empty modular-monolith directory structure.
- [x] Configure strict TypeScript.
- [x] Configure runtime schema validation.
- [x] Configure dependency-cruiser.
- [x] Enforce one-directional layer boundaries.
- [x] Enforce feature-to-feature imports through public `index` entrypoints only.
- [x] Enforce no circular or unresolved imports.
- [x] Configure the test runner.
- [x] Configure GitHub Actions CI.
- [x] Add foundation scripts for typecheck, architecture checks, tests, and build.
- [x] Add a protective-failure architecture test.
- [x] Add a synthetic disabled-market fail-closed test.
- [x] Add a synthetic historical-record rendering test that does not import feature code.

### M0 exit gate

- [x] Authority files are complete and versioned.
- [x] Typecheck passes.
- [x] Architecture checks pass.
- [x] Tests pass for the currently implemented foundation scope.
- [x] CI passes for the currently implemented foundation scope.
- [x] No production feature implementation exists.
- [x] No synthetic value can appear as a production prediction.
- [x] Synthetic fail-closed and historical-independence protections pass.

---

## M1 — Provider access and immutable evidence

### The Odds API

- [x] Verify secret access without exposing the secret.
- [x] Verify MLB event access.
- [x] Verify Underdog bookmaker access.
- [ ] Verify region and market parameters from preserved real-response request metadata.
- [x] Capture sanitized MLB event fixture.
- [x] Capture sanitized Batter Hits baseline fixture.
- [x] Capture sanitized Batter Hits alternate fixture.
- [ ] Verify complete provider event, player, market, side, line, start-time, and offer-type identity.
- [x] Verify observed market keys and multipliers/offer metadata actually supplied.

### BALLDONTLIE

- [x] Verify secret access without exposing the secret.
- [x] Capture sanitized players fixture.
- [x] Capture sanitized games fixture.
- [x] Capture sanitized lineups fixture.
- [x] Capture sanitized plate-appearances fixture.
- [x] Capture sanitized plays fixtures required by terminal-outcome mapping.
- [ ] Capture sanitized current-season statistics fixture.
- [ ] Reverify every observation in `docs/providers/balldontlie-quirks.md`.
- [ ] Add one protecting test per confirmed quirk.

### M1 exit gate

- [ ] Every provider claim points to a preserved sanitized fixture.
- [ ] No endpoint, parameter, field, date rule, or market key is assumed.
- [ ] Raw snapshots are immutable and identified by hashes.

---

## M2 — Batter Hits capability matrix

For every required component, record endpoint, exact JSON path, fixture, availability, ambiguity, normalization rule, and blocking consequence.

Primary document:

```text
docs/providers/batter-hits-capability-matrix.md
```

### Offer and settlement identity

- [x] Underdog source identity.
- [x] Event identity.
- [x] Player identity — partial capability recorded; zero or multiple matches fail closed.
- [x] Market identity.
- [x] Baseline/alternate identity.
- [x] Selected Higher/Lower side.
- [x] Posted line.
- [ ] Pregame start time/status — scheduled and final observed; complete state semantics remain open.

### Game and player joins

- [x] MLB game identity and one observed provider join; generalized join tolerance remains open.
- [x] Team identity and opponent.
- [x] Player identity mapping — 17 unique matches and one zero-match fail-closed case preserved.
- [x] Current-season game guard fields.
- [x] Home/away state.

### Lineup and opportunity

- [x] Confirmed lineup availability.
- [x] Batting-order/lineup-slot availability.
- [ ] Probable opposing starter identity.
- [x] Plate-appearance ordering — `pa_number` is preserved as ordering metadata and is not assumed to be a contiguous completed-PA count.
- [x] Batter and pitcher identity fields per PA are preserved in the promoted fixtures.
- [ ] Handedness where required across the complete PA matchup path.

### Canonical terminal PA vector

Determine whether approved data can map every raw PA into exactly one of:

- [x] `K` — observed in promoted fixture evidence, including `Strikeout Double Play` with a separate runner event.
- [x] `UBB` — observed raw `Walk`, distinct from `Intent Walk`.
- [x] `IBB` — observed raw `Intent Walk`.
- [x] `HBP` — observed raw `Hit By Pitch`.
- [x] `1B` — observed raw `Single`.
- [x] `2B` — observed raw `Double`.
- [x] `3B` — observed raw `Triple`.
- [x] `HR` — observed raw home-run labels preserved in fixture-backed evidence.
- [x] `ROE` — observed raw `Field Error` with batter-safe context.
- [x] `FC` — observed `Fielders Choice`, `Fielders Choice Out`, and `Forceout` batter-safe contexts.
- [x] `SF` — observed raw `Sac Fly`.
- [x] `SH` — observed raw `Sac Bunt`.
- [x] `BIP_OUT` — observed standard and compound batter-out contexts.
- [x] `CATCHER_INTERFERENCE` — observed exact raw `Catcher Interference` with play confirmation.
- [ ] `OTHER_PA` — no supporting raw terminal result was observed; unknown values must fail closed.

Checked terminal-category items above mean fixture-backed observed capability plus the tested mapping behavior for supported labels. This does not create a provider-wide guarantee or make `OTHER_PA` available.

- [x] Verify supported mappings are mutually exclusive — each accepted promoted row produces exactly one canonical terminal category.
- [ ] Verify provider results are collectively exhaustive — `OTHER_PA` remains unobserved and unknown future labels fail closed.
- [x] Document and test that unmapped, malformed, contradictory, and context-insufficient raw values fail closed without an `OTHER_PA` fallback.

### M2 exit gate

- [ ] Every required Batter Hits input is verified, unavailable, or explicitly ambiguous.
- [ ] Missing data has a written blocker and lawful options.
- [ ] No mathematical category is silently merged or invented.

---

## M3 — Contracts from evidence

### Pure domain contracts

- [x] `SelectedSide`.
- [x] `ProbabilityMassFunction`.
- [x] `EligibilityProbability`.
- [x] `SettlementResult`.
- [x] `WinLossVoid`.
- [x] `MarketStatus`.
- [x] `FeatureStatus`.

### Provider and normalized contracts

- [ ] Raw The Odds API event schema.
- [ ] Raw Underdog offer schema.
- [ ] Raw BALLDONTLIE player schema.
- [ ] Raw game schema.
- [ ] Raw lineup schema.
- [x] Raw plate-appearance schema — all 607 promoted PA rows parse; unknown fields are preserved and missing required observed fields fail validation.
- [x] Raw play schema where required — all 3,497 promoted play rows parse; nullable identities/text and observed pagination shapes are preserved.
- [ ] `NormalizedBoardOffer`.
- [ ] `NormalizedGame`.
- [ ] `NormalizedPlayer`.
- [ ] `NormalizedLineup`.
- [x] `NormalizedTerminalPA` and evidence-backed mapping — verified exact labels map deterministically; contextual compound labels require explicit batter disposition; caught stealing remains separate; unknown values fail closed.
- [ ] Provider IDs, source timestamps, and fixture hashes survive normalization across every required provider contract.
- [ ] Unknown or malformed provider data fails closed across every required provider contract.
- [ ] Selected side and line survive unchanged.

Verified by `test/balldontlie-terminal-pa-contracts.test.ts` and `test/balldontlie-terminal-pa-mapping.test.ts`. All 607 promoted PA rows produce exactly one explicit state: normalized terminal PA, baserunning-only, or fail-closed rejection. The full `npm run verify` suite passed 24 tests with no regressions.

---

## M4 — Verified deterministic core

- [x] Probability-vector validation.
- [x] Scenario-weight validation.
- [x] Hitter survival-to-count conversion.
- [x] Exact deterministic convolution.
- [x] Scenario mixing.
- [x] Higher settlement.
- [x] Lower settlement.
- [x] Integer-line tie handling.
- [x] Half-point handling.
- [x] `P(Win)+P(Loss)+P(Void)=1` invariant.
- [x] `P(Win | grades)`.
- [x] Side-aware ranking comparator.
- [x] Higher/Lower symmetry tests.
- [x] Upward/downward distribution-shift tests.
- [x] Dynamic programming versus brute force.
- [x] Canonical worked-example golden test.
- [x] Deterministic identical-input rerun test.

---

## M5 — Registries, fail-closed behavior, and historical independence

- [x] Planned-market catalog.
- [x] Implemented-market registry.
- [x] Feature registry with enable/disable state.
- [x] Settlement registry with versions and effective dates.
- [x] Single-source market-key ownership test.
- [x] No silent fallback test.
- [x] Disabled feature cannot produce a prediction.
- [x] Not-yet-production-validated market cannot rank.
- [x] Immutable saved-prediction envelope.
- [x] Generic historical renderer independent of active feature code.
- [x] Feature-specific historical data uses a versioned isolated envelope.

---

## M6 — Shared game and hitter opportunity foundation

- [x] Define `GameScenarioSet` contract.
- [x] Define shared lineup state.
- [x] Define home/away state.
- [x] Define shared offensive-environment state.
- [x] Define starter and bullpen scenario interfaces.
- [x] Define scenario-weight conservation.
- [x] Define hitter PA survival interface by lineup slot.
- [x] Preserve raw and monotone-adjusted survival curves.
- [x] Test survival-to-count conversion.
- [x] Test consistency with team batters faced.
- [x] Test shared scenarios move opportunity and outcome assumptions together.
- [x] Prohibit feature-specific contradictory game scenarios.

---

## M7 — Synthetic Batter Hits vertical slice

- [ ] Create `src/features/batter-hits/` only when implementation begins.
- [ ] Create small feature manifest.
- [ ] Transfer Batter Hits market-key ownership from planned catalog to feature manifest in one commit.
- [ ] Implement public feature `index` entrypoint.
- [ ] Accept normalized board offer and shared scenarios.
- [ ] Build a clearly synthetic Hits distribution.
- [ ] Apply generic settlement for Higher.
- [ ] Apply generic settlement for Lower.
- [ ] Support baseline and alternate lines from the same distribution.
- [ ] Produce generic candidate record.
- [ ] Save immutable synthetic prediction outside production output paths.
- [ ] Render through CLI or JSON entrypoint.
- [ ] Disable the feature and prove fail-closed behavior.
- [ ] Remove the feature and prove historical rendering still works.
- [ ] Restore only after the removal proof passes.

---

## M8 — Current-season fitting and validation

### Categorical hitter model

- [x] Define current-season recency weighting — uniform current-season weighting won fixed validation and expanding walk-forward comparisons.
- [x] Define one approved pooling path per parameter.
- [x] Prohibit double shrinkage.
- [x] Fit current-season batter effects.
- [x] Fit current-season pitcher-allowed effects.
- [x] Fit and evaluate current-season platoon effects.
- [x] Fit coherent terminal categorical probabilities.
- [x] Handle rare outcomes and report uncertainty without prior-season supplementation.

### Context and opportunity

- [ ] Park neutralization and application.
- [ ] Defense-to-batted-ball translation if supported.
- [ ] Times-through-order effects.
- [x] Bullpen transition scenarios — selected `starter-bf-side-pool-1000` from the intersection of the fixed-validation and expanding walk-forward proper-score nondominated sets under `CANONICAL_MATH_SPEC.md` Version 1.5; 9 focused tests, the real-data shared-environment gate, the complete 329-test verification gate, and GitHub Actions verify run 396 passed while production remained disabled and untouched-test rows remained sealed.
- [x] Shared offensive-environment scenarios.
- [x] Hitter PA survival by lineup slot and home/away.
- [x] Define and validate monotonicity handling for fitted hitter PA survival curves — selected curves are monotone by construction, raw and fitted curves are preserved, and no production repair threshold is used.
- [ ] Eligibility and participation probability.
- [x] Opportunity/outcome dependence benchmark.
- [x] Treat projected and confirmed versions of an otherwise identical lineup identically in model assumptions and opportunity distributions.

### Validation and calibration

- [x] Earlier current-season fit period.
- [x] Later validation period.
- [x] Reserve and seal an untouched latest current-season test period during candidate selection.
- [ ] Run the final untouched-test evaluation after the complete runtime candidate is frozen.
- [x] Walk-forward evaluation where practical.
- [x] Reliability curves.
- [x] Brier score.
- [x] Log loss.
- [x] Probability-bucket counts and uncertainty.
- [x] Validation-period half-line and altline-tail checks.
- [x] Overdispersion checks.
- [ ] Frozen, versioned complete runtime model artifacts.
- [x] Runtime application code does not import the offline fitting scripts.

### M8 exit gate

- [x] Batter Hits explicitly remains not yet production-validated; the completed fitting and validation evidence may merge without enabling real-prop ranking.
- [x] No placeholder or unvalidated coefficient can reach production ranking.

M8 merge status is documented in `docs/modeling/m8-merge-status-v1.md`. Open production gates above remain blockers for M9 and may not be silently treated as completed.

---

## M9 — Real Batter Hits ranking

- [ ] Connect real frozen model artifacts.
- [ ] Connect real normalized current board offers.
- [ ] Exclude started games.
- [ ] Preserve exact selected side and line.
- [ ] Produce `P(Win)`, `P(Loss)`, `P(Void)`, and `P(Win | grades)`.
- [ ] Verify baseline and alternate offers use the same statistic distribution.
- [ ] Enable only after all acceptance gates pass.
- [ ] Begin prospective board archiving and grading.

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

- [ ] Reuse the validated terminal PA vector.
- [ ] Build the base-value distribution from the same categorical outcomes.
- [ ] Validate baseline and alternate tails.

### Hits + Runs + RBIs

- [ ] Verify Underdog baseline and alternate offers.
- [ ] Verify runner identity, advancement, lineup, base-out, score, and official-stat data sufficiency.
- [ ] Build a tagged-player base-out joint model.
- [ ] Prohibit independent marginal convolution.

### Pitcher Strikeouts

- [ ] Verify required pitcher state and pitch-count data.
- [ ] Build sequential joint workload-and-outcome state propagation.
- [ ] Model continuation and removal.
- [ ] Prohibit the independent batters-faced shortcut.

---

## Changelog

### Version 2.1 — 2026-07-29

- Closed the M8 bullpen-transition-scenarios item after the Version 1.5 proper-score nondominated-intersection rule selected `starter-bf-side-pool-1000`.
- Recorded the fixed nondominated set `{side-pool-500, side-pool-1000, league}`, the walk-forward nondominated set `{side-pool-1000}`, and the single-candidate stable intersection.
- Recorded 9 focused passing tests, the passing real-data shared-environment gate, the complete 329-of-329 verification gate, and passing GitHub Actions verify run 396.
- Preserved production-disabled status and the sealed untouched-test period; no real prop was enabled.

### Version 2.0 — 2026-07-29

- Recorded the completed M8 current-season fitting and validation evidence for recency weighting, single-pass pooling, batter effects, pitcher-allowed effects, platoon evaluation, coherent categorical probabilities, rare-outcome uncertainty, PA survival, reliability, scoring metrics, tail checks, and overdispersion checks.
- Recorded the projected-lineup equivalence rule and focused regression: projected-versus-confirmed status alone cannot alter model assumptions or opportunity distributions.
- Recorded the sealed untouched-test period and separated its reservation from the still-open final untouched-test evaluation.
- Closed the M8 merge gate as explicitly not yet production-validated while preserving fail-closed protection against real-prop ranking.
- Kept final runtime artifacts, eligibility, remaining context effects, and M9 production integration open.

### Version 1.9 — 2026-07-29

- Recorded benchmark artifact `a606b98c25d35ff5711b88eae089d6745003ad4c04a527cbb21418c7f4661b52` for `shared-environment-k4`, selected independently by the 189-game holdout and 14-fold expanding-window walk-forward evaluation.
- Recorded a 3.24611015062674% walk-forward relative joint-log-loss improvement versus the K=1 independence baseline, with all 189 validation games scored exactly once and no untouched-test rows accessed.
- Closed only the M8 shared offensive-environment-scenarios and opportunity/outcome-dependence-benchmark items. The scenario count remains nonpermanent, benchmark-only, and not production-enabled; runtime integration, tail checks, calibration, untouched testing, and production gates remain open.

### Version 1.8 — 2026-07-23

- Recorded complete M6 shared-game and hitter-opportunity infrastructure from merged commit `7b97a58`, including exact lineup-slot opportunity tails, joint starter/bullpen workload-path consistency, fail-closed rejection of every non-monotone raw survival curve, pre-adjusted-curve bypass protection, and exact-zero-only PMF tail trimming.
- Recorded that `src/game/` is the canonical shared boundary consumed through `src/game/index.ts`, with no real market enabled.
- Added the explicit M8 follow-up requiring evidence-backed monotonicity handling and prohibiting any production repair threshold without current-season evidence.
- The complete GitHub Actions verification gate passed on PR #9.

### Version 1.7 — 2026-07-23

- Recorded verified `MarketStatus`, `FeatureStatus`, and complete M5 registry, fail-closed, immutable-snapshot, and historical-independence protections from merged commit `3e18c86`; the full verification gate passed, production registries remain empty, and no real market was enabled.

### Version 1.6 — 2026-07-23

- Recorded the verified M3 probability and settlement contracts and complete M4 deterministic core from merged commit `9d80e51`, with all 44 tests passing.

### Version 1.5 — 2026-07-23

- Recorded the deterministic BALLDONTLIE terminal-PA mapping boundary.
- Recorded exact verified-label mappings and context-required compound mappings.
- Recorded separate caught-stealing handling and rejection of unknown, malformed, contradictory, or insufficient-context inputs.
- Recorded deterministic classification of all 607 promoted PA rows without an `OTHER_PA` fallback.
- Recorded the complete verification gate: typecheck, script checks, architecture, build, and 24 passing tests.
- Kept `OTHER_PA`, provider-wide collective exhaustiveness, remaining provider contracts, models, and real-prop ranking open.

### Version 1.4 — 2026-07-23

- Recorded the evidence-derived canonical terminal-PA and separate baserunning domain categories.
- Recorded runtime-validated raw BALLDONTLIE plate-appearance and play schemas that preserve unknown fields.
- Recorded the strict `NormalizedTerminalPA` boundary with explicit provider/game/player/PA identity and source snapshot SHA-256.
- Recorded direct verification across 607 PA rows, 3,497 play rows, typecheck, dependency architecture, build, and five focused tests.
- Kept provider-result mapping, unknown/context-insufficient normalization, mutual exclusivity, collective exhaustiveness, and the overall terminal-PA gate open.

### Version 1.3 — 2026-07-23

- Recorded terminal-PA fixture promotion in commit `5850fa0`.
- Recorded the focused checksum, sanitization, and compound-event evidence test in commit `40b0bb8`.
- Closed the plate-appearance and plays fixture-capture checklist items.
- Recorded fixture-backed capability for every observed canonical terminal category except `OTHER_PA`.
- Recorded `pa_number` as ordering metadata rather than a contiguous completed-PA count.
- Kept mutual exclusivity, collective exhaustiveness, production normalization, and all M2 exit gates open.
- Did not begin provider-derived contracts.

### Version 1.2 — 2026-07-23

- Added the dedicated Batter Hits provider capability matrix.
- Recorded preserved Underdog baseline and alternate fixtures, market keys, selected-side fields, lines, multipliers, and null source IDs.
- Recorded preserved BALLDONTLIE game and lineup fixtures.
- Recorded one observed cross-provider game join and the 17-of-18 player-linkage result with James Jarvis failing closed.
- Kept complete pregame status semantics, PA/plays fixture promotion, terminal-category closure, and every M2 exit gate open.
- Did not begin provider-derived contracts.

### Version 1.1 — 2026-07-23

- Recorded direct CI evidence for the synthetic disabled-market and historical-independence protections and closed the M0 exit gate.
- Recorded successful secret-safe access to both approved providers.
- Recorded the preserved sanitized The Odds API MLB events fixture and BALLDONTLIE player fixture.
- Left Underdog market access, game/status data, lineups, plate appearances, plays, and current-season statistics open until their real capability captures are inspected.

### Version 1.0 — 2026-07-23

- Created the V3 evidence-driven master checklist.
- Added the modular foundation before market implementation.
- Added provider evidence and terminal-PA capability gates before provider-derived contracts.
- Preserved the verified core-math and first Batter Hits vertical-slice sequence.
- Promoted current-season fitting and validation into a major dedicated phase.
- Preserved H+R+RBI and Pitcher Strikeouts as planned future markets with their required joint model families.
- Recorded the directly verified strict TypeScript, architecture, test, build, and CI foundation progress.
