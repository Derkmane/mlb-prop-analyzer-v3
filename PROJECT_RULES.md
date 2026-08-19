# MLB Prop Analyzer --- Project Rules

**Version:** 2.14\
**Status:** Canonical project rules\
**Applies to:** MLB Prop Analyzer V3\
**Repository:** `Derkmane/mlb-prop-analyzer-v3`

------------------------------------------------------------------------

## 1. Authority and purpose

This file controls project scope, approved data sources, architecture,
workflow, approvals, testing, delivery, and change control.

`CANONICAL_MATH_SPEC.md` controls probability mathematics, statistical
definitions, model-family requirements, settlement calculations,
calibration requirements, and mathematical tests.

Neither file may silently override the other. If they appear to
conflict, stop the affected work, show the conflict and practical
impact, and propose the smallest correction.

------------------------------------------------------------------------

## 2. Rule levels

Every rule is one of three types.

### LOCKED

A hard boundary that may change only through the canonical-source change
process and explicit user approval.

### DEFAULT

The approved starting strategy. It must be tested and may be changed
when evidence shows it is wrong, inefficient, contradictory, or harmful.

### OPEN

Not yet decided. Research, testing, and a recommendation are required
before implementation.

When a rule is not labeled, treat it as DEFAULT unless it is clearly
stated as LOCKED.

------------------------------------------------------------------------

## 3. Active repository boundary --- LOCKED

The only active working repository is:

`Derkmane/mlb-prop-analyzer-v3`

Do not inspect, modify, test, commit to, or otherwise work in another
repository unless the user explicitly approves one narrow read-only
reference purpose.

`Derkmane/mlb-prop-analyzer-v2` may remain available as read-only
historical reference material, but it is not the active implementation
and is not a source of truth for V3 architecture.

Carry forward:

-   verified mathematics
-   approved test vectors
-   product requirements
-   provider observations that are clearly documented and reverified
-   lessons learned

Do not automatically copy or port V2 application code, architecture,
schemas, mappings, dependencies, or workflows. Any reuse of an
implementation artifact requires a specific reason, evidence that it is
still correct, and explicit approval.

No file may be written, edited, committed, or deleted in another
repository during V3 work.

------------------------------------------------------------------------

## 4. Current-task containment --- LOCKED

Work only on the exact assigned task.

Do not silently expand into unrelated:

-   audits
-   debugging
-   refactoring
-   cleanup
-   dependency upgrades
-   architecture changes
-   UI redesign
-   source changes
-   mathematical changes
-   migrations
-   rebuilds
-   checklist items

Report unrelated findings briefly and leave them untouched unless they
directly block the approved task.

Destructive deletion, rollback, repository replacement, migration, or
reconstruction requires an evidence-based proposal and explicit
approval.

------------------------------------------------------------------------

## 5. Golden Rule and product objective --- LOCKED

The app analyzes Underdog MLB pregame player props.

The sole product objective is to identify, within each approved
category, the eligible posted Higher or Lower picks with the highest
true probability that the **selected side wins**.

The governing ranking quantity is:

`P(Win | grades)`

Primary sort:

1.  `P(Win | grades)` descending
2.  `P(Void)` ascending as the tiebreak

The app is not trying to identify players who will perform well. It is
trying to identify posted Higher or Lower sides most likely to win.

Every prop must preserve:

-   player
-   event and game identity
-   market
-   line
-   selected side
-   official settlement statistic
-   `P(Win)`
-   `P(Loss)`
-   `P(Void)`
-   `P(Win | grades)`
-   model and settlement-rule versions

For Higher, upward distribution shifts may help and downward shifts must
hurt. For Lower, downward shifts may help and upward shifts must hurt.

No multiplier, hidden booster score, risk score, player reputation,
excitement, player-quality label, or side preference may alter ranking
outside the approved probability model.

Every technical subtask must directly improve, validate, protect, or
display side-aware probability, eligibility, workload, distribution
construction, settlement, calibration, reproducibility, category
ranking, saved predictions, or grading.

### Side-aware soft-line discovery --- LOCKED

A **soft line** is an exact posted Underdog offer whose selected side and
line produce favorable side-specific probability under an approved,
versioned base baseball distribution and discovery rule.

Rules:

-   a line may be soft to Higher because it is posted too low relative
    to the modeled distribution
-   a line may be soft to Lower because it is posted too high relative
    to the modeled distribution
-   every exact posted Higher or Lower offer is evaluated on its own
    selected side and line; neither side receives preference
-   expected player output, fair-line distance, price, or multiplier may
    be preserved as evidence or metadata but may not replace exact
    side-and-line settlement probability
-   the base soft-line probability and discovery decision are
    preliminary evidence, not the final ranking probability
-   every later approved context factor must act through eligibility,
    workload, shared scenarios, or the statistic distribution; the app
    must then recompute and resettle the exact posted side and line
-   the final context-adjusted `P(Win | grades)` is the only probability
    used for category ranking
-   base softness margin, context probability delta, multiplier, and
    discovery labels may not independently alter final ranking
-   a hard discovery cutoff may exclude offers from complete context
    evaluation only after chronological current-season validation shows
    that the cutoff preserves the strongest final-probability
    candidates at the approved recall standard
-   until that validation exists, discovery must be an audit label, a
    broad high-recall screen, or both; it may not silently discard an
    offer that could become one of the strongest final picks

The base distribution, discovery method, final context-adjusted
distribution, and all corresponding versions must remain distinct and
auditable whenever this two-stage process is used.

------------------------------------------------------------------------

## 6. Product structure --- LOCKED

The app has exactly three categories:

1.  Opportunity Miner Favorites
2.  High Probability Baseline Props
3.  High Probability Altline Props

Rules:

-   one prop per player per category
-   overlap across categories is allowed
-   Top Five means the first five eligible picks after approved sorting
-   pregame only; started games are excluded
-   selected side, line, market, and settlement statistic must survive
    ranking, display, saving, and grading
-   categories may filter, deduplicate, sort, and select
-   categories may not modify probabilities
-   the user builds their own entries

A market and a category are different objects. Batter Hits is a market
feature. High Probability Altline Props is a category selector.

