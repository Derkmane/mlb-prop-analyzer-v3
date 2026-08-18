import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const EXPECTED_MAIN_RULES_BLOB = 'bfce686b5bae59c34e13b1d1413b4fa1833417ec';
const OUTPUT_PATH = 'PROJECT_RULES.md';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trimEnd();
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function replaceExactlyOnce(source, oldText, newText, label) {
  const first = source.indexOf(oldText);
  if (first < 0) throw new Error(`${label}: expected source block was not found`);
  if (source.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`${label}: expected source block occurs more than once`);
  }
  return `${source.slice(0, first)}${newText}${source.slice(first + oldText.length)}`;
}

const mainBlob = git('rev-parse', 'origin/main:PROJECT_RULES.md');
if (mainBlob !== EXPECTED_MAIN_RULES_BLOB) {
  throw new Error(`main PROJECT_RULES.md blob changed: expected ${EXPECTED_MAIN_RULES_BLOB}, got ${mainBlob}`);
}

const baseline = execFileSync('git', ['show', 'origin/main:PROJECT_RULES.md'], { encoding: 'utf8' });

const oldVersion = '**Version:** 2.12\\';
const newVersion = '**Version:** 2.13\\';

const oldSection16 = `## 16. Feature enable, disable, and removal --- LOCKED

The central feature registry owns production enable/disable state.

Disabling a feature must fail closed:

-   no new prediction
-   no category eligibility
-   no ranking
-   no silent fallback to old, audit, deprecated, generic,
    implied-probability, or side-independent logic

Removal procedure:

1.  disable the feature in the registry
2.  verify no new production prediction can use it
3.  run architecture checks and the full behavior suite
4.  resolve or explicitly document hidden dependencies
5.  remove the feature folder and registry entry
6.  run dependency-cruiser, type checking, and tests
7.  search active production code for every feature-manifest identifier
8.  confirm historical predictions still load and render without active
    feature code

Zero identifier matches are required in active production code only.
Matches may remain in immutable saved records, historical fixtures, and
explicitly isolated historical compatibility code.

Historical records are never rewritten merely because a feature is
removed.`;

const newSection16 = `## 16. Feature enable, disable, and removal --- LOCKED

The central feature registry owns **production** enable/disable state.

Disabling a feature in the production registry must fail closed for the
production path:

-   no new production prediction
-   no production category eligibility
-   no production ranking
-   no silent fallback to old, audit, deprecated, generic,
    implied-probability, or side-independent logic

A production-disabled feature may participate only in the separately
versioned **research-ranking** path defined in Section 18 when every
Section 18 research-ranking requirement is satisfied. Research ranking
must not change production enablement or make a disabled feature
available to the production prediction path.

Removal procedure:

1.  disable the feature in the registry
2.  verify no new production prediction can use it
3.  run architecture checks and the full behavior suite
4.  resolve or explicitly document hidden dependencies
5.  remove the feature folder and registry entry
6.  run dependency-cruiser, type checking, and tests
7.  search active production code for every feature-manifest identifier
8.  confirm historical predictions still load and render without active
    feature code

Zero identifier matches are required in active production code only.
Matches may remain in immutable saved records, historical fixtures, and
explicitly isolated historical compatibility code.

Historical records are never rewritten merely because a feature is
removed.`;

const oldSection18 = `## 18. Mathematical authority and production readiness --- LOCKED

All production probability calculations must follow
\`CANONICAL_MATH_SPEC.md\`.

No real prop may rank until its distribution builder, eligibility event,
settlement rule, current-season fit, chronological validation, and
calibration status satisfy the canonical requirements.

Synthetic fixtures may be used for architecture and mathematical tests
but must be unmistakably synthetic and may never appear as production
predictions.

Baseline and alternate offers for the same statistic use the same
official-statistic distribution and differ only through posted offer
attributes and settlement.`;

