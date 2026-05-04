import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("state lock and graph", () => {
  test("writes materialized graph after apply and exposes materialized diff view", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-materialized-"));
    const skillDir = join(root, "skills", "repo-conventions");
    const hookPath = join(root, ".use0-kit", "sources", "hooks", "pre-apply.sh");

    await mkdir(skillDir, { recursive: true });
    await mkdir(join(root, ".use0-kit", "sources", "hooks"), { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");
    await writeFile(hookPath, "echo before\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );
    await runCli(["hook", "add", "--id", "pre-apply", "--content", "echo before", "--targets", "codex"], {
      cwd: root
    });
    await runCli(["secret", "add", "--id", "openai", "--env", "OPENAI_API_KEY", "--targets", "claude-code"], {
      cwd: root
    });
    await runCli(["pack", "init", "frontend", "--name", "acme/frontend", "--version", "1.0.0"], {
      cwd: root
    });
    await runCli(["pack", "add", "frontend", "skill:repo-conventions"], { cwd: root });
    await runCli(
      ["plugin", "add", "path:./plugins/repo-helper", "--id", "repo-helper", "--targets", "codex"],
      { cwd: root }
    );
    await runCli(["apply"], { cwd: root });

    const materialized = await readFile(join(root, ".use0-kit", "materialized.json"), "utf8");
    const state = await readFile(join(root, ".use0-kit", "state.json"), "utf8");
    expect(materialized).toContain("skill:repo-conventions");
    expect(materialized).toContain(".codex/skills/repo-conventions");
    expect(materialized).toContain("hook:pre-apply");
    expect(materialized).toContain(".codex/hooks/pre-apply.sh");
    expect(materialized).toContain("secret:openai");
    expect(materialized).toContain(".claude/secrets/openai.json");
    expect(materialized).toContain("pack:frontend");
    expect(materialized).toContain(".use0-kit/store/packs/frontend.json");
    expect(materialized).toContain("plugin:repo-helper");
    expect(materialized).toContain(".use0-kit/store/plugins/repo-helper.json");
    expect(state).toContain('"backupId"');
    expect(state).toContain('"backups"');
    expect(state).toContain('"detectedAgents"');
    expect(state).toContain('"codex"');
    expect(state).toContain('.codex/config.toml');
    expect(state).toContain('"lastApply"');
    expect((await runCli(["backup", "list"], { cwd: root })).trim().length).toBeGreaterThan(0);
    expect(await runCli(["diff", "--materialized"], { cwd: root })).toContain("materialized: clean");
  });

  test("lock refresh stores richer resource details and verify catches drift", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-lockstate-"));
    const skillDir = join(root, "skills", "web-design");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Web Design\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "web-design", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );

    await runCli(["lock", "refresh"], { cwd: root });
    const lockBefore = await readFile(join(root, "use0-kit.lock.json"), "utf8");
    expect(lockBefore).toContain('"skill:web-design"');
    expect(lockBefore).toContain('"kind": "skill"');
    expect(lockBefore).toContain('"targets"');

    await writeFile(join(skillDir, "SKILL.md"), "# Web Design\n\nchanged\n", "utf8");
    expect(await runCli(["lock", "verify"], { cwd: root })).toContain("lock mismatch");
    expect(await runCli(["lock", "explain"], { cwd: root })).toContain("web-design");
    expect(await runCli(["diff", "--effective"], { cwd: root })).toContain("effective: pending");
  });

  test("materialized diff detects plan drift independently from lock drift", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-materialized-drift-"));
    const skillDir = join(root, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );
    await runCli(["apply"], { cwd: root });
    expect(await runCli(["diff", "--materialized"], { cwd: root })).toContain("materialized: clean");

    await runCli(
      ["command", "add", "--id", "security-scan", "--content", "echo hi", "--targets", "claude-code"],
      { cwd: root }
    );

    expect(await runCli(["diff", "--materialized"], { cwd: root })).toContain("materialized: pending");
  });

  test("diff supports scoped effective/materialized views", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-diff-scope-"));
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

      await runCli(["lock", "refresh"], { cwd: globalRoot });
      expect(await runCli(["diff", "--scope", "global", "--effective"], { cwd: root })).toContain("effective: clean");
      await runCli(["apply", "--scope", "global"], { cwd: root });
      expect(await runCli(["diff", "--scope", "global", "--materialized"], { cwd: root })).toContain(
        "materialized: clean"
      );

      await writeFile(join(skillDir, "SKILL.md"), "# Global Skill\n\nchanged\n", "utf8");
      expect(await runCli(["diff", "--scope", "global", "--effective"], { cwd: root })).toContain(
        "effective: pending"
      );
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });
});