### Projected lineup treatment --- LOCKED

Before an official confirmed lineup is available, the app must use its
current approved projection of the starting players and batting order as
the active lineup assumption.

Rules:

-   a projected starter is treated as starting for model construction
    until confirmed information replaces the projection
-   a projected batting order is treated as the active batting order
    until the official lineup posts
-   projected status by itself may not reduce the modeled statistic
    distribution, `P(Win)`, `P(Win | grades)`, eligibility, category
    access, ranking position, or confidence
-   projected status by itself may not increase `P(Void)` or apply a
    start-probability multiplier, uncertainty discount, hidden penalty,
    or side-independent risk score
-   the projected and confirmed versions of an otherwise identical
    lineup must produce identical model distributions and probabilities;
    only source metadata may differ
-   when the official lineup becomes available, it atomically replaces
    the projection and the affected predictions are recomputed from the
    confirmed players and batting order
-   projected starters and batting order must come from an approved,
    versioned, current-season evidence path; the projection method must
    be validated separately, but projection status is not a probability
    penalty
-   projection accuracy, coverage, exact-slot accuracy, and
    projected-versus-confirmed replacement rates may be measured, saved,
    and displayed as diagnostic evidence, but those diagnostics may not
    reduce `P(Win)`, `P(Win | grades)`, eligibility, category access,
    ranking, or confidence or increase `P(Void)` solely because the
    active lineup is projected
-   only an actual change in player identity, batting order, opposing
    starter, or another approved baseball input may change the modeled
    distribution when confirmed information replaces the projection
-   a player who is neither projected nor confirmed to start may not be
    treated as a starting hitter merely because an offer exists

------------------------------------------------------------------------

## 7. Approved production sources --- LOCKED

Only these sources may supply production baseball or board data:

### The Odds API

Used for:

-   Underdog board data
-   verified baseline markets
-   verified alternate markets
-   provider offer identity
-   posted side and line

### BALLDONTLIE MLB API

Used for verified available MLB data including:

-   teams
-   players
-   games
-   schedules
-   confirmed current-game lineups
-   statistics
-   plate appearances
-   plays
-   current-season information exposed by the approved API

For lineup resolution, an exact BALLDONTLIE current-game batting-order
row has precedence over every other lineup source.

### MLB Stats API (`statsapi.mlb.com`)

Approved only for pregame posted current-game starting-player and
batting-order evidence when BALLDONTLIE does not expose an exact
current-game lineup row for that player.

Rules:

-   use only verified MLB Stats API schedule/lineup response fields
-   preserve the MLB Stats API game, player, batting-order, capture-time,
    and source-snapshot lineage used for a confirmed posted slot
-   do not use MLB Stats API performance statistics, probabilities,
    prices, settlement data, or other model inputs under this approval
-   a unique MLB Stats API posted lineup slot is confirmed lineup evidence,
    not projected lineup evidence
-   MLB Stats API posted lineup evidence may not overwrite an exact
    BALLDONTLIE current-game batting-order row
-   a unique MLB Stats API posted lineup slot has precedence over
    user-supplied projected lineup evidence

### User-supplied projected lineup evidence

Approved only as an optional pregame current-day projection source when the
user deliberately supplies lineup evidence for the active MLB regular-season
slate, including a structured transcription of a user-provided lineup
screenshot.

Rules:

-   user-supplied projected lineup evidence is optional; its absence may not
    disable, block, or otherwise change the normal BALLDONTLIE and MLB Stats
    API lineup path
-   it may supply only projected starting-hitter identity, team, and batting
    order under this approval; it may not supply performance statistics,
    probabilities, prices, settlement data, or other model inputs
-   every imported projection must preserve the active slate date, declared
    source label, import timestamp, immutable source-evidence identity or hash,
    and the structured player, team, and batting-order rows actually used
-   every accepted user-supplied row has lineup status `projected`
-   exact BALLDONTLIE current-game evidence has first precedence; a unique MLB
    Stats API posted lineup has second precedence; user-supplied projected
    lineup evidence is used only when neither confirmed source supplies that
    player's unique current-game slot
-   confirmed evidence atomically replaces a user-supplied projection and the
    affected prediction is recomputed from the confirmed player and batting
    order
-   ambiguous, malformed, wrong-date, wrong-game, or wrong-team user-supplied
    projection evidence fails closed for the affected row and may not leak into
    another game or date
-   a user-supplied screenshot may be transcribed only from evidence the user
    deliberately provided; this approval does not authorize autonomous browser
    scraping or browser capture
-   projection status alone may not change probability, eligibility, void,
    confidence, category access, or ranking, consistent with Section 6

If neither BALLDONTLIE current-game evidence, MLB Stats API posted-lineup
evidence, nor a unique approved user-supplied projected lineup supplies a slot
for the player, fail closed for that capture attempt, leave the game eligible
for a later scheduled capture, and do not inherit a batting order from an
earlier game.

Not allowed without explicit approval:

-   scraping or autonomous browser capture
-   browser-captured production data except the deliberately user-supplied
    projected-lineup evidence defined above
-   silently substituted providers
-   invented endpoints, fields, schemas, parameters, coefficients, or
    availability
-   web-search player, team, league, game, park, or board statistics

Technical references may support methods but may not supply production
prediction data.

------------------------------------------------------------------------

## 8. API evidence before provider-derived contracts --- LOCKED

Never assume API keys, endpoints, parameters, response schemas, date
formats, statuses, pagination, market names, current-season coverage, or
field availability.

Before defining provider-derived contracts or implementing provider
adapters:

1.  verify real API access
2.  capture representative raw responses
3.  sanitize and preserve fixtures
4.  document actual JSON paths and observed quirks
5.  create a capability matrix
6.  define normalized contracts from that evidence

Pure domain types that come from the product and mathematics may be
defined earlier. Provider-shaped contracts may not be invented from
memory.

If required data is unavailable:

1.  stop the affected model work
2.  identify the exact missing field
3.  identify the model component it blocks
4.  present lawful options
5.  obtain approval before changing the source policy or mathematical
    design

