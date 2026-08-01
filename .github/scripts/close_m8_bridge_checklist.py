from pathlib import Path

path = Path('PROJECT_CHECKLIST.md')
text = path.read_text()

if '**Version:** 3.0' not in text:
    raise SystemExit('Expected checklist Version 3.0')
text = text.replace('**Version:** 3.0', '**Version:** 3.1', 1)

start = text.index('## M8 Bridge — Frozen base-distribution handoff')
end = text.index('\n---\n\n## M8.5 — Context-adjusted Batter Hits successor', start)
section = text[start:end]
expected_open = section.count('- [ ]')
if expected_open != 16:
    raise SystemExit(f'Expected 16 open M8 Bridge items, found {expected_open}')
section = section.replace('- [ ]', '- [x]')
section += """

M8 Bridge completion evidence — `M8BatterHitsBaseEvaluationV1` and the reusable `m8-batter-hits-base-distribution-v1` contract preserve the frozen M8 distribution as immutable `D_base`, settle every exact surviving offer through core settlement, retain complete player/game/lineup/starter/provider/model/artifact lineage, hash the base distribution and shared scenario identity, and keep discovery audit-only with no runtime `tau_soft` or hard exclusion. Focused regressions proved exact parity with the existing frozen M8 output, one-object baseline/altline reuse, Higher/Lower symmetry, integer-line voids, projected/confirmed invariance, deterministic reruns, and tamper rejection. GitHub Actions verify run 492 passed 350 of 350 tests with typecheck, script checks, architecture, build, selected-side, and protective-architecture gates clean. Production ranking remained disabled and untouched-test evidence remained sealed.
"""
text = text[:start] + section + text[end:]

old_archive = """- [x] Implement prospective board archiving and grading — the archiver preserves exact offer identity, complete distributions, model and settlement versions, provider snapshot hashes, and immutable-per-date behavior; the official-Hits grader uses exact provider game and player IDs, settles Higher/Lower including integer-line voids, and refuses to persist incomplete grading. Archive and grading tests passed 10 of 10; the integrated focused gate passed 24 of 24 and the complete repository verification passed 360 of 360. Production ranking remained disabled and untouched-test rows remained sealed."""
new_archive = """- [ ] Implement prospective board archiving and grading — the prior implementation remains isolated in blocked PR #21 and is intentionally absent from this clean M8 amendment branch. Do not mark M9 archive/grading complete or merge its claimed live evidence until the exact July 31 runtime files are recovered and verified unchanged, or the implementation is separately re-established under an approved evidence plan."""
if text.count(old_archive) != 1:
    raise SystemExit(f'Expected one inherited M9 archive claim, found {text.count(old_archive)}')
text = text.replace(old_archive, new_archive)

changelog_anchor = '## Changelog\n\n### Version 3.0 — 2026-08-01'
changelog_replacement = """## Changelog

### Version 3.1 — 2026-08-01

- Closed the M8 Bridge after direct projected/confirmed runtime compliance and the immutable `M8BatterHitsBaseEvaluationV1` handoff passed.
- Added one reusable, hash-verified `D_base` per identical baseball-input identity and exact side-and-line settlement for baseline and alternate offers without rebuilding the distribution.
- Preserved complete model, settlement, provider, lineup, opposing-starter, artifact, and shared-scenario lineage while keeping discovery audit-only and `tau_soft` absent.
- Recorded Higher/Lower symmetry, integer-line void, deterministic rerun, projected/confirmed invariance, frozen-output parity, and tamper-rejection evidence.
- Recorded GitHub Actions verify run 492 passing 350 of 350 tests with production ranking disabled and untouched-test evidence sealed.
- Corrected the inherited M9 archive/grading status: PR #21 remains isolated and its code and July 31 runtime bytes are not part of the clean M8 amendment branch.
- Left every M8.5 factor, fitting, validation, final-distribution, and production gate unchecked.

### Version 3.0 — 2026-08-01"""
if text.count(changelog_anchor) != 1:
    raise SystemExit(f'Expected one changelog anchor, found {text.count(changelog_anchor)}')
text = text.replace(changelog_anchor, changelog_replacement)

path.write_text(text)
