# M9 Batter Hits V5 current-season refit plan

**Recorded before V5 refitting or July 30–August 4 outcome evaluation:** 2026-07-30  
**Repository:** `Derkmane/mlb-prop-analyzer-v3`  
**Base architecture:** `m8-batter-hits-complete-candidate-v1`  
**Base artifact SHA-256:** `728895ca850c5481cd1f17944e38464f16396becc3622146a1384bba19ce5cde`  
**Rejected shared-intercept calibration evaluation SHA-256:** `dfa07a44520689e42e43ad367f83e03eb78c0a08f9f8000d884d090008d068d5`  
**Rejected monotone logit-affine calibration evaluation SHA-256:** `b67893780d14e282ca53afb5e681190794cba37c155864668ce3e182df831841`

## Structural reassessment

Two post-hoc calibration families were evaluated on current-season chronological evidence:

1. A shared logit-intercept map produced a fixed/walk-forward stable candidate but moved the 1.5-line tail in the wrong direction while improving other scores.
2. A monotone logit-affine map produced no nonidentity candidate in the intersection of the fixed-validation and expanding walk-forward nondominated sets. Fixed validation preferred identity while walk-forward preferred mild calibration.

These results show that one static season-wide calibration map is not stable across the later current-season periods. Further post-hoc calibration-family edits are prohibited for this work session. The replacement direction is to refresh the already-selected baseball-model parameters using later current-season evidence while preserving the previously selected architecture and hyperparameters.

## Unchanged architecture and selections

V5 may not reopen or change the previously selected model families, candidate grids, pooling strengths, mathematical structure, settlement logic, or environment coefficient. It must preserve:

- coherent categorical terminal-PA model structure;
- selected batter and pitcher pooling definitions;
- selected platoon definition;
- shared offensive-environment scenario structure and coefficient `1`;
- selected hitter opportunity and named-starter retention structure;
- selected starter-to-bullpen transition structure;
- exact nested opportunity-count mixture;
- exact Poisson-binomial Hits convolution;
- generic Higher/Lower settlement;
- baseline/alternate reuse of one statistic distribution;
- no post-hoc calibration layer in V5 candidate selection.

V5 is a parameter refit of the existing selected structure, not a new architecture search.

## Chronology

- source evidence start: 2026-03-26
- refit-development cutoff: 2026-07-15
- fixed validation: 2026-07-16 through 2026-07-25
- final refit cutoff after validation passes: 2026-07-25
- untouched acceptance reservation: 2026-07-30 through 2026-08-04

July 26–29 is preserved development evidence but is ineligible for untouched acceptance because earlier tooling opened those captured files while searching for a partition manifest. V5 development and validation may not use July 26–29 unless a later versioned plan explicitly assigns them before fitting; this V5 plan does not assign them.

No July 30–August 4 plate-appearance outcome may be opened, graded, inspected, scored, fitted, used for selection, or used for corroboration before the V5 candidate is frozen and hashed.

## Refit procedure

1. Build one exact V5 development partition ending July 25 using only explicitly named manifests and shards.
2. Rebuild the already-selected terminal-outcome, shared-environment, starter-retention, and bullpen parameters from the declared fit period ending July 15.
3. Evaluate the rebuilt complete distribution on July 16–25.
4. Compare the V5 refit against the original frozen candidate on identical validation observations.
5. Require V5 to belong to the joint proper-score nondominated set for multiclass log loss and multiclass Brier score and to preserve probability mass, Higher/Lower symmetry, and directional monotonicity.
6. Report Higher 0.5, 1.5, and 2.5 Brier scores, observed/predicted mean Hits, reliability counts, and paired score differences. These are mandatory diagnostics and acceptance evidence.
7. If the validation gate passes, refit the unchanged selected structure once on all declared evidence through July 25 and freeze a new versioned candidate with `productionEnabled: false`.
8. Only that frozen candidate may enter the one-time July 30–August 4 acceptance evaluation.

## Fail-closed rule

If the unchanged selected structure cannot produce a validation-supported refit, Batter Hits remains production-disabled. Do not return to another static post-hoc calibration family in this work session, do not weaken the canonical proper-score stability rule, and do not enable the prior candidate.

## Product objective

The sole objective is to improve the true probability that each posted Higher or Lower side wins. V5 must preserve one coherent Hits distribution, exact side-aware settlement, baseline/alternate distribution reuse, and ranking only by `P(Win | grades)` with `P(Void)` as the tiebreak.
