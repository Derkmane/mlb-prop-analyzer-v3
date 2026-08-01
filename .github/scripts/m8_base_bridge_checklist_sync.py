from pathlib import Path

path = Path('PROJECT_CHECKLIST.md')
text = path.read_text()

if '**Version:** 2.9' not in text:
    raise SystemExit('Expected checklist Version 2.9')
text = text.replace('**Version:** 2.9', '**Version:** 3.0', 1)

m8_anchor = '''M8 current-season fitting and runtime-freeze work is closed. The one-time untouched-test evaluation remains a separate later acceptance gate and may not be used for retuning. M9 may integrate the frozen model and runtime eligibility gate, but real ranking remains fail closed until all M9 acceptance requirements and the untouched-test decision are satisfied.

---

## M9 — Real Batter Hits ranking'''

m8_replacement = '''M8 current-season fitting and runtime-freeze work is closed. The one-time untouched-test evaluation remains a separate later acceptance gate and may not be used for retuning. M9 may integrate the frozen model and runtime eligibility gate, but real ranking remains fail closed until all M9 acceptance requirements and the untouched-test decision are satisfied.

---

## M8 Bridge — Frozen base-distribution handoff

This section amends the runtime and evidence boundary around frozen M8. It does not reopen, refit, or mutate the frozen M8 candidate. The exact frozen M8 statistic distribution is the versioned `D_base` predecessor consumed by M8.5.

- [x] Preserve frozen M8 runtime artifacts, selected component hashes, model version, distribution-builder version, settlement version, production-disabled state, and sealed untouched-test boundary unchanged.
- [ ] Land direct projected-or-confirmed runtime acceptance through the real M9 path; identical baseball inputs must produce identical distributions and probabilities with only lineup-status metadata differing.
- [ ] Define `M8BatterHitsBaseEvaluationV1` as the immutable public base-evaluation envelope.
- [ ] Preserve exact player, game, market, posted side, posted line, lineup, opposing starter, shared `GameScenarioSet`, provider snapshots, and evaluation timestamp.
- [ ] Preserve `D_base`, base `P(Win)`, base `P(Loss)`, base `P(Void)`, and `p_base(d,L)=P_base(Win | grades; d,L)` from exact core settlement.
- [ ] Build `D_base` once per identical player, game, settlement statistic, baseball input set, and model version; baseline and alternate offers settle that same distribution without rebuilding it.
- [ ] Preserve a deterministic shared-scenario identity or hash so M8.5 proves it consumed the same game assumptions.
- [ ] Add audit-only side-aware soft-line evidence for every supported exact posted Higher or Lower offer.
- [ ] Keep `tau_soft`, softness margin, and every hard discovery exclusion disabled until M8.5 final probabilities exist and chronological current-season recall validation passes.
- [ ] Prove the bridge leaves the existing frozen M8 distribution and probabilities byte-for-byte unchanged for identical inputs.
- [ ] Prove Higher/Lower symmetry, integer-line tie/void handling, baseline/altline distribution reuse, deterministic reruns, and tamper rejection through the bridge.
- [ ] Keep production ranking and category access disabled; completing the bridge does not authorize a real ranked pick.

### M8 Bridge exit gate

- [ ] Frozen M8 remains immutable and independently verifiable as `D_base`.
- [ ] Every base evaluation carries complete version and source lineage.
- [ ] Every supported posted side and line can receive exact `p_base` without a runtime-invented threshold.
- [ ] No discovery label, price, multiplier, fair-line distance, or base probability can bypass M8.5 or alter final rank.
- [ ] Focused bridge tests and the complete repository verification gate pass.

---

## M8.5 — Context-adjusted Batter Hits successor

M8.5 is a new current-season model version that consumes the immutable M8 base evaluation and produces a separately versioned context-adjusted `D_final`. It may not silently edit the frozen M8 artifacts or use the original M8 untouched cohort for factor selection or tuning.

### Versioned factor contract

- [ ] Replace the scalar-only factor-extension proposal with a typed artifact contract that supports `identity`, `terminal-outcome-vector`, `scenario-mixture`, `opportunity-survival`, `workload-transition`, and `batted-ball-translation` effect types.
- [ ] Require every factor artifact to preserve factor key, status, model version, artifact SHA-256, validation status, active season, application stage, selected-side-input prohibition, required inputs, and source-evidence version.
- [ ] Require unknown, missing, unvalidated, wrong-season, side-dependent, hash-drifted, or unsupported factor artifacts to fail closed or remain explicit identity according to the approved manifest.
- [ ] Prohibit every factor from directly adding or subtracting probability points or reading the selected Higher/Lower side.

### Context factors and order

- [ ] Team-specific bullpen outcome model — replace the generic league bullpen outcome assumptions while preserving the validated starter-to-bullpen workload transition and avoiding double counting.
- [ ] Game-specific offensive-environment model — preserve one shared game scenario set and jointly affect approved opportunity and outcome assumptions.
- [ ] Park model — proceed only with verified approved-source venue evidence and current-season validation.
- [ ] Times-through-order model — apply only to starter repeated exposure and preserve the separate starter-to-bullpen transition.
- [ ] Defense data-sufficiency decision — implement only if approved current-season evidence supports balls-in-play translation without altering K, BB, HBP, or HR outcomes improperly.

### Final distribution and validation

- [ ] Define `M8_5FinalEvaluationV1` with source M8 evaluation hash, `D_base` hash, `D_final`, final probabilities, context model version, factor versions, factor artifact hashes, shared-scenario identity, and settlement version.
- [ ] Apply every validated context factor through eligibility, workload, shared scenarios, or the statistic distribution before exact settlement.
- [ ] Settle `D_final` against the exact posted side and line to produce `p_final(d,L)`.
- [ ] Preserve `contextProbabilityDelta(d,L)=p_final(d,L)-p_base(d,L)` as diagnostic evidence only.
- [ ] Use one identical `D_final` for baseline and alternate offers sharing the same player, game, statistic, baseball inputs, and model versions.
- [ ] Fit and validate each candidate using active-season-only chronological evidence, untouched later validation, and walk-forward evaluation where required.
- [ ] Reserve a new untouched current-season cohort for the frozen M8.5 candidate; do not use the original M8 untouched rows to select, tune, or retry M8.5.
- [ ] Validate any proposed `tau_soft` or other hard discovery predicate only after `p_final` exists, using an approved recall standard for the strongest final-probability candidates.
- [ ] Prove upward shifts help Higher and hurt Lower, downward shifts help Lower and hurt Higher, and no factor can create a side-independent booster.
- [ ] Freeze a new versioned M8.5 successor only after all factor, calibration, tail, deterministic-output, provenance, and untouched-test gates pass.
- [ ] Keep M8.5 production-disabled until explicit approval and every downstream M9/M10 gate passes.

### M8.5 exit gate

- [ ] `D_base` and `D_final` are distinct, immutable, versioned, and fully traceable.
- [ ] Final category ordering can consume only `p_final`, then `P(Void)`.
- [ ] Hard soft-line filtering remains disabled unless approved recall validation passes.
- [ ] Focused factor and final-distribution tests plus the complete repository verification gate pass.
- [ ] A new untouched-test acceptance decision is preserved immutably.

---

## M9 — Real Batter Hits ranking'''

