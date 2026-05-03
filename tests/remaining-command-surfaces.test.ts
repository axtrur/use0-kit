import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("remaining command surfaces", () => {
  test("supports mcp enable-disable-test-env, instruction init-read-remove-link, hook test, registry remove, and sync apply", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-remaining-"));
    const fromRoot = join(root, "from");
    const toRoot = join(root, "to");
    const registryPath = join(root, "registry.json");

    await runCli(["scope", "init", "--scope", "project"], { cwd: fromRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: toRoot });

    await runCli(
      [
        "mcp",
        "add",
        "--id",
        "context7",
        "--command",
        "npx",
        "--args",
        "-y,@upstash/context7-mcp",
        "--targets",
        "codex"
      ],
      { cwd: fromRoot }
    );
    await runCli(
      ["instruction", "init", "Testing", "--body", "Run npm test before PRs.", "--targets", "codex"],
      { cwd: fromRoot }
    );
    await runCli(
      ["hook", "add", "--id", "pre-apply", "--content", "echo before", "--targets", "codex"],
      { cwd: fromRoot }
    );
    await runCli(
      ["secret", "add", "--id", "openai", "--env", "OPENAI_API_KEY", "--targets", "codex"],
      { cwd: fromRoot }
    );
    await runCli(["pack", "init", "frontend", "--name", "acme/frontend", "--version", "1.0.0"], {
      cwd: fromRoot
    });
    await runCli(["pack", "add", "frontend", "hook:pre-apply"], { cwd: fromRoot });
    await runCli(["profile", "create", "frontend", "--name", "Frontend"], { cwd: fromRoot });
    await runCli(["profile", "add", "frontend", "pack:frontend"], { cwd: fromRoot });

    expect(await runCli(["mcp", "test", "context7"], { cwd: fromRoot })).toContain("ok");
    expect(await runCli(["mcp", "env", "context7"], { cwd: fromRoot })).toContain("command=npx");
    await runCli(["mcp", "disable", "context7"], { cwd: fromRoot });
    expect(await runCli(["mcp", "list"], { cwd: fromRoot })).toContain("context7 (disabled)");
    await runCli(["mcp", "enable", "context7"], { cwd: fromRoot });
    expect(await runCli(["instruction", "read", "Testing"], { cwd: fromRoot })).toContain("Run npm test");
    await runCli(["instruction", "link", "--agent", "codex"], { cwd: fromRoot });
    expect(await runCli(["hook", "test", "pre-apply"], { cwd: fromRoot })).toContain("echo before");

    await writeFile(
      registryPath,
      JSON.stringify({ items: [{ kind: "skill", id: "web-design", name: "Web Design" }] }, null, 2),
      "utf8"
    );
    await runCli(["registry", "add", "official", registryPath], { cwd: fromRoot });
    expect(await runCli(["registry", "list"], { cwd: fromRoot })).toContain("official");
    await runCli(["registry", "remove", "official"], { cwd: fromRoot });
    expect(await runCli(["registry", "list"], { cwd: fromRoot })).not.toContain("official");

    await runCli(["sync", "--from", fromRoot, "--to", toRoot, "--apply"], { cwd: root });
    expect(await runCli(["mcp", "list"], { cwd: toRoot })).toContain("context7");
    expect(await runCli(["list", "--kind", "secret"], { cwd: toRoot })).toContain("secret:openai");
    expect(await runCli(["list", "--kind", "pack"], { cwd: toRoot })).toContain("pack:frontend");
    expect(await runCli(["list", "--kind", "profile"], { cwd: toRoot })).toContain("profile:frontend");
    expect(await runCli(["hook", "test", "pre-apply"], { cwd: toRoot })).toContain("echo before");

    await runCli(["instruction", "remove-section", "Testing"], { cwd: fromRoot });
    expect(await runCli(["instruction", "read", "Testing"], { cwd: fromRoot })).toContain("Unknown");
  });

  test("supports top-level sync --mode fork with real forked resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-sync-mode-"));
    const fromRoot = join(root, "from");
    const toRoot = join(root, "to");
    const skillDir = join(fromRoot, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n\nsource copy\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: fromRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: toRoot });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: fromRoot }
    );

    expect(await runCli(["sync", "--from", fromRoot, "--to", toRoot, "--mode", "fork"], { cwd: root })).toContain(
      "Synced 1 resource"
    );

    const manifest = await readFile(join(toRoot, "use0-kit.toml"), "utf8");
    expect(manifest).toContain(".agents/skills/repo-conventions");
    expect(manifest).toContain('scope_mode = "fork"');
    expect(await readFile(join(toRoot, ".agents", "skills", "repo-conventions", "SKILL.md"), "utf8")).toContain(
      "source copy"
    );
  });

  test("supports sync --apply with agent filtering", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-sync-apply-agent-"));
    const fromRoot = join(root, "from");
    const toRoot = join(root, "to");
    const skillDir = join(fromRoot, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: fromRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: toRoot });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex,cursor"],
      { cwd: fromRoot }
    );

    expect(
      await runCli(["sync", "--from", fromRoot, "--to", toRoot, "--apply", "--agent", "codex"], { cwd: root })
    ).toContain("Synced 1 resource");
    expect(await readFile(join(toRoot, ".codex", "skills", "repo-conventions", "SKILL.md"), "utf8")).toContain(
      "Repo Conventions"
    );
    await expect(readFile(join(toRoot, ".cursor", "skills", "repo-conventions", "SKILL.md"), "utf8")).rejects.toThrow();
  });
});