Known BALLDONTLIE observations must be recorded in
`docs/providers/balldontlie-quirks.md` and reverified with V3 fixtures.

------------------------------------------------------------------------

## 9. Current-season-only production evidence --- LOCKED

Only the active MLB regular season may supply player, team, or league
performance observations used for production fitting, pooling,
calibration, validation, or prediction.

Do not use:

-   prior seasons
-   career statistics
-   Marcel or other multi-season estimators
-   prior-season priors or regression targets
-   age curves derived from prior seasons

Current-season chronology must separate fitting, validation, and
untouched testing. When evidence is insufficient, label the component
insufficient or not yet production-validated. Do not fill the gap with
older seasons.

Archive raw Underdog boards prospectively because earlier board
environments cannot be reconstructed from box scores alone.

------------------------------------------------------------------------

## 10. Modular-monolith architecture --- LOCKED

V3 begins as one repository and one deployable application with enforced
internal module boundaries.

The approved layers are:

### `composition`

The only layer allowed to assemble the complete application, registries,
providers, persistence, entrypoints, categories, and enabled features.

### `domain`

Pure product and baseball concepts. It may not import adapters, UI,
persistence, or feature implementations.

### `core`

Pure deterministic cross-market logic including probability operations,
settlement, side-aware ranking, validation, determinism, and
canonicalization.

Settlement and ranking belong in core and may not be reimplemented per
feature.

### `application`

Use-case orchestration. It coordinates ports and domain operations
without owning provider details.

### `game`

The one shared game, lineup, offensive-environment, opportunity, and
workload scenario system used by all markets from the same game.

### `features`

Implemented market features only. No empty future-feature folders.

### `categories`

Opportunity Miner, Baseline, and Altline eligibility and selection
logic. Categories may not alter probability.

### `historical`

Read-only interpretation and rendering of immutable saved predictions.
It may not depend on active feature implementation code.

### `adapters`

Provider, persistence, HTTP, CLI, UI-facing, clock, and logging
adapters. Raw provider objects may not leak past adapter normalization
boundaries.

There is no generic `shared` dumping ground.

------------------------------------------------------------------------

## 11. Information flow --- LOCKED

Approved flow:

``` text
raw provider response
→ immutable raw snapshot
→ runtime-validated provider schema
→ normalized contracts
→ shared GameScenarioSet
→ market feature statistic distribution and eligibility
→ when used, versioned side-aware base discovery evidence and validated
  context-adjusted final distribution
→ core settlement and final side-aware probabilities
→ generic candidate
→ category selection and ranking
→ immutable saved run
→ API, CLI, and UI view models
```

Layers may not bypass this flow.

Examples:

-   UI may not call BALLDONTLIE directly.
-   Infrastructure may not rank candidates.
-   Categories may not change `P(Win)`.
-   Soft-line discovery may not replace or bypass the validated final
    context model.
-   Base discovery probability, context probability delta, and
    multiplier may not replace final `P(Win | grades)` in ranking.
-   Features may not create arbitrary saved-run formats.
-   Historical rendering may not rerun the current production model.

------------------------------------------------------------------------

## 12. Shared game and workload correctness --- LOCKED

One shared game and workload model must drive all props from the same
game.

Markets may not use contradictory assumptions about:

-   lineup
-   home and away state
-   game environment
-   starter workload
-   bullpen transition
-   team batters faced
-   scenario weights
-   game length, postponement, or suspension state

Existing canonical cross-market concepts are never duplicated merely
because fewer than three features currently consume them.

New ordinary helper abstractions should normally not move into a shared
location until three separate features genuinely require them.

------------------------------------------------------------------------

## 13. Feature ownership and public boundaries --- LOCKED

A feature folder is created only when active implementation of that
market begins.

Each feature owns its market-specific:

-   normalized input requirements
-   official-statistic distribution builder
-   eligibility logic
-   feature-specific explanation data
-   feature-specific persisted fields
-   feature-specific presentation
-   tests
-   public `index` entrypoint

A feature may import another feature only through that feature's public
`index` entrypoint. Reaching into another feature's internal files is
prohibited.

A feature may not:

-   fetch provider data directly
-   own generic settlement or category ranking
-   silently fall back to another model
-   write to arbitrary persistence paths
-   bypass shared game scenarios

------------------------------------------------------------------------

## 14. Feature manifest --- LOCKED

Each implemented feature has a small manifest containing only
identifiers static analysis cannot reliably discover:

-   feature ID
-   market keys
-   storage keys
-   API route paths
-   feature-specific saved-prediction field names

Generic shared fields such as player, market, line, selected side,
probabilities, model version, and settlement version belong to no single
feature.

The folder and code are the record of files, exports, UI components,
dependencies, tests, and commands. Do not duplicate that information in
a large hand-maintained manifest.

------------------------------------------------------------------------

## 15. Market-key ownership and statuses --- LOCKED

Every market key has exactly one canonical declaration.

For an implemented market, the feature manifest owns and exports its
market keys. The feature registry and market registry consume those
exported constants.

For a planned market without an implementation folder, the
planned-market catalog owns and exports its keys.

When implementation begins, ownership transfers from the planned-market
catalog to the feature manifest in one commit, and the old declaration
is removed in that same commit.

No handwritten second copy is allowed.

Preferred status progression:

``` text
PLANNED
→ DATA UNDER INVESTIGATION
→ MODEL UNDER DEVELOPMENT
→ VALIDATION
→ PRODUCTION ENABLED
```

Not yet production-validated does not mean abandoned.

Hits + Runs + RBIs is the primary V1 market. It must be
investigated for approved-source data sufficiency and modeled
under an approved family recorded in the CANONICAL_MATH_SPEC.md
Section 12.2 registry. Its active family is Family B, the
directly fitted composite distribution defined in
CANONICAL_MATH_SPEC.md Section 8.3.2. Family A, the
tagged-player base-out joint model, remains approved and may
later replace Family B through the normal canonical revision
process.

Batter Runs is a V1 market under the same Family B assignment.

Under either family, constructing Hits + Runs + RBIs by
convolving independent Hits, Runs, and RBI marginal
distributions is prohibited.

