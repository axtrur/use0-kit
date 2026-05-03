import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("scope explain", () => {
  test("explains layered winner across global user workspace and project scopes", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-explain-"));
    const xdgConfig = join(root, "config");
    const xdgData = join(root, "data");
    const xdgState = join(root, "state");
    const workspaceRoot = join(root, "workspace");
    const projectRoot = join(workspaceRoot, "apps", "web");
    const globalSkill = join(root, "global-skill");
    const workspaceSkill = join(root, "workspace-skill");
    const projectSkill = join(root, "project-skill");

    await mkdir(globalSkill, { recursive: true });
    await mkdir(workspaceSkill, { recursive: true });
    await mkdir(projectSkill, { recursive: true });
    await writeFile(join(globalSkill, "SKILL.md"), "# Web Design\n", "utf8");
    await writeFile(join(workspaceSkill, "SKILL.md"), "# Web Design\n\nworkspace\n", "utf8");
    await writeFile(join(projectSkill, "SKILL.md"), "# Web Design\n\nproject\n", "utf8");

    const prevConfig = process.env.XDG_CONFIG_HOME;
    const prevData = process.env.XDG_DATA_HOME;
    const prevState = process.env.XDG_STATE_HOME;
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

      await runCli(
        ["skill", "add", "--id", "web-design", "--source", `path:${globalSkill}`, "--targets", "codex"],
        { cwd: join(xdgData, "use0-kit", "global") }
      );
      await runCli(
        ["skill", "add", "--id", "web-design", "--source", `path:${workspaceSkill}`, "--targets", "codex"],
        { cwd: workspaceRoot }
      );
      await runCli(
        ["skill", "add", "--id", "web-design", "--source", `path:${projectSkill}`, "--targets", "codex"],
        { cwd: projectRoot }
      );

      const explained = await runCli(["scope", "explain", "skill:web-design"], { cwd: projectRoot });

      expect(explained).toContain("builtin: not present");
      expect(explained).toContain("global:");
      expect(explained).toContain("workspace:");
      expect(explained).toContain("project:");
      expect(explained).toContain("result: project wins");
      expect(explained).toContain("project-skill");
    } finally {
      if (prevConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prevConfig;
      if (prevData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = prevData;
      if (prevState === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = prevState;
    }
  });

  test("explains inherited pinned and shadowed MCP resolution", async () => {
    const prevConfig = process.env.XDG_CONFIG_HOME;
    const prevData = process.env.XDG_DATA_HOME;
    const prevState = process.env.XDG_STATE_HOME;
    const root = await mkdtemp(join(tmpdir(), "use0-kit-explain-mcp-"));
    const xdgConfig = join(root, "config");
    const xdgData = join(root, "data");
    const xdgState = join(root, "state");
    const globalRoot = join(xdgData, "use0-kit", "global");
    const projectRoot = join(root, "project");
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;
    process.env.XDG_STATE_HOME = xdgState;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });

      await runCli(
        ["mcp", "add", "--id", "context7", "--command", "npx", "--args", "-y,@upstash/context7-mcp", "--targets", "codex"],
        { cwd: globalRoot }
      );
      await runCli(
        ["scope", "sync", "--from", globalRoot, "--to", projectRoot, "mcp:context7", "--mode", "pin"],
        { cwd: root }
      );
      await runCli(
        ["mcp", "add", "--id", "context7", "--command", "node", "--args", "custom.js", "--targets", "codex", "--force"],
        { cwd: projectRoot }
      );

      const explained = await runCli(["scope", "explain", "mcp:context7"], { cwd: projectRoot });

      expect(explained).toContain("global:");
      expect(explained).toContain("project:");
      expect(explained).toContain("shadowed");
      expect(explained).toContain("result: project wins");
      expect(explained).toContain("node");
    } finally {
      if (prevConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prevConfig;
      if (prevData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = prevData;
      if (prevState === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = prevState;
    }
  });

  test("supports scope and agent filtered explain output", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-explain-agent-filter-"));
    const xdgConfig = join(root, "config");
    const xdgData = join(root, "data");
    const projectRoot = join(root, "project");

    const prevConfig = process.env.XDG_CONFIG_HOME;
    const prevData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });

      const globalRoot = join(xdgData, "use0-kit", "global");
      await runCli(
        ["mcp", "add", "--id", "cursor-only", "--command", "npx", "--args", "-y,@scope/server", "--targets", "cursor"],
        { cwd: globalRoot }
      );
      await runCli(
        ["mcp", "add", "--id", "codex-only", "--command", "node", "--args", "server.js", "--targets", "codex"],
        { cwd: projectRoot }
      );

      const scoped = await runCli(["scope", "explain", "mcp:cursor-only", "--scope", "global"], { cwd: projectRoot });
      expect(scoped).toContain("global:");
      expect(scoped).not.toContain("project:");

      const filtered = await runCli(["scope", "explain", "mcp:cursor-only", "--agent", "codex"], { cwd: projectRoot });
      expect(filtered).toContain("global: not targeted to codex");
      expect(filtered).toContain("result: not present");

      const projectFiltered = await runCli(
        ["scope", "explain", "mcp:codex-only", "--scope", "project", "--agent", "codex"],
        { cwd: projectRoot }
      );
      expect(projectFiltered).toContain("project:");
      expect(projectFiltered).toContain("result: project wins");

      const json = JSON.parse(
        await runCli(
          ["scope", "explain", "mcp:cursor-only", "--scope", "global", "--agent", "codex", "--json"],
          { cwd: projectRoot }
        )
      );
      expect(json.selector).toBe("mcp:cursor-only");
      expect(json.scopes).toEqual([
        { scope: "builtin", status: "not present" },
        { scope: "global", status: "not targeted to codex" }
      ]);
      expect(json.result).toBe("not present");

      const winnerJson = JSON.parse(
        await runCli(
          ["scope", "explain", "mcp:codex-only", "--scope", "project", "--agent", "codex", "--json"],
          { cwd: projectRoot }
        )
      );
      expect(winnerJson.winnerScope).toBe("project");
      expect(winnerJson.result).toContain("project wins");
    } finally {
      if (prevConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prevConfig;
      if (prevData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = prevData;
    }
  });
});
