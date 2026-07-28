# M8 Hit Recency Benchmark Evidence

**Version:** 1.0  
**Status:** Verified binary benchmark evidence; not a production categorical-model approval  
**Repository:** `Derkmane/mlb-prop-analyzer-v3`  
**Recorded:** 2026-07-27

## Purpose

This report records the current-season Hit-versus-No-Hit recency evidence produced during M8.

It does not define the production coherent categorical model, pooling structure, platoon interaction, calibration model, or runtime coefficients. Binary log5 remains a permanent benchmark only.

## Source evidence

- Active season: 2026 MLB regular season only
- Fit period: 2026-03-26 through 2026-06-21
- Validation period: 2026-06-22 through 2026-07-05
- Untouched test period: 2026-07-06 through 2026-07-25
- Untouched test rows sealed: 16,830
- Recency dataset SHA-256: `eb27e4cbcee7298b3698693079c48d75b5dd4af6ad1c130dbdeacf196be76d57`
- Hit benchmark SHA-256: `50f570618310b3f8fdc59d80af79ae0b881121e8112cb330135eba8c74764b22`

### Benchmark dataset accounting

- Source rows conserved: 101,989
- Hit/No-Hit benchmark observations: 101,738
- Fit observations: 87,462
- Validation observations: 14,276
- Hit observations: 22,044
- No-Hit observations: 79,694
- Contextual No-Hit observations: 2,565
- Platoon-eligible benchmark observations: 99,155
- Explicitly excluded rows: 251

`Strikeout Double Play` was treated as a verified batter strikeout and therefore No Hit. `Caught Stealing 2B` was treated as a separate baserunning event and excluded rather than labeled No Hit.

## Candidate grid

The benchmark compared:

- uniform current-season weighting
- exponential half-life: 7 days
- exponential half-life: 14 days
- exponential half-life: 21 days
- exponential half-life: 30 days
- exponential half-life: 45 days
- exponential half-life: 60 days
- exponential half-life: 90 days

No pooling, smoothing, or probability clipping was introduced. Validation observations without usable two-class fit history for both batter and pitcher were excluded identically for every candidate.

## Fixed holdout evaluation

- Eligible validation cohort: 13,436 of 14,276 observations
- Coverage: 94.12%
- Evaluation SHA-256: `143d726677546c43b349fe8f7a228d1d6cae913511e9f8c1aa31c8a6fe42edaf`

| Candidate | Log loss | Brier score | Mean prediction | Effective fit weight |
|---|---:|---:|---:|---:|
| Uniform | 0.531790133 | 0.172923421 | 0.217654337 | 87,462.000 |
| Half-life 7 | 0.553193088 | 0.178232628 | 0.220611885 | 10,729.996 |
| Half-life 14 | 0.538196225 | 0.174709690 | 0.219086225 | 20,472.984 |
| Half-life 21 | 0.534588874 | 0.173747281 | 0.218771347 | 29,102.467 |
| Half-life 30 | 0.533063603 | 0.173305656 | 0.218590006 | 37,989.975 |
| Half-life 45 | 0.532270449 | 0.173068186 | 0.218381680 | 48,421.059 |
| Half-life 60 | 0.532009631 | 0.172989342 | 0.218241179 | 55,370.406 |
| Half-life 90 | 0.531841647 | 0.172938525 | 0.218072947 | 63,889.064 |

**Fixed-holdout result:** uniform baseline retained.

## Expanding walk-forward evaluation

- Validation folds: 14
- Aggregate eligible observations: 13,872
- Walk-forward SHA-256: `16607a0ac456ec923666eb400e157267b849e7d35614a3edf0809168ee8651bb`

Each fold used only observations available before that fold date. Earlier validation outcomes could enter later folds, but same-day and future outcomes could not leak backward.

| Candidate | Aggregate log loss | Aggregate Brier score | Mean prediction |
|---|---:|---:|---:|
| Uniform | 0.530499946 | 0.172643255 | 0.218201823 |
| Half-life 7 | 0.554382992 | 0.178799029 | 0.219531681 |
| Half-life 14 | 0.538541855 | 0.175029729 | 0.219150992 |
| Half-life 21 | 0.534376775 | 0.173841317 | 0.218982278 |
| Half-life 30 | 0.532452646 | 0.173257363 | 0.218855223 |
| Half-life 45 | 0.531363551 | 0.172918097 | 0.218712036 |
| Half-life 60 | 0.530974594 | 0.172795481 | 0.218616836 |
| Half-life 90 | 0.530698122 | 0.172707733 | 0.218501606 |

**Walk-forward result:** uniform baseline retained.

## Evidence-supported conclusion

For the current-season binary Hit/No-Hit benchmark, the evidence does not justify exponential recency decay. Uniform weighting outperformed every tested half-life in both the fixed later validation period and the 14-fold expanding walk-forward evaluation, on both log loss and Brier score.

Therefore:

1. Uniform current-season weighting is the evidence-supported default for the next coherent categorical-model fitting work.
2. No exponential half-life is approved from this benchmark.
3. The production categorical model must still validate weighting by outcome inside its own fitted coherent model before real-prop ranking.
4. The untouched July 6–25 test period remains sealed until the final selected production candidate is ready for one-time evaluation.

## Verification evidence

Focused tests passed:

- Hit benchmark dataset: 6 passed, 0 failed
- Fixed holdout recency evaluation: 4 passed, 0 failed
- Walk-forward recency evaluation: 4 passed, 0 failed

GitHub Actions verify run `30321224106` passed typecheck, script checks, architecture, build, protective tests, and the complete repository suite at commit `cecf548fa404cbcb86485ee1b8ec62da02fff1f6`.

## Remaining boundary

This report does not mark M8 recency fully production-defined. `CANONICAL_MATH_SPEC.md` requires within-current-season recency weighting by outcome to be fitted, documented, versioned, and validated as part of the coherent categorical model. The next M8 task is to define and test the single approved current-season pooling/model path without double shrinkage, using uniform weighting as the supported starting candidate.
