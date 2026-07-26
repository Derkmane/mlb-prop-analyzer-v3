# MLB Prop Analyzer — Project Rules

**Version:** 2.1  
**Status:** Canonical project rules  
**Applies to:** MLB Prop Analyzer V3  
**Repository:** `Derkmane/mlb-prop-analyzer-v3`

---

## 1. Authority and purpose

This file controls project scope, approved data sources, architecture, workflow, approvals, testing, delivery, and change control.

`CANONICAL_MATH_SPEC.md` controls probability mathematics, statistical definitions, model-family requirements, settlement calculations, calibration requirements, and mathematical tests.

Neither file may silently override the other. If they appear to conflict, stop the affected work, show the conflict and practical impact, and propose the smallest correction.

---

## 2. Rule levels

Every rule is one of three types.

### LOCKED

A hard boundary that may change only through the canonical-source change process and explicit user approval.

### DEFAULT

The approved starting strategy. It must be tested and may be changed when evidence shows it is wrong, inefficient, contradictory, or harmful.

### OPEN

Not yet decided. Research, testing, and a recommendation are required before implementation.

When a rule is not labeled, treat it as DEFAULT unless it is clearly stated as LOCKED.

---

## 3. Active repository boundary — LOCKED

The only active working repository is:

`Derkmane/mlb-prop-analyzer-v3`

Do not inspect, modify, test, commit to, or otherwise work in another repository unless the user explicitly approves one narrow read-only reference purpose.

`Derkmane/mlb-prop-analyzer-v2` may remain available as read-only historical reference material, but it is not the active implementation and is not a source of truth for V3 architecture.

Carry forward:

- verified mathematics
- approved test vectors
- product requirements
- provider observations that are clearly documented and reverified
- lessons learned

Do not automatically copy or port V2 application code, architecture, schemas, mappings, dependencies, or workflows. Any reuse of an implementation artifact requires a specific reason, evidence that it is still correct, and explicit approval.

No file may be written, edited, committed, or deleted in another repository during V3 work.

---

## 4. Current-task containment — LOCKED

Work only on the exact assigned task.

Do not silently expand into unrelated:

- audits
- debugging
- refactoring
- cleanup
- dependency upgrades
- architecture changes
- UI redesign
- source changes
- mathematical changes
- migrations
- rebuilds
- checklist items

Report unrelated findings briefly and leave them untouched unless they directly block the approved task.

Destructive deletion, rollback, repository replacement, migration, or reconstruction requires an evidence-based proposal and explicit approval.

---

## 5. Golden Rule and product objective — LOCKED

The app analyzes Underdog MLB pregame player props.

The sole product objective is to identify, within each approved category, the eligible posted Higher or Lower picks with the highest true probability that the **selected side wins**.

The governing ranking quantity is:

`P(Win | grades)`

Primary sort:

1. `P(Win | grades)` descending
2. `P(Void)` ascending as the tiebreak

The app is not trying to identify players who will perform well. It is trying to identify posted Higher or Lower sides most likely to win.

Every prop must preserve:

- player
- event and game identity
- market
- line
- selected side
- official settlement statistic
- `P(Win)`
- `P(Loss)`
- `P(Void)`
- `P(Win | grades)`
- model and settlement-rule versions

For Higher, upward distribution shifts may help and downward shifts must hurt. For Lower, downward shifts may help and upward shifts must hurt.

No multiplier, hidden booster score, risk score, player reputation, excitement, player-quality label, or side preference may alter ranking outside the approved probability model.

Every technical subtask must directly improve, validate, protect, or display side-aware probability, eligibility, workload, distribution construction, settlement, calibration, reproducibility, category ranking, saved predictions, or grading.

---

## 6. Product structure — LOCKED

The app has exactly three categories:

1. Opportunity Miner Favorites
2. High Probability Baseline Props
3. High Probability Altline Props

Rules:

- one prop per player per category
- overlap across categories is allowed
- Top Five means the first five eligible picks after approved sorting
- pregame only; started games are excluded
- selected side, line, market, and settlement statistic must survive ranking, display, saving, and grading
- categories may filter, deduplicate, sort, and select
- categories may not modify probabilities
- the user builds their own entries

A market and a category are different objects. Batter Hits is a market feature. High Probability Altline Props is a category selector.

---

## 7. Approved production sources — LOCKED

Only these sources may supply production baseball or board data:

### The Odds API

Used for:

- Underdog board data
- verified baseline markets
- verified alternate markets
- provider offer identity
- posted side and line

### BALLDONTLIE MLB API

Used for verified available MLB data including:

- teams
- players
- games
- schedules
- lineups
- statistics
- plate appearances
- plays
- current-season information exposed by the approved API

Not allowed without explicit approval:

- scraping
- browser capture as a production source
- silently substituted providers
- invented endpoints, fields, schemas, parameters, coefficients, or availability
- web-search player, team, league, game, park, or board statistics

Technical references may support methods but may not supply production prediction data.

---

## 8. API evidence before provider-derived contracts — LOCKED

Never assume API keys, endpoints, parameters, response schemas, date formats, statuses, pagination, market names, current-season coverage, or field availability.

Before defining provider-derived contracts or implementing provider adapters:

1. verify real API access
2. capture representative raw responses
3. sanitize and preserve fixtures
4. document actual JSON paths and observed quirks
5. create a capability matrix
6. define normalized contracts from that evidence

Pure domain types that come from the product and mathematics may be defined earlier. Provider-shaped contracts may not be invented from memory.

If required data is unavailable:

1. stop the affected model work
2. identify the exact missing field
3. identify the model component it blocks
4. present lawful options
5. obtain approval before changing the source policy or mathematical design

Known BALLDONTLIE observations must be recorded in `docs/providers/balldontlie-quirks.md` and reverified with V3 fixtures.

---

## 9. Current-season-only production evidence — LOCKED

Only the active MLB regular season may supply player, team, or league performance observations used for production fitting, pooling, calibration, validation, or prediction.

Do not use:

- prior seasons
- career statistics
- Marcel or other multi-season estimators
- prior-season priors or regression targets
- age curves derived from prior seasons

Current-season chronology must separate fitting, validation, and untouched testing. When evidence is insufficient, label the component insufficient or not yet production-validated. Do not fill the gap with older seasons.

Archive raw Underdog boards prospectively because earlier board environments cannot be reconstructed from box scores alone.

---

## 10. Modular-monolith architecture — LOCKED

V3 begins as one repository and one deployable application with enforced internal module boundaries.

The approved layers are:

### `composition`

The only layer allowed to assemble the complete application, registries, providers, persistence, entrypoints, categories, and enabled features.

### `domain`

Pure product and baseball concepts. It may not import adapters, UI, persistence, or feature implementations.

### `core`

Pure deterministic cross-market logic including probability operations, settlement, side-aware ranking, validation, determinism, and canonicalization.

Settlement and ranking belong in core and may not be reimplemented per feature.

### `application`

Use-case orchestration. It coordinates ports and domain operations without owning provider details.

### `game`

The one shared game, lineup, offensive-environment, opportunity, and workload scenario system used by all markets from the same game.

### `features`

Implemented market features only. No empty future-feature folders.

### `categories`

Opportunity Miner, Baseline, and Altline eligibility and selection logic. Categories may not alter probability.

### `historical`

Read-only interpretation and rendering of immutable saved predictions. It may not depend on active feature implementation code.

### `adapters`

Provider, persistence, HTTP, CLI, UI-facing, clock, and logging adapters. Raw provider objects may not leak past adapter normalization boundaries.

There is no generic `shared` dumping ground.

---

## 11. Information flow — LOCKED

Approved flow:

```text
raw provider response
→ immutable raw snapshot
→ runtime-validated provider schema
→ normalized contracts
→ shared GameScenarioSet
→ market feature statistic distribution and eligibility
→ core settlement and side-aware probabilities
→ generic candidate
→ category selection and ranking
→ immutable saved run
→ API, CLI, and UI view models
```

Layers may not bypass this flow.

Examples:

- UI may not call BALLDONTLIE directly.
- Infrastructure may not rank candidates.
- Categories may not change `P(Win)`.
- Features may not create arbitrary saved-run formats.
- Historical rendering may not rerun the current production model.

---

## 12. Shared game and workload correctness — LOCKED

One shared game and workload model must drive all props from the same game.

Markets may not use contradictory assumptions about:

- lineup
- home and away state
- game environment
- starter workload
- bullpen transition
- team batters faced
- scenario weights
- game length, postponement, or suspension state

Existing canonical cross-market concepts are never duplicated merely because fewer than three features currently consume them.

New ordinary helper abstractions should normally not move into a shared location until three separate features genuinely require them.

---

## 13. Feature ownership and public boundaries — LOCKED

A feature folder is created only when active implementation of that market begins.

Each feature owns its market-specific:

- normalized input requirements
- official-statistic distribution builder
- eligibility logic
- feature-specific explanation data
- feature-specific persisted fields
- feature-specific presentation
- tests
- public `index` entrypoint

A feature may import another feature only through that feature's public `index` entrypoint. Reaching into another feature's internal files is prohibited.

A feature may not:

- fetch provider data directly
- own generic settlement or category ranking
- silently fall back to another model
- write to arbitrary persistence paths
- bypass shared game scenarios

---

## 14. Feature manifest — LOCKED

Each implemented feature has a small manifest containing only identifiers static analysis cannot reliably discover:

- feature ID
- market keys
- storage keys
- API route paths
- feature-specific saved-prediction field names

Generic shared fields such as player, market, line, selected side, probabilities, model version, and settlement version belong to no single feature.

The folder and code are the record of files, exports, UI components, dependencies, tests, and commands. Do not duplicate that information in a large hand-maintained manifest.

---

## 15. Market-key ownership and statuses — LOCKED

Every market key has exactly one canonical declaration.

For an implemented market, the feature manifest owns and exports its market keys. The feature registry and market registry consume those exported constants.

For a planned market without an implementation folder, the planned-market catalog owns and exports its keys.

When implementation begins, ownership transfers from the planned-market catalog to the feature manifest in one commit, and the old declaration is removed in that same commit.

No handwritten second copy is allowed.

Preferred status progression:

```text
PLANNED
→ DATA UNDER INVESTIGATION
→ MODEL UNDER DEVELOPMENT
→ VALIDATION
→ PRODUCTION ENABLED
```

Not yet production-validated does not mean abandoned.

Hits + Runs + RBIs remains an intended market and must be investigated for approved-source data sufficiency and a tagged-player base-out joint model.

Pitcher Strikeouts remains an intended market and requires the canonical sequential joint workload-and-outcome process. It may not use the hitter opportunity-mixture shortcut.

Batter Hits is the first intended production vertical slice.

---

## 16. Feature enable, disable, and removal — LOCKED

The central feature registry owns production enable/disable state.

Disabling a feature must fail closed:

- no new prediction
- no category eligibility
- no ranking
- no silent fallback to old, audit, deprecated, generic, implied-probability, or side-independent logic

Removal procedure:

1. disable the feature in the registry
2. verify no new production prediction can use it
3. run architecture checks and the full behavior suite
4. resolve or explicitly document hidden dependencies
5. remove the feature folder and registry entry
6. run dependency-cruiser, type checking, and tests
7. search active production code for every feature-manifest identifier
8. confirm historical predictions still load and render without active feature code

Zero identifier matches are required in active production code only. Matches may remain in immutable saved records, historical fixtures, and explicitly isolated historical compatibility code.

Historical records are never rewritten merely because a feature is removed.

---

## 17. Dependency and type enforcement — LOCKED

V3 uses strict TypeScript.

Type checking, runtime schema validation, dependency-cruiser, registry tests, and deletion-time identifier searches protect different dependency classes and must work together.

Dependency-cruiser must enforce:

- one-directional layer rules
- no feature-internal cross-imports
- no circular dependencies
- no unresolved imports
- historical isolation from active features
- domain and core isolation from external adapters

Orphan reports require review and are not automatic deletion instructions. CLI entrypoints, verification scripts, migrations, and test helpers may legitimately appear orphaned.

Do not create a custom feature-impact application when standard dependency analysis is sufficient.

---

## 18. Mathematical authority and production readiness — LOCKED

All production probability calculations must follow `CANONICAL_MATH_SPEC.md`.

No real prop may rank until its distribution builder, eligibility event, settlement rule, current-season fit, chronological validation, and calibration status satisfy the canonical requirements.

Synthetic fixtures may be used for architecture and mathematical tests but must be unmistakably synthetic and may never appear as production predictions.

Baseline and alternate offers for the same statistic use the same official-statistic distribution and differ only through posted offer attributes and settlement.

---

## 19. Early BALLDONTLIE capability gate — LOCKED

The first provider investigation must explicitly determine whether approved BALLDONTLIE responses can support the canonical terminal plate-appearance vector and hitter opportunity model.

It must verify whether raw events can distinguish the required terminal categories, including walk types, hit types, reached-on-error, fielder's choice, sacrifices, other outs, catcher interference, and other terminal PA results.

It must also verify lineup position, opportunity order, batter and pitcher identity, handedness where required, and game-state fields needed by the model.

If the source cannot support a required distinction, do not silently merge categories or pretend the current specification was implemented. Stop and propose a source-supported mathematical correction or another approved option.

---

## 20. Build order — DEFAULT

Use this evidence-driven order unless a documented blocker justifies a proposed change:

