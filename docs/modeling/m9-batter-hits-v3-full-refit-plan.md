# M9 Batter Hits V3 full-refit plan

**Recorded before V3 fitting or untouched-period access:** 2026-07-30  
**Repository:** `Derkmane/mlb-prop-analyzer-v3`  
**Prior failed production candidate:** `m8-batter-hits-complete-candidate-v1`  
**Prior untouched evaluation SHA-256:** `7bc151aceb0c683cbba56d1f7887f1f35436d27ff22d696ecff95851020036c1`  
**Coefficient-only V2 evaluation SHA-256:** `870caefe9a6c1b2b41e2a436010aba043b6e462e0ef75900efefe6ba1cdd9aca`

## Reason for replacement

The V1 candidate improved overall multiclass log loss, multiclass Brier score, and Higher 0.5 Brier score, but worsened Higher 1.5 and Higher 2.5 Brier scores. The subsequent coefficient-only V2 evaluation selected coefficient zero only because its rule pooled the complete July 6–25 development window and required literal non-worsening on every metric. The actual later July 16–25 validation window favored positive environment strength on every reported metric, while earlier chronological folds showed substantial temporal drift.

A zero environment coefficient is not an acceptable production resolution because it disconnects shared offensive scenarios from per-opportunity outcomes while those same scenarios still alter opportunity counts. The correct replacement is a complete current-season refit rather than forcing one scalar coefficient to repair stale upstream components.

## Frozen chronology

- fit: 2026-03-26 through 2026-07-15
- validation: 2026-07-16 through 2026-07-25
- untouched test: 2026-07-26 through 2026-07-31

No observation dated 2026-07-26 or later may be used for fitting, candidate generation, candidate selection, tie-breaking, corroboration, or artifact freezing.

## Components to refit together

The V3 refit rebuilds the complete Batter Hits stack from approved current-season evidence:

1. recency weighting and coherent terminal plate-appearance outcome estimates
2. current-season pooling and platoon interaction
3. shared offensive-environment scenarios
4. hitter plate-appearance survival and named-starter retention
5. starter-to-bullpen transition and generic bullpen terminal-outcome model
6. complete Batter Hits distribution candidate

The verified nested opportunity-count mixture, exact Poisson-binomial Hits convolution, generic Higher/Lower settlement, side preservation, and ranking objective remain unchanged.

## Candidate control

Existing approved ordered candidate families and deterministic selection rules are reused unless a separate written revision is recorded before the affected evaluation begins. No candidate value may be added after its evaluation starts.

The complete candidate must retain a nonzero shared offensive-environment effect. If no nonzero candidate satisfies the required proper-score and posted-line validation gates, the shared-environment model must be replaced rather than silently selecting coefficient zero.

## Validation outputs

Every complete candidate reports at least:

- multiclass log loss
- multiclass Brier score
- Higher 0.5 Brier score
- Higher 1.5 Brier score
- Higher 2.5 Brier score
- observed and predicted mean Hits
- chronological fold results
- probability-mass conservation
- Higher/Lower settlement symmetry and directional monotonicity

The selected model must be frozen, versioned, and hashed before the untouched period is opened.

## Untouched acceptance

The July 26–31 report must contain at least:

- 900 included starter-hitter observations
- 35 observations with actual Hits greater than 2.5

The frozen V3 candidate must improve or preserve the predeclared complete-distribution and posted-line gates. Untouched results may authorize production or reject V3, but may not retune V3.

## Product objective

The sole objective remains identifying eligible posted Higher or Lower Batter Hits props with the highest true `P(Win | grades)`, using `P(Void)` only as the tiebreak. No model component is retained merely to complete a milestone.
