import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("generic edit", () => {
  test("returns editable paths for local and resolved remote resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-edit-"));
    const server = createServer((req, res) => {
      if (req.url === "/.well-known/agent-skills") {
        res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
        res.end("# Remote Edit Skill\n");
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind local test server");
    }
    const base = `http://127.0.0.1:${address.port}`;

    try {
      await runCli(["scope", "init", "--scope", "project"], { cwd: root });
      await runCli(
        ["skill", "add", "--id", "remote-edit-skill", "--source", `well-known:${base}`, "--targets", "codex"],
        { cwd: root }
      );
      await runCli(
        ["command", "add", "--id", "security-scan", "--content", "echo hi", "--targets", "codex"],
        { cwd: root }
      );

      const skillPath = await runCli(["edit", "skill:remote-edit-skill"], { cwd: root });
      const commandPath = await runCli(["edit", "command:security-scan"], { cwd: root });

      expect(skillPath).toContain(".use0-kit/cache/normalized-skills");
      expect(await readFile(join(skillPath, "SKILL.md"), "utf8")).toContain("Remote Edit Skill");
      expect(commandPath).toContain(".use0-kit/resources/commands/security-scan.md");
      expect(await readFile(commandPath, "utf8")).toContain("echo hi");
    } finally {
      server.close();
    }
  });
});