1. create and approve V3 authority files
2. create the strict TypeScript modular scaffold
3. enforce architecture boundaries and CI gates
4. verify The Odds API and BALLDONTLIE access
5. capture and sanitize representative provider fixtures
6. complete the Batter Hits capability matrix
7. define provider-derived contracts from captured evidence
8. implement verified deterministic core mathematics
9. implement registries, fail-closed behavior, and historical independence
10. implement the shared game and hitter opportunity foundation
11. create a synthetic removable Batter Hits vertical slice
12. fit, version, and validate current-season models
13. enable real-prop ranking only after acceptance gates pass
14. implement complete categories, saved-run workflows, grading, API/UI presentation, and deployment

Do not impose daily caps or time estimates. Continue through the verified sequence until the user chooses to stop or an approval, access, secret, evidence, or runtime boundary is reached.

---

## 21. Testing intent and failure classification — LOCKED

Before running a test or diagnostic, state the expected result and what that result would prove.

### Expected or protective failure

A deliberate rejection proves a guardrail works. Examples include disabled-market rejection, invalid probability rejection, forbidden-import rejection, started-game exclusion, or a planned red test before implementation.

An expected protective failure is a successful test outcome and does not count toward repeated-failure escalation.

### Diagnostic finding

A read-only diagnostic may expose a missing field, incorrect assumption, broken dependency, or unsupported schema. It is not a failed implementation attempt because no corrective edit was attempted.

### Failed implementation attempt

A code, configuration, schema, or mapping edit counts as a failed implementation attempt when the defined target still fails, the defect remains, a regression is created, approved output changes unexpectedly, or the result cannot be verified.

A single edit that fails multiple checks counts as one implementation attempt.

### Regression

A regression breaks behavior that was directly verified before the edit. The attempted change must normally be reverted and counts as one failed implementation attempt against the affected file or component.

### Test or fixture defect

When production behavior appears correct but the test, fixture, expected value, mock, or harness is wrong, classify the defect against the test infrastructure. Do not change expected values merely to make tests pass without evidence that the earlier expectation was wrong.

### External or environmental failure

Missing secrets, provider outages, rate limits, network problems, installation failures, or unrelated CI/runtime failures do not count as implementation failures against production code. Report the access or environment boundary honestly.

---

## 22. Repeated-failure escalation — LOCKED

Mandatory structural reassessment is triggered when either occurs:

1. two failed implementation attempts affect the same file or component in one working session, regardless of whether the diagnosed causes appear different
2. approximately 90 minutes of active corrective work have been spent on the same unresolved component after the first unexpected failure

Expected protective failures, planned red tests, passive waiting, unrelated work, diagnostics without edits, and external/environmental failures do not count.

After the trigger:

- stop editing the affected file or component
- do not make a third implementation attempt
- report what each attempt proved
- report any remaining read-only diagnostic findings
- reassess assumptions, boundaries, responsibilities, and dependencies
- propose one structural direction

Allowed structural directions:

- redesign the interface or boundary
- split an overloaded component
- replace the faulty component
- revert to the last verified state
- delete and reconstruct the component
- stop at an evidence, access, secret, runtime, or approval boundary

Read-only investigation may continue if it is reported as investigation and does not conceal another patch attempt.

Deletion is never automatic.

---

## 23. Determinism and saved records — LOCKED

Identical versioned inputs must produce identical outputs.

Every saved prediction must preserve or reference:

- model version
- math-spec version
- project-rules version
- provider snapshot identifiers or hashes
- normalized-data version
- model-artifact versions
- settlement-registry version
- configuration version
- timestamps
- selected side and line
- scenario weights
- opportunity distributions
- final statistic distribution
- `P(Win)`, `P(Loss)`, `P(Void)`, and `P(Win | grades)`

Saved predictions and runs are immutable.

Historical rendering must work without importing the active feature implementation. Feature-specific historical data must be isolated inside a versioned envelope, while generic display and grading data remain readable.

Raw JSON identity metadata may be canonicalized for migration verification, but exact equality is required for scenario weights, opportunity distributions, final distributions, eligibility probability, all win/loss/void values, ranking order, selected side, line, and settlement statistic.

Any migration-related difference in those values requires immediate reversion of the move.

---

## 24. Commit discipline — LOCKED

Each commit has one clear purpose.

Do not mix:

- structure and model behavior
- file movement and logic changes
- provider normalization and ranking
- persistence and probability changes
- UI redesign and model work

A file move commit contains only file moves and import-path updates. No cleanup, renaming, refactoring, or logic improvement may be hidden inside it.

---

## 25. Goal-conflict escalation — LOCKED

If a project rule, architecture boundary, workflow, source restriction, or implementation decision appears to reduce ranking correctness, undermine side awareness, prevent modular ownership or complete removal, require contradictory models, create hidden fallbacks, or materially waste work without protecting correctness, stop the affected work and tell the user.

