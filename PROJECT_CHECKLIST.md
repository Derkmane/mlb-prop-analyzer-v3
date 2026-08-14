# MLB Prop Analyzer V3 — Master Project Checklist

**Version:** 4.4
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
- [x] Add a synthetic historical-record rendering test that does not import active feature code.

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
- [x] Settlement registry with versions and verified temporal applicability per `CANONICAL_MATH_SPEC.md` §12.1.
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

- [x] Park neutralization and application — explicitly not modeled in this M8 version; frozen manifest records `modeled: false`, reason `deferred, not fitted in M8`, and identity adjustment.
- [x] Defense-to-batted-ball translation — explicitly not modeled in this M8 version; frozen manifest records `modeled: false`, reason `deferred, not fitted in M8`, and identity adjustment.
- [x] Times-through-order effects — explicitly not modeled in this M8 version; frozen manifest records `modeled: false`, reason `deferred, not fitted in M8`, and identity adjustment.
- [x] Bullpen transition scenarios — selected `starter-bf-side-pool-1000` from the intersection of the fixed-validation and expanding walk-forward proper-score nondominated sets under `CANONICAL_MATH_SPEC.md` Version 1.5; 9 focused tests, the real-data shared-environment gate, the complete verification gate, and GitHub Actions verify run 396 passed while production remained disabled and untouched-test rows remained sealed.
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

## M8 Bridge — Frozen base-distribution handoff

This section amends the runtime and evidence boundary around frozen M8. It does not reopen, refit, or mutate the frozen M8 candidate. The exact frozen M8 statistic distribution is the versioned `D_base` predecessor consumed by M8.5.

- [x] Preserve frozen M8 runtime artifacts, selected component hashes, model version, distribution-builder version, settlement version, production-disabled state, and sealed untouched-test boundary unchanged.
- [x] Land direct projected-or-confirmed runtime acceptance through the real M9 path; identical baseball inputs must produce identical distributions and probabilities with only lineup-status metadata differing.
- [x] Define `M8BatterHitsBaseEvaluationV1` as the immutable public base-evaluation envelope.
- [x] Preserve exact player, game, market, posted side, posted line, lineup, opposing starter, shared `GameScenarioSet`, provider snapshots, and evaluation timestamp.
- [x] Preserve `D_base`, base `P(Win)`, base `P(Loss)`, base `P(Void)`, and `p_base(d,L)=P_base(Win | grades; d,L)` from exact core settlement.
- [x] Build `D_base` once per identical player, game, settlement statistic, baseball input set, and model version; baseline and alternate offers settle that same distribution without rebuilding it.
- [x] Preserve a deterministic shared-scenario identity or hash so M8.5 proves it consumed the same game assumptions.
- [x] Add audit-only side-aware soft-line evidence for every supported exact posted Higher or Lower offer.
- [x] Keep `tau_soft`, softness margin, and every hard discovery exclusion disabled until M8.5 final probabilities exist and chronological current-season recall validation passes.
- [x] Prove the bridge leaves the existing frozen M8 distribution and probabilities byte-for-byte unchanged for identical inputs.
- [x] Prove Higher/Lower symmetry, integer-line tie/void handling, baseline/altline distribution reuse, deterministic reruns, and tamper rejection through the bridge.
- [x] Keep production ranking and category access disabled; completing the bridge does not authorize a real ranked pick.

### M8 Bridge exit gate

- [x] Frozen M8 remains immutable and independently verifiable as `D_base`.
- [x] Every base evaluation carries complete version and source lineage.
- [x] Every supported posted side and line can receive exact `p_base` without a runtime-invented threshold.
- [x] No discovery label, price, multiplier, fair-line distance, or base probability can bypass M8.5 or alter final rank.
- [x] Focused bridge tests and the complete repository verification gate pass.


M8 Bridge completion evidence — `M8BatterHitsBaseEvaluationV1` and the reusable `m8-batter-hits-base-distribution-v1` contract preserve the frozen M8 distribution as immutable `D_base`, settle every exact surviving offer through core settlement, retain complete player/game/lineup/starter/provider/model/artifact lineage, hash the base distribution and shared scenario identity, and keep discovery audit-only with no runtime `tau_soft` or hard exclusion. Focused regressions proved exact parity with the existing frozen M8 output, one-object baseline/altline reuse, Higher/Lower symmetry, integer-line voids, projected/confirmed invariance, deterministic reruns, and tamper rejection. GitHub Actions verify run 492 passed 350 of 350 tests with typecheck, script checks, architecture, build, selected-side, and protective-architecture gates clean. Production ranking remained disabled and untouched-test evidence remained sealed.

---

## M8.5 — Context-adjusted Batter Hits successor

M8.5 is a new current-season model version that consumes the immutable M8 base evaluation and produces a separately versioned context-adjusted `D_final`. It may not silently edit the frozen M8 artifacts or use the original M8 untouched cohort for factor selection or tuning.

### Versioned factor contract

- [x] Replace the scalar-only factor-extension proposal with a typed artifact contract that supports `identity`, `terminal-outcome-vector`, `scenario-mixture`, `opportunity-survival`, `workload-transition`, `park-transformation`, and `batted-ball-translation` effect types.
- [x] Require every factor artifact to preserve factor key, status, model version, artifact SHA-256, validation status, active season, application stage, selected-side-input prohibition, direct-probability-effect prohibition, required inputs, source-evidence version, and untouched-test reservation.
- [x] Require unknown, missing, unvalidated, wrong-season, side-dependent, hash-drifted, unsupported, or malformed factor artifacts to fail closed; disabled factors remain one explicit versioned identity effect rather than a silent fallback.
- [x] Prohibit every factor from directly adding or subtracting probability points or reading the selected Higher/Lower side.

Typed factor-contract completion evidence — `M8_5BatterHitsFactorArtifactV1` replaces PR #24's universal scalar coefficient with seven discriminated effect kinds operating only in baseball units. Terminal-outcome vectors require every canonical terminal PA category and conserved probability; scenario mixtures and workload transitions conserve row mass; opportunity-survival effects are monotone; park transformations are handedness- and outcome-specific; batted-ball translation is restricted to approved balls-in-play categories and cannot move K, UBB, IBB, HBP, HR, catcher interference, or `OTHER_PA`. Every artifact is production-disabled, active-season-only, versioned, SHA-256 verified, explicit about required inputs and application stages, forbids selected-side and direct-probability inputs, preserves the untouched-test seal, defaults to an explicit identity effect, and fails closed on unknown keys, missing evidence, wrong season, malformed structures, silent scalar coefficients, or hash drift. Six focused contract tests and GitHub Actions verify run 503 passed 356 of 356 tests with typecheck, script checks, architecture, build, selected-side, and protective-architecture gates clean. No fitted factor, `D_final`, settlement, ranking, or production behavior was added.

### Context factors and order

- [x] Team-specific bullpen outcome model — replace the generic league bullpen outcome assumptions while preserving the validated starter-to-bullpen workload transition and avoiding double counting.

Team-specific bullpen completion evidence — Real active-season fixed-holdout and expanding daily walk-forward evaluation selected `team-hand-pool-2500` over the frozen generic bullpen terminal-outcome baseline. The evaluation used 34,718 fit bullpen PA and 5,773 later-validation bullpen PA across all 30 pitching teams and produced 60 typed team-and-hand terminal-outcome vectors. Fixed-validation categorical log loss improved from `1.6923687794008386` to `1.692003088213786`; walk-forward categorical log loss improved from `1.6923687794008506` to `1.691816818192014`. Evaluation identity SHA-256 is `3056b9fd5b8258cdc222d1cd2e5b9fb02183f0a9d72b5625776f367132538a31`; committed factor artifact SHA-256 is `156dd99ea37aea2272fcd300b8512ad9dc27905c458b6033eeb330759f74cd9d`; committed factor file byte SHA-256 is `5eedb8c4c6485b2d90e86b7d2070e5f07cd54eeb8b7cc412323346e3e896a1f5`; preserved starter/bullpen-transition SHA-256 is `1db3b58868096ea2e19a2e2e9559a709275869db1618af69fd8143d9aae302c3`; and team-identity projection SHA-256 is `c42a6894fc43f1e119078392936431f137297ad792eef239ef71a802d27cd86e`. A byte-for-byte rerun reproduced the exact evaluation and factor files. The committed artifact-lock regression and GitHub Actions verify runs 536 and 537 passed 371 of 371 tests with typecheck, script checks, architecture, build, selected-side, and protective-architecture gates clean. Excluded-game offensive statistics were not used; the frozen workload transition was unchanged; selected-side input and direct probability adjustment remained prohibited; production and ranking remained disabled; and untouched-test rows remained sealed.

