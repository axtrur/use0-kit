import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("mcp server mode", () => {
  test("serves initialize, tools/list, and tools/call for self-management", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-mcp-server-"));
    const skillDir = join(root, "skills", "repo-conventions");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );

    const initialize = JSON.parse(
      await runCli(
        [
          "mcp",
          "serve",
          "--request",
          JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
        ],
        { cwd: root }
      )
    ) as { result: { serverInfo: { name: string } } };
    expect(initialize.result.serverInfo.name).toBe("use0-kit");

    const toolsList = JSON.parse(
      await runCli(
        [
          "mcp",
          "serve",
          "--request",
          JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
        ],
        { cwd: root }
      )
    ) as { result: { tools: Array<{ name: string }> } };
    expect(toolsList.result.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["use0.list", "use0.info", "use0.explain", "use0.plan", "use0.apply", "use0.sync", "use0.doctor"])
    );

    const listCall = JSON.parse(
      await runCli(
        [
          "mcp",
          "serve",
          "--request",
          JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "use0.list", arguments: { selectors: ["skill:repo-conventions"] } }
          })
        ],
        { cwd: root }
      )
    ) as { result: { content: Array<{ text: string }> } };
    expect(listCall.result.content[0].text).toContain("skill:repo-conventions");

    const explainCall = JSON.parse(
      await runCli(
        [
          "mcp",
          "serve",
          "--request",
          JSON.stringify({
            jsonrpc: "2.0",
            id: 4,
            method: "tools/call",
            params: { name: "use0.explain", arguments: { selector: "skill:repo-conventions", json: true } }
          })
        ],
        { cwd: root }
      )
    ) as { result: { content: Array<{ text: string }> } };
    expect(explainCall.result.content[0].text).toContain('"selector": "skill:repo-conventions"');

    const planCall = JSON.parse(
      await runCli(
        [
          "mcp",
          "serve",
          "--request",
          JSON.stringify({
            jsonrpc: "2.0",
            id: 5,
            method: "tools/call",
            params: { name: "use0.plan", arguments: { json: true } }
          })
        ],
        { cwd: root }
      )
    ) as { result: { content: Array<{ text: string }> } };
    expect(planCall.result.content[0].text).toContain('"resourceId": "skill:repo-conventions"');

    const doctorCall = JSON.parse(
      await runCli(
        [
          "mcp",
          "serve",
          "--request",
          JSON.stringify({
            jsonrpc: "2.0",
            id: 6,
            method: "tools/call",
            params: { name: "use0.doctor", arguments: {} }
          })
        ],
        { cwd: root }
      )
    ) as { result: { content: Array<{ text: string }> } };
    expect(doctorCall.result.content[0].text).toContain("manifest-parse:");
  });

  test("supports use0.sync tool calls for current-scope parent resolution", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-mcp-sync-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const projectRoot = join(root, "project");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

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
      await runCli(["pack", "init", "frontend", "--name", "pack/frontend"], { cwd: globalRoot });
      await runCli(["pack", "add", "frontend", "skill:global-skill"], { cwd: globalRoot });
      await writeFile(
        join(projectRoot, "use0-kit.toml"),
        [
          'version = 1',
          'default_scope = "project"',
          '',
          '[scope]',
          'level = "project"',
          'mode = "project"',
          'canonical_store = ".use0-kit/store"',
          'parents = [{ scope = "global", selector = "pack:frontend", mode = "pin" }]',
          '',
          '[agents]',
          'enabled = ["codex"]',
          'materialize = "symlink"'
        ].join("\n") + "\n",
        "utf8"
      );

      const syncCall = JSON.parse(
        await runCli(
          [
            "mcp",
            "serve",
            "--request",
            JSON.stringify({
              jsonrpc: "2.0",
              id: 7,
              method: "tools/call",
              params: { name: "use0.sync", arguments: { agent: "codex" } }
            })
          ],
          { cwd: projectRoot }
        )
      ) as { result: { content: Array<{ text: string }> } };

      expect(syncCall.result.content[0].text).toContain("Synced 2 resource(s) from declared parents and applied");
      expect(await readFile(join(projectRoot, "use0-kit.toml"), "utf8")).toContain('id = "global-skill"');
      await access(join(projectRoot, ".codex", "skills", "global-skill", "SKILL.md"));
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });
});
