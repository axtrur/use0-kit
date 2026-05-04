import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("generic add remove", () => {
  test("supports top-level add/remove across multiple resource kinds", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-generic-add-remove-"));

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["add", "mcp", "context7", "--command", "npx", "--args", "-y,@upstash/context7-mcp", "--targets", "codex"],
      { cwd: root }
    );
    await runCli(
      ["add", "instruction", "testing", "--body", "Run pnpm test before PRs.", "--title", "Testing", "--targets", "codex"],
      { cwd: root }
    );
    await runCli(
      ["add", "command", "security-scan", "inline:echo%20hi", "--targets", "codex"],
      { cwd: root }
    );
    await runCli(
      ["add", "subagent", "backend", "inline:Own%20backend%20changes.", "--targets", "codex"],
      { cwd: root }
    );
    await runCli(
      ["add", "hook", "pre-apply", "inline:echo%20before", "--targets", "codex"],
      { cwd: root }
    );
    await runCli(
      ["add", "pack", "frontend", "--name", "acme/frontend", "--version", "1.0.0"],
      { cwd: root }
    );
    await runCli(["pack", "add", "frontend", "command:security-scan"], { cwd: root });
    await runCli(
      ["add", "plugin", "repo-helper", "path:./plugins/repo-helper", "--targets", "codex"],
      { cwd: root }
    );

    const listOutput = await runCli(["list"], { cwd: root });
    expect(listOutput).toContain("mcp:context7");
    expect(listOutput).toContain("instruction:testing");
    expect(listOutput).toContain("command:security-scan");
    expect(listOutput).toContain("subagent:backend");
    expect(listOutput).toContain("hook:pre-apply");
    expect(listOutput).toContain("pack:frontend");
    expect(listOutput).toContain("plugin:repo-helper");
    expect(await runCli(["info", "plugin:repo-helper"], { cwd: root })).toContain("source=path:./plugins/repo-helper");
    expect(await runCli(["edit", "plugin:repo-helper"], { cwd: root })).toBe(join(root, "plugins", "repo-helper"));
    expect(await runCli(["list", "mcp"], { cwd: root })).toBe("mcp:context7");
    expect(await runCli(["list", "command:security-scan", "pack:frontend"], { cwd: root })).toContain(
      "command:security-scan"
    );
    expect(await runCli(["list", "command:security-scan", "pack:frontend"], { cwd: root })).toContain(
      "pack:frontend"
    );
    expect(await runCli(["list", "command:security-scan", "pack:frontend"], { cwd: root })).not.toContain(
      "mcp:context7"
    );

    await runCli(["remove", "mcp:context7"], { cwd: root });
    await runCli(["remove", "instruction:testing"], { cwd: root });
    await runCli(["remove", "command:security-scan"], { cwd: root });
    await runCli(["remove", "subagent:backend"], { cwd: root });
    await runCli(["remove", "hook:pre-apply"], { cwd: root });
    await runCli(["remove", "pack:frontend"], { cwd: root });
    await runCli(["remove", "plugin:repo-helper"], { cwd: root });

    const after = await runCli(["list"], { cwd: root });
    expect(after).not.toContain("mcp:context7");
    expect(after).not.toContain("instruction:testing");
    expect(after).not.toContain("command:security-scan");
    expect(after).not.toContain("subagent:backend");
    expect(after).not.toContain("hook:pre-apply");
    expect(after).not.toContain("pack:frontend");
    expect(after).not.toContain("plugin:repo-helper");
  });
});