- [x] Game-specific offensive-environment model — preserve one shared game scenario set and jointly affect approved opportunity and outcome assumptions.

Game-specific offensive-environment completion evidence — Real active-season fixed-holdout and expanding daily walk-forward evaluation selected `opponent-only-l2-0.01` over the frozen global shared-scenario mixture. The strictly chronological pregame feature path used only earlier-date current-season opponent plate-appearance and hit-rate-allowed evidence, excluded same-date and same-game outcome leakage, and rejected incomplete feature histories. The evaluation retained 1,107 fit games and 189 later-validation games with 15 feature exclusions. Fixed-validation joint log loss improved from `10.32538847048714` to `10.318972105284502`; walk-forward joint log loss improved from `10.325388470487145` to `10.319085221244196`. Evaluation identity SHA-256 is `81c853f8545e4a40afa865a4cb648817fd53780c5e6a5222033a65d65cdebef4`; feature-dataset identity SHA-256 is `8090f344de26b2b57f56086645c01a7d7486137a1316a4a826265170c35ce23a`; committed model artifact SHA-256 is `6530a40baeed55d6c20ac9a45cb511974853137bac88b731d621bfd9d7ab4bce`; and committed model file byte SHA-256 is `b149943ae56f586f312b703def10ce6203cfa63bdf11909762edd50f653b534b`. A byte-for-byte rerun reproduced every metric and identity. The committed artifact-lock regression and GitHub Actions verify run 548 passed 386 of 386 tests with typecheck, script checks, architecture, build, selected-side, and protective-architecture gates clean. Shared scenario definitions were unchanged; one game-specific mixture jointly moves approved opportunity and outcome assumptions; selected-side input and direct probability adjustment remained prohibited; excluded offensive statistics were not used; production and ranking remained disabled; and untouched-test rows remained sealed.

- [x] Park model — canonical fixed-validation and expanding walk-forward categorical proper-score nondominated-set intersection selected `venue-hand-pool-2500`; exact provider venue identity and current-season-only validation preserved.

Park model completion evidence — Venue evidence verified 1,346 of 1,346 games across 32 exact provider venues, 30 home teams, and 2 multi-venue home teams with no alias merging and no home-team venue inference; venue audit SHA-256 is `69aab27d1aa798e197b38e4a8a1a6538965265e5833d944acb115df34c165338`. The evaluation cohort retained 26,759 fit plate appearances and 14,265 validation plate appearances with 0 missing-handedness exclusions. Fixed-validation categorical log loss improved from `1.6620430674352507` to `1.6616058208441955`; walk-forward categorical log loss improved from `1.6620430674352604` to `1.66157008198203`. Hit metrics remained diagnostic only and did not select the candidate. Evaluation dataset SHA-256 is `074af50e2a881e7ab8df47480bc67e68c15ce03987bf153a587c86bb249712bb`; canonical evaluation SHA-256 is `d715419f9bcbb118540f11f7431729f56ab85b12cc3ab7311216417006b690b9`; typed factor artifact SHA-256 is `c70550bd4798bd5ad6de7263801a7794b2c4eba8d2c86957d0992e3591aee985`; park wrapper artifact SHA-256 is `f1bd0d83997dd1efede69fa3ab69162938dd5df7d65732d44ec1f9689eaf85f9`; committed artifact file byte SHA-256 is `efc8f4b91eb00d5a961ace09dda951a08a008011791be6e43160d6fef64015ae`. The tracked artifact is `model-artifacts/m8-5-park-transformation-v1.json` with 96 effects across 32 venues and L/R/S batter hands. Frozen M8 was unchanged; selected-side input and direct probability adjustment remained prohibited; prior-season rows were not used; production and ranking remained disabled; and untouched-test rows remained sealed.

Park is a validated factor that is explicitly not applied at runtime; the measured effect is approximately `0.0004` nats, no runtime park resolution is wired into `D_final`, and the frozen artifact is preserved as fitting evidence only.

- [x] Times-through-order model — current-season evaluation closed as an explicit identity/no-op limited to starter repeated exposure while preserving the separate starter-to-bullpen transition.

Times-through-order completion evidence — The explicit identity artifact is `model-artifacts/m8-5-times-through-order-identity-v1.json`, SHA-256 `78352afd7c5bfe2ce1383aa7276e9b942826ec02271726a0a2065807c467c352`. First exposure remains identity, no repeated-starter-exposure adjustment is applied to `D_final`, and the separately validated starter-to-bullpen transition remains unchanged. Selected-side input and direct probability adjustment remain prohibited; production and ranking remain disabled; and the untouched cohort remains sealed.

- [x] Defense data-sufficiency decision — approved current-season team-level evidence supports defending-team attribution and strict BIP-only isolation, but the effect-size pre-screen does not justify fitting or runtime application; Defense is closed as an explicit versioned identity/no-op.

Defense completion evidence — Approved BALLDONTLIE evidence attributes each plate appearance to the defending team through exact game `home_team`/`away_team` identity plus `halfInning`, restricts the eligible translation scope to `1B`, `2B`, `3B`, `ROE`, `FC`, `SF`, `SH`, and `BIP_OUT`, preserves `K`, `UBB`, `IBB`, `HBP`, `HR`, and `CATCHER_INTERFERENCE` unchanged, and supports strictly-earlier-date chronology without same-date or same-game leakage. Individual fielder identity and position are unavailable, so only team-level Defense was assessed. The canonical 2026-03-26 through 2026-06-21 fit period used resolved dataset SHA-256 `a40eca0b15e5d69c7c718e807c2ced7b007650f0628dd7761c87f9f56f1d3b59` and team offensive-environment dataset SHA-256 `eb627faefd24b9862965151c45fd7ccce588d36fe9acb7ddb6f4a04e14a3dc8a`; 30 defending teams, 1,122 mapped games, 54,919 included BIP rows, 1,687 unmapped rows (3.1%), and per-team BIP counts of minimum 1,490 and median 1,847 were retained. `BIP_REACH` had pooled rate `0.29596`, observed max-minus-min spread `0.06084`, and spread-to-noise ratio `2.022`. Accounting for the expected range across 30 groups implies approximately one percentage point of true between-team variation and an optimistic unconditional categorical log-loss ceiling near `0.00026` nats before existing per-pitcher allowed effects absorb shared team-defense signal. No Defense candidate family or grid was fit. The committed identity artifact is `model-artifacts/m8-5-defense-to-batted-ball-identity-v1.json`, artifact SHA-256 `85d163f127791bf04ba786b7c1661f7f88515a7a724debd22a6892855133712f`; it is production-disabled, selected-side independent, direct-probability-effect prohibited, BIP-scoped, and keeps untouched-test rows excluded. The focused artifact-lock regression and GitHub Actions verify run 647 passed 454 of 454 tests with typecheck, script checks, architecture, build, selected-side, and protective-architecture gates clean. Production and ranking remain disabled, and no M8.5 freeze, untouched-test access, exit-gate closure, or M9 work began.

### Final distribution and validation

- [x] Define `M8_5FinalEvaluationV1` with source M8 evaluation hash, `D_base` hash, `D_final`, final probabilities, context model version, factor versions, factor artifact hashes, shared-scenario identity, and settlement version.
- [x] Apply each runtime-approved context factor through shared scenarios or the statistic distribution before exact settlement; game-specific offensive environment and team-specific bullpen are applied, times-through-order is explicit identity, and park is explicitly not applied.
- [x] Settle `D_final` against the exact posted side and line to produce `p_final(d,L)`.
- [x] Preserve `contextProbabilityDelta(d,L)=p_final(d,L)-p_base(d,L)` as diagnostic evidence only.
- [x] Use one identical `D_final` for baseline and alternate offers sharing the same player, game, statistic, baseball inputs, and model versions.
- [x] Fit and validate each candidate using active-season-only chronological evidence, untouched later validation, and walk-forward evaluation where required.
- [x] Reserve a new untouched current-season cohort for the frozen M8.5 candidate; do not use the original M8 untouched rows to select, tune, or retry M8.5.
- [ ] Validate any proposed `tau_soft` or other hard discovery predicate only after `p_final` exists, using an approved recall standard for the strongest final-probability candidates — no hard predicate was proposed or recall-validated in M8.5, so this item intentionally remains open and hard discovery filtering remains disabled.
- [x] Prove upward shifts help Higher and hurt Lower, downward shifts help Lower and hurt Higher, and no factor can create a side-independent booster.
- [x] Freeze a new versioned M8.5 successor only after all factor, calibration, tail, deterministic-output, provenance, and untouched-test gates pass.
- [x] Keep M8.5 production-disabled until explicit approval and every downstream M9/M10 gate passes.