CANONICAL_MATH_SPEC.md controls model-family requirements. Where
this document names a specific family for a market, it is a
pointer to the registry, not an independent authority.

Pitcher Strikeouts remains an intended market and requires the canonical
sequential joint workload-and-outcome process. It may not use the hitter
opportunity-mixture shortcut.

Batter Hits is the first intended production vertical slice.

------------------------------------------------------------------------

## 16. Feature enable, disable, and removal --- LOCKED

The central feature registry owns **production** enable/disable state.

Disabling a feature in the production registry must fail closed for the
production path:

-   no new production prediction
-   no production category eligibility
-   no production ranking
-   no silent fallback to old, audit, deprecated, generic,
    implied-probability, or side-independent logic

A production-disabled feature may participate only in the separately
versioned **research-ranking** path defined in Section 18 when every
Section 18 research-ranking requirement is satisfied. Research ranking
must not change production enablement or make a disabled feature
available to the production prediction path.

Removal procedure:

1.  disable the feature in the registry
2.  verify no new production prediction can use it
3.  run architecture checks and the full behavior suite
4.  resolve or explicitly document hidden dependencies
5.  remove the feature folder and registry entry
6.  run dependency-cruiser, type checking, and tests
7.  search active production code for every feature-manifest identifier
8.  confirm historical predictions still load and render without active
    feature code

Zero identifier matches are required in active production code only.
Matches may remain in immutable saved records, historical fixtures, and
explicitly isolated historical compatibility code.

Historical records are never rewritten merely because a feature is
removed.

------------------------------------------------------------------------

## 17. Dependency and type enforcement --- LOCKED

V3 uses strict TypeScript.

Type checking, runtime schema validation, dependency-cruiser, registry
tests, and deletion-time identifier searches protect different
dependency classes and must work together.

Dependency-cruiser must enforce:

-   one-directional layer rules
-   no feature-internal cross-imports
-   no circular dependencies
-   no unresolved imports
-   historical isolation from active features
-   domain and core isolation from external adapters

Orphan reports require review and are not automatic deletion
instructions. CLI entrypoints, verification scripts, migrations, and
test helpers may legitimately appear orphaned.

Do not create a custom feature-impact application when standard
dependency analysis is sufficient.

------------------------------------------------------------------------

## 18. Mathematical authority, research ranking, and production readiness --- LOCKED

All displayed probability calculations must follow
`CANONICAL_MATH_SPEC.md`.

**Research ranking** and **production-calibrated probability authorization**
are separate states.

### Research ranking

A real pregame prop may appear in the three product categories as
**UNVALIDATED RESEARCH** when all of the following are true:

-   the market is implemented and the exact posted offer comes from an
    approved production board source
-   the prediction uses a frozen or otherwise explicitly versioned
    current-season fitted distribution already preserved by the repository
    or a committed archive path
-   runtime probability evaluation is deterministic and exact under the
    declared model
-   a versioned market-specific settlement rule and eligibility event are
    available
-   the exact posted Higher or Lower side and line are settled through the
    generic side-aware settlement path
-   category ordering remains `P(Win | grades)` descending, then `P(Void)`
    ascending
-   any known calibration, distribution-shape, sample-sufficiency, or
    validation failure is preserved and surfaced where corresponding
    evidence exists

Research ranking does not assert that the displayed probability is
calibrated, production-valid, or a validated estimate of true win
probability. Every probability displayed through the research-ranking path
must be visibly labeled **UNVALIDATED RESEARCH**. A known failed cohort may
remain visible for research ranking only if the failure is displayed; it may
not be relabeled as passing, calibrated, or production-valid.

Research ranking may not use synthetic fixtures, an unfitted or unversioned
model, a rejected candidate that was never frozen or otherwise authorized for
archived evaluation, a deprecated model, a generic projection, raw implied
probability, a side-independent score, or another fallback. A failed or
insufficient calibration result never authorizes substitution of a different
line, model family, or probability source.

The central production feature enable/disable state continues to gate
production predictions. A separately versioned research-ranking admission
path may read eligible versioned or committed archived research outputs
without changing production enablement. It must not silently convert a
disabled feature into a production-enabled feature.

### Production calibration and production-valid probability claims

No real prop may be presented as a production-calibrated prediction, and no
displayed probability may be described as calibrated or production-valid,
until its distribution builder, eligibility event, settlement rule,
current-season fit, chronological validation, and calibration status satisfy
all canonical production requirements.

Synthetic fixtures may be used for architecture and mathematical tests but
must be unmistakably synthetic and may never appear as real research-ranked
or production predictions.

Baseline and alternate offers for the same statistic use the same
official-statistic distribution and differ only through posted offer
attributes and settlement.

------------------------------------------------------------------------

## 19. Early BALLDONTLIE capability gate --- LOCKED

The first provider investigation must explicitly determine whether
approved BALLDONTLIE responses can support the canonical terminal
plate-appearance vector and hitter opportunity model.

It must verify whether raw events can distinguish the required terminal
categories, including walk types, hit types, reached-on-error, fielder's
choice, sacrifices, other outs, catcher interference, and other terminal
PA results.

It must also verify lineup position, opportunity order, batter and
pitcher identity, handedness where required, and game-state fields
needed by the model.

If the source cannot support a required distinction, do not silently
merge categories or pretend the current specification was implemented.
Stop and propose a source-supported mathematical correction or another
approved option.

------------------------------------------------------------------------

## 20. Build order --- DEFAULT

Use this evidence-driven order unless a documented blocker justifies a
proposed change:

1.  create and approve V3 authority files
2.  create the strict TypeScript modular scaffold
3.  enforce architecture boundaries and CI gates
4.  verify The Odds API and BALLDONTLIE access
5.  capture and sanitize representative provider fixtures
6.  complete the Batter Hits capability matrix
7.  define provider-derived contracts from captured evidence
8.  implement verified deterministic core mathematics
9.  implement registries, fail-closed behavior, and historical
    independence
10. implement the shared game and hitter opportunity foundation
11. create a synthetic removable Batter Hits vertical slice
12. fit, version, and validate current-season models
13. enable research ranking only through Section 18's research gate; enable
    production-calibrated real-prop output only after all production
    acceptance gates pass
