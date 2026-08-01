# M8 Batter Hits production-enablement gate v1

**Status:** Required decision record; no production enablement authorized  
**Repository:** `Derkmane/mlb-prop-analyzer-v3`  
**Scope:** Frozen M8 Batter Hits model acceptance only

## Purpose

This document defines the only allowed path from the currently sealed M8 Batter Hits artifacts to a future production-enabled model version. It does not itself enable production, authorize real ranking, or replace `PROJECT_RULES.md`, `CANONICAL_MATH_SPEC.md`, or `PROJECT_CHECKLIST.md`.

## Current state

The frozen complete candidate and every referenced component remain `productionEnabled: false`. Runtime verification must continue to reject any silent in-place flag change, artifact hash drift, model-version drift, component substitution, or access to the untouched test before the predeclared access boundary.

## Required M8 acceptance evidence

All of the following must be true before an M8 production-enabled successor may be proposed:

1. The exact frozen candidate and its exact referenced shared-environment, starter-retention, and terminal-outcome artifacts verify successfully before test access.
2. The one-time untouched current-season test is run only after its predeclared access boundary.
3. The immutable untouched-test report preserves the exact candidate SHA-256, source partition SHA-256, source evidence-set SHA-256, test window, observation identities SHA-256, evidence counts, exclusions, selected metrics, benchmark metrics, and acceptance results.
4. The untouched-test report has `status: "untouched-test-passed"` and `acceptance.allRequiredGatesPass: true`.
5. The report contains at least 900 included starter observations.
6. The report contains at least 35 observations with actual Hits above 2.5.
7. The selected candidate has strictly lower log loss than the predeclared no-environment benchmark.
8. The selected candidate does not worsen multiclass Brier score versus that benchmark.
9. Higher 0.5, Higher 1.5, and Higher 2.5 Brier scores each do not worsen versus the same benchmark.
10. The report is committed immutably and its evaluation SHA-256 verifies.

A failed gate is a failed acceptance decision. The untouched test may not be used for retuning, coefficient selection, factor selection, or another attempt with the same reserved rows.

## Required change-control path

Even if every M8 acceptance gate passes, production enablement is not an in-place boolean edit.

1. Report the exact evidence, impact, proposed successor artifact versions, and all remaining risks.
2. Obtain explicit user approval for the production-enablement change.
3. If any canonical wording must change, update the complete Project Source first under the mandatory source-synchronization workflow.
4. Create new versioned successor artifacts and manifests. Preserve the sealed M8 artifacts unchanged as historical evidence.
5. Record predecessor hashes, successor hashes, active season, model version, distribution-builder version, settlement version, and the untouched-test evaluation hash.
6. Add focused tamper, deterministic-output, Higher/Lower symmetry, tie/void, and directional-monotonicity regression coverage.
7. Run the complete repository verification gate and report the literal tally and CI link.
8. Deliver through a pull request. Do not merge without explicit user approval.

## What an M8 pass does not authorize

An accepted M8 model does not by itself authorize real prop ranking or production display. The real board path must independently satisfy provider-contract, identity-linkage, pregame-only, exact side-and-line, probability-generation, projected-lineup, archive/grading, category, saved-run, API, UI, deployment, and all other active checklist gates.

The production feature registry and ranking authorization must remain disabled until their own gates pass. No M8 factor pull request may silently flip those controls.

## Failure and rollback rule

If the untouched test fails, evidence is insufficient, hashes drift, the candidate changes, the reserved rows were accessed early, or any required provenance cannot be verified, M8 remains disabled. The failure must be reported exactly. Any later model must use a new version, new predeclared fitting/validation process, and a new untouched cohort; the original frozen artifacts and failed report remain immutable.