`M8_5FinalEvaluationV1` preserves immutable `D_base` and `D_final` lineage, exact final `P(Win)`, `P(Loss)`, `P(Void)`, and `P(Win | grades)`, context-model and settlement versions, factor versions and artifact identities, shared-scenario identity, and diagnostic-only `contextProbabilityDelta`. The canonical frozen successor applies game-specific offensive environment and team-specific bullpen, records times-through-order as explicit identity, records Defense as explicit identity, and records park as validated but not applied because its approximately `0.0004`-nat effect does not justify a unique runtime venue dependency. Focused regressions proved no-applied-factor equality with `D_base`, bullpen movement with mass conservation to `1e-12`, identical `D_final` reuse for baseline and alternate offers, Higher/Lower directional monotonicity, diagnostic delta exclusion from ranking order, and fail-closed artifact-hash drift.

Frozen-successor and untouched-acceptance completion evidence — Successor model `m8-5-batter-hits-successor-freeze-v1` is frozen at artifact SHA-256 `a296c384397315832b39d322a7d061ca73e542d94a886087f743f0774199cd17`. The separately reserved untouched cohort spans `2026-07-26` through `2026-07-29`: 4 dates, 54 final games, 4,159 source plate appearances, and 900 scored hitter-game observations. Cohort identity SHA-256 is `d82c8e62cdad9023793898c1f0e9ed5baaee650fad650cc13620b7b0800b3d17`; reservation-artifact SHA-256 is `34558a6b0fffa592de882132b093f3496f14c250b987b3d91eaedc9a254e22cb`; immutable acceptance-artifact internal SHA-256 is `9c7ba5ae6b7b77334e2e5c444b680261fa8e0e82ef9ce621091c30f64ec3f321`; and committed acceptance file-byte SHA-256 is `38603400cf77cb5f0ade13077fb8215e59ac7ad7b1d2fb8b13adf18491cb0497`. Evaluation run count is exactly `1` and the cohort seal remained intact.

On identical observations, `D_final` categorical log loss was `1.1963378032` versus `1.1969075917` for `D_base`, delta `-0.0005697884`; `D_final` categorical Brier was `0.6558780914` versus `0.6561814842` for `D_base`, delta `-0.0003033928`. `D_final` was no worse on both primary proper scores and strictly better on both, so it passed the frozen acceptance rule. Higher 2.5 Brier was microscopically worse for `D_final` (`0.0457482521126077` versus `0.04574081190097689`), but it was labeled diagnostic only and could not alter the decision. The untouched log-loss delta is slightly larger than the approximately `0.0004`-nat combined fitted improvement; with only 900 observations this difference is within noise and is not evidence that the factors performed better than expected.

Exclusions were preserved rather than repaired: 4 simultaneous multi-slot phase shifts, 4 unknown terminal results, 4 incomplete history-update games, and 8 excluded team sides. Factor dispositions are game-specific offensive environment `APPLIED`, team-specific bullpen `APPLIED`, times-through-order `IDENTITY`, Defense `IDENTITY`, and park `VALIDATED NOT APPLIED`. GitHub Actions verify run 674 passed 476 of 476 tests; dependency-cruiser inspected 260 modules and 782 dependencies with zero violations, and typecheck, script checks, build, selected-side, and protective-architecture gates passed. Production, ranking, hard discovery filtering, and retuning remain disabled.

This four-date, 900-observation result is an acceptance check under the frozen rule. It is not decisive evidence of predictive value and must not be described as proof that the context layer materially improves predictions.

### M8.5 exit gate

- [x] `D_base` and `D_final` are distinct, immutable, versioned, and fully traceable.
- [x] Final category ordering can consume only `p_final`, then `P(Void)`.
- [x] Hard soft-line filtering remains disabled unless approved recall validation passes.
- [x] Focused factor and final-distribution tests plus the complete repository verification gate pass.
- [x] A new untouched-test acceptance decision is preserved immutably.

M8.5 is closed. This closure authorizes the next M9 ranking milestone only; it does not enable production, ranking, hard discovery filtering, `tau_soft`, retuning, or any category output by itself.

---

## M9 — Real Batter Hits ranking

- [x] Connect real frozen model artifacts — exact `m8-batter-hits-runtime-freeze-v1` artifact connected through the feature, adapter, and composition public boundaries with SHA-256 `e5a660ffc0aefc093dc80aae0169109bd7717605098d790b3257a83fad5bf3de`; build and 2 focused tests passed, GitHub Actions verify run 402 passed 334 of 334 tests, production ranking remains disabled, and untouched-test rows remain sealed.
- [x] Connect real normalized current board offers — committed fixture-backed The Odds API contracts and normalization preserve exact event, Underdog bookmaker, baseline/alternate market, uniquely linked BALLDONTLIE player, Higher/Lower side, posted line, price, multiplier, market timestamp, and source snapshot identity; 34 offers normalized, both unresolved James Jarvis offers failed closed, 3 focused tests passed, and GitHub Actions verify run 405 passed 337 of 337 tests while probability generation and production ranking remained disabled.
- [x] Exclude started games — fixture-backed BALLDONTLIE game-state normalization and the shared pregame eligibility gate require the matched current-season regular-season game to remain `STATUS_SCHEDULED` and require the evaluation time to be strictly before both preserved provider start timestamps; final, unknown, missing, duplicate, or start-time-reached states fail closed. Four focused tests passed and GitHub Actions verify run 408 passed 341 of 341 tests while side and line remained unchanged and production ranking remained disabled.
- [x] Preserve exact selected side and line — exhaustive fixture-backed regression matched all 34 uniquely linked baseline and alternate offers through both normalized and pregame composition boundaries; raw `Over` remained `Over` and mapped only to `higher`, raw `Under` remained `Under` and mapped only to `lower`, and every numeric provider point survived exactly as the posted line. Final-game exclusion retained the same immutable offer identities. Two focused tests passed and GitHub Actions verify run 413 passed 343 of 343 tests while production ranking remained disabled.
- [x] Produce `P(Win)`, `P(Loss)`, `P(Void)`, and `P(Win | grades)` — the exact frozen complete Batter Hits candidate, SHA-256 `728895ca850c5481cd1f17944e38464f16396becc3622146a1384bba19ce5cde`, now builds deterministic scenario-conditioned nested opportunity-count and exact Poisson-binomial Batter Hits distributions and settles exact Higher/Lower sides and posted lines through the generic core settlement path. Baseline and alternate examples conserve probability mass, mismatched runtime identity and production authorization fail closed, 3 focused tests passed, and GitHub Actions verify run 417 passed 346 of 346 tests while production ranking remained disabled and untouched-test rows remained sealed.
- [x] Verify baseline and alternate offers use the same statistic distribution — the committed board contains verified baseline and alternate Batter Hits offers but no same-player pair, so one explicit test-only invariant held normalized player, game, team, lineup, opposing starter, shared scenarios, and frozen model artifacts fixed while substituting only provider-observed alternate offer attributes. The complete runtime distribution and candidate statistic distribution remained exactly identical; selected side, posted line, price, multiplier, and settlement probabilities were allowed to differ. One focused test passed and GitHub Actions verify run 420 passed 347 of 347 tests while production ranking remained disabled and untouched-test rows remained sealed.
- [ ] Enable only after all acceptance gates pass.
- [ ] Implement prospective board archiving and grading — the prior implementation remains isolated in blocked PR #21 and is intentionally absent from this clean M8 amendment branch. Do not mark M9 archive/grading complete or merge its claimed live evidence until the exact July 31 runtime files are recovered and verified unchanged, or the implementation is separately re-established under an approved evidence plan.
- [ ] Recover and verify the July 31 live archive evidence — the runtime reported 30 rows at `artifacts/board-archives/batter-hits/2026-07-31.json` with claimed SHA-256 `ae8803b5625662e483f1b6f52e715f55a671a3c9d777ae7ec1aa65fda1bedc8c`, and a grading file at `artifacts/board-archives/batter-hits/grades/2026-07-31.json` with claimed SHA-256 `998b8158e2156756c4efec5aec21ebac049232657ae171dd49066fb51e4628d6`. The archive path built confirmed-only runtime observations, so no projected lineup row was coerced. Recover the exact original runtime files unchanged, verify both hashes, and preserve an approved immutable evidence receipt; do not regenerate, rewrite, or relabel the July 31 records.

