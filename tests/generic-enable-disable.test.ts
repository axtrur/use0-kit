import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("generic enable disable", () => {
  test("supports top-level enable/disable for mcp and agent selectors", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-enable-disable-"));

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await mkdir(join(root, ".codex", "skills"), { recursive: true });
    await runCli(
      ["mcp", "add", "--id", "context7", "--command", "npx", "--args", "-y,@upstash/context7-mcp", "--targets", "codex"],
      { cwd: root }
    );

    await runCli(["disable", "mcp:context7"], { cwd: root });
    expect(await runCli(["mcp", "list"], { cwd: root })).toContain("context7 (disabled)");
    await runCli(["enable", "mcp:context7"], { cwd: root });
    expect(await runCli(["mcp", "list"], { cwd: root })).toContain("context7");
    expect(await runCli(["mcp", "list"], { cwd: root })).not.toContain("context7 (disabled)");

    await runCli(["disable", "agent:codex"], { cwd: root });
    expect(await runCli(["agent", "detect"], { cwd: root })).toContain("codex: missing");
    await runCli(["enable", "agent:codex"], { cwd: root });
    expect(await runCli(["agent", "detect"], { cwd: root })).toContain("codex: detected");
  });
});
