# MLB Prop Analyzer V3

A modular, side-aware analyzer for Underdog MLB pregame player props.

The sole ranking objective is to order eligible selected Higher or Lower sides by `P(Win | grades)`, using `P(Void)` ascending as the tiebreak.

## Foundation

- strict TypeScript
- runtime validation at untrusted boundaries
- dependency-cruiser architecture enforcement
- deterministic core mathematics
- one shared game/workload model
- market features separated from category selectors
- fail-closed production registries
- immutable historical records independent of active feature code

## Current status

Foundation only. No market is production-enabled and no displayed value is a production probability.

See:

- `PROJECT_RULES.md`
- `CANONICAL_MATH_SPEC.md`
- `PROJECT_CHECKLIST.md`
- `docs/providers/balldontlie-quirks.md`
