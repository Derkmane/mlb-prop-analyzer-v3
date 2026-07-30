# M9 Batter Hits V2 revision plan

**Recorded before V2 candidate evaluation:** 2026-07-30  
**Repository:** `Derkmane/mlb-prop-analyzer-v3`  
**Prior frozen model:** `m8-batter-hits-complete-candidate-v1`  
**Prior artifact SHA-256:** `728895ca850c5481cd1f17944e38464f16396becc3622146a1384bba19ce5cde`

## Reason for a new model version

The one-time 2026-07-06 through 2026-07-25 evaluation was completed after the V1 candidate was frozen. V1 improved multiclass log loss, multiclass Brier score, and Higher 0.5 Brier score relative to the predeclared no-environment benchmark, but it worsened Higher 1.5 and Higher 2.5 Brier scores. The selected mean Hits prediction was also farther above the observed mean than the no-environment benchmark.

Those rows may not revise V1. They become development evidence only for a new model version with a newly reserved untouched period.

## Frozen V2 candidate family

All V1 model artifacts, player and pitcher estimates, starter-retention curves, bullpen model, shared scenario weights, opportunity mathematics, and settlement mathematics remain fixed during this candidate comparison.

The only candidate parameter is the shared offensive-environment coefficient:

```text
0
0.25
0.5
0.75
1
```

The ordered candidate identifiers are:

```text
environment-000
environment-025
environment-050
environment-075
environment-100
```

No additional coefficient may be added after evaluation begins.

## Development chronology

The already-exposed V1 test period is reclassified only for V2 development:

- earlier development segment: 2026-07-06 through 2026-07-15
- fixed later validation segment: 2026-07-16 through 2026-07-25
- chronological stability folds: four consecutive five-day folds covering 2026-07-06 through 2026-07-25

No observation dated 2026-07-26 or later may be read during V2 candidate evaluation, selection, fitting, or freezing.

## Predeclared selection rule

For each coefficient, report:

- multiclass log loss
- multiclass Brier score
- Higher 0.5 Brier score
- Higher 1.5 Brier score
- Higher 2.5 Brier score
- predicted mean Hits
- observed mean Hits

A candidate is admissible only when, on the fixed later validation segment:

1. multiclass log loss is no worse than `environment-000`
2. multiclass Brier score is no worse than `environment-000`
3. Higher 0.5 Brier score is no worse than `environment-000`
4. Higher 1.5 Brier score is no worse than `environment-000`
5. Higher 2.5 Brier score is no worse than `environment-000`

The same five non-worsening conditions must hold on the aggregate chronological-fold evaluation.

Among admissible candidates, select deterministically by:

1. lowest fixed-validation multiclass log loss
2. lowest fixed-validation multiclass Brier score
3. lowest maximum fixed-validation line Brier score across 0.5, 1.5, and 2.5
4. lower environment coefficient
5. ascending candidate identifier

If only `environment-000` is admissible, V2 uses no shared environment effect rather than preserving an effect that harms posted-line probabilities. If no candidate is admissible because of an implementation or data defect, fix that defect without changing this candidate set or selection rule. If no nonzero candidate is admissible, do not create another coefficient grid from these rows.

## Newly reserved untouched period

The V2 latest-current-season untouched period is:

```text
2026-07-26 through 2026-07-31
```

It must remain unread until the V2 candidate is selected, fitted if necessary, frozen, versioned, and hashed.

Minimum reporting volume for the untouched report:

- at least 900 included starter-hitter observations
- at least 35 observations with actual Hits greater than 2.5

If the reserved period does not meet both reporting volumes, the V2 model remains not production-validated; the candidate set and selection rule may not be changed using those rows.

## Production objective

The V2 candidate exists only to improve the accuracy of side-aware win probabilities at actual posted Batter Hits lines. It must continue to produce one coherent statistic distribution for baseline and alternate offers, settle exact Higher and Lower sides, and rank only by `P(Win | grades)` with `P(Void)` as the tiebreak.
