# M9 Batter Hits V3 tail-calibration plan

**Recorded before calibration fitting or July 26–31 outcome evaluation:** 2026-07-30  
**Repository:** `Derkmane/mlb-prop-analyzer-v3`  
**Base candidate:** `m8-batter-hits-complete-candidate-v1`  
**Base artifact SHA-256:** `728895ca850c5481cd1f17944e38464f16396becc3622146a1384bba19ce5cde`  
**Failed untouched evaluation SHA-256:** `7bc151aceb0c683cbba56d1f7887f1f35436d27ff22d696ecff95851020036c1`

## Revision reason

The base candidate improved complete-distribution log loss, complete-distribution Brier score, and Higher 0.5 Brier score relative to its no-environment benchmark. It failed because its raw Higher 1.5 and Higher 2.5 tail probabilities were slightly worse.

A later coefficient study showed that positive shared-environment strength improved the later July 16–25 validation period. Setting the environment coefficient to zero would disconnect shared offensive scenarios from per-opportunity outcomes while the same scenarios still alter opportunities.

The demonstrated defect is therefore selected-side tail calibration, not the existence of the coherent environment-dependent baseball distribution.

## Frozen chronology

- calibration development start: 2026-03-26
- final calibration fit end: 2026-07-25
- fixed later validation: 2026-07-16 through 2026-07-25
- newly reserved untouched period: 2026-07-26 through 2026-07-31

July 26–31 raw shards may be captured and hash-verified prospectively, but no plate-appearance outcome from those dates may be graded, inspected, scored, fitted, used for candidate selection, used for tie-breaking, or used to freeze the calibration artifact.

## Base distribution

The following remain unchanged while calibration is selected:

- current-season terminal PA model
- player and pitcher pooling
- platoon model
- shared offensive scenarios
- environment coefficient `1`
- hitter opportunity and named-starter retention distributions
- starter-to-bullpen transition
- bullpen terminal-outcome model
- nested opportunity-count mixture
- exact Poisson-binomial Hits convolution
- generic Higher/Lower settlement

## Calibration family

For a raw integer Hits PMF, define cumulative tails:

```text
T_k = P(Hits >= k),  k >= 1
```

Fit one shared logit-intercept calibration parameter `delta` from current-season starter-hitter observations at the actual evaluated thresholds `k = 1, 2, 3`:

```text
C_delta(T) = logistic(logit(T) + delta)
```

Exact endpoints remain exact:

```text
C_delta(0) = 0
C_delta(1) = 1
```

The fitted intercept uses equal weight for the three threshold events and minimizes binary log loss. One shared monotone transform is applied to every cumulative tail, so tail ordering is preserved.

The calibrated PMF is reconstructed as:

```text
P'(H=0) = 1 - C_delta(T_1)
P'(H=h) = C_delta(T_h) - C_delta(T_(h+1))
P'(H=K) = C_delta(T_K)
```

This preserves one coherent statistic distribution for baseline and alternate offers. It does not calibrate Higher and Lower separately; Lower remains the exact complement after settlement.

## Ordered shrinkage candidates

For each training window, first fit the unshrunk intercept `delta_hat`. The ordered candidate family applies a fixed shrinkage multiplier:

```text
calibration-shrink-000: lambda = 0.00  (benchmark only; not selectable)
calibration-shrink-025: lambda = 0.25
calibration-shrink-050: lambda = 0.50
calibration-shrink-075: lambda = 0.75
calibration-shrink-100: lambda = 1.00
```

Candidate intercept:

```text
delta_candidate = lambda * delta_hat
```

No additional multiplier may be added after evaluation begins.

## Validation designs

### Fixed later validation

Fit `delta_hat` on all eligible observations dated 2026-03-26 through 2026-07-15. Evaluate each candidate on 2026-07-16 through 2026-07-25.

### Expanding walk-forward

1. fit through 2026-06-21; validate 2026-06-22 through 2026-07-05
2. fit through 2026-07-05; validate 2026-07-06 through 2026-07-15
3. fit through 2026-07-15; validate 2026-07-16 through 2026-07-25

Each validation observation is scored once in the walk-forward aggregate.

## Scores and selection

Every candidate reports:

- multiclass log loss
- multiclass Brier score
- Higher 0.5 Brier score
- Higher 1.5 Brier score
- Higher 2.5 Brier score
- observed mean Hits
- predicted mean Hits
- probability-mass conservation

The zero-shrinkage candidate is a benchmark only because the unchanged raw candidate already failed its one-time untouched gate.

A nonzero candidate is selectable only when:

1. it is in the fixed-validation nondominated set for multiclass log loss and multiclass Brier score;
2. it is in the expanding walk-forward nondominated set for the same two proper scores;
3. none of its 0.5, 1.5, or 2.5 Brier scores is worse than the zero-shrinkage benchmark on fixed validation;
4. none of those three line Brier scores is worse than the benchmark on the walk-forward aggregate.

Among selectable candidates, choose the smallest `lambda`, representing the strongest shrinkage toward no calibration. Ties use ascending candidate identifier.

If no nonzero candidate is selectable, this calibration family is rejected without opening the July 26–31 outcomes.

## Final fit and freeze

After selection, refit `delta_hat` once on all eligible observations dated 2026-03-26 through 2026-07-25. Freeze:

- the selected shrinkage multiplier
- the final fitted intercept
- the base candidate identity
- the source observation identity hash
- fixed and walk-forward evidence
- the July 26–31 untouched reservation
- `productionEnabled: false`

Only the frozen calibrated candidate may enter the July 26–31 acceptance evaluation.

## Product objective

The sole purpose of this calibration is to improve the true selected-side win probabilities at posted Batter Hits lines while preserving the coherent baseball distribution, Higher/Lower symmetry, and ranking by `P(Win | grades)` with `P(Void)` only as the tiebreak.