---

## M10 — Categories, saved runs, grading, and presentation

- [x] Opportunity Miner eligibility — implemented in commit `c00c4f98b84890093ef35678c82f8a8120a6cc4c`; verified at commit `d8681e71819607bccc756eb9dac8be3c8c8e3d64` by GitHub Actions run 747.
- [x] High Probability Baseline eligibility — commit `5625df541b2b94bdb603318156abe5830fd80c62`; GitHub Actions run 749.
- [x] High Probability Altline eligibility — commit `bc7cc1485b9e52b6e3a51383cdaeeef111d20c93`; GitHub Actions run 750.
- [x] One prop per player per category — commits `c00c4f98b84890093ef35678c82f8a8120a6cc4c`, `5625df541b2b94bdb603318156abe5830fd80c62`, and `bc7cc1485b9e52b6e3a51383cdaeeef111d20c93`; verified by runs 747, 749, 750, and real-archive run 759 at commit `9b55267b23ab9632cf0522530afb0c3f913ed497`.
- [x] Category overlap allowed — commit `b1b038c5264125c9e22a5719e377c2be7b67402a`; verified by runs 751 and 759 at commit `9b55267b23ab9632cf0522530afb0c3f913ed497`.
- [x] Sort only by final `p_final=P(Win | grades)`, then `P(Void)`; base probability, softness margin, context delta, price, multiplier, and discovery labels cannot alter order — commits `d8681e71819607bccc756eb9dac8be3c8c8e3d64`, `5625df541b2b94bdb603318156abe5830fd80c62`, and `bc7cc1485b9e52b6e3a51383cdaeeef111d20c93`; verified by runs 747, 749, 750, and 759.
- [x] Top Five selection — commit `b1b038c5264125c9e22a5719e377c2be7b67402a`; verified by run 751 and real-archive run 759 at commit `9b55267b23ab9632cf0522530afb0c3f913ed497`.
- [x] Complete immutable saved-run storage — commits `1c46ce7a884b27e2c9a83e7f4642aef141701b72` and `764a48bc97553e9d5148bc8ce3cb2188626ab9c6`; GitHub Actions run 761 passed 560 of 560 tests.
- [x] Atomic persistence — commits `1c46ce7a884b27e2c9a83e7f4642aef141701b72` and `764a48bc97553e9d5148bc8ce3cb2188626ab9c6`; run 761 verified exact bytes, overwrite refusal, directory and file synchronization, and zero surviving temporary files.
- [x] Historical-only rendering — commit `08df180bfd05dc45d81365cc36948a191611ecc3`; GitHub Actions run 762 passed 562 of 562 tests with zero active-feature imports.
- [x] Versioned grading — final corrective commit `ecf02030ad0108fd53e3772de119abdd5114d77a`; GitHub Actions run 765 passed 567 of 567 tests. Real evidence: exact capture `20260805T160217812Z--235bac8c330999cccfe86b6037a1007eb06f8ec23d1aacdbc3131a70d18db353` was graded in GitHub Actions run `31041810622`, attempt 2, only after games `5059484`, `5059485`, and `5059486` all returned exact `STATUS_FINAL`. The immutable report graded 78 rows as 39 wins, 39 losses, and 0 voids; observed win rate and mean archived `P(Win | grades)` were both 0.5; archive modification was false; grade report SHA-256 was `c0e0d851992fe9d5b10b236fa45d4b17d594930d95f2756478bf9e04cb4454d4`.
- [x] Daily scheduled prospective board capture is configured at `21:15 UTC` with immutable ledger caching, a 330-minute timeout, and `if: always()` artifact upload — implementation commit `aac2935f1856823ec8169a71e43b026d2c95ca4c`; GitHub Actions run 774 passed 580/580.
- [x] Daily scheduled final-only grading is configured at `09:00 UTC`; non-final archives are skipped with immutable status evidence, final archives use exact game/player Hits joins and core settlement, and reports/logs upload under `if: always()` with a 180-minute timeout — implementation commit `aac2935f1856823ec8169a71e43b026d2c95ca4c`; GitHub Actions run 774 passed 580/580.
- [x] API entrypoints — merged PR #61, merge commit `5f632ced9d3b822abb2abb0d709c938101a54d8b`; `GET /api/hhr-display-board` returns the persisted read-only HHR display board with `Cache-Control: no-store`, unsupported paths/methods fail without archive reads, and archive failure fails closed. PR verify run `31519917988` passed, and post-deployment main verify run `31539088716` reverified the API path.
- [x] UI display with no probability logic in the UI — merged PR #62, merge commit `fc4ac40c89b4af165ace490dd467aed5ae640a00`; responsive password-gated display preserves delivered ranking order, renders `P(Win)`, `P(Loss)`, `P(Void)`, and `P(Win | grades)`, and keeps settlement/probability logic server-side. PR verify run `31522109244` passed, and main verify run `31539088716` reverified authentication, rendering, API preservation, and logout behavior.
- [x] Deployment and public-link verification — Replit app `Player Analytics` is published through Autoscale/cloudrun at `https://player-analytics--derkmane.replit.app`. Deployment-target fix PR #64 merged as commit `7848074387eb7bc5c6fa899fe730f1cc2d5d3b52`; post-merge main verify run `31539088716` passed 678 of 678 tests with zero architecture violations, and Replit reported deployment status `success` for deployment `5ff04892-19b2-4b83-846b-aff76a2b1790`.

---

## Active project workstreams — 2026-08-12

### Workstream 1 — Capture coverage — highest priority after this PR

Suspected defect: the board archiver may run at a single fixed time, so games that started earlier are already off the board when capture runs. That loses whole games, and loses them non-randomly — day games differ systematically from night games in lineups, rest, and getaway-day usage. No distribution fix helps with props that were never captured.

Proposed remedy if confirmed: **multiple captures per day**, timed to the actual schedule, so each game is captured while its props are still live. Projected lineups continue to run at full weight per locked rules; `lineupStatus` remains display-only.

Open question to resolve before adding captures: cumulative dedup retains the newest capture per prop identity. That behavior has only ever been exercised across days. Confirm it handles multiple same-day captures correctly.

### Workstream 2 — Model fix — in progress

- [x] v1.10 — zero-inflated and hurdle approved as Family B forms; §17.46 fit-time distribution-shape gate canonical.
- [x] §17.46 diagnostic implemented; frozen v2 fails all three checks (alpha range 0.4253, worst-bin zero gap 0.0553, tail gaps at all thresholds), runner exits 1.
- [x] v1.11 — §14.2 per-line calibration gate. Recorded evidence: 0.5 FAIL Z=-2.218 / 1.5 PASS Z=+0.145 / 2.5+ FAIL n=11 Z=-2.825.
- [ ] Step 5 — declare the reserved untouched test period in writing before freezing any candidate.
- [ ] Step 6 — fit zero-inflated and hurdle candidates, evaluate both against the §17.46 per-bin gate. In-sample; needs no new games.
- [ ] Step 7 — freeze selected candidate, then evaluate the reserved period once.

### Workstream 3 — Front end — parallel, not blocked by model work

The UI reads committed archives. It does not depend on model validation or capture coverage. Continue independently.

- [ ] Phase 5 — refresh button. Read-only, no request-time model or ranking compute.
- [ ] Surface capture coverage in the UI once Workstream 1 reports.
- [ ] Item J — the trimmed display artifact lacks per-pick `p_i`, so §14.2 cannot be computed from it. When §14.2 is implemented, either extend the evidence path or have the display copy carry precomputed E, V, Z per cohort.