if text.count(m8_anchor) != 1:
    raise SystemExit(f'Expected one M8-to-M9 anchor, found {text.count(m8_anchor)}')
text = text.replace(m8_anchor, m8_replacement)

old_archive = '''- [x] Begin prospective board archiving and grading — the live July 31, 2026 Underdog Batter Hits board was captured through the connected frozen M8 runtime into one immutable 30-row archive at `artifacts/board-archives/batter-hits/2026-07-31.json`, archive SHA-256 `ae8803b5625662e483f1b6f52e715f55a671a3c9d777ae7ec1aa65fda1bedc8c`. Exact player, game, market, side, line, probabilities, complete distributions, model versions, settlement version, and provider snapshot hashes were preserved. The official-Hits grader uses exact provider game and player IDs, settles Higher/Lower including integer-line voids, refuses to persist incomplete grading, and reported 30 pending, 0 unresolved rows while the game was not final. Archive and grading tests passed 10 of 10; the integrated focused gate passed 24 of 24 and the complete repository verification passed 360 of 360. Production ranking remained disabled and untouched-test rows remained sealed.'''

new_archive = '''- [x] Implement prospective board archiving and grading — the archiver preserves exact offer identity, complete distributions, model and settlement versions, provider snapshot hashes, and immutable-per-date behavior; the official-Hits grader uses exact provider game and player IDs, settles Higher/Lower including integer-line voids, and refuses to persist incomplete grading. Archive and grading tests passed 10 of 10; the integrated focused gate passed 24 of 24 and the complete repository verification passed 360 of 360. Production ranking remained disabled and untouched-test rows remained sealed.
- [ ] Recover and verify the July 31 live archive evidence — the runtime reported 30 rows at `artifacts/board-archives/batter-hits/2026-07-31.json` with claimed SHA-256 `ae8803b5625662e483f1b6f52e715f55a671a3c9d777ae7ec1aa65fda1bedc8c`, and a grading file at `artifacts/board-archives/batter-hits/grades/2026-07-31.json` with claimed SHA-256 `998b8158e2156756c4efec5aec21ebac049232657ae171dd49066fb51e4628d6`. The archive path built confirmed-only runtime observations, so no projected lineup row was coerced. Recover the exact original runtime files unchanged, verify both hashes, and preserve an approved immutable evidence receipt; do not regenerate, rewrite, or relabel the July 31 records.'''

