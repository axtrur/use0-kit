import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { instructionMarkerEnd, instructionMarkerStart, renderInstructions } from "../src/core/instructions.js";

describe("renderInstructions", () => {
  test("renders codex instructions into AGENTS.md-compatible markdown", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-instructions-"));
    const instructionDir = join(root, ".use0-kit", "resources", "instructions");
    const instructionPath = join(instructionDir, "testing.md");

    await mkdir(instructionDir, { recursive: true });
    await writeFile(instructionPath, "## Testing\n\nRun npm test before opening a PR.\n", "utf8");

    const rendered = await renderInstructions({
      root,
      instructions: [
        {
          id: "testing",
          source: `path:${instructionPath}`,
          targets: ["codex"]
        }
      ],
      agentId: "codex"
    });

    expect(rendered.path).toBe(join(root, "AGENTS.md"));
    expect(rendered.content).toContain(instructionMarkerStart("testing"));
    expect(rendered.content).toContain("## Testing");
    expect(rendered.content).toContain("Run npm test before opening a PR.");
    expect(rendered.content).toContain(instructionMarkerEnd("testing"));
    expect(rendered.content.match(/## Testing/g)).toHaveLength(1);
  });
});
