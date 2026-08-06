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

  assert.match(mathSpec, /\*\*Version:\*\* 1\.8/);
  assert.match(projectRules, /\*\*Version:\*\* 2\.10\\/);

  assert.ok(
    mathSpec.includes(
      "42. Every Family B market reports calibration separately at\n" +
        "    each posted line, with lines at 2.5 and above bucketed\n" +
        "    separately. Aggregate calibration passing on\n" +
        "    shallow-line volume alone is not acceptance.",
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
      "44. A Family B distribution failing its calibration gate\n" +
        "    fails closed and cannot reach ranking. It may not be\n" +
        "    replaced by a shallower line, a standard line, a Family\n" +
        "    A approximation, or any fallback distribution.",
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
