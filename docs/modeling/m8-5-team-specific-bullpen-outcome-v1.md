# M8.5 Team-Specific Bullpen Outcome — Evaluation Boundary v1

## Status

Implementation and synthetic contract verification are complete on the focused branch. Real current-season evaluation remains required before the factor can be marked validated or merged as an active M8.5 component.

Production remains disabled. Frozen M8 remains unchanged.

## Exact purpose

Replace only the frozen generic bullpen terminal-outcome assumption:

- `m8-generic-bullpen-outcome-v1`

with current-season pitching-team and pitcher-hand terminal-outcome vectors when, and only when, later chronological evidence supports the additional team signal.

The existing fitted `starterBullpenTransition` remains byte-for-byte source evidence and is not refit, transformed, or replaced by this component.

## Approved input join

The existing resolved categorical PA dataset preserves:

- observation date
- provider game identity
- batting half-inning
- recovered starter/bullpen row position
- pitcher identity
- pitcher handedness
- canonical terminal PA category

The separately verified team offensive-environment dataset preserves, for the same period/date/game/batting side:

- batting team identity
- opponent team identity

For each recovered bullpen PA, the pitching bullpen team is the batting-side row's exact `opponentTeamId`. The join uses period, observed date, provider game identity, and batting side. Missing or duplicate team-game identity fails closed.

No team is inferred from a player name, text label, web statistic, or unverified provider field.

## Candidate family

Each candidate fits one pitching-team and pitcher-hand categorical vector over all 15 canonical terminal PA categories. Raw current-season counts receive exactly one pooling pass toward the frozen generic bullpen vector for the same pitcher hand.

Candidate league-equivalent PA strengths:

- 25
- 50
- 100
- 250
- 500
- 1,000
- 2,500

The frozen generic bullpen L/R mixture weights are preserved. They are not re-estimated here.

## Validation gate

The generic M8 bullpen is the explicit identity baseline.

A team-specific candidate is eligible only when it:

1. improves categorical log loss on the fixed later validation period;
2. does not worsen multiclass Brier score on that same fixed period;
3. improves categorical log loss under expanding daily walk-forward evaluation;
4. does not worsen multiclass Brier score under the same walk-forward evaluation.

Among candidates passing all four requirements, the strongest pooling candidate is selected. If none passes, the decision is explicit identity retention and no validated factor artifact is produced.

The selected final team vectors are fitted from the fit period only. Validation outcomes are not folded into the selected factor artifact.

## Typed effect

A validated result emits only typed `terminal-outcome-vector` effects with:

- `scope: bullpen`
- matchup key `pitching-team:<teamId>|pitcher-hand:L`
- matchup key `pitching-team:<teamId>|pitcher-hand:R`
- every canonical terminal PA category present
- conserved probability mass

The resolver requires exactly one L and one R vector per represented team. Duplicate, incomplete, wrong-factor, unknown-team, malformed, or hash-invalid artifacts fail closed.

## Prohibited behavior

This component may not:

- read `selectedSide`;
- add or subtract probability points;
- contain a generic scalar coefficient;
- change starter or bullpen workload probabilities;
- change `starterBullpenTransition`;
- use validation rows to fit the final selected vectors;
- access the untouched-test cohort;
- change M8, settlement, ranking, `tau_soft`, or production status.

## Real execution

`npm run evaluate:m8-5-team-bullpen-outcome` builds TypeScript, discovers the unique verified current-season resolved categorical and matching team offensive-environment artifacts under `artifacts/`, verifies the frozen shared-environment and complete-candidate artifacts, runs fixed and walk-forward evaluation, and writes:

- evaluation evidence to `artifacts/m8-5-team-bullpen-outcome-evaluation-v1.json`;
- a typed factor artifact to `model-artifacts/m8-5-team-bullpen-outcome-v1.json` only when the validated-team-signal gate passes.

The command prints the literal fit/validation PA counts, team count, selected candidate, generic and selected proper scores, preserved workload-transition SHA-256, evaluation SHA-256, factor SHA-256 when created, and all safety-state declarations.