14. implement complete categories, saved-run workflows, grading, API/UI
    presentation, and deployment

Do not impose daily caps or time estimates. Continue through the
verified sequence until the user chooses to stop or an approval, access,
secret, evidence, or runtime boundary is reached.

------------------------------------------------------------------------

### Single-source implementation and cleanup --- LOCKED

For every logical component, there must be exactly one active
implementation.

-   Before creating a new implementation file, search for an existing
    implementation of the same responsibility.
-   If an implementation is replaced, remove the old implementation in
    the same change.
-   Do not leave duplicate, backup, copied, suffixed, experimental, or
    generated implementations in the active repository.
-   Every responsibility has exactly one active source of truth.

### Artifact cleanup --- LOCKED

-   Temporary artifacts created during work must be removed before the
    task is complete.
-   Superseded generated outputs must be deleted instead of accumulated.
-   The repository must not retain stale generated artifacts that can be
    mistaken for active inputs.

### Replaceable modular architecture --- LOCKED

-   Modules own one responsibility behind a stable public interface.
-   Replacing a module should require edits only at documented
    integration points.
-   Components must be easy to delete and rebuild without widespread
    code changes.

------------------------------------------------------------------------

## 21. Testing intent and failure classification --- LOCKED

Before running a test or diagnostic, state the expected result and what
that result would prove.

### Expected or protective failure

A deliberate rejection proves a guardrail works. Examples include
disabled-market rejection, invalid probability rejection,
forbidden-import rejection, started-game exclusion, or a planned red
test before implementation.

An expected protective failure is a successful test outcome and does not
count toward repeated-failure escalation.

### Diagnostic finding

A read-only diagnostic may expose a missing field, incorrect assumption,
broken dependency, or unsupported schema. It is not a failed
implementation attempt because no corrective edit was attempted.

### Failed implementation attempt

A code, configuration, schema, or mapping edit counts as a failed
implementation attempt when the defined target still fails, the defect
remains, a regression is created, approved output changes unexpectedly,
or the result cannot be verified.

A single edit that fails multiple checks counts as one implementation
attempt.

### Regression

A regression breaks behavior that was directly verified before the edit.
The attempted change must normally be reverted and counts as one failed
implementation attempt against the affected file or component.

### Test or fixture defect

When production behavior appears correct but the test, fixture, expected
value, mock, or harness is wrong, classify the defect against the test
infrastructure. Do not change expected values merely to make tests pass
without evidence that the earlier expectation was wrong.

### External or environmental failure

Missing secrets, provider outages, rate limits, network problems,
installation failures, or unrelated CI/runtime failures do not count as
implementation failures against production code. Report the access or
environment boundary honestly.

------------------------------------------------------------------------

## 22. Repeated-failure structural reassessment and continued resolution --- LOCKED

Mandatory structural reassessment is triggered when either occurs:

1.  two failed implementation attempts affect the same file or component
    in one working session, regardless of whether the diagnosed causes
    appear different
2.  approximately 90 minutes of active corrective work have been spent
    on the same unresolved component after the first unexpected failure

Expected protective failures, planned red tests, passive waiting,
unrelated work, diagnostics without edits, and external/environmental
failures do not count.

After the trigger:

-   stop blind, incremental, or assumption-driven patching of the
    affected file or component
-   do not repeat the same implementation approach or make another
    unexamined patch
-   continue working on the same unresolved issue
-   report what each failed attempt proved
-   complete read-only investigation of the affected component,
    upstream inputs, downstream consumers, schemas, tests, artifacts,
    boundaries, and dependencies
-   reassess assumptions, ownership, interfaces, responsibilities, and
    the full dependency chain
-   select one evidence-based structural direction
-   execute that structural direction through its focused verification
    gate unless the user stops or a real evidence, access, secret,
    runtime, destructive-change approval, canonical-change approval, or
    other explicit authorization boundary is reached
-   never end the workflow with only a failure report when another
    diagnostic or corrective step can be performed with available tools
-   when user action is required, provide exactly one concrete next
    action that advances the same issue

Allowed structural directions:

-   redesign the interface or boundary
-   split an overloaded component
-   replace the faulty component
-   revert to the last verified state
-   delete and reconstruct the component
-   perform a broader coherent correction across the complete affected
    dependency chain instead of continuing microscopic patches

Read-only investigation is required when necessary to choose the
structural direction. It is not a reason to stop working.

The trigger prohibits a third blind patch; it does not prohibit a
structurally redesigned implementation attempt after the full
reassessment.

Destructive deletion, rollback, replacement, or reconstruction remains
subject to the approval requirements elsewhere in these rules. Deletion
is never automatic.

------------------------------------------------------------------------

## 23. Determinism and saved records --- LOCKED

Identical versioned inputs must produce identical outputs.

Every saved prediction must preserve or reference:

-   model version
-   math-spec version
-   project-rules version
-   provider snapshot identifiers or hashes
-   normalized-data version
-   model-artifact versions
-   settlement-registry version
-   configuration version
-   timestamps
-   selected side and line
-   scenario weights
-   opportunity distributions
-   base statistic distribution and base side-specific probabilities
    when soft-line discovery is used
-   soft-line discovery method and version when soft-line discovery is
    used
-   final context-adjusted statistic distribution
-   final context-model and factor-artifact versions
-   context probability delta when it is reported
-   `P(Win)`, `P(Loss)`, `P(Void)`, and `P(Win | grades)`

Saved predictions and runs are immutable.

Historical rendering must work without importing the active feature
implementation. Feature-specific historical data must be isolated inside
a versioned envelope, while generic display and grading data remain
readable.

Raw JSON identity metadata may be canonicalized for migration
verification, but exact equality is required for scenario weights,
opportunity distributions, final distributions, eligibility probability,
all win/loss/void values, ranking order, selected side, line, and
settlement statistic.

Any migration-related difference in those values requires immediate
reversion of the move.

------------------------------------------------------------------------

## 24. Commit discipline --- LOCKED

Each commit has one clear purpose.

Do not mix:

-   structure and model behavior
-   file movement and logic changes
-   provider normalization and ranking
-   persistence and probability changes
-   UI redesign and model work

