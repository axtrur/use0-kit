import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("--force semantics", () => {
  test("replaces existing declarations only when force is set", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-force-add-"));
    const firstSkill = join(root, "skills", "first");
    const secondSkill = join(root, "skills", "second");

    await mkdir(firstSkill, { recursive: true });
    await mkdir(secondSkill, { recursive: true });
    await writeFile(join(firstSkill, "SKILL.md"), "# First Skill\n", "utf8");
    await writeFile(join(secondSkill, "SKILL.md"), "# Second Skill\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(["skill", "add", `path:${firstSkill}`, "--id", "code-review", "--targets", "codex"], { cwd: root });

    await expect(
      runCli(["skill", "add", `path:${secondSkill}`, "--id", "code-review", "--targets", "codex"], { cwd: root })
    ).rejects.toThrow(/skill:code-review already exists/);

    await runCli(["skill", "add", `path:${secondSkill}`, "--id", "code-review", "--targets", "codex", "--force"], {
      cwd: root
    });

    const manifest = await readFile(join(root, "use0-kit.toml"), "utf8");
    expect(manifest).toContain(`source = "path:${secondSkill}"`);
    expect(manifest).not.toContain(`source = "path:${firstSkill}"`);
  });

  test("does not bypass policy gates", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-force-policy-"));

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await writeFile(
      join(root, "use0-kit.toml"),
      [
        'default_scope = "project"',
        "",
        "[policy]",
        "allow_untrusted_sources = false",
        "",
        "[trust]",
        'allowed_sources = ["path:"]',
        "",
        "[[skills]]",
        'id = "remote-skill"',
        'source = "github:unknown/repo#skills/remote-skill"',
        'targets = ["codex"]',
        ""
      ].join("\n"),
      "utf8"
    );

    await expect(runCli(["apply", "--force"], { cwd: root })).rejects.toThrow(/Policy violation/);
  });

  test("does not overwrite unmanaged materialization targets even when force is set", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-force-unmanaged-"));
    const skillDir = join(root, "skills", "repo-conventions");
    const unmanagedSkillDir = join(root, ".codex", "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await mkdir(unmanagedSkillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");
    await writeFile(join(unmanagedSkillDir, "SKILL.md"), "# User-owned Skill\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(["skill", "add", `path:${skillDir}`, "--id", "repo-conventions", "--targets", "codex"], { cwd: root });

    await expect(runCli(["apply", "--force", "--agent", "codex"], { cwd: root })).rejects.toThrow(
      /Refusing to overwrite unmanaged file/
    );
    expect(await readFile(join(unmanagedSkillDir, "SKILL.md"), "utf8")).toContain("User-owned Skill");
    await expect(access(join(root, ".use0-kit", "materialized.json"))).rejects.toThrow();
  });
});