if text.count(old_archive) != 1:
    raise SystemExit(f'Expected one July 31 archive item, found {text.count(old_archive)}')
text = text.replace(old_archive, new_archive)

old_sort = '- [ ] Sort by `P(Win | grades)`, then `P(Void)`.'
new_sort = '- [ ] Sort only by final `p_final=P(Win | grades)`, then `P(Void)`; base probability, softness margin, context delta, price, multiplier, and discovery labels cannot alter order.'
if text.count(old_sort) != 1:
    raise SystemExit(f'Expected one M10 sort item, found {text.count(old_sort)}')
text = text.replace(old_sort, new_sort)

changelog_anchor = '''## Changelog

### Version 2.9 — 2026-07-31'''
changelog_replacement = '''## Changelog

### Version 3.0 — 2026-08-01

- Added the explicit M8 Bridge that preserves frozen M8 as immutable `D_base` and requires a versioned base-evaluation envelope before M8.5.
- Added audit-only exact side-and-line `p_base` discovery while keeping `tau_soft` and hard offer exclusion disabled until final-model recall validation exists.
- Added the separately versioned M8.5 `D_final` sequence, typed context-factor effect families, current-season validation, new untouched-cohort requirement, and final exact settlement rules.
- Locked team-specific bullpen work to replace generic bullpen outcome assumptions while preserving the validated starter-to-bullpen workload transition.
- Corrected July 31 evidence status: archive/grader implementation is verified, but exact original archive and grading bytes remain an open recovery-and-hash-verification gate and may not be regenerated or rewritten.
- Clarified M10 ordering uses only final `p_final`, then `P(Void)`.

### Version 2.9 — 2026-07-31'''

if text.count(changelog_anchor) != 1:
    raise SystemExit(f'Expected one changelog anchor, found {text.count(changelog_anchor)}')
text = text.replace(changelog_anchor, changelog_replacement)

path.write_text(text)