A file move commit contains only file moves and import-path updates. No
cleanup, renaming, refactoring, or logic improvement may be hidden
inside it.

------------------------------------------------------------------------

## 25. Goal-conflict escalation --- LOCKED

If a project rule, architecture boundary, workflow, source restriction,
or implementation decision appears to reduce ranking correctness,
undermine side awareness, prevent modular ownership or complete removal,
require contradictory models, create hidden fallbacks, or materially
waste work without protecting correctness, stop the affected work and
tell the user.

State:

1.  the exact conflicting rule or decision
2.  the evidence
3.  the practical impact
4.  the smallest proposed correction
5.  whether project rules, math specification, architecture, or code
    must change

Do not blindly obey the conflict and do not silently ignore it.

------------------------------------------------------------------------

## 26. Canonical-source change and synchronization process --- LOCKED

### Approved revisions

When either canonical source needs revision:

1.  identify the exact statement at issue
2.  show the evidence and practical impact
3.  propose exact replacement language or formula
4.  obtain approval
5.  update the complete canonical source before code
6.  increase that document's own version
7.  add a dated changelog entry
8.  provide the complete updated file using the exact canonical filename
9.  verify the delivered file is byte-for-byte identical to the approved
    repository copy
10. update implementation second
11. add or update a focused regression test
12. run it and report the result

No silent source changes. Do not provide only a patch, excerpt, diff, or
summary when a complete canonical replacement is required.

### Mandatory repository replacement and cleanup

Whenever a canonical authority file changes, the old active repository
copy must be removed and replaced in the same repository change by the
complete approved new file at the same exact canonical path. Updating a
Project Source without replacing the repository copy is incomplete and
may not be reported as synchronized.

For every canonical revision:

1.  replace the full active repository file; do not leave the old active
    bytes in place
2.  preserve only the exact canonical filename and path
3.  delete every stale, suffixed, renamed, backup, copied, generated, or
    duplicate active repository copy of that authority
4.  search the active repository tree for obsolete copies before
    claiming completion
5.  verify the replacement file is complete and present at the exact
    canonical path in the active repository
6.  do not continue dependent work, open merge approval, or claim the
    revision complete until replacement, cleanup, and identity
    verification all pass

Historical Git commits may retain prior versions as history. No prior
version may remain as an active repository file or alternate authority.
This replacement-and-cleanup rule applies to every canonical authority
revision and to every other repository component or artifact that is
explicitly replaced: remove the superseded active copy in the same
change unless a canonical retention rule requires it to remain.

### Zero-tolerance mismatch recovery

The active repository is the sole authority for canonical files. No
local, uploaded, cached, or Project Source copy is authority, and no
synchronization between copies is required or permitted as a gate. At
every preflight, and before any technical decision or repository work,
read the complete active repository copies of:

-   `PROJECT_RULES.md`
-   `CANONICAL_MATH_SPEC.md`

Compare the exact canonical filename, internal version, dated changelog,
complete content, and content hash. A filename suffix, upload label, PR
description, prior response, summary, or memory is not proof of
identity.

When a mismatch is discovered:

1.  stop the affected work immediately
2.  identify which copy is stale using complete-content and hash
    evidence
3.  do not merely report that the files differ
4.  immediately provide the user the complete confirmed-current
    replacement file using the exact canonical filename
5.  state the stale copy's version and hash and the replacement copy's
    version and hash
6.  verify the delivered replacement is byte-for-byte identical to the
    confirmed-current authority
7.  do not continue dependent work until the complete replacement has
    been delivered

If the confirmed-current authority cannot be determined, stop and
identify the exact ambiguity. Never guess, reconstruct from memory,
combine versions, relabel an older file as current, or deliver a file
whose complete content and hash were not verified.

The active repository may contain only one canonical path for each
authority file:

-   `/PROJECT_RULES.md`
-   `/CANONICAL_MATH_SPEC.md`

Do not create or retain active suffixed, renamed, backup, generated, or
duplicate canonical copies in the repository. Historical Git commits may
retain earlier versions, but they are not active authority. An active
branch whose canonical copy is stale may not be merged or used as
preflight authority until it is synchronized.

------------------------------------------------------------------------

## 27. Execution, communication, and access --- LOCKED

### Codex-first repository execution

Use Codex for repository inspection, implementation, file creation,
edits, focused tests, diagnostics, CI review, commits, pushes, and pull
request work whenever the available Codex or GitHub capability can
perform the task.

Do not hand repository work back to the user as shell babysitting when
Codex or GitHub can perform it directly. Replit commands are a fallback
for work that genuinely requires the user's live Replit environment,
secrets, browser or session access, public-link checks, or runtime-only
evidence that Codex and GitHub cannot access.

Use GitHub directly whenever it saves time for repository inspection,
file creation, edits, commits, pull requests, and available CI evidence.

### Runtime and command safety

Python is prohibited for MLB Prop Analyzer V3 repository and Replit
execution. Do not install, invoke, probe for, or depend on `python`,
`python3`, `pip`, `pip3`, virtual environments, Python scripts, or
Python packages. Do not add Python tooling or dependencies to the
repository. A future Python exception requires explicit user approval
and a canonical Project Rules revision before any installation, command,
script, or dependency is introduced.

The project execution language remains strict TypeScript and Node.js.
Repository inspection, file creation, edits, transformations, commits,
pushes, pull requests, and CI review must be performed through Codex or
GitHub whenever those capabilities are available. When the assistant
has no such capability, the user may perform the edit directly in the
GitHub web editor or the Replit file editor; the assistant supplies
complete file content or exact find-and-replace text, never a script,
heredoc, or chained command.

A user-run Replit command may use only an executable already proven to
exist in this exact workspace by prior successful project output. The
established command set is limited to `git`, `node`, `npm`, and basic
non-interactive POSIX shell utilities already demonstrated in the
workspace. If an executable has not been proven available, do not place
it in a user command. Use Codex or GitHub instead, or stop at the exact
runtime boundary and obtain explicit approval before installation.

