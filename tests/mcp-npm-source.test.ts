import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("mcp npm source alias", () => {
  test("expands --npm into stdio npx configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-mcp-npm-"));

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["mcp", "add", "--id", "postgres", "--npm", "@modelcontextprotocol/server-postgres", "--targets", "codex"],
      { cwd: root }
    );

    const manifest = await readFile(join(root, "use0-kit.toml"), "utf8");
    const rendered = await runCli(["mcp", "render", "--agent", "codex"], { cwd: root });

    expect(manifest).toContain('command = "npx"');
    expect(manifest).toContain('"@modelcontextprotocol/server-postgres"');
    expect(manifest).toContain('transport = "stdio"');
    expect(rendered).toContain('command = "npx"');
    expect(rendered).toContain('"@modelcontextprotocol/server-postgres"');
  });

  test("supports npm source references in namespaced and generic add flows", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-mcp-npm-source-ref-"));

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["mcp", "add", "filesystem", "--source", "npm:@modelcontextprotocol/server-filesystem", "--targets", "codex"],
      { cwd: root }
    );
    await runCli(
      ["add", "mcp", "github", "--source", "npm:@modelcontextprotocol/server-github", "--targets", "codex"],
      { cwd: root }
    );

    const manifest = await readFile(join(root, "use0-kit.toml"), "utf8");
    const rendered = await runCli(["mcp", "render", "--agent", "codex"], { cwd: root });

    expect(manifest).toContain('"@modelcontextprotocol/server-filesystem"');
    expect(manifest).toContain('"@modelcontextprotocol/server-github"');
    expect(rendered).toContain("@modelcontextprotocol/server-filesystem");
    expect(rendered).toContain("@modelcontextprotocol/server-github");
  });
});
