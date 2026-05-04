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
    expect(initialInfo).toContain(".use0-kit/sources/skills/repo-conventions");
    expect(initialInfo).toContain("targets=codex");
    const initializedSkill = await readFile(
      join(root, ".use0-kit", "sources", "skills", "repo-conventions", "SKILL.md"),
      "utf8"
    );
    expect(initializedSkill).toContain("name: repo-conventions");
    expect(initializedSkill).toContain("description:");
    expect(initializedSkill).not.toContain("id: repo-conventions");
    expect(initializedSkill).toContain("Describe the repo-conventions skill here.");

    const updatedSkillDir = join(root, ".use0-kit", "sources", "skills", "updated-conventions");
    await mkdir(updatedSkillDir, { recursive: true });
    await writeFile(join(updatedSkillDir, "SKILL.md"), "# Updated Repo Conventions\n", "utf8");
    expect(
      await runCli(
        ["skill", "update", "repo-conventions", `path:${updatedSkillDir}`, "--targets", "cursor,codex"],
        { cwd: root }
      )
    ).toContain("Updated skill:repo-conventions");

    const updatedInfo = await runCli(["info", "skill:repo-conventions"], { cwd: root });
    expect(updatedInfo).toContain(`source=path:${updatedSkillDir}`);
    expect(updatedInfo).toContain("targets=cursor,codex");
  });

  test("rejects non-directory skill sources", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-skill-source-shape-"));
    const skillFile = join(root, "SKILL.md");
    const skillDir = join(root, "skills", "valid-skill");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await writeFile(skillFile, "# Single File Skill\n", "utf8");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Valid Skill\n", "utf8");

    await expect(
      runCli(["skill", "add", "--id", "single-file", "--source", `path:${skillFile}`, "--targets", "codex"], {
        cwd: root
      })
    ).rejects.toThrow(/Skill source must be a directory/);
    await expect(
      runCli(["skill", "add", "--id", "inline-skill", "--source", "inline:Nope", "--targets", "codex"], {
        cwd: root
      })
    ).rejects.toThrow(/Skill source must be a directory/);

    await runCli(["skill", "add", "--id", "valid-skill", "--source", `path:${skillDir}`, "--targets", "codex"], {
      cwd: root
    });
    await expect(
      runCli(["skill", "update", "valid-skill", "inline:Nope"], {
        cwd: root
      })
    ).rejects.toThrow(/Skill source must be a directory/);
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
