import { mkdir, readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("skill init and update", () => {
  test("scaffolds a local skill and updates its source and targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-skill-init-"));

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    expect(await runCli(["skill", "init", "repo-conventions", "--targets", "codex"], { cwd: root })).toContain(
      "Initialized skill:repo-conventions"
    );

    const initialInfo = await runCli(["info", "skill:repo-conventions"], { cwd: root });
    expect(initialInfo).toContain("source=path:");
    expect(initialInfo).toContain("targets=codex");
    expect(await readFile(join(root, "skills", "repo-conventions", "SKILL.md"), "utf8")).toContain(
      "Describe the repo-conventions skill here."
    );

    expect(
      await runCli(
        ["skill", "update", "repo-conventions", "inline:Updated%20repo%20conventions", "--targets", "cursor,codex"],
        { cwd: root }
      )
    ).toContain("Updated skill:repo-conventions");

    const updatedInfo = await runCli(["info", "skill:repo-conventions"], { cwd: root });
    expect(updatedInfo).toContain("source=inline:Updated%20repo%20conventions");
    expect(updatedInfo).toContain("targets=cursor,codex");
  });

  test("supports top-level validate and score commands for skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-skill-validate-"));
    const skillDir = join(root, "my-skill");

    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      ["# My Skill", "", "description: useful", "", "```sh", "echo ok", "```"].join("\n"),
      "utf8"
    );

    expect(await runCli(["validate", "skill", skillDir], { cwd: root })).toBe("valid");
    expect(await runCli(["score", "skill", skillDir], { cwd: root })).toBe("score: 100");
  });
});
