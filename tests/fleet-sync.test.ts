import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("fleet sync", () => {
  test("syncs selected resources to multiple fleet targets and applies them", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-fleet-"));
    const sourceRoot = join(root, "source");
    const targetA = join(root, "target-a");
    const targetB = join(root, "target-b");
    const skillDir = join(sourceRoot, "skills", "repo-conventions");

    await runCli(["scope", "init", "--scope", "project"], { cwd: sourceRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: targetA });
    await runCli(["scope", "init", "--scope", "project"], { cwd: targetB });
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n\nFleet baseline.\n", "utf8");
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex,cursor"],
      { cwd: sourceRoot }
    );
    await runCli(["fleet", "add", "dev-a", targetA], { cwd: sourceRoot });
    await runCli(["fleet", "add", "dev-b", targetB], { cwd: sourceRoot });

    expect(await runCli(["fleet", "list"], { cwd: sourceRoot })).toContain("dev-a");
    expect(
      await runCli(["fleet", "sync", "skill:repo-conventions", "--apply", "--agent", "codex"], { cwd: sourceRoot })
    ).toContain("Fleet synced");

    expect(await readFile(join(targetA, "use0-kit.toml"), "utf8")).toContain('id = "repo-conventions"');
    expect(await readFile(join(targetB, "use0-kit.toml"), "utf8")).toContain('id = "repo-conventions"');
    await access(join(targetA, ".codex", "skills", "repo-conventions", "SKILL.md"));
    await access(join(targetB, ".codex", "skills", "repo-conventions", "SKILL.md"));
  });

  test("supports member-filtered fleet sync and fleet remove", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-fleet-filter-"));
    const sourceRoot = join(root, "source");
    const targetA = join(root, "target-a");
    const targetB = join(root, "target-b");
    const commandPath = join(sourceRoot, "commands", "security-scan.md");

    await runCli(["scope", "init", "--scope", "project"], { cwd: sourceRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: targetA });
    await runCli(["scope", "init", "--scope", "project"], { cwd: targetB });
    await mkdir(join(sourceRoot, "commands"), { recursive: true });
    await writeFile(commandPath, "---\nname: Security Scan\n---\n\nRun checks.\n", "utf8");
    await runCli(["command", "add", "--id", "security-scan", "--source", `path:${commandPath}`, "--targets", "codex"], {
      cwd: sourceRoot
    });
    await runCli(["fleet", "add", "dev-a", targetA], { cwd: sourceRoot });
    await runCli(["fleet", "add", "dev-b", targetB], { cwd: sourceRoot });

    expect(
      await runCli(["fleet", "sync", "command:security-scan", "--member", "dev-a"], { cwd: sourceRoot })
    ).toContain("to 1 target(s)");
    expect(await readFile(join(targetA, "use0-kit.toml"), "utf8")).toContain('id = "security-scan"');
    expect(await readFile(join(targetB, "use0-kit.toml"), "utf8")).not.toContain('id = "security-scan"');

    expect(await runCli(["fleet", "remove", "dev-b"], { cwd: sourceRoot })).toContain("Removed fleet:dev-b");
    expect(await runCli(["fleet", "list"], { cwd: sourceRoot })).not.toContain("dev-b");
  });
});