### Existing queue — unchanged

- A. Batter Hits 884 nonstarter — needs its own settlement rule.
- B. Batter Hits one-sided prop `f21b2664.../123/0.5`.
- C. Multi-market persist no-output no-op.
- D. Rate limiter 13000ms vs ~112ms adaptive.
- F. Checklist V1 category section contradicts `PROJECT_RULES.md`.
- G. HHR Opportunity Miner not wired for HHR.
- H. HHR Baseline Props gap — expected, alternate lines only.

---

## Future planned markets

These are intended investigations, not abandoned markets. No empty feature folders are created before implementation begins.

### Hits + Runs + RBIs — V1 PRIMARY MARKET (M11)

Model family: Family B, directly fitted composite
(CANONICAL_MATH_SPEC.md §8.3.2). The tagged-player base-out
requirement is SUPERSEDED as of Version 1.8 by owner
decision. Do not raise it as a conflict.

Settlement contract status:

- [x] Register `underdog-batter-hhr-settlement-v1` with verified temporal applicability — `CANONICAL_MATH_SPEC.md` advanced from Version 1.8 to Version 1.9 so §12.1 now requires exactly one self-describing temporal form: operator-designated `effectiveDate` under §12.1(a), or verified `sourcePublishedAt` publication boundary under §12.1(b). Underdog does not publish operator-designated effective dates; all Underdog settlement rules register under §12.1(b) publication boundary. The HHR rule is registered with `sourcePublishedAt: '2026-06-22'`; `SettlementRuleRegistration` enforces exactly one temporal field. PR #70 merged as `e5bb8b5df08877152786aabace3d2b1efe28f601`; post-merge main verify run `31554833774` passed 684/684.
- [ ] Wire the registered HHR settlement rule into final grading — **NOT IMPLEMENTED**. Current HHR grading does not consume the settlement registry and still throws when an archived player lacks an official HHR stats row. Do not mark HHR nonstarter void handling complete until official post-game starting-lineup evidence is verified and the Case A/Case B grading path is implemented.

HHR and Batter Hits remain production-disabled and ranking-disabled. Settlement-contract registration does not authorize either market.

- [x] Verify Underdog baseline and alternate offers — preserved sanitized The Odds API fixture `fixtures/sanitized/m11/hhr/respecified-v2/the-odds-api-underdog-hhr-board-v2.json` verifies exact Underdog `us_dfs` baseline `batter_hits_runs_rbis` and alternate `batter_hits_runs_rbis_alternate` markets with observed Over/Under sides and posted lines. `normalizeUnderdogBatterHhrCapture` preserves exact side, line, and offer type and rejects unsupported market-key sets. Immutable evidence commit `5278d63f123207772a76f25c482c5cecbb919331`; main verify run `31540589584` passed 678/678 including the baseline/alternate line-preservation and shared-distribution regression.
- [ ] Verify approved-source data sufficiency for the
      declared Family B conditioning inputs.
- [ ] Build the directly fitted composite distribution over
      T = H+R+RBI.
- [ ] Prohibit independent marginal convolution. PRESERVED
      AND UNCHANGED.
- [ ] Settle every alternate line independently off the
      same fitted distribution.
- [ ] Report per-line calibration with 2.5+ bucketed
      separately.
- [ ] Fail closed on calibration failure with no fallback.

### Batter Runs — V1 MARKET (M11)

Model family: Family B, directly fitted composite.
Designated cut if M11 drags.

- [ ] Verify Underdog baseline and alternate offers.
- [ ] Build the directly fitted composite distribution
      over R.
- [ ] Report cross-market coherence against HHR within the
      declared tolerance.
- [ ] Report per-line calibration.
- [ ] Fail closed on calibration failure.

### POST-V1

#### Batter Total Bases

- [ ] Reuse the validated terminal PA vector.
- [ ] Build the base-value distribution from the same categorical outcomes.
- [ ] Validate baseline and alternate tails.

#### Pitcher Strikeouts

- [ ] Verify required pitcher state and pitch-count data.
- [ ] Build sequential joint workload-and-outcome state propagation.
- [ ] Model continuation and removal.
- [ ] Prohibit the independent batters-faced shortcut.

---

=== V1 MARKET AND CATEGORY SCOPE (LOCKED) ===

Origin: user requirement, restated 2026-08-05. HHR is the
primary market of this application and the user's most-used
prop (~90%). It was deferred in the v0.1 scope lock without
being weighed against actual usage. That was a
prioritization error. HHR is not optional and V1 does not
ship without it.

--- V1 MARKETS ---

[x] Batter Hits              -- BUILT, end-to-end
[ ] Batter Hits+Runs+RBIs    -- PRIMARY, M11
[ ] Batter Runs              -- M11, designated cut if M11 drags
--- POST-V1 MARKETS (NOT V1) ---

[ ] Batter Total Bases       -- user low priority
[ ] Pitcher Strikeouts       -- build last; sequential DP model

--- V1 CATEGORIES ---

[x] Opportunity Miner        -- BUILT (positive price edge vs offer)
[ ] HHR 2.5 Lower Alt        -- top 20 by probability
[ ] HHR 0.5 Higher Alt       -- top 20 by probability

Categories are eligibility filters over existing
distributions. They are not models. No new math.

--- ALTERNATE LINE REQUIREMENT ---

The user plays alternate lines ~75% of the time. Alt lines
are the primary use case, not a secondary feature.

[ ] Every market exposes full alt ladder
[ ] Each alt line computed INDEPENDENTLY off the same
    distribution
[ ] NEVER interpolated between standard lines
[ ] NEVER substituted with a standard line if unavailable
[ ] Tail calibration verified per-line, deep lines (2.5+)
    bucketed separately

--- RANKING RULE (ABSOLUTE) ---

Ranking is by probability ONLY.

The app does NOT filter, floor, penalize, or reorder by
payout multiplier. It does NOT evaluate ticket or parlay
value. It does NOT build parlays.

The user selects and stacks props themselves. The app's
job is to produce accurate ranked lists. Payout is a
DISPLAY-ONLY field.

Any future proposal to add payout logic to ranking must be
rejected without escalation.

--- DEFERRED / CLOSED ---

[ ] Remaining M8.5 context factors (park, bullpen team
    dimension, times-through-order) -- BUILD AFTER the
    outcome vector generalizes, so they are written once
    against the general shape, not twice
[ ] Remove scripts/bootstrap-m10-archive-ledger.mjs once
    the archive ledger has real entries
[x] V5 refit -- PERMANENTLY SHELVED, do not resurrect
[x] Platoon walk-forward parity -- RESOLVED (a05362d5)

--- FRONT END (M12+) ---

[x] Must display P(Win), P(Loss), P(Void), ranking rationale — implemented by merged PR #62 and reverified on main in run `31539088716`.
[x] NO probability logic in the UI layer — merged PR #62 keeps settlement/probability logic server-side; main run `31539088716` passed the focused authentication/rendering/API regressions.

## Changelog

### Version 4.4 — 2026-08-12

- Recorded Workstream 1 capture coverage as the highest priority after this documentation PR, including the suspected single-fixed-time coverage defect, the multiple-captures-per-day remedy if confirmed, and the open same-day cumulative-dedup question that must be resolved before adding captures.
- Recorded Workstream 2 model-fix status through `CANONICAL_MATH_SPEC.md` Versions 1.10 and 1.11, the frozen v2 §17.46 failure evidence, the §14.2 per-line calibration evidence, and the ordered open Steps 5 through 7.
- Recorded Workstream 3 as independent front-end work: Phase 5 refresh button, later capture-coverage display, and Item J for the §14.2 per-pick-probability evidence path or precomputed cohort E/V/Z.
- Preserved existing queue items A, B, C, D, F, G, and H unchanged.
- This checklist revision changes documentation and execution order only. It does not modify capture schedules, model fitting, candidate selection, workflows, runtime behavior, production enablement, or ranking enablement.

### Version 4.3 — 2026-08-11