const newSection18 = `## 18. Mathematical authority, research ranking, and production readiness --- LOCKED

All displayed probability calculations must follow
\`CANONICAL_MATH_SPEC.md\`.

**Research ranking** and **production-calibrated probability authorization**
are separate states.

### Research ranking

A real pregame prop may appear in the three product categories as
**UNVALIDATED RESEARCH** when all of the following are true:

-   the market is implemented and the exact posted offer comes from an
    approved production board source
-   the prediction uses a frozen or otherwise explicitly versioned
    current-season fitted distribution already preserved by the repository
    or a committed archive path
-   runtime probability evaluation is deterministic and exact under the
    declared model
-   a versioned market-specific settlement rule and eligibility event are
    available
-   the exact posted Higher or Lower side and line are settled through the
    generic side-aware settlement path
-   category ordering remains \`P(Win | grades)\` descending, then \`P(Void)\`
    ascending
-   any known calibration, distribution-shape, sample-sufficiency, or
    validation failure is preserved and surfaced where corresponding
    evidence exists

Research ranking does not assert that the displayed probability is
calibrated, production-valid, or a validated estimate of true win
probability. Every probability displayed through the research-ranking path
must be visibly labeled **UNVALIDATED RESEARCH**. A known failed cohort may
remain visible for research ranking only if the failure is displayed; it may
not be relabeled as passing, calibrated, or production-valid.

Research ranking may not use synthetic fixtures, an unfitted or unversioned
model, a rejected candidate that was never frozen or otherwise authorized for
archived evaluation, a deprecated model, a generic projection, raw implied
probability, a side-independent score, or another fallback. A failed or
insufficient calibration result never authorizes substitution of a different
line, model family, or probability source.

The central production feature enable/disable state continues to gate
production predictions. A separately versioned research-ranking admission
path may read eligible versioned or committed archived research outputs
without changing production enablement. It must not silently convert a
disabled feature into a production-enabled feature.

### Production calibration and production-valid probability claims

No real prop may be presented as a production-calibrated prediction, and no
displayed probability may be described as calibrated or production-valid,
until its distribution builder, eligibility event, settlement rule,
current-season fit, chronological validation, and calibration status satisfy
all canonical production requirements.

Synthetic fixtures may be used for architecture and mathematical tests but
must be unmistakably synthetic and may never appear as real research-ranked
or production predictions.

Baseline and alternate offers for the same statistic use the same
official-statistic distribution and differ only through posted offer
attributes and settlement.`;

const oldBuildOrder13 = '13. enable real-prop ranking only after acceptance gates pass';
const newBuildOrder13 = `13. enable research ranking only through Section 18's research gate; enable
    production-calibrated real-prop output only after all production
    acceptance gates pass`;

const oldChangelogMarker = `## Changelog

### Version 2.12 — 2026-08-17`;
const newChangelogMarker = `## Changelog

### Version 2.13 — 2026-08-18

-   Separated explicitly labeled research ranking from production-calibrated
    probability authorization so versioned current-season research outputs may
    populate the three product categories without claiming calibration.
-   Required every research-ranked probability to display \`UNVALIDATED
    RESEARCH\` and required known calibration, distribution-shape,
    sample-sufficiency, and validation failures to remain visible where
    corresponding evidence exists.
-   Required research ranking to use approved board sources, a versioned
    current-season fitted distribution, deterministic exact evaluation, a
    versioned settlement/eligibility rule, exact side-and-line settlement, and
    the unchanged canonical ranking order.
-   Prohibited research ranking from using synthetic fixtures, unfitted or
    unversioned models, rejected unfrozen candidates, deprecated/generic/raw
    implied-probability fallbacks, or side-independent scores.
-   Preserved production feature disablement and every production calibration
    requirement for any claim that a probability is calibrated or
    production-valid; research ranking does not production-enable a feature.
-   Clarified Section 16 and the build-order wording only as necessary to keep
    the new research/production distinction internally consistent.

### Version 2.12 — 2026-08-17`;

const transformations = [
  ['version', oldVersion, newVersion],
  ['section-16', oldSection16, newSection16],
  ['section-18', oldSection18, newSection18],
  ['build-order-13', oldBuildOrder13, newBuildOrder13],
  ['changelog-2.13', oldChangelogMarker, newChangelogMarker],
];

let output = baseline;
for (const [label, oldText, newText] of transformations) {
  output = replaceExactlyOnce(output, oldText, newText, label);
}

let reversed = output;
for (const [label, oldText, newText] of [...transformations].reverse()) {
  reversed = replaceExactlyOnce(reversed, newText, oldText, `reverse-${label}`);
}

if (reversed !== baseline) {
  throw new Error('reverse transformation did not reproduce main PROJECT_RULES.md byte-for-byte');
}

const baselineSha = sha256(baseline);
const reversedSha = sha256(reversed);
if (reversedSha !== baselineSha) {
  throw new Error(`reverse SHA-256 mismatch: baseline ${baselineSha}, reversed ${reversedSha}`);
}

writeFileSync(OUTPUT_PATH, output, 'utf8');
console.log(`MAIN_BLOB\t${mainBlob}`);
console.log(`BASELINE_SHA256\t${baselineSha}`);
console.log(`REVERSED_SHA256\t${reversedSha}`);
console.log(`TRANSFORMATIONS\t${transformations.length}`);
console.log(`OUTPUT_SHA256\t${sha256(output)}`);
