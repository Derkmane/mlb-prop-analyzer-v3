# M8 Batter Hits fitting and validation — merge status

**Status:** Ready to merge as an M8 evidence and model-development milestone. Batter Hits remains disabled for real-prop ranking until the remaining production gates are completed.

## Product goal

The model exists to find the posted Higher or Lower Batter Hits props with the highest true chance that the selected side wins. Every M8 component below either builds the hitter's hit distribution, checks whether that distribution is trustworthy, or protects the app from ranking an unvalidated probability.

## Completed in this branch

### Current-season evidence and chronology

- Preserved 147 current-season date shards covering March 1 through July 25, 2026.
- Preserved 1,571 games and 118,819 plate appearances without truncation.
- Froze strictly chronological periods:
  - fit: March 26 through June 21
  - validation: June 22 through July 5
  - untouched test: July 6 through July 25
- The untouched test rows remain sealed and excluded from candidate selection.
- Prior seasons and career statistics are not used.

### Hitter and pitcher matchup model

- Evaluated uniform current-season weighting against multiple recency-decay candidates.
- Uniform current-season weighting won the fixed validation comparison and the expanding walk-forward comparison.
- Implemented one current-season categorical pooling path for batter effects and pitcher-allowed effects.
- Enforced one shrinkage pass per parameter; a second player-to-league shrinkage pass is prohibited.
- Evaluated batter and pitcher effects together through one coherent terminal plate-appearance probability vector.
- Added current-season platoon candidate evaluation and walk-forward checks.
- Preserved every supported terminal plate-appearance result as one explicit category instead of combining independent binary models.

### Opportunity and game context

- Built and evaluated hitter plate-appearance distributions by lineup slot and home/away state.
- Selected the `slot-home-away-pool-50` PA-survival benchmark consistently in fixed validation and expanding walk-forward evaluation.
- Preserved monotone PA-survival curves by construction; no arbitrary repair threshold is used.
- Built a shared offensive-environment benchmark that moves opportunity and outcome assumptions together.
- Selected the `shared-environment-k4` benchmark in both fixed validation and walk-forward evaluation.
- Preserved one shared game scenario set for lineup, home/away state, offensive environment, opposing starter, bullpen transition, and team batters faced.
- Built and validated the shared starter-to-bullpen transition distribution from current-season terminal PA order while conserving starter plus bullpen batters faced to total team batters faced.
- Under `CANONICAL_MATH_SPEC.md` Version 1.5, the fixed-validation nondominated set was `starter-bf-side-pool-500`, `starter-bf-side-pool-1000`, and `starter-bf-league`; the walk-forward nondominated set was only `starter-bf-side-pool-1000`; the stable intersection therefore selected `starter-bf-side-pool-1000`.
- The fixed-validation candidate log-loss range was `2.8480057054840135` through `2.850462309846479`, a span of `0.0024566043624656095`. The league limit remained on the fixed-validation frontier because its Brier score `0.9266005135161092` was lower than the finite `500` and `1000` candidates despite its worse log loss. This is selection evidence only; it does not establish a nonzero home/away effect or the downstream ranking impact of the component.

### Projected lineup rule

- Projected starters and projected batting order are the active lineup until the official lineup posts.
- Projected status is metadata only. It cannot reduce probability, eligibility, category access, ranking, or confidence and cannot increase void probability.
- A focused regression builds otherwise identical projected and confirmed lineups and requires identical opportunity distributions and hitter assumptions.
- When the official lineup changes player identity or batting order, the confirmed lineup replaces the projection and the model recomputes from the new baseball inputs.

### Validation and protection

- Added fixed validation and expanding walk-forward evaluations.
- Added categorical and Hit-specific log-loss and Brier-score reporting.
- Added reliability and probability-bucket reporting.
- Added rare-outcome sample-size and uncertainty reporting.
- Added Batter Hits overdispersion and half-line tail checks with Higher/Lower symmetry.
- Added deterministic hashes and tamper checks for datasets and evaluation artifacts.
- Enforced that untouched-test rows cannot enter fitting or candidate selection.
- Starter-bullpen selection passed 9 focused tests, the real-data shared-environment gate selected `starter-bf-side-pool-1000`, the complete `npm run verify` gate passed 329 of 329 tests, and GitHub Actions verify run 396 passed on commit `6af41c3`.
- The production registry remains fail closed: no unvalidated Batter Hits probability can rank a real prop.

## Explicitly not completed or enabled by this merge

This merge does not claim that Batter Hits is production validated. It does not:

- enable real Underdog props for ranking
- connect a final frozen categorical runtime model artifact
- run the final untouched-test evaluation
- finish board-offer normalization and live pregame joins
- finish the market-specific eligibility and settlement input path
- approve park, defense, weather, or times-through-order effects without current-season evidence
- add an injury-prediction model
- apply any projected-lineup penalty

Those items remain later production gates. They must not be silently substituted with placeholder coefficients, implied probability, hidden scores, or prior-season data.

## Merge decision

M8 has produced a substantial, deterministic, current-season fitting and validation framework with protective tests and explicit evidence boundaries. It is safe to merge this work while keeping Batter Hits disabled and explicitly not yet production validated. The next milestone must convert the selected evidence-backed components into frozen runtime artifacts, perform the final untouched-test gate, complete real board/game normalization, and only then consider real-prop ranking.