- Synchronized the checklist with `CANONICAL_MATH_SPEC.md` Version 1.9, which replaced the Version 1.8 mandatory effective-date requirement with the mutually exclusive §12.1(a) operator-designated effective date / §12.1(b) verified publication-boundary contract.
- Recorded that Underdog does not publish operator-designated effective dates and that Underdog settlement rules register under §12.1(b) publication boundaries.
- Recorded `underdog-batter-hhr-settlement-v1` as registered after merged PR #70 (`e5bb8b5df08877152786aabace3d2b1efe28f601`); the domain type enforces exactly one temporal form, and post-merge main verify run `31554833774` passed 684 of 684 tests.
- Explicitly left HHR nonstarter void handling open: current grading does not consume the registered rule and still throws on a missing official HHR stats row.
- Preserved HHR and Batter Hits production-disabled and ranking-disabled status. No other M11 item was marked complete.

### Version 4.2 — 2026-08-11

- Closed only the first HHR M11 checklist item after direct repository verification of preserved The Odds API evidence for exact Underdog baseline and alternate HHR markets, sides, lines, and offer types.
- Recorded immutable evidence commit `5278d63f123207772a76f25c482c5cecbb919331` and main verify run `31540589584`, which passed 678 of 678 tests.
- No provider logic, model fitting, probabilities, settlement, categories, production/ranking enablement, or canonical authority changed.

### Version 4.1 — 2026-08-11

- Synchronized M10 presentation status with merged repository evidence: PR #61 closed the read-only HHR API entrypoint and PR #62 closed the password-gated responsive UI with no browser-side probability or ranking logic.
- Recorded the successful Replit `Player Analytics` Autoscale/cloudrun deployment at `https://player-analytics--derkmane.replit.app` after PR #64 merged as `7848074387eb7bc5c6fa899fe730f1cc2d5d3b52`.
- Recorded post-merge main GitHub Actions verify run `31539088716`: 678 tests, 678 pass, 0 fail, with typecheck, script checks, build, architecture, selected-side, and protective-architecture gates clean.
- Closed the matching front-end display requirements already directly verified by the merged UI implementation; no production-enable, ranking-enable, model, provider, settlement, probability, or canonical authority change was made.

### Version 4.0 — 2026-08-05

- Replaced the sanitized-only grading caveat with the first real exact-archive result: 78 picks, 39 wins, 39 losses, 0 voids, observed 0.5 versus mean predicted 0.5, with archive modification false.
- Recorded the verified daily 21:15 UTC prospective board capture and daily 09:00 UTC final-only grading schedules from implementation commit `aac2935f1856823ec8169a71e43b026d2c95ca4c`; GitHub Actions run 774 passed 580/580.
- Left API entrypoints, UI display, deployment, and public-link verification unchecked.

### Version 3.9 — 2026-08-05

- Closed Opportunity Miner, High Probability Baseline, High Probability Altline, one-prop-per-player, overlap, canonical final-probability sorting, and Top Five using commits `c00c4f98b84890093ef35678c82f8a8120a6cc4c`, `d8681e71819607bccc756eb9dac8be3c8c8e3d64`, `5625df541b2b94bdb603318156abe5830fd80c62`, `bc7cc1485b9e52b6e3a51383cdaeeef111d20c93`, `b1b038c5264125c9e22a5719e377c2be7b67402a`, and `9b55267b23ab9632cf0522530afb0c3f913ed497`; GitHub Actions runs 747, 749, 750, 751, and 759 supplied the direct gates.
- Closed complete immutable saved-run storage and atomic persistence at commits `1c46ce7a884b27e2c9a83e7f4642aef141701b72` and `764a48bc97553e9d5148bc8ce3cb2188626ab9c6`; run 761 passed 560 of 560 tests.
- Closed feature-independent historical-only rendering at commit `08df180bfd05dc45d81365cc36948a191611ecc3`; run 762 passed 562 of 562 tests.
- Closed the versioned grading implementation at final corrective commit `ecf02030ad0108fd53e3772de119abdd5114d77a`; run 765 passed 567 of 567 tests. The grading path has been exercised only with sanitized deterministic test evidence and has not yet produced a real archived-board grade report.
- Left API entrypoints, UI display, deployment, and public-link verification open. Production and ranking remain disabled, and no July 31 recovery work was performed.

### Version 3.8 — 2026-08-04

- Closed the M8.5 final-distribution and exit gates after the separately reserved `2026-07-26` through `2026-07-29` untouched cohort completed one immutable acceptance run: 4 dates, 54 final games, 4,159 source plate appearances, and 900 scored hitter-game observations.
- Recorded cohort identity SHA-256 `d82c8e62cdad9023793898c1f0e9ed5baaee650fad650cc13620b7b0800b3d17`, reservation-artifact SHA-256 `34558a6b0fffa592de882132b093f3496f14c250b987b3d91eaedc9a254e22cb`, frozen-successor SHA-256 `a296c384397315832b39d322a7d061ca73e542d94a886087f743f0774199cd17`, acceptance internal SHA-256 `9c7ba5ae6b7b77334e2e5c444b680261fa8e0e82ef9ce621091c30f64ec3f321`, and committed acceptance file-byte SHA-256 `38603400cf77cb5f0ade13077fb8215e59ac7ad7b1d2fb8b13adf18491cb0497`.
- Recorded `D_final` categorical log loss `1.1963378032` versus `1.1969075917` for `D_base`, delta `-0.0005697884`, and categorical Brier `0.6558780914` versus `0.6561814842`, delta `-0.0003033928`; `D_final` passed by proper-score dominance under the frozen rule.
- Recorded that Higher 2.5 Brier was microscopically worse for `D_final` but remained diagnostic only and could not alter the decision; the slightly larger untouched delta relative to the approximately `0.0004`-nat combined fitted improvement is within noise on 900 observations and is not evidence of better-than-expected factor performance.
- Preserved rather than repaired 4 simultaneous multi-slot phase shifts, 4 unknown terminal results, 4 incomplete history-update games, and 8 excluded team sides.
- Recorded final factor dispositions: game-specific offensive environment `APPLIED`, team-specific bullpen `APPLIED`, times-through-order `IDENTITY`, Defense `IDENTITY`, and park `VALIDATED NOT APPLIED`.
- Recorded GitHub Actions verify run 674 passing 476 of 476 tests, with 260 modules and 782 dependencies inspected and zero architecture violations; typecheck, script checks, build, selected-side, and protective-architecture gates passed.
- Left `tau_soft` and hard-discovery recall validation unchecked because no hard predicate was proposed or validated; hard discovery filtering remains disabled. Production, ranking, hard discovery filtering, and retuning remain disabled.
- Stated explicitly that four dates and 900 scored observations are not decisive evidence of predictive value and that this result is an acceptance check under the frozen rule, not proof that the context layer materially improves predictions.
- Closed M8.5 without starting M9 implementation.

### Version 3.7 — 2026-08-04

- Closed the M8.5 Defense data-sufficiency decision as an explicit versioned identity/no-op after approved-source team attribution, BIP-only scope, and strictly chronological capability passed.
- Recorded the current-season pre-screen using resolved dataset SHA-256 `a40eca0b15e5d69c7c718e807c2ced7b007650f0628dd7761c87f9f56f1d3b59` and team offensive-environment dataset SHA-256 `eb627faefd24b9862965151c45fd7ccce588d36fe9acb7ddb6f4a04e14a3dc8a`: 30 teams, 1,122 mapped games, 54,919 included BIP rows, 1,687 unmapped rows, minimum 1,490 and median 1,847 observations per team, and `BIP_REACH` spread-to-noise ratio `2.022`.
- Recorded approximately one percentage point of estimated true between-team variation and an optimistic categorical log-loss ceiling near `0.00026` nats before overlap with existing per-pitcher allowed effects; no Defense family or candidate grid was fit.
- Added and locked `model-artifacts/m8-5-defense-to-batted-ball-identity-v1.json`, artifact SHA-256 `85d163f127791bf04ba786b7c1661f7f88515a7a724debd22a6892855133712f`, restricted to approved BIP categories with production, ranking, selected-side input, direct probability effects, fitting, and untouched-test access disabled.
- Recorded GitHub Actions verify run 647 passing 454 of 454 tests with typecheck, script checks, architecture, build, selected-side, and protective-architecture gates clean.
- Did not begin the M8.5 freeze, reserve or read a new untouched cohort, close an M8.5 exit gate, or start M9.

### Version 3.6 — 2026-08-04

