# M9 Batter Hits V4 monotone-calibration replacement

**Recorded before V4 fitting, selection, or July 26–31 outcome evaluation:** 2026-07-30  
**Repository:** `Derkmane/mlb-prop-analyzer-v3`  
**Base candidate:** `m8-batter-hits-complete-candidate-v1`  
**Base artifact SHA-256:** `728895ca850c5481cd1f17944e38464f16396becc3622146a1384bba19ce5cde`  
**Rejected V3 calibration evaluation SHA-256:** `dfa07a44520689e42e43ad367f83e03eb78c0a08f9f8000d884d090008d068d5`

## Structural reassessment

Two focused correction families have now been evaluated without touching the newly reserved July 26–31 outcomes.

1. Changing only the shared-environment coefficient could not stably calibrate every posted Batter Hits line range.
2. A one-parameter shared logit-intercept tail calibrator produced a canonical stable proper-score candidate (`calibration-shrink-075`) but slightly worsened the 1.5-line Brier score while improving the complete distribution and the 0.5 and 2.5 lines.

The second result proves that one constant log-odds shift is too rigid. It does not prove that calibrated probability mapping is wrong. The replacement is one monotone nonlinear map applied to every cumulative Hits tail, which preserves one coherent statistic distribution and exact Higher/Lower complements while allowing different raw probability regions to receive different corrections.

The V3 shared-intercept family and its literal per-line decimal veto are rejected. They are historical evidence only and are not active production inputs.

## Frozen chronology

- calibration development start: 2026-03-26
- final calibration fit end: 2026-07-25
- fixed later validation: 2026-07-16 through 2026-07-25
- expanding walk-forward validation: the same three folds used by V3
- newly assigned untouched period for V4: 2026-07-26 through 2026-07-31

V3 froze no calibrated candidate and did not grade, inspect, score, fit, select, or evaluate any July 26–31 outcome. Those dates therefore remain untouched and are newly assigned to V4. Captured shard files may be hash-verified prospectively, but outcome rows remain prohibited until one V4 candidate is frozen and hashed.

## Unchanged baseball distribution

The following remain fixed during calibration selection:

- current-season terminal PA model
- batter and pitcher pooling
- platoon model
- shared offensive scenarios
- environment coefficient `1`
- hitter opportunity and named-starter retention distributions
- starter-to-bullpen transition
- bullpen terminal-outcome model
- nested opportunity-count mixture
- exact Poisson-binomial Hits convolution
- generic Higher/Lower settlement

Calibration remains a probability-reliability layer and is not a second talent-shrinkage pass.

## Monotone logit-affine calibration family

For every raw cumulative Hits tail probability `T = P(Hits >= k)`, define:

```text
C_(a,b)(T) = logistic(a * logit(T) + b)
```

with:

```text
a > 0
C_(a,b)(0) = 0
C_(a,b)(1) = 1
```

The same increasing map is applied to every cumulative tail. Therefore raw tail ordering is preserved automatically. Reconstruct the calibrated PMF by adjacent calibrated-tail differences. Baseline and alternate offers continue to use the same calibrated statistic distribution; only posted side and line change settlement.

### Unshrunk fit

Fit one unshrunk pair `(a_hat, b_hat)` from the actual threshold events `k = 1, 2, 3` in each training window. Each threshold event receives equal weight.

Use deterministic bounded optimization:

- optimize `eta = log(a)` over `[-2, 2]` by fixed golden-section search;
- for each `eta`, solve the unique intercept score equation by fixed bisection over `[-40, 40]`;
- initialize and terminate only by versioned deterministic bounds, iteration counts, and numeric tolerance;
- report the fitted slope, intercept, objective value, example counts, and fit SHA-256.

### Ordered shrinkage candidates

Shrink the unshrunk map continuously toward identity:

```text
a_lambda = 1 + lambda * (a_hat - 1)
b_lambda = lambda * b_hat
```

The frozen ordered family is:

```text
monotone-calibration-000: lambda = 0.00  (identity benchmark only)
monotone-calibration-025: lambda = 0.25
monotone-calibration-050: lambda = 0.50
monotone-calibration-075: lambda = 0.75
monotone-calibration-100: lambda = 1.00
```

No additional multiplier, slope bound, intercept bound, candidate, score, or tie-break may be added after V4 evaluation begins.

## Validation and selection

Every candidate reports:

- multiclass log loss
- multiclass Brier score
- Higher 0.5 Brier score
- Higher 1.5 Brier score
- Higher 2.5 Brier score
- observed mean Hits
- predicted mean Hits
- probability-mass conservation
- deterministic observation identity hashes

Candidate admissibility follows `CANONICAL_MATH_SPEC.md` Version 1.5 exactly:

1. form the fixed-validation nondominated set using multiclass log loss and multiclass Brier score;
2. form the expanding walk-forward nondominated set using the same proper scores;
3. intersect the two sets;
4. exclude the identity benchmark from production selection because the unchanged raw model already failed its one-time acceptance test;
5. select the remaining candidate with the smallest `lambda`, which is the strongest shrinkage toward identity;
6. use ascending candidate identifier only if pooling strength is equal.

Line-specific Brier scores remain mandatory diagnostics and acceptance evidence. They do not create a second candidate-admissibility rule or override the canonical proper-score nondominated intersection through differences far below sampling uncertainty.

If the nonidentity stable intersection is empty, V4 is rejected without opening July 26–31 outcomes. Do not revise V4 after that result.

## Final fitting and freeze

After selection, refit `(a_hat, b_hat)` once on every eligible development observation dated 2026-03-26 through 2026-07-25. Freeze and hash:

- model version `m9-batter-hits-monotone-calibrated-candidate-v2`
- selected candidate identifier and shrinkage multiplier
- final unshrunk and applied slope/intercept
- base candidate and component artifact identities
- source observation identity
- fixed and walk-forward evidence
- July 26–31 untouched reservation
- `productionEnabled: false`

Only this frozen candidate may enter the one-time July 26–31 acceptance evaluation.

## Product objective

The sole objective is to improve the true probability that each posted Higher or Lower side wins. The calibration map must preserve one coherent Hits PMF, exact Higher/Lower settlement symmetry, baseline/alternate distribution reuse, and ranking only by `P(Win | grades)` with `P(Void)` as the tiebreak.