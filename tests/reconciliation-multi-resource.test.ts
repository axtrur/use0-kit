import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("multi-resource reconciliation", () => {
  test("classifies diff for mcp instruction command and hook resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-reconcile-diff-"));
    const globalRoot = join(root, "global");
    const projectRoot = join(root, "project");

    await runCli(["scope", "init", "--scope", "global"], { cwd: globalRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });

    await runCli(
      ["mcp", "add", "--id", "context7", "--command", "npx", "--args", "-y,@upstash/context7-mcp", "--targets", "codex"],
      { cwd: globalRoot }
    );
    await runCli(
      ["instruction", "init", "Testing", "--id", "testing", "--body", "Run npm test.", "--targets", "codex"],
      { cwd: globalRoot }
    );
    await runCli(
      ["command", "add", "--id", "security-scan", "--content", "echo hi", "--targets", "codex"],
      { cwd: globalRoot }
    );
    await runCli(
      ["hook", "add", "--id", "pre-apply", "--content", "echo before", "--targets", "codex"],
      { cwd: globalRoot }
    );

    await runCli(
      ["instruction", "init", "Testing", "--id", "testing", "--body", "Project override.", "--targets", "codex"],
      { cwd: projectRoot }
    );
    await runCli(
      ["command", "add", "--id", "security-scan", "--content", "echo overridden", "--targets", "codex"],
      { cwd: projectRoot }
    );

    const diff = await runCli(
      ["scope", "diff", "--from", globalRoot, "--to", projectRoot, "--kind", "mcp,instruction,command,hook"],
      { cwd: root }
    );

    expect(diff).toContain("ADDED mcp:context7");
    expect(diff).toContain("CHANGED instruction:testing");
    expect(diff).toContain("SHADOWED instruction:testing");
    expect(diff).toContain("CHANGED command:security-scan");
    expect(diff).toContain("SHADOWED command:security-scan");
    expect(diff).toContain("ADDED hook:pre-apply");
  });

  test("supports inherit pin fork and mirror for non-skill resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-reconcile-sync-"));
    const globalRoot = join(root, "global");
    const inheritRoot = join(root, "inherit");
    const forkRoot = join(root, "fork");
    const mirrorRoot = join(root, "mirror");

    await runCli(["scope", "init", "--scope", "global"], { cwd: globalRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: inheritRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: forkRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: mirrorRoot });

    await runCli(
      ["instruction", "init", "Testing", "--id", "testing", "--body", "Run npm test.", "--targets", "codex"],
      { cwd: globalRoot }
    );
    await runCli(
      ["command", "add", "--id", "security-scan", "--content", "echo hi", "--targets", "codex"],
      { cwd: globalRoot }
    );
    await runCli(
      ["hook", "add", "--id", "pre-apply", "--content", "echo before", "--targets", "codex"],
      { cwd: globalRoot }
    );

    await runCli(
      ["scope", "sync", "--from", globalRoot, "--to", inheritRoot, "instruction:testing", "--mode", "inherit"],
      { cwd: root }
    );
    await runCli(
      ["scope", "sync", "--from", globalRoot, "--to", forkRoot, "command:security-scan", "--mode", "fork"],
      { cwd: root }
    );
    await runCli(
      ["scope", "sync", "--from", globalRoot, "--to", mirrorRoot, "--mode", "mirror", "--prune"],
      { cwd: root }
    );
    await runCli(
      ["scope", "sync", "--from", globalRoot, "--to", inheritRoot, "hook:pre-apply", "--mode", "pin"],
      { cwd: root }
    );

    const inherited = await readFile(join(inheritRoot, "use0-kit.toml"), "utf8");
    const forked = await readFile(join(forkRoot, "use0-kit.toml"), "utf8");
    const mirrored = await readFile(join(mirrorRoot, "use0-kit.toml"), "utf8");

    expect(inherited).toContain('origin_scope = "global"');
    expect(inherited).toContain('scope_mode = "inherit"');
    expect(inherited).toContain('pinned_digest = "');
    expect(forked).toContain(".agents/commands/security-scan");
    expect(forked).toContain('scope_mode = "fork"');
    expect(mirrored).toContain('id = "testing"');
    expect(mirrored).toContain('id = "security-scan"');
    expect(mirrored).toContain('id = "pre-apply"');
    expect(mirrored).toContain('scope_mode = "mirror"');
  });
});
