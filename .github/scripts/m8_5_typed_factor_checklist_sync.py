from pathlib import Path

path = Path('PROJECT_CHECKLIST.md')
text = path.read_text()

if text.count('**Version:** 3.1') != 1:
    raise SystemExit('Expected exactly one checklist Version 3.1 header')
text = text.replace('**Version:** 3.1', '**Version:** 3.2', 1)

old_contract = '''### Versioned factor contract

- [ ] Replace the scalar-only factor-extension proposal with a typed artifact contract that supports `identity`, `terminal-outcome-vector`, `scenario-mixture`, `opportunity-survival`, `workload-transition`, and `batted-ball-translation` effect types.
- [ ] Require every factor artifact to preserve factor key, status, model version, artifact SHA-256, validation status, active season, application stage, selected-side-input prohibition, required inputs, and source-evidence version.
- [ ] Require unknown, missing, unvalidated, wrong-season, side-dependent, hash-drifted, or unsupported factor artifacts to fail closed or remain explicit identity according to the approved manifest.
- [ ] Prohibit every factor from directly adding or subtracting probability points or reading the selected Higher/Lower side.

### Context factors and order'''

new_contract = '''### Versioned factor contract

- [x] Replace the scalar-only factor-extension proposal with a typed artifact contract that supports `identity`, `terminal-outcome-vector`, `scenario-mixture`, `opportunity-survival`, `workload-transition`, `park-transformation`, and `batted-ball-translation` effect types.
- [x] Require every factor artifact to preserve factor key, status, model version, artifact SHA-256, validation status, active season, application stage, selected-side-input prohibition, direct-probability-effect prohibition, required inputs, source-evidence version, and untouched-test reservation.
- [x] Require unknown, missing, unvalidated, wrong-season, side-dependent, hash-drifted, unsupported, or malformed factor artifacts to fail closed; disabled factors remain one explicit versioned identity effect rather than a silent fallback.
- [x] Prohibit every factor from directly adding or subtracting probability points or reading the selected Higher/Lower side.

Typed factor-contract completion evidence — `M8_5BatterHitsFactorArtifactV1` replaces PR #24's universal scalar coefficient with seven discriminated effect kinds operating only in baseball units. Terminal-outcome vectors require every canonical terminal PA category and conserved probability; scenario mixtures and workload transitions conserve row mass; opportunity-survival effects are monotone; park transformations are handedness- and outcome-specific; batted-ball translation is restricted to approved balls-in-play categories and cannot move K, UBB, IBB, HBP, HR, catcher interference, or `OTHER_PA`. Every artifact is production-disabled, active-season-only, versioned, SHA-256 verified, explicit about required inputs and application stages, forbids selected-side and direct-probability inputs, preserves the untouched-test seal, defaults to an explicit identity effect, and fails closed on unknown keys, missing evidence, wrong season, malformed structures, silent scalar coefficients, or hash drift. Six focused contract tests and GitHub Actions verify run 503 passed 356 of 356 tests with typecheck, script checks, architecture, build, selected-side, and protective-architecture gates clean. No fitted factor, `D_final`, settlement, ranking, or production behavior was added.

### Context factors and order'''

if text.count(old_contract) != 1:
    raise SystemExit(f'Expected one typed-contract checklist block, found {text.count(old_contract)}')
text = text.replace(old_contract, new_contract, 1)

changelog_anchor = '''## Changelog

### Version 3.1 — 2026-08-01'''
changelog_replacement = '''## Changelog

### Version 3.2 — 2026-08-01

- Replaced the rejected scalar-only PR #24 proposal with the versioned `M8_5BatterHitsFactorArtifactV1` typed contract.
- Added distinct identity, terminal-outcome-vector, scenario-mixture, opportunity-survival, workload-transition, park-transformation, and batted-ball-translation effect families.
- Required production-disabled current-season artifacts, deterministic SHA-256 identity, complete evidence lineage, explicit application stages and required inputs, and sealed untouched-test metadata.
- Prohibited selected-side inputs, direct probability changes, universal scalar coefficients, and silent fallbacks; unknown, malformed, wrong-season, unvalidated, or hash-drifted artifacts fail closed.
- Restricted defensive translation to supported balls-in-play categories and preserved non-BIP outcomes outside that effect family.
- Recorded six focused contract tests and GitHub Actions verify run 503 passing 356 of 356 tests; no M8.5 factor or `D_final` implementation was started.

### Version 3.1 — 2026-08-01'''

if text.count(changelog_anchor) != 1:
    raise SystemExit(f'Expected one Version 3.1 changelog anchor, found {text.count(changelog_anchor)}')
text = text.replace(changelog_anchor, changelog_replacement, 1)

path.write_text(text)
