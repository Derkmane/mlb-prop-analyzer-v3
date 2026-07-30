# M9 Batter Hits V3 full-refit plan — superseded

**Status:** Superseded before fitting began  
**Superseded on:** 2026-07-30  
**Repository:** `Derkmane/mlb-prop-analyzer-v3`

This plan was recorded after the V1 untouched-test failure but before any V3 fitting or any July 26–31 outcome evaluation.

It proposed rebuilding every Batter Hits component. Subsequent review found that conclusion was broader than the evidence supported:

- the V1 complete candidate improved overall multiclass log loss and multiclass Brier score;
- the full environment-dependent distribution remained useful;
- the demonstrated defect was calibration at the posted 1.5 and 2.5 Hits thresholds;
- no evidence isolated the talent, bullpen, starter-retention, opportunity, or shared-scenario components as independently defective.

A complete refit would therefore change unimplicated components and add work without directly targeting the observed selected-side probability error.

The active replacement is:

`docs/modeling/m9-batter-hits-v3-tail-calibration-plan.md`

No V3 full-refit artifact was generated from this superseded plan. The July 26–31 reservation remains excluded from calibration fitting, candidate selection, validation, and freezing.