- Closed times-through-order as an explicit identity/no-op limited to starter repeated exposure while preserving the separate starter-to-bullpen transition; recorded artifact SHA-256 `78352afd7c5bfe2ce1383aa7276e9b942826ec02271726a0a2065807c467c352`.
- Recorded park as validated but explicitly not applied at runtime because the measured effect is approximately `0.0004` nats and does not justify a unique runtime venue dependency; preserved the frozen artifact and fitting evidence without wiring runtime park resolution.
- Added and verified `M8_5FinalEvaluationV1` and context-adjusted `D_final` composition applying game-specific offensive environment and team-specific bullpen while recording TTO identity and park non-application.
- Recorded exact final settlement, immutable baseline/alternate `D_final` reuse, Higher/Lower directional monotonicity, diagnostic-only context delta, mass conservation, and fail-closed factor-artifact drift.
- Recorded GitHub Actions verify run 641 passing 453 of 453 tests with typecheck, script checks, architecture, build, selected-side, and protective-architecture gates clean.
- Preserved production-disabled and ranking-disabled status and the sealed untouched cohort; did not start Defense or M9, freeze M8.5, or close any M8.5 exit gate.

### Version 3.5 — 2026-08-03

- Closed the third M8.5 context-factor item after the canonical fixed-validation and expanding walk-forward categorical proper-score nondominated-set intersection selected `venue-hand-pool-2500`.
- Recorded exact venue-audit, evaluation-dataset, canonical-evaluation, typed-factor, park-wrapper, and committed file-byte SHA-256 identities.
- Recorded the corrected candidate-selection rule: categorical log loss and categorical Brier only, independent fixed and walk-forward frontiers, stable intersection, identity as the infinite-pooling candidate, and Hit metrics diagnostic only.
- Removed the temporary park lineage diagnostic scripts and their syntax-check references.
- Replaced `PROJECT_RULES.md` with Version 2.9 designating the active repository the sole canonical authority.
- Preserved production-disabled and ranking-disabled status, the frozen M8 boundary, and the sealed untouched-test cohort.

### Version 3.4 — 2026-08-02

- Closed the second M8.5 context-factor item after real active-season fixed-holdout and expanding daily walk-forward evaluation selected `opponent-only-l2-0.01` for game-specific shared-scenario weights.
- Added a strictly chronological earlier-date opponent-only pregame feature path with same-date, same-game, excluded-offensive-statistic, and untouched-test leakage protections.
- Preserved the exact frozen shared scenario definitions and changed only their game-specific mixture weights so approved opportunity and outcome assumptions move jointly.
- Recorded exact evaluation, feature-dataset, model-artifact, and file-byte SHA-256 identities plus a byte-for-byte deterministic rerun.
- Recorded the committed artifact-lock regression and GitHub Actions verify run 548 passing 386 of 386 tests with typecheck, script checks, architecture, build, selected-side, and protective-architecture gates clean.
- Preserved production-disabled and ranking-disabled status, selected-side and direct-probability prohibitions, excluded-offensive-statistic rejection, and the sealed untouched-test boundary.

### Version 3.3 — 2026-08-02

- Closed the first M8.5 context-factor item after real current-season fixed-holdout and expanding walk-forward validation selected `team-hand-pool-2500` for team-specific bullpen terminal outcomes.
- Preserved the exact 30-team, 60-vector factor artifact and added a byte-lock regression covering the committed file, internal artifact identity, active-season evidence, and side/direct-probability prohibitions.
- Recorded exact evaluation, artifact, file-byte, team-identity-projection, and frozen starter/bullpen-transition SHA-256 identities.
- Confirmed rejected offensive statistics were not used, the frozen workload transition was unchanged, production and ranking remained disabled, and untouched-test rows remained sealed.
- Recorded the deterministic real-evidence rerun and GitHub Actions verify runs 536 and 537 passing 371 of 371 tests with typecheck, script checks, architecture, build, selected-side, and protective-architecture gates clean.

### Version 3.2 — 2026-08-01

- Replaced the rejected scalar-only PR #24 proposal with the versioned `M8_5BatterHitsFactorArtifactV1` typed contract.
- Added distinct identity, terminal-outcome-vector, scenario-mixture, opportunity-survival, workload-transition, park-transformation, and batted-ball-translation effect families.
- Required production-disabled current-season artifacts, deterministic SHA-256 identity, complete evidence lineage, explicit application stages and required inputs, and sealed untouched-test metadata.
- Prohibited selected-side inputs, direct probability changes, universal scalar coefficients, and silent fallbacks; unknown, malformed, wrong-season, unvalidated, or hash-drifted artifacts fail closed.
- Restricted defensive translation to supported balls-in-play categories and preserved non-BIP outcomes outside that effect family.
- Recorded six focused contract tests and GitHub Actions verify run 503 passing 356 of 356 tests; no M8.5 factor or `D_final` implementation was started.

### Version 3.1 — 2026-08-01

- Closed the M8 Bridge after direct projected/confirmed runtime compliance and the immutable `M8BatterHitsBaseEvaluationV1` handoff passed.
- Added one reusable, hash-verified `D_base` per identical baseball-input identity and exact side-and-line settlement for baseline and alternate offers without rebuilding the distribution.
- Preserved complete model, settlement, provider, lineup, opposing-starter, artifact, and shared-scenario lineage while keeping discovery audit-only and `tau_soft` absent.
- Recorded Higher/Lower symmetry, integer-line void, deterministic rerun, projected/confirmed invariance, frozen-output parity, and tamper-rejection evidence.
- Recorded GitHub Actions verify run 492 passing 350 of 350 tests with production ranking disabled and untouched-test evidence sealed.
- Corrected the inherited M9 archive/grading status: PR #21 remains isolated and its code and July 31 runtime bytes are not part of the clean M8 amendment branch.
- Left every M8.5 factor, fitting, validation, final-distribution, and production gate unchecked.

### Version 3.0 — 2026-08-01

- Added the explicit M8 Bridge that preserves frozen M8 as immutable `D_base` and requires a versioned base-evaluation envelope before M8.5.
- Added audit-only exact side-and-line `p_base` discovery while keeping `tau_soft` and hard offer exclusion disabled until final-model recall validation exists.
- Added the separately versioned M8.5 `D_final` sequence, typed context-factor effect families, current-season validation, new untouched-cohort requirement, and final exact settlement rules.
- Locked team-specific bullpen work to replace generic bullpen outcome assumptions while preserving the validated starter-to-bullpen workload transition.
- Corrected July 31 evidence status: archive/grader implementation is verified, but exact original archive and grading bytes remain an open recovery-and-hash-verification gate and may not be regenerated or rewritten.
- Clarified M10 ordering uses only final `p_final`, then `P(Void)`.

### Version 2.9 — 2026-07-31

- Began prospective live Underdog Batter Hits board archiving through the connected frozen M8 runtime.
- Preserved one immutable 30-row July 31 archive with SHA-256 `ae8803b5625662e483f1b6f52e715f55a671a3c9d777ae7ec1aa65fda1bedc8c`.
- Added official BALLDONTLIE final-game Hits grading using exact archived game and player identities and exact Higher/Lower settlement.
- Verified that incomplete games remain pending and do not create a permanent grade sidecar; the initial live run reported 30 pending and 0 unresolved rows.
- Recorded 10-of-10 archive/grading tests, 24-of-24 integrated focused tests, and 360-of-360 complete repository tests passing.
- Preserved the connected M8 model, production-disabled status, and sealed untouched-test boundary.

### Version 2.8 — 2026-07-30

- Added a fixture-backed test-only invariant proving baseline and alternate Batter Hits offer attributes do not create different baseball distributions.
- Recorded that the committed board contains real baseline and alternate offers but no same-player pair, avoiding any unsupported provider claim.
- Held player, game, team, lineup, opposing starter, shared scenarios, and frozen model artifacts fixed while substituting only provider-observed alternate offer attributes.
- Verified exact equality of the complete runtime and candidate statistic distributions while allowing side, line, price, multiplier, and settlement probabilities to differ.
- Recorded 1-of-1 focused passing test and GitHub Actions verify run 420 with 347-of-347 tests passing; production ranking remains disabled and untouched-test rows remain sealed.

### Version 2.7 — 2026-07-30