State:

1. the exact conflicting rule or decision
2. the evidence
3. the practical impact
4. the smallest proposed correction
5. whether project rules, math specification, architecture, or code must change

Do not blindly obey the conflict and do not silently ignore it.

---

## 26. Canonical-source change and synchronization process — LOCKED

### Approved revisions

When either canonical source needs revision:

1. identify the exact statement at issue
2. show the evidence and practical impact
3. propose exact replacement language or formula
4. obtain approval
5. update the complete canonical source before code
6. increase that document's own version
7. add a dated changelog entry
8. provide the complete updated file using the exact canonical filename
9. verify the delivered file is byte-for-byte identical to the approved repository copy
10. update implementation second
11. add or update a focused regression test
12. run it and report the result

No silent source changes. Do not provide only a patch, excerpt, diff, or summary when a complete canonical replacement is required.

### Zero-tolerance mismatch recovery

At every preflight, and before any technical decision or repository work, read the complete Project Source copies and the complete repository copies of:

- `PROJECT_RULES.md`
- `CANONICAL_MATH_SPEC.md`

Compare the exact canonical filename, internal version, dated changelog, complete content, and content hash. A filename suffix, upload label, PR description, prior response, summary, or memory is not proof of identity.

When a mismatch is discovered:

1. stop the affected work immediately
2. identify which copy is stale using complete-content and hash evidence
3. do not merely report that the files differ
4. immediately provide the user the complete confirmed-current replacement file using the exact canonical filename
5. state the stale copy's version and hash and the replacement copy's version and hash
6. verify the delivered replacement is byte-for-byte identical to the confirmed-current authority
7. do not continue dependent work until the complete replacement has been delivered

If the confirmed-current authority cannot be determined, stop and identify the exact ambiguity. Never guess, reconstruct from memory, combine versions, relabel an older file as current, or deliver a file whose complete content and hash were not verified.

The active repository may contain only one canonical path for each authority file:

- `/PROJECT_RULES.md`
- `/CANONICAL_MATH_SPEC.md`

Do not create or retain active suffixed, renamed, backup, generated, or duplicate canonical copies in the repository. Historical Git commits may retain earlier versions, but they are not active authority. An active branch whose canonical copy is stale may not be merged or used as preflight authority until it is synchronized.

---

## 27. Execution, communication, and access — LOCKED

Use GitHub directly whenever it saves time for repository inspection, file creation, edits, commits, pull requests, and available CI evidence.

Use Replit only for secrets, live runtime, browser/session access, environment-specific verification, or public-link checks.

When the user must act, give one exact next action.

Do not impose time estimates, daily caps, or artificial stopping points. Continue the approved sequence until the task passes its evidence gate, the user stops, or a real boundary is reached.

Do not promise background work or future completion.

---

## 28. Project placement — LOCKED

Canonical complete files belong in Project Sources:

- `PROJECT_RULES.md`
- `CANONICAL_MATH_SPEC.md`

Standing project directives belong in the Project Instructions field as one complete copyable replacement.

There is no separate Project Knowledge deliverable.

---

## Changelog

### Version 2.1 — 2026-07-26

- Added zero-tolerance canonical mismatch recovery requiring immediate delivery of the complete confirmed-current replacement file instead of merely reporting divergence.
- Required exact filename, internal version, changelog, complete-content, and content-hash verification before claiming canonical synchronization.
- Prohibited active suffixed, renamed, backup, generated, or duplicate canonical copies and blocked stale authority copies from merge or preflight use.
- Clarified that historical Git commits may retain earlier versions but are not active authority.

### Version 2.0 — 2026-07-23

- Established `Derkmane/mlb-prop-analyzer-v3` as the only active repository.
- Replaced migration-first planning with a clean modular-monolith foundation while preserving verified mathematics and product requirements.
- Locked strict TypeScript, runtime schema validation, dependency-cruiser boundaries, feature public entrypoints, and no empty future-feature folders.
- Separated markets from product categories and centralized settlement and ranking in core.
- Added single-source market-key ownership across feature manifests and the planned-market catalog.
- Added fail-closed feature disable/removal rules and historical rendering independent of active features.
- Required provider evidence and sanitized fixtures before provider-derived contracts.
- Added the early terminal-PA and lineup capability gate.
- Preserved H+R+RBI and Pitcher Strikeouts as planned markets with their required mathematical families.
- Added detailed failure classification and repeated-failure structural escalation.
- Prohibited daily caps and time estimates from controlling project execution.

### Version 1.4 — 2026-07-22

- Established the side-aware Golden Rule and current-season-only V2 foundation.
