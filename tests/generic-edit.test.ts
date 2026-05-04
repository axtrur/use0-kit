import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("generic edit", () => {
  test("returns editable paths for local skill and managed command resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-edit-"));

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    const skillDir = join(root, ".use0-kit", "sources", "skills", "local-edit-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Local Edit Skill\n", "utf8");
    await runCli(
      ["skill", "add", "--id", "local-edit-skill", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );
    await runCli(
      ["command", "add", "--id", "security-scan", "--content", "echo hi", "--targets", "codex"],
      { cwd: root }
    );

    const skillPath = await runCli(["edit", "skill:local-edit-skill"], { cwd: root });
    const commandPath = await runCli(["edit", "command:security-scan"], { cwd: root });

    expect(skillPath).toBe(skillDir);
    expect(await readFile(join(skillPath, "SKILL.md"), "utf8")).toContain("Local Edit Skill");
    expect(commandPath).toContain(".use0-kit/sources/commands/security-scan.md");
    expect(await readFile(commandPath, "utf8")).toContain("echo hi");
  });
});
