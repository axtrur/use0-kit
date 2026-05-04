import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("lock and update lifecycle", () => {
  test("lock prune removes stale resource entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-prune-"));
    const skillDir = join(root, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );
    await runCli(["lock", "refresh"], { cwd: root });
    await runCli(["skill", "remove", "repo-conventions"], { cwd: root });

    const before = await readFile(join(root, "use0-kit.lock.json"), "utf8");
    expect(before).toContain("skill:repo-conventions");

    await runCli(["lock", "prune"], { cwd: root });

    const after = await readFile(join(root, "use0-kit.lock.json"), "utf8");
    expect(after).not.toContain("skill:repo-conventions");
  });

  test("top-level prune delegates to lock prune", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-top-level-prune-"));
    const skillDir = join(root, "skills", "repo-conventions");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );
    await runCli(["lock", "refresh"], { cwd: root });
    await runCli(["remove", "skill:repo-conventions"], { cwd: root });

    expect(await runCli(["prune"], { cwd: root })).toContain("pruned 1 resource");
    const after = await readFile(join(root, "use0-kit.lock.json"), "utf8");
    expect(after).not.toContain("skill:repo-conventions");
  });

  test("update --all ignores selector narrowing and refreshes the full lock state", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-update-all-"));
    const skillDir = join(root, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );
    await runCli(
      ["command", "add", "security-scan", `inline:${encodeURIComponent("echo scan\n")}`, "--targets", "claude-code"],
      { cwd: root }
    );

    expect(await runCli(["update", "skill:repo-conventions", "--all"], { cwd: root })).toContain("updated 2 resource");
    const lock = await readFile(join(root, "use0-kit.lock.json"), "utf8");
    expect(lock).toContain("skill:repo-conventions");
    expect(lock).toContain("command:security-scan");
  });

  test("update --recursive --lock refreshes nested project locks", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-recursive-"));
    const workspaceRoot = join(root, "workspace");
    const projectRoot = join(workspaceRoot, "apps", "web");
    const skillDir = join(projectRoot, "skills", "web-design");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Web Design\n", "utf8");

    await runCli(["scope", "init", "--scope", "workspace", "--root", workspaceRoot], {
      cwd: workspaceRoot
    });
    await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });
    await runCli(
      ["skill", "add", "--id", "web-design", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: projectRoot }
    );
    await runCli(["lock", "refresh"], { cwd: projectRoot });

    await writeFile(join(skillDir, "SKILL.md"), "# Web Design\n\nchanged\n", "utf8");

    const output = await runCli(["update", "--recursive", "--lock"], { cwd: workspaceRoot });

    expect(output).toContain("updated 1 resource");
    expect(await runCli(["lock", "verify"], { cwd: projectRoot })).toContain("lock ok");
    expect(await readFile(join(projectRoot, "use0-kit.lock.json"), "utf8")).toContain("web-design");
  });

  test("update supports selector filtering and scoped roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-update-scope-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      const globalRoot = join(xdgData, "use0-kit", "global");
      const skillDir = join(globalRoot, "skills", "global-skill");
      const commandDir = join(globalRoot, ".use0-kit", "sources", "commands");
      await mkdir(skillDir, { recursive: true });
      await mkdir(commandDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Global Skill\n", "utf8");
      await writeFile(join(commandDir, "security-scan.md"), "echo scan\n", "utf8");
      await runCli(
        ["skill", "add", "--id", "global-skill", "--source", `path:${skillDir}`, "--targets", "codex"],
        { cwd: globalRoot }
      );
      await runCli(
        ["command", "add", "--id", "security-scan", "--source", `path:${join(commandDir, "security-scan.md")}`, "--targets", "claude-code"],
        { cwd: globalRoot }
      );

      const output = await runCli(["update", "skill:global-skill", "--scope", "global"], { cwd: root });

      expect(output).toContain("updated 1 resource");
      expect(await runCli(["lock", "verify"], { cwd: globalRoot })).toContain("lock ok");
      expect(await readFile(join(globalRoot, "use0-kit.lock.json"), "utf8")).toContain("skill:global-skill");
      expect(await readFile(join(globalRoot, "use0-kit.lock.json"), "utf8")).toContain("command:security-scan");
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });

  test("lock commands support scoped roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-lock-scope-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      const globalRoot = join(xdgData, "use0-kit", "global");
      const skillDir = join(globalRoot, "skills", "global-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Global Skill\n", "utf8");
      await runCli(
        ["skill", "add", "--id", "global-skill", "--source", `path:${skillDir}`, "--targets", "codex"],
        { cwd: globalRoot }
      );

      expect(await runCli(["lock", "refresh", "--scope", "global"], { cwd: root })).toContain("lock refreshed");
      expect(await runCli(["lock", "verify", "--scope", "global"], { cwd: root })).toContain("lock ok");
      expect(await runCli(["lock", "explain", "--scope", "global"], { cwd: root })).toContain("skill:global-skill");

      await runCli(["skill", "remove", "global-skill"], { cwd: globalRoot });
      expect(await runCli(["lock", "prune", "--scope", "global"], { cwd: root })).toContain("pruned 1 resource");
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });

  test("lock refresh captures resolvedRef and materialized paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-lock-rich-state-"));
    const skillDir = join(root, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");
    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await writeFile(
      join(root, "use0-kit.toml"),
      [
        "version = 1",
        'default_scope = "project"',
        "",
        "[scope]",
        'level = "project"',
        'mode = "project"',
        'materialize = "symlink"',
        'canonical_store = ".use0-kit/store"',
        "parents = []",
        "",
        "[agents]",
        'enabled = ["codex"]',
        "",
        "[[skills]]",
        'id = "repo-conventions"',
        `source = "path:${skillDir}"`,
        'ref = "main"',
        'origin_scope = "global"',
        'scope_mode = "pin"',
        'targets = ["codex"]',
        ""
      ].join("\n")
    );

    await runCli(["apply"], { cwd: root });
    await runCli(["lock", "refresh"], { cwd: root });

    const lock = await readFile(join(root, "use0-kit.lock.json"), "utf8");
    expect(lock).toContain('"scope": "project"');
    expect(lock).toContain('"resolvedRef": "main"');
    expect(lock).toContain('"originScope": "global"');
    expect(lock).toContain('"scopeMode": "pin"');
    expect(lock).toContain('"materialized"');
    expect(lock).toContain('.codex/skills/repo-conventions');

    const explained = await runCli(["lock", "explain"], { cwd: root });
    expect(explained).toContain("resolvedRef=main");
    expect(explained).toContain("originScope=global");
    expect(explained).toContain("scopeMode=pin");
    expect(explained).toContain("materialized=");
  });
});
