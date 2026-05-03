import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("next CLI surfaces", () => {
  test("supports hook resources and generic add/remove/list/info", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-generic-"));
    const skillDir = join(root, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["add", "skill", `path:${skillDir}`, "--id", "repo-conventions", "--targets", "codex"],
      { cwd: root }
    );
    await runCli(
      ["hook", "add", "--id", "pre-apply", "--content", "echo before", "--targets", "codex"],
      { cwd: root }
    );

    expect(await runCli(["list"], { cwd: root })).toContain("skill:repo-conventions");
    expect(await runCli(["list", "--kind", "hook"], { cwd: root })).toContain("hook:pre-apply");
    expect(await runCli(["info", "skill:repo-conventions"], { cwd: root })).toContain("repo-conventions");
    expect(await runCli(["hook", "list"], { cwd: root })).toContain("pre-apply");

    await runCli(["remove", "skill:repo-conventions"], { cwd: root });
    await runCli(["hook", "remove", "pre-apply"], { cwd: root });

    expect(await runCli(["list"], { cwd: root })).not.toContain("skill:repo-conventions");
    expect(await runCli(["hook", "list"], { cwd: root })).not.toContain("pre-apply");
  });

  test("supports lock explain/refresh/verify plus diff and update", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-lock-"));
    const skillDir = join(root, "skills", "web-design");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Web Design\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "web-design", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );

    const diffBefore = await runCli(["diff"], { cwd: root });
    expect(diffBefore).toContain("pending");

    await runCli(["lock", "refresh"], { cwd: root });
    expect(await runCli(["lock", "verify"], { cwd: root })).toContain("lock ok");
    expect(await runCli(["lock", "explain"], { cwd: root })).toContain("web-design");

    await runCli(["apply"], { cwd: root });
    expect(await runCli(["diff"], { cwd: root })).toContain("clean");

    await writeFile(join(skillDir, "SKILL.md"), "# Web Design\n\nupdated\n", "utf8");
    expect(await runCli(["update"], { cwd: root })).toContain("updated 1 resource");
    expect(await readFile(join(root, "use0-kit.lock.json"), "utf8")).toContain("web-design");
  });
});