Never place required work after a command that may open an interactive
installation, confirmation, authentication, package-manager, or
environment prompt. A command given to the user must either be
non-interactive or stop before the prompt with the next action clearly
identified.

When a user-run command is genuinely required, keep it to the smallest
safe runtime-only action. Do not combine repository editing, generated
text replacement, commits, pushes, tests, and runtime verification into
one fragile chained command. Repository editing and delivery remain the
assistant's responsibility through Codex or GitHub.

Use Replit only for secrets, live runtime, browser/session access,
environment-specific verification, or public-link checks.

When the user must act, give one exact next action.

Do not impose time estimates, daily caps, or artificial stopping points.
Continue the approved sequence until the task passes its evidence gate,
the user stops, or a real boundary is reached.

Do not promise background work or future completion.

------------------------------------------------------------------------

## 28. Project placement --- LOCKED

Canonical complete files live only in the active repository at:

-   `PROJECT_RULES.md`
-   `CANONICAL_MATH_SPEC.md`

Standing project directives belong in the Project Instructions field as
one complete copyable replacement.

There is no separate Project Knowledge deliverable.

------------------------------------------------------------------------

## Changelog

### Version 2.14 — 2026-08-19

-   Approved deliberately user-supplied current-day projected lineup evidence,
    including structured transcription of user-provided lineup screenshots, as
    an optional projected-lineup source only.
-   Locked lineup-source precedence to exact BALLDONTLIE current-game evidence,
    then unique MLB Stats API posted-lineup evidence, then unique user-supplied
    projected-lineup evidence.
-   Required every user-supplied projection to remain `projected`, preserve
    date/source/import/row lineage, fail closed on ambiguous or mismatched rows,
    and be atomically replaced when confirmed evidence becomes available.
-   Prohibited user-supplied projection evidence from supplying performance
    statistics, probabilities, prices, settlement data, or other model inputs,
    and preserved the prohibition on autonomous scraping/browser capture.
-   Made user-supplied projections explicitly optional so absence never changes
    or blocks the normal approved-source path; preserved the existing rule that
    projection status itself cannot penalize probability, eligibility, void,
    confidence, category access, or ranking.
-   Made no mathematical, settlement, category, ranking, model-family,
    calibration, or production-enablement change.

### Version 2.13 — 2026-08-18

-   Separated explicitly labeled research ranking from production-calibrated
    probability authorization so versioned current-season research outputs may
    populate the three product categories without claiming calibration.
-   Required every research-ranked probability to display `UNVALIDATED
    RESEARCH` and required known calibration, distribution-shape,
    sample-sufficiency, and validation failures to remain visible where
    corresponding evidence exists.
-   Required research ranking to use approved board sources, a versioned
    current-season fitted distribution, deterministic exact evaluation, a
    versioned settlement/eligibility rule, exact side-and-line settlement, and
    the unchanged canonical ranking order.
-   Prohibited research ranking from using synthetic fixtures, unfitted or
    unversioned models, rejected unfrozen candidates, deprecated/generic/raw
    implied-probability fallbacks, or side-independent scores.
-   Preserved production feature disablement and every production calibration
    requirement for any claim that a probability is calibrated or
    production-valid; research ranking does not production-enable a feature.
-   Clarified Section 16 and the build-order wording only as necessary to keep
    the new research/production distinction internally consistent.

### Version 2.12 — 2026-08-17

-   Corrected the MLB Stats API classification after direct live evidence
    showed `schedule?hydrate=lineups` returns posted current-game lineup
    data when available rather than a dependable pregame projection feed.
-   Restricted MLB Stats API use to posted current-game starting-player
    and batting-order evidence when an exact BALLDONTLIE current-game row
    is absent, and classified a unique accepted MLB Stats slot as confirmed.
-   Preserved exact BALLDONTLIE current-game lineup precedence, source
    lineage, fail-closed behavior, and later scheduled retry when neither
    approved source supplies a unique current-game slot.
-   Added no projection model, confidence adjustment, third source,
    probability change, eligibility penalty, category change, or ranking
    change.

### Version 2.11 — 2026-08-15

-   Approved MLB Stats API (`statsapi.mlb.com`) only for pregame
    projected starting-player and batting-order evidence when an exact
    BALLDONTLIE current-game lineup row is absent.
-   Preserved BALLDONTLIE current-game lineup precedence and required
    MLB Stats projected evidence to preserve game, player, batting-order,
    capture-time, and source-snapshot lineage.
-   Prohibited MLB Stats API performance statistics or other model inputs
    under this source approval.
-   Removed authorization for inheriting a projected batting-order slot
    from an earlier game: when neither current BALLDONTLIE evidence nor
    MLB Stats projected evidence supplies a unique slot, lineup
    resolution fails closed.
-   Preserved projected status as display-only metadata with no
    probability, eligibility, void, confidence, category, or ranking
    penalty.

### Version 2.10 — 2026-08-05

- Updated the Section 15 Hits + Runs + RBIs requirement to
  reference the CANONICAL_MATH_SPEC.md Section 12.2 market
  registry rather than mandating a fixed model family.
- Recorded Hits + Runs + RBIs as the primary V1 market and
  Batter Runs as a V1 market, both assigned Family B, the
  directly fitted composite distribution defined in
  CANONICAL_MATH_SPEC.md Section 8.3.2.
- Retained Family A, the tagged-player base-out joint model,
  as approved and available to replace Family B through the
  normal canonical revision process.
- Preserved without change the prohibition on constructing
  Hits + Runs + RBIs from independent marginal convolution.
- Clarified that CANONICAL_MATH_SPEC.md controls model-family
  requirements and that family names in PROJECT_RULES.md are
  pointers to the registry, not independent authority.

### Version 2.9 --- 2026-08-03

-   Designated the active repository the sole authority for canonical
    files and removed every Project Source copy, placement, and
    byte-identity requirement.
-   Permitted the user to perform repository edits directly in the
    GitHub web editor or Replit file editor when no assistant has
    repository write capability.
-   Preserved the Python prohibition, the proven-executable limit on
    user-run commands, and the prohibition on scripts, heredocs, and
    chained commands.

### Version 2.8 --- 2026-08-03

