# MLB Prop Analyzer V3

A modular, side-aware analyzer for Underdog MLB pregame player props. The sole ranking objective is to order eligible selected Higher or Lower sides by `P(Win | grades)`, using `P(Void)` ascending as the tiebreak.

## How to run

```bash
npm run verify
```

This runs: typecheck → script syntax check → architecture enforcement → build → tests.

All 8 tests pass as of setup. No web server or persistent workflow — this is a pure TypeScript library/math engine.

## Stack

- **Runtime:** Node.js 24
- **Language:** Strict TypeScript
- **Validation:** Zod 4
- **Architecture enforcement:** dependency-cruiser
- **Tests:** Node.js built-in test runner

## Key project documents

- `PROJECT_RULES.md` — canonical project rules and constraints
- `CANONICAL_MATH_SPEC.md` — probability mathematics specification
- `PROJECT_CHECKLIST.md` — implementation checklist
- `docs/providers/balldontlie-quirks.md` — data provider notes

## Status

Foundation only. No market is production-enabled and no displayed value is a production probability.

## User preferences

- Do not modify application code, architecture, project rules, math specifications, or create a UI without explicit instruction.
- Do not add provider credentials.
- Run `npm run verify` to confirm the project is in good standing.