- Restored and verified the already-frozen complete Batter Hits candidate artifact with SHA-256 `728895ca850c5481cd1f17944e38464f16396becc3622146a1384bba19ce5cde`.
- Connected confirmed fixture-backed lineup, batting-slot, handedness, and opposing-starter inputs to the frozen runtime artifacts.
- Built deterministic scenario-conditioned nested opportunity-count and exact Poisson-binomial Batter Hits distributions.
- Produced side-aware `P(Win)`, `P(Loss)`, `P(Void)`, and `P(Win | grades)` through generic core settlement while preserving exact side and line.
- Recorded 3-of-3 focused passing tests and GitHub Actions verify run 417 with 346-of-346 tests passing; production ranking remains disabled and untouched-test rows remain sealed.

### Version 2.6 — 2026-07-30

- Added exhaustive fixture-backed selected-side and posted-line preservation coverage for all 34 uniquely linked Batter Hits offers.
- Verified baseline and alternate offers through both normalized and pregame composition boundaries.
- Verified raw Over maps only to Higher, raw Under maps only to Lower, and every numeric provider point survives exactly as the posted line.
- Verified final-game exclusion preserves the same immutable normalized offer identity rather than rewriting side or line.
- Recorded 2-of-2 focused passing tests and GitHub Actions verify run 413 with 343-of-343 tests passing; production ranking remains disabled.

### Version 2.5 — 2026-07-30

- Added the shared pregame game-eligibility gate and fixture-backed BALLDONTLIE game-state normalization.
- Required a uniquely matched current-season regular-season game with exact scheduled status and an evaluation time strictly before both preserved provider start timestamps.
- Verified that final, unknown, missing, duplicate, and start-time-reached game states fail closed before probability generation or ranking.
- Preserved exact normalized offer identity, selected Higher/Lower side, and posted line for every surviving offer.
- Recorded 4-of-4 focused passing tests and GitHub Actions verify run 408 with 341-of-341 tests passing; production ranking remains disabled.

### Version 2.4 — 2026-07-30

- Connected fixture-backed real Underdog Batter Hits baseline and alternate board offers through strict The Odds API contracts and normalization.
- Preserved event, bookmaker, market, offer type, uniquely linked player, Higher/Lower side, exact line, price, multiplier, market timestamp, and source snapshot identity.
- Verified 34 normalized offers and fail-closed rejection of both unresolved James Jarvis offers.
- Recorded 3-of-3 focused passing tests and GitHub Actions verify run 405 with 337-of-337 tests passing; probability generation and production ranking remain disabled.

### Version 2.3 — 2026-07-30

- Connected the exact frozen Batter Hits runtime artifact through the existing feature, adapter, and composition public boundaries.
- Added strict artifact version, SHA-256, selected-candidate, deferred-component, production-disabled, and untouched-test-seal validation.
- Verified that artifact tampering fails closed before composition and that Batter Hits still cannot produce or rank a real prediction.
- Recorded 2-of-2 focused passing tests and GitHub Actions verify run 402 with 334-of-334 tests passing, plus clean typecheck, script checks, architecture, and build.

### Version 2.2 — 2026-07-29

- Closed M8 current-season fitting and runtime freezing with artifact `model-artifacts/m8-batter-hits-runtime-freeze-v1.json`, SHA-256 `e5a660ffc0aefc093dc80aae0169109bd7717605098d790b3257a83fad5bf3de`.
- Recorded park, defense-to-batted-ball, and times-through-order as explicit non-modeled identity components; no coefficient or residual is fitted or applied.
- Deferred eligibility and participation probability to the M9 pregame runtime gate rather than treating it as a fitted M8 component.
- Recorded exact selected recency, pooling, coherent-matchup, platoon, starter/bullpen, PA-survival, and shared-environment identities with preserved fixed and walk-forward proper-score evidence.
- Recorded 3-of-3 focused freeze tests and the complete 332-of-332 repository verification with typecheck, script checks, architecture, and build passing.
- Preserved `productionEnabled: false`, `untouchedTestAccessed: false`, and the sealed one-time untouched-test acceptance boundary.

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
---

## Workstream 1 — Capture coverage implementation close-out — 2026-08-14

### Coverage defect and timing evidence

- [x] Capture coverage defect confirmed. The prior single 21:15 UTC board capture reached between 47% and 100% of the day's MLB slate depending on schedule shape. Every missing game was already started before the capture, confirming a systematic timing/coverage defect rather than a model-distribution defect.
- [x] K4 lineup-timing evidence recorded: confirmed lineups were available a mean 86 minutes before first pitch; projected lineups were available a mean 630 minutes before first pitch. Projected lineup status remains full-weight baseball input under the locked projected-lineup rule and is not a probability penalty.

### Grading/runtime prerequisite work

- [x] Step A — adaptive rate limiter completed. Grading pacing improved from 41m23s to 21.4s. Provider pacing was verified at the approved 600 requests/minute ceiling and 112 ms request spacing.
- [x] Step B — cross-archive provider reuse completed. The pinned five-capture workload required 78 provider requests for 26 unique games versus approximately 192 requests before reuse. Equivalence was proven with cumulative source-set SHA-256 `8aabb3dc7403093eb6152378aa7784a909e0c3b4826f8d7334dd7d70113375de` and 422 retained selected-side rows.
- [x] Step C — settled by workflow run `31703407121`. Five previously ungraded archives completed in 9,977 ms.

### D1 — schedule-aware multi-capture controller

- [x] D1 merged in PR #90. The board archiver now runs on cron `0,30 * * * *`.
- [x] NORMAL capture band is 40–110 minutes before first pitch for an uncovered game.
- [x] RECOVERY capture band is greater than 0 and less than 40 minutes before first pitch for an uncovered game.
- [x] Runs with no uncovered game in either band return NOOP.
- [x] CAPTURE is snapshot-first: the immutable provider-board snapshot is completed before historical/enrichment work and the exact snapshot set is replayed to both Batter Hits and HHR.
- [x] Coverage durability is gated on the full capture transaction. Coverage is not finalized until both archivers have consumed and verified the same immutable snapshot set. HHR archive-ledger durability occurs before Batter Hits archive-ledger durability, with the Batter Hits ledger last so an incomplete transaction remains retryable.
- [x] Started games are never claimed.

### Step 2 — Batter Hits cumulative same-day dedup

- [x] Batter Hits cumulative latest-capture selected-side dedup v2 merged in PR #91.
- [x] Cumulative dedup occurs only after immutable per-capture selected-side selection and before cumulative summary/calibration.
- [x] Latest-capture identity is `providerGameId + providerPlayerId + providerMarketKey + offerType + postedLine`; `providerEventId` and selected side do not create new cumulative identities.
- [x] HHR and Batter Hits now share one latest-capture reducer implementation.
- [x] HHR real-evidence equivalence was re-proven after reducer generalization: source-set SHA-256 `8aabb3dc7403093eb6152378aa7784a909e0c3b4826f8d7334dd7d70113375de`, 422 retained rows, blocked count 0, outcomes identical.
- [x] Combined multi-market cumulative contract advanced to v2 and includes component contract identity in its digest.
- [x] Production and ranking remain disabled.

### Item N — historical Batter Hits cumulative v1 evidence

- [x] Any Batter Hits cumulative v1 file produced after PR #90 merged and before PR #91 merged is known over-counted under same-day multi-capture operation and must not be cited as calibration or validation evidence.
- [x] Immutable per-capture Batter Hits archives and grade reports remain authoritative source evidence; cumulative v2 rebuilds from those immutable reports.

### D1d — live scheduled-run acceptance

- [x] Real scheduled NOOP proven by workflow run `31816364437`. The controller performed one schedule read, evaluated 14 provider events, returned NOOP because no uncovered game was inside the capture window, skipped all CAPTURE-only work, preserved ledger durability, and exited successfully.
- [ ] Real scheduled CAPTURE proof pending. Required evidence remains: snapshot-first ordering, `runStartToSnapshotElapsedMs`, identical `snapshotSetSha256` across both replay receipts, both receipts complete, coverage written only after both archivers consumed the snapshot, HHR ledger saved before Batter Hits ledger, every claimed game's `boardSnapshotCompletedAt` strictly before first pitch, and full-day distinct-game coverage versus the actual MLB slate.

Workstream 1 implementation is complete. Final live D1d CAPTURE and full-day coverage evidence remain open acceptance evidence and must be appended when observed.
