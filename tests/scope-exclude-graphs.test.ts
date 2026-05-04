import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("scope exclude and graph views", () => {
  test("supports excluding inherited resources from child scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-exclude-"));
    const globalRoot = join(root, "global");
    const projectRoot = join(root, "project");
    const skillDir = join(globalRoot, "skills", "web-design");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Web Design\n", "utf8");

    await runCli(["scope", "init", "--scope", "global"], { cwd: globalRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });
    await runCli(
      ["skill", "add", "--id", "web-design", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: globalRoot }
    );
    await runCli(
      ["scope", "sync", "--from", globalRoot, "--to", projectRoot, "skill:web-design", "--mode", "inherit"],
      { cwd: root }
    );

    await runCli(["scope", "exclude", "skill:web-design"], { cwd: projectRoot });

    const explained = await runCli(["scope", "explain", "skill:web-design"], { cwd: projectRoot });
    const diff = await runCli(["scope", "diff", "--from", globalRoot, "--to", projectRoot], { cwd: root });
    const manifest = await readFile(join(projectRoot, "use0-kit.toml"), "utf8");

    expect(explained).toContain("project: excluded");
    expect(explained).toContain("result: excluded");
    expect(diff).toContain("REMOVED skill:web-design");
    expect(manifest).toContain("[[excludes]]");
    expect(manifest).toContain('selector = "skill:web-design"');
  });

  test("supports conflict skip and merge plus diff effective/materialized flags", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-graphs-"));
    const globalRoot = join(root, "global");
    const projectRoot = join(root, "project");
    const globalSkill = join(globalRoot, "skills", "repo-conventions");
    const projectSkill = join(projectRoot, "skills", "repo-conventions");

    await mkdir(globalSkill, { recursive: true });
    await mkdir(projectSkill, { recursive: true });
    await writeFile(join(globalSkill, "SKILL.md"), "# Repo Conventions\n\nglobal\n", "utf8");
    await writeFile(join(projectSkill, "SKILL.md"), "# Repo Conventions\n\nproject\n", "utf8");

    await runCli(["scope", "init", "--scope", "global"], { cwd: globalRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${globalSkill}`, "--targets", "codex"],
      { cwd: globalRoot }
    );
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${projectSkill}`, "--targets", "codex"],
      { cwd: projectRoot }
    );
    await runCli(
      ["instruction", "init", "Testing", "--id", "testing", "--body", "global body", "--targets", "codex"],
      { cwd: globalRoot }
    );
    await runCli(
      ["instruction", "init", "Testing", "--id", "testing", "--body", "project body", "--targets", "codex"],
      { cwd: projectRoot }
    );

    await runCli(
      ["scope", "sync", "--from", globalRoot, "--to", projectRoot, "skill:repo-conventions", "--mode", "inherit", "--conflict", "skip"],
      { cwd: root }
    );
    expect(await readFile(join(projectRoot, "use0-kit.toml"), "utf8")).toContain(`path:${projectSkill}`);

    await runCli(
      ["scope", "sync", "--from", globalRoot, "--to", projectRoot, "instruction:testing", "--mode", "inherit", "--conflict", "merge"],
      { cwd: root }
    );
    const merged = await readFile(join(projectRoot, "use0-kit.toml"), "utf8");
    expect(merged).toContain(
      `source = "path:${join(projectRoot, ".use0-kit", "sources", "instructions", "testing.md")}"`
    );
    expect(
      await readFile(join(projectRoot, ".use0-kit", "sources", "instructions", "testing.md"), "utf8")
    ).toContain("project body");
    expect(
      await readFile(join(projectRoot, ".use0-kit", "sources", "instructions", "testing.md"), "utf8")
    ).toContain("global body");

    expect(await runCli(["diff", "--effective"], { cwd: projectRoot })).toContain("effective");
    await runCli(["apply"], { cwd: projectRoot });
    expect(await runCli(["diff", "--materialized"], { cwd: projectRoot })).toContain("materialized");
  });
});
