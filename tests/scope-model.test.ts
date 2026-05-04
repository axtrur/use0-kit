import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("scope model", () => {
  test("initializes global and user scopes in XDG locations and reports ordered scope chain", async () => {
    const prevConfig = process.env.XDG_CONFIG_HOME;
    const prevData = process.env.XDG_DATA_HOME;
    const prevState = process.env.XDG_STATE_HOME;
    const root = await mkdtemp(join(tmpdir(), "use0-kit-scope-model-"));
    const xdgConfig = join(root, "config");
    const xdgData = join(root, "data");
    const xdgState = join(root, "state");
    const workspaceRoot = join(root, "workspace");
    const projectRoot = join(workspaceRoot, "apps", "web");

    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;
    process.env.XDG_STATE_HOME = xdgState;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      await runCli(["scope", "init", "--scope", "user"], { cwd: root });
      await runCli(["scope", "init", "--scope", "workspace", "--root", workspaceRoot], {
        cwd: workspaceRoot
      });
      await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });
      await runCli(["scope", "init", "--scope", "session"], { cwd: projectRoot });

      await expect(access(join(xdgData, "use0-kit", "global", "use0-kit.toml"))).resolves.toBeUndefined();
      await expect(access(join(xdgConfig, "use0-kit", "use0-kit.toml"))).resolves.toBeUndefined();
      await expect(access(join(workspaceRoot, "use0-kit.toml"))).resolves.toBeUndefined();
      await expect(access(join(projectRoot, "use0-kit.toml"))).resolves.toBeUndefined();
      await expect(access(join(projectRoot, ".use0-kit", "session", "use0-kit.toml"))).resolves.toBeUndefined();

      const scopeList = await runCli(["scope", "list"], { cwd: projectRoot });
      const scopeListJson = JSON.parse(await runCli(["scope", "list", "--json"], { cwd: projectRoot })) as {
        scopes: Array<{ name: string; active: boolean; path: string }>;
        effectiveOrder: string[];
      };
      const currentScope = await runCli(["scope", "current"], { cwd: projectRoot });
      const scopePath = await runCli(["scope", "path", "--scope", "global"], { cwd: projectRoot });
      const sessionPath = await runCli(["scope", "path", "--scope", "session"], { cwd: projectRoot });
      const inspectScope = await runCli(["scope", "inspect", "--scope", "workspace"], {
        cwd: projectRoot
      });
      const inspectSession = await runCli(["scope", "inspect", "--scope", "session"], {
        cwd: projectRoot
      });

      expect(scopeList).toContain("builtin");
      expect(scopeList).toContain("global");
      expect(scopeList).toContain("user");
      expect(scopeList).toContain("workspace");
      expect(scopeList).toContain("project");
      expect(scopeList).toContain("session");
      expect(scopeList).toContain("builtin < global < user < workspace < project < session");
      expect(scopeListJson.scopes).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "session", active: true })])
      );
      expect(scopeListJson.effectiveOrder).toEqual(["builtin", "global", "user", "workspace", "project", "session"]);
      expect(currentScope).toContain("session");
      expect(scopePath).toContain(join(xdgData, "use0-kit", "global"));
      expect(sessionPath).toContain(join(projectRoot, ".use0-kit", "session"));
      expect(inspectScope).toContain(join(workspaceRoot, "use0-kit.toml"));
      expect(inspectScope).toContain("scope=workspace");
      expect(inspectScope).toContain("resources=0");
      expect(inspectSession).toContain(join(projectRoot, ".use0-kit", "session", "use0-kit.toml"));
    } finally {
      if (prevConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prevConfig;
      if (prevData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = prevData;
      if (prevState === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = prevState;
    }
  });

  test("supports manifest-declared scope parents with pack selector sync", async () => {
    const prevConfig = process.env.XDG_CONFIG_HOME;
    const prevData = process.env.XDG_DATA_HOME;
    const prevState = process.env.XDG_STATE_HOME;
    const root = await mkdtemp(join(tmpdir(), "use0-kit-scope-parents-"));
    const xdgConfig = join(root, "config");
    const xdgData = join(root, "data");
    const xdgState = join(root, "state");
    const workspaceRoot = join(root, "workspace");
    const projectRoot = join(workspaceRoot, "apps", "web");

    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;
    process.env.XDG_STATE_HOME = xdgState;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });

      const globalRoot = join(xdgData, "use0-kit", "global");
      const skillDir = join(globalRoot, "skills", "global-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Global Skill\n", "utf8");
      await runCli(
        ["skill", "add", "--id", "global-skill", "--source", `path:${skillDir}`, "--targets", "codex"],
        { cwd: globalRoot }
      );
      await runCli(["pack", "init", "frontend", "--scope", "global", "--name", "pack/frontend"], { cwd: root });
      await runCli(["pack", "add", "frontend", "skill:global-skill", "--scope", "global"], { cwd: root });

      const manifestPath = join(projectRoot, "use0-kit.toml");
      const manifest = await readFile(manifestPath, "utf8");
      await writeFile(
        manifestPath,
        manifest +
          '\n[scope]\nmode = "project"\nparents = [{ scope = "global", selector = "pack:frontend", mode = "pin" }]\n',
        "utf8"
      );

      expect(await runCli(["scope", "sync", "--from-parents"], { cwd: projectRoot })).toContain(
        "Synced 2 resource(s) from declared parents"
      );
      const synced = await readFile(manifestPath, "utf8");
      expect(synced).not.toContain('[[profiles]]');
      expect(synced).toContain('[[packs]]');
      expect(synced).toContain('id = "frontend"');
      expect(synced).toContain('[[skills]]');
      expect(synced).toContain('id = "global-skill"');
      expect(await runCli(["scope", "explain", "skill:global-skill"], { cwd: projectRoot })).toContain(
        "pack frontend"
      );
    } finally {
      if (prevConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prevConfig;
      if (prevData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = prevData;
      if (prevState === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = prevState;
    }
  });

  test("session scope overrides project in scoped explain and effective listing", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-session-precedence-"));
    const projectRoot = join(root, "project");

    await mkdir(projectRoot, { recursive: true });
    await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });
    await runCli(["scope", "init", "--scope", "session"], { cwd: projectRoot });

    await runCli(
      ["command", "add", "inline:echo%20project", "--id", "shared-cmd", "--targets", "codex"],
      { cwd: projectRoot }
    );
    await runCli(
      ["command", "add", "inline:echo%20session", "--id", "shared-cmd", "--targets", "codex"],
      { cwd: join(projectRoot, ".use0-kit", "session") }
    );

    expect(await runCli(["list", "--effective"], { cwd: projectRoot })).toContain("command:shared-cmd");
    expect(await runCli(["scope", "explain", "command:shared-cmd"], { cwd: projectRoot })).toContain(
      "result: session wins"
    );
  });

  test("scope inspect supports kind and agent filtering", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-scope-inspect-filters-"));

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["command", "add", "--id", "codex-only", "--content", "echo codex", "--targets", "codex"],
      { cwd: root }
    );
    await runCli(
      ["command", "add", "--id", "cursor-only", "--content", "echo cursor", "--targets", "cursor"],
      { cwd: root }
    );
    const skillDir = join(root, ".use0-kit", "sources", "skills", "repo-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Skill\n", "utf8");
    await runCli(["skill", "add", "--id", "repo-skill", "--source", `path:${skillDir}`, "--targets", "codex"], {
      cwd: root
    });
    await runCli(["apply", "--agent", "codex"], { cwd: root });

    const commandsOnly = await runCli(["scope", "inspect", "--scope", "project", "--kind", "command"], { cwd: root });
    expect(commandsOnly).toContain("resources=2");
    expect(commandsOnly).toContain("command:codex-only");
    expect(commandsOnly).toContain("command:cursor-only");
    expect(commandsOnly).not.toContain("skill:repo-skill");

    const codexOnly = await runCli(["scope", "inspect", "--scope", "project", "--kind", "command", "--agent", "codex"], {
      cwd: root
    });
    expect(codexOnly).toContain("resources=1");
    expect(codexOnly).toContain("materialized.command:codex-only=");
    expect(codexOnly).toContain("command:codex-only");
    expect(codexOnly).not.toContain("command:cursor-only");

    const codexOnlyJson = JSON.parse(
      await runCli(["scope", "inspect", "--scope", "project", "--kind", "command", "--agent", "codex", "--json"], {
        cwd: root
      })
    ) as {
      scope: string;
      resources: number;
      selectors: string[];
      materialized?: Record<string, Record<string, string | string[]>>;
    };
    expect(codexOnlyJson.scope).toBe("project");
    expect(codexOnlyJson.resources).toBe(1);
    expect(codexOnlyJson.selectors).toEqual(["command:codex-only"]);
    expect(codexOnlyJson.materialized?.["command:codex-only"]).toBeTruthy();
  });

  test("scope inspect exposes declared parent entries, not just a count", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-scope-inspect-parents-"));

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await writeFile(
      join(root, "use0-kit.toml"),
      [
        (await readFile(join(root, "use0-kit.toml"), "utf8")).trimEnd(),
        "",
        "[scope]",
        'id = "repo"',
        'level = "project"',
        'mode = "project"',
        'canonical_store = ".use0-kit/store"',
        'parents = [{ scope = "user", mode = "inherit" }, { scope = "global", selector = "pack:frontend", mode = "pin" }]',
        ""
      ].join("\n"),
      "utf8"
    );

    const detailed = await runCli(["scope", "inspect", "--scope", "project"], { cwd: root });
    expect(detailed).toContain("parents=2");
    expect(detailed).toContain("parent[0]=scope:user,mode:inherit");
    expect(detailed).toContain("parent[1]=scope:global,selector:pack:frontend,mode:pin");

    const json = JSON.parse(await runCli(["scope", "inspect", "--scope", "project", "--json"], { cwd: root })) as {
      parents: number;
      parentEntries: Array<{ scope: string; selector?: string; mode?: string }>;
    };
    expect(json.parents).toBe(2);
    expect(json.parentEntries).toEqual([
      { scope: "user", mode: "inherit" },
      { scope: "global", selector: "pack:frontend", mode: "pin" }
    ]);
  });
});
