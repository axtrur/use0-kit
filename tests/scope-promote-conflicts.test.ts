import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";
import { syncScopesDetailed } from "../src/core/reconciliation.js";

describe("scope promote and conflicts", () => {
  test("promotes a project skill into global scope using fork by default", async () => {
    const prevConfig = process.env.XDG_CONFIG_HOME;
    const prevData = process.env.XDG_DATA_HOME;
    const prevState = process.env.XDG_STATE_HOME;
    const root = await mkdtemp(join(tmpdir(), "use0-kit-promote-"));
    const xdgConfig = join(root, "config");
    const xdgData = join(root, "data");
    const xdgState = join(root, "state");
    const projectRoot = join(root, "project");
    const skillDir = join(projectRoot, "skills", "repo-conventions");

    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;
    process.env.XDG_STATE_HOME = xdgState;

    try {
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n\nproject owned\n", "utf8");

      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });
      await runCli(
        ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
        { cwd: projectRoot }
      );

      const output = await runCli(
        ["scope", "promote", "skill:repo-conventions", "--from", projectRoot, "--to", join(xdgData, "use0-kit", "global")],
        { cwd: root }
      );

      expect(output).toContain("Promoted skill:repo-conventions");
      const manifest = await readFile(join(xdgData, "use0-kit", "global", "use0-kit.toml"), "utf8");
      expect(manifest).toContain('id = "repo-conventions"');
      expect(manifest).toContain('.agents/skills/repo-conventions');
      expect(manifest).toContain('scope_mode = "fork"');
    } finally {
      if (prevConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prevConfig;
      if (prevData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = prevData;
      if (prevState === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = prevState;
    }
  });

  test("supports scope promote --publishable by stamping publish metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-promote-publishable-"));
    const fromRoot = join(root, "user");
    const toRoot = join(root, "global");

    await runCli(["scope", "init", "--scope", "user"], { cwd: fromRoot });
    await runCli(["scope", "init", "--scope", "global"], { cwd: toRoot });
    await runCli(["add", "pack", "frontend", "--name", "acme/frontend"], { cwd: fromRoot });

    const output = await runCli(
      ["scope", "promote", "pack:frontend", "--from", fromRoot, "--to", toRoot, "--publishable"],
      { cwd: root }
    );

    expect(output).toContain("Promoted pack:frontend");
    const manifest = await readFile(join(toRoot, "use0-kit.toml"), "utf8");
    expect(manifest).toContain('id = "frontend"');
    expect(manifest).toContain("provenance_published_at = ");
  });

  test("promotes a project skill into user scope using pin by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-promote-pin-"));
    const fromRoot = join(root, "project");
    const toRoot = join(root, "user");
    const skillDir = join(fromRoot, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n\nproject owned\n", "utf8");
    await runCli(["scope", "init", "--scope", "project"], { cwd: fromRoot });
    await runCli(["scope", "init", "--scope", "user"], { cwd: toRoot });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: fromRoot }
    );

    const output = await runCli(
      ["scope", "promote", "skill:repo-conventions", "--from", fromRoot, "--to", toRoot],
      { cwd: root }
    );

    expect(output).toContain("Promoted skill:repo-conventions");
    const manifest = await readFile(join(toRoot, "use0-kit.toml"), "utf8");
    expect(manifest).toContain('scope_mode = "pin"');
    expect(manifest).toContain("pinned_digest = ");
  });

  test("supports fail parent-wins and child-wins conflict policies during sync", async () => {
    const prevConfig = process.env.XDG_CONFIG_HOME;
    const prevData = process.env.XDG_DATA_HOME;
    const prevState = process.env.XDG_STATE_HOME;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    delete process.env.XDG_STATE_HOME;
    const root = await mkdtemp(join(tmpdir(), "use0-kit-conflicts-"));
    const globalRoot = join(root, "global");
    const projectRoot = join(root, "project");
    const globalSkill = join(globalRoot, "skills", "web-design");
    const projectSkill = join(projectRoot, "skills", "web-design");

    await mkdir(globalSkill, { recursive: true });
    await mkdir(projectSkill, { recursive: true });
    await writeFile(join(globalSkill, "SKILL.md"), "# Web Design\n\nglobal\n", "utf8");
    await writeFile(join(projectSkill, "SKILL.md"), "# Web Design\n\nproject\n", "utf8");

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: globalRoot });
      await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });
      await runCli(
        ["skill", "add", "--id", "web-design", "--source", `path:${globalSkill}`, "--targets", "codex"],
        { cwd: globalRoot }
      );
      await runCli(
        ["skill", "add", "--id", "web-design", "--source", `path:${projectSkill}`, "--targets", "codex"],
        { cwd: projectRoot }
      );

      await expect(
        runCli(
          ["scope", "sync", "--from", globalRoot, "--to", projectRoot, "skill:web-design", "--mode", "inherit", "--conflict", "fail"],
          { cwd: root }
        )
      ).rejects.toThrow("Conflict");

      await runCli(
        ["scope", "sync", "--from", globalRoot, "--to", projectRoot, "skill:web-design", "--mode", "inherit", "--conflict", "child-wins"],
        { cwd: root }
      );
      expect(await readFile(join(projectRoot, "use0-kit.toml"), "utf8")).toContain(`path:${projectSkill}`);

      await runCli(
        ["scope", "sync", "--from", globalRoot, "--to", projectRoot, "skill:web-design", "--mode", "inherit", "--conflict", "parent-wins"],
        { cwd: root }
      );
      expect(await readFile(join(projectRoot, "use0-kit.toml"), "utf8")).toContain(`path:${globalSkill}`);
    } finally {
      if (prevConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prevConfig;
      if (prevData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = prevData;
      if (prevState === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = prevState;
    }
  });

  test("uses target policy on_conflict when sync flag is omitted", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-conflicts-policy-"));
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

    await writeFile(
      join(projectRoot, "use0-kit.toml"),
      [(await readFile(join(projectRoot, "use0-kit.toml"), "utf8")).trimEnd(), "", "[policy]", 'on_conflict = "skip"', ""].join("\n"),
      "utf8"
    );

    expect(
      await runCli(["scope", "sync", "--from", globalRoot, "--to", projectRoot, "skill:repo-conventions", "--mode", "inherit"], {
        cwd: root
      })
    ).toContain(`from ${globalRoot} to ${projectRoot}`);
    expect(await readFile(join(projectRoot, "use0-kit.toml"), "utf8")).toContain(`path:${projectSkill}`);
  });

  test("rejects conflict ask mode in non-interactive runs instead of silently overwriting", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-conflicts-ask-"));
    const globalRoot = join(root, "global");
    const projectRoot = join(root, "project");
    const globalSkill = join(globalRoot, "skills", "web-design");
    const projectSkill = join(projectRoot, "skills", "web-design");

    await mkdir(globalSkill, { recursive: true });
    await mkdir(projectSkill, { recursive: true });
    await writeFile(join(globalSkill, "SKILL.md"), "# Web Design\n\nglobal\n", "utf8");
    await writeFile(join(projectSkill, "SKILL.md"), "# Web Design\n\nproject\n", "utf8");
    await runCli(["scope", "init", "--scope", "global"], { cwd: globalRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });
    await runCli(
      ["skill", "add", "--id", "web-design", "--source", `path:${globalSkill}`, "--targets", "codex"],
      { cwd: globalRoot }
    );
    await runCli(
      ["skill", "add", "--id", "web-design", "--source", `path:${projectSkill}`, "--targets", "codex"],
      { cwd: projectRoot }
    );

    await expect(
      runCli(
        ["scope", "sync", "--from", globalRoot, "--to", projectRoot, "skill:web-design", "--mode", "inherit", "--conflict", "ask"],
        { cwd: root }
      )
    ).rejects.toThrow("requires an interactive TTY");

    expect(await readFile(join(projectRoot, "use0-kit.toml"), "utf8")).toContain(`path:${projectSkill}`);
  });

  test("resolves ask conflicts through an explicit resolver when one is provided", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-conflicts-ask-resolver-"));
    const globalRoot = join(root, "global");
    const projectRoot = join(root, "project");
    const globalSkill = join(globalRoot, "skills", "web-design");
    const projectSkill = join(projectRoot, "skills", "web-design");

    await mkdir(globalSkill, { recursive: true });
    await mkdir(projectSkill, { recursive: true });
    await writeFile(join(globalSkill, "SKILL.md"), "# Web Design\n\nglobal\n", "utf8");
    await writeFile(join(projectSkill, "SKILL.md"), "# Web Design\n\nproject\n", "utf8");
    await runCli(["scope", "init", "--scope", "global"], { cwd: globalRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });
    await runCli(
      ["skill", "add", "--id", "web-design", "--source", `path:${globalSkill}`, "--targets", "codex"],
      { cwd: globalRoot }
    );
    await runCli(
      ["skill", "add", "--id", "web-design", "--source", `path:${projectSkill}`, "--targets", "codex"],
      { cwd: projectRoot }
    );

    await syncScopesDetailed({
      fromRoot: globalRoot,
      toRoot: projectRoot,
      selector: "skill:web-design",
      mode: "inherit",
      conflict: "ask",
      conflictResolver: async () => "parent-wins"
    });

    expect(await readFile(join(projectRoot, "use0-kit.toml"), "utf8")).toContain(`path:${globalSkill}`);
  });

  test("supports scope fork command as a dedicated alias for fork sync mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-scope-fork-"));
    const sourceRoot = join(root, "source");
    const forkRoot = join(root, "fork");
    const skillDir = join(sourceRoot, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n\nsource owned\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: sourceRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: forkRoot });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: sourceRoot }
    );

    const output = await runCli(
      ["scope", "fork", "skill:repo-conventions", "--from", sourceRoot, "--to", forkRoot],
      { cwd: root }
    );

    expect(output).toContain("Forked skill:repo-conventions");
    const manifest = await readFile(join(forkRoot, "use0-kit.toml"), "utf8");
    expect(manifest).toContain(".agents/skills/repo-conventions");
    expect(manifest).toContain('scope_mode = "fork"');
    expect(await readFile(join(forkRoot, ".agents", "skills", "repo-conventions", "SKILL.md"), "utf8")).toContain(
      "source owned"
    );
  });

  test("supports scope sync dry-run previews in text and json forms", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-scope-dry-run-"));
    const fromRoot = join(root, "from");
    const toRoot = join(root, "to");
    const skillDir = join(fromRoot, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n\nsource owned\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: fromRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: toRoot });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: fromRoot }
    );

    const previewText = await runCli(
      ["scope", "sync", "--from", fromRoot, "--to", toRoot, "skill:repo-conventions", "--mode", "pin", "--dry-run"],
      { cwd: root }
    );
    expect(previewText).toContain("ADD\tskill:repo-conventions");

    const before = await readFile(join(toRoot, "use0-kit.toml"), "utf8");
    expect(before).not.toContain('id = "repo-conventions"');

    const previewJson = JSON.parse(
      await runCli(
        [
          "scope",
          "sync",
          "--from",
          fromRoot,
          "--to",
          toRoot,
          "skill:repo-conventions",
          "--mode",
          "pin",
          "--dry-run",
          "--json"
        ],
        { cwd: root }
      )
    ) as {
      mode: string;
      changes: Array<{ selector: string; action: string }>;
    };
    expect(previewJson.mode).toBe("pin");
    expect(previewJson.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ selector: "skill:repo-conventions", action: "ADD" })])
    );

    const after = await readFile(join(toRoot, "use0-kit.toml"), "utf8");
    expect(after).not.toContain('id = "repo-conventions"');
  });

  test("supports scope sync --apply for direct scope-to-scope propagation", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-scope-sync-apply-"));
    const fromRoot = join(root, "from");
    const toRoot = join(root, "to");
    const skillDir = join(fromRoot, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n\nsource owned\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: fromRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: toRoot });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex,cursor"],
      { cwd: fromRoot }
    );

    const output = await runCli(
      ["scope", "sync", "--from", fromRoot, "--to", toRoot, "skill:repo-conventions", "--mode", "pin", "--apply", "--agent", "codex"],
      { cwd: root }
    );

    expect(output).toContain("and applied");
    expect(await readFile(join(toRoot, ".codex", "skills", "repo-conventions", "SKILL.md"), "utf8")).toContain(
      "source owned"
    );
    await expect(readFile(join(toRoot, ".cursor", "skills", "repo-conventions", "SKILL.md"), "utf8")).rejects.toThrow();
  });
});