-   Required every canonical revision to remove and replace the old
    active repository file in the same change with the complete approved
    file at the exact canonical path.
-   Prohibited reporting Project Source synchronization before the
    repository copy has been replaced and verified byte-for-byte
    identical.
-   Required active-tree cleanup of stale, suffixed, renamed, backup,
    copied, generated, and duplicate authority files before completion.
-   Extended same-change removal of superseded active copies to other
    explicitly replaced repository components and artifacts unless a
    canonical retention rule requires preservation.

### Version 2.7 --- 2026-08-03

-   Prohibited Python installation, commands, scripts, packages,
    dependencies, probes, and virtual environments for MLB Prop Analyzer
    V3 repository and Replit execution.
-   Locked strict TypeScript and Node.js as the project execution path;
    any future Python exception requires explicit user approval and a
    canonical Project Rules revision first.
-   Restricted user-run Replit commands to executables already proven in
    the exact workspace, currently `git`, `node`, `npm`, and demonstrated
    basic non-interactive POSIX shell utilities.
-   Prohibited delegating repository file edits through Replit scripts,
    heredocs, large pasted commands, or fragile command chains when
    Codex or GitHub can perform the work directly.
-   Required repository editing, generated-text replacement, commits,
    pushes, pull requests, and CI review to remain assistant-owned through
    Codex or GitHub whenever available.

### Version 2.6 --- 2026-08-02

-   Required Codex-first repository execution whenever Codex or GitHub
    can perform inspection, implementation, edits, tests, diagnostics,
    CI review, commits, pushes, or pull-request work.
-   Prohibited handing repository work back to the user as repeated
    shell babysitting when the available repository tools can perform it
    directly.
-   Clarified that Python is neither prohibited nor assumed: use it only
    when it is appropriate and its exact executable has been verified in
    the target environment.
-   Prohibited commands that place required work behind interactive
    installation, confirmation, authentication, package-manager, or
    environment prompts.
-   Required user-run commands to use verified installed tools, remain
    non-interactive, and be reduced to the smallest safe action.
-   Prohibited large pasted scripts, heredocs, and fragile chained
    commands when Codex or GitHub can make the same repository change
    directly.

### Version 2.5 --- 2026-08-01

-   Defined a soft line as an exact posted offer that may favor either
    Higher or Lower under an approved side-aware base distribution and
    discovery rule.
-   Separated preliminary base soft-line probability from final
    context-adjusted probability and locked final `P(Win | grades)` as
    the only category-ranking probability.
-   Required all context factors to act through eligibility, workload,
    shared scenarios, or the statistic distribution before exact
    settlement and prohibited direct probability-point boosters.
-   Required any hard discovery cutoff to prove high recall for the
    strongest final-probability candidates before it may exclude offers
    from full context evaluation.
-   Clarified that projected-lineup accuracy and replacement metrics are
    diagnostic only and may not penalize probability, eligibility,
    void, confidence, category access, or ranking.
-   Added audit and saved-record requirements for base distribution,
    discovery method, final context distribution, factor versions, and
    reported probability delta.

### Version 2.4 --- 2026-07-31

-   Replaced the repeated-failure instruction to stop editing with a
    requirement to stop blind incremental patching while continuing
    diagnosis and resolution of the same issue.
-   Required complete mapping of the affected component, inputs,
    consumers, schemas, tests, artifacts, boundaries, and dependencies
    before selecting one structural correction.
-   Required execution of the selected structural direction through its
    focused verification gate unless the user stops or a real evidence,
    access, secret, runtime, destructive-change approval,
    canonical-change approval, or other explicit authorization boundary
    is reached.
-   Clarified that the trigger prohibits a third blind patch, not a
    structurally redesigned implementation after full reassessment.
-   Prohibited ending with only a failure report when another diagnostic
    or corrective step can be performed with available tools.

### Version 2.3 --- 2026-07-29

-   Added single active implementation rule.
-   Added mandatory cleanup of obsolete implementations and generated
    artifacts.
-   Strengthened replaceable modular architecture requirements.

### Version 2.2 --- 2026-07-29

-   Locked projected starters and projected batting order as the active
    lineup assumption until the official lineup posts.
-   Prohibited any probability, eligibility, void, confidence, category,
    ranking, or hidden-score penalty solely because a lineup is
    projected rather than confirmed.
-   Required identical projected-versus-confirmed lineup inputs to
    produce identical distributions and probabilities, with only source
    metadata allowed to differ.
-   Required official lineups to atomically replace projections and
    trigger recomputation.

### Version 2.1 --- 2026-07-26

-   Added zero-tolerance canonical mismatch recovery requiring immediate
    delivery of the complete confirmed-current replacement file instead
    of merely reporting divergence.
-   Required exact filename, internal version, changelog,
    complete-content, and content-hash verification before claiming
    canonical synchronization.
-   Prohibited active suffixed, renamed, backup, generated, or duplicate
    canonical copies and blocked stale authority copies from merge or
    preflight use.
-   Clarified that historical Git commits may retain earlier versions
    but are not active authority.

### Version 2.0 --- 2026-07-23

-   Established `Derkmane/mlb-prop-analyzer-v3` as the only active
    repository.
-   Replaced migration-first planning with a clean modular-monolith
    foundation while preserving verified mathematics and product
    requirements.
-   Locked strict TypeScript, runtime schema validation,
    dependency-cruiser boundaries, feature public entrypoints, and no
    empty future-feature folders.
-   Separated markets from product categories and centralized settlement
    and ranking in core.
-   Added single-source market-key ownership across feature manifests
    and the planned-market catalog.
-   Added fail-closed feature disable/removal rules and historical
    rendering independent of active features.
-   Required provider evidence and sanitized fixtures before
    provider-derived contracts.
-   Added the early terminal-PA and lineup capability gate.
-   Preserved H+R+RBI and Pitcher Strikeouts as planned markets with
    their required mathematical families.
-   Added detailed failure classification and repeated-failure
    structural escalation.
-   Prohibited daily caps and time estimates from controlling project
    execution.

### Version 1.4 --- 2026-07-22

-   Established the side-aware Golden Rule and current-season-only V2
    foundation.
