import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readRepositoryFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("canonical Family B guardrails remain synchronized across authorities", async () => {
  const [mathSpec, projectRules, checklist] = await Promise.all([
    readRepositoryFile("CANONICAL_MATH_SPEC.md"),
    readRepositoryFile("PROJECT_RULES.md"),
    readRepositoryFile("PROJECT_CHECKLIST.md"),
  ]);

  assert.match(mathSpec, /\*\*Version:\*\* 1\.15/);
  assert.match(projectRules, /\*\*Version:\*\* 2\.14/);

  assert.ok(
    mathSpec.includes(
      "#### HHR CONDITIONED-HURDLE ZERO COMPONENT RECOVERY\n\n" +
        "The successor hurdle candidate uses the previously approved conditioned-hurdle\n" +
        "zero component.\n\n" +
        "To recover the omitted frozen component reproducibly, fit exactly once on the\n" +
        "approved 5,964-row fitting cohort:\n\n" +
        "target:\n" +
        "    I(T = 0)\n\n" +
        "logistic predictors, in this exact order:\n" +
        "    1. intercept\n" +
        "    2. expectedPlateAppearances\n" +
        "    3. raw lineupSlot\n" +
        "    4. contextHitQualityLogit\n\n" +
        "raw lineupSlot is recovered from the frozen fitting fixture as:\n" +
        "    lineupSlot = 4 * centeredLineupSlot + 5\n\n" +
        "The recovered historical coefficient vector is:\n\n" +
        "    intercept                   = -0.3156807637\n" +
        "    expectedPlateAppearances    = -0.4421437692\n" +
        "    lineupSlot                  =  0.0101539499\n" +
        "    contextHitQualityLogit      = -1.0649822595\n\n" +
        "A deterministic reconstruction must reproduce each coefficient within 1e-8.\n" +
        "Otherwise fail closed and do not continue.\n\n" +
        "After successful reconstruction these coefficients are frozen. No further\n" +
        "zero-component fitting, predictor changes, model-family changes, coefficient\n" +
        "sweeps, or tolerance changes are permitted for this successor candidate.\n\n" +
        "This recovery changes no positive-count predictors, fitting period, reserved\n" +
        "untouched period, successor gate, calibration rule, ranking rule, or\n" +
        "production status.",
    ),
  );
  assert.ok(mathSpec.includes("### Version 1.13 — 2026-08-17"));

  assert.ok(
    mathSpec.includes(
      "42. Every required Family B posted-line cohort independently\n" +
        "    verifies both Section 14.2 calibration-evidence\n" +
        "    conditions. Voids are excluded. The verification report\n" +
        "    must preserve the calibration-eligible decided-pick\n" +
        "    count, sample-sufficiency state, calibration-agreement\n" +
        "    state, observed wins, expected wins, variance,\n" +
        "    Z statistic, absolute Z, calculation method, and final\n" +
        "    line-cohort verdict.\n\n" +
        "    When individual per-pick probabilities are available,\n" +
        "    verification must use the primary heterogeneous-\n" +
        "    probability calculation defined in Section 14.2. The\n" +
        "    pooled standard-error fallback is permitted only when\n" +
        "    those individual probabilities are unavailable.\n\n" +
        "    A cohort that reaches the minimum sample volume but\n" +
        "    fails calibration agreement remains failed. Lines at\n" +
        "    2.5 and above remain bucketed separately. Aggregate\n" +
        "    calibration passing on shallow-line volume alone is not\n" +
        "    acceptance.",
    ),
  );
  assert.ok(
    mathSpec.includes(
      "43. Family B cross-market coherence is computed and\n" +
        "    reported for related statistics fitted separately.\n" +
        "    Deviation beyond the declared versioned tolerance fails\n" +
        "    closed rather than being silently accepted.",
    ),
  );
  assert.ok(
    mathSpec.includes(
      "44. A Family B distribution failing its calibration gate fails closed for\n" +
        "    production-calibrated output and cannot be described as calibrated,\n" +
        "    accepted, or production-valid. A frozen or otherwise explicitly\n" +
        "    versioned archived Family B distribution may remain eligible for Section\n" +
        "    18 **UNVALIDATED RESEARCH** ranking only when all research-ranking\n" +
        "    requirements are satisfied and the failed or insufficient line-cohort\n" +
        "    calibration state is displayed wherever corresponding evidence exists.\n" +
        "    Calibration failure never authorizes substitution of a shallower line, a\n" +
        "    standard line, a Family A approximation, or any fallback distribution.",
    ),
  );
  assert.ok(
    mathSpec.includes(
      "45. Every market's mathematical family is read from the\n" +
        "    versioned registry in §12.2. No module infers,\n" +
        "    defaults, or substitutes a family at runtime.",
    ),
  );

  assert.ok(
    mathSpec.includes(
      "| Batter Hits + Runs + RBIs | Family B directly fitted composite (8.3.2) |",
    ),
  );
  assert.ok(
    mathSpec.includes(
      "| Batter Runs | Family B directly fitted composite (8.3.2) |",
    ),
  );
  assert.doesNotMatch(
    mathSpec,
    /Runs, RBIs, and Hits \+ Runs \+ RBIs require a tagged-player base-out and lineup-state model\./,
  );

  assert.ok(
    projectRules.includes(
      "CANONICAL_MATH_SPEC.md controls model-family requirements. Where\n" +
        "this document names a specific family for a market, it is a\n" +
        "pointer to the registry, not an independent authority.",
    ),
  );
  assert.doesNotMatch(
    projectRules,
    /must be investigated\nfor approved-source data sufficiency and a tagged-player base-out joint\nmodel\./,
  );

  assert.ok(
    checklist.includes("### Hits + Runs + RBIs — V1 PRIMARY MARKET (M11)"),
  );
  assert.ok(checklist.includes("### Batter Runs — V1 MARKET (M11)"));
  assert.ok(
    checklist.includes(
      "- [ ] Prohibit independent marginal convolution. PRESERVED\n" +
        "      AND UNCHANGED.",
    ),
  );
  assert.ok(checklist.includes("### POST-V1"));
});
