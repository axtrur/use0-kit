import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import { loadGuidelineSpecEntries, runGuidelineSpec } from "./runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const specEntries = await loadGuidelineSpecEntries(join(__dirname, "specs"));

describe.sequential("guideline specs", () => {
  test("docs and executable specs stay linked", async () => {
    const docsDir = join(repoRoot, "docs", "guidelines");
    const guideFiles = (await readdir(docsDir)).filter((entry) => /^GUIDELINE_.*\.md$/.test(entry)).sort();
    const docsFromSpecs = new Set<string>();

    for (const { fileName, spec } of specEntries) {
      expect(fileName, spec.name).toBe(`${spec.name}.guideline.json`);
      expect(spec.doc, fileName).toMatch(/^docs\/guidelines\/GUIDELINE_.*\.md$/);

      const guide = await readFile(join(repoRoot, spec.doc), "utf8");
      expect(guide, spec.doc).toContain(`tests/guidelines/specs/${fileName}`);
      docsFromSpecs.add(spec.doc);
    }

    for (const guideFile of guideFiles) {
      const guidePath = `docs/guidelines/${guideFile}`;
      expect(docsFromSpecs.has(guidePath), `${guidePath} missing executable spec`).toBe(true);
    }
  });

  for (const { spec } of specEntries) {
    test(spec.name, async () => {
      await runGuidelineSpec(spec);
    });
  }
});
