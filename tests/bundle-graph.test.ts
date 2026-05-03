import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("bundle graph resources", () => {
  test("scope sync expands pack resources including subagents and secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-pack-sync-"));
    const globalRoot = join(root, "global");
    const projectRoot = join(root, "project");

    await runCli(["scope", "init", "--scope", "global"], { cwd: globalRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });

    await runCli(
      ["command", "add", "--id", "security-scan", "--content", "echo hi", "--targets", "codex"],
      { cwd: globalRoot }
    );
    await runCli(
      ["subagent", "add", "--id", "backend", "--content", "You own backend.", "--targets", "codex"],
      { cwd: globalRoot }
    );
    await runCli(
      ["secret", "add", "--id", "openai", "--env", "OPENAI_API_KEY", "--targets", "codex"],
      { cwd: globalRoot }
    );
    await runCli(["pack", "init", "frontend", "--name", "acme/frontend", "--version", "1.0.0"], {
      cwd: globalRoot
    });
    await runCli(["pack", "add", "frontend", "command:security-scan"], { cwd: globalRoot });
    await runCli(["pack", "add", "frontend", "subagent:backend"], { cwd: globalRoot });
    await runCli(["pack", "add", "frontend", "secret:openai"], { cwd: globalRoot });

    await runCli(
      ["scope", "sync", "--from", globalRoot, "--to", projectRoot, "pack:frontend", "--mode", "pin"],
      { cwd: root }
    );

    const manifest = await readFile(join(projectRoot, "use0-kit.toml"), "utf8");
    expect(manifest).toContain('[[packs]]');
    expect(manifest).toContain('id = "frontend"');
    expect(manifest).toContain('scope_mode = "pin"');
    expect(manifest).toContain('command:security-scan');
    expect(manifest).toContain('[[subagents]]');
    expect(manifest).toContain('id = "backend"');
    expect(manifest).toContain('[[secrets]]');
    expect(manifest).toContain('id = "openai"');
  });

  test("pack and profile participate in explain and lock state", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-pack-lock-"));
    const skillDir = join(root, "skills", "web-design");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Web Design\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "web-design", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );
    await runCli(["pack", "init", "frontend", "--name", "acme/frontend", "--version", "1.0.0"], {
      cwd: root
    });
    await runCli(["pack", "add", "frontend", "skill:web-design"], { cwd: root });
    await runCli(["profile", "create", "frontend", "--name", "Frontend"], { cwd: root });
    await runCli(["profile", "add", "frontend", "skill:web-design"], { cwd: root });

    expect(await runCli(["scope", "explain", "pack:frontend"], { cwd: root })).toContain(
      "result: project wins"
    );
    expect(await runCli(["scope", "explain", "profile:frontend"], { cwd: root })).toContain(
      "result: project wins"
    );

    await runCli(["lock", "refresh"], { cwd: root });
    const lock = await readFile(join(root, "use0-kit.lock.json"), "utf8");
    expect(lock).toContain('"pack:frontend"');
    expect(lock).toContain('"profile:frontend"');

    const plan = await runCli(["plan"], { cwd: root });
    expect(plan).toContain("WRITE  pack pack:frontend");
    expect(plan).toContain("WRITE  profile profile:frontend");
  });

  test("pack install and profile sync reuse the same graph expansion for bundled resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-graph-unify-"));
    const sourceRoot = join(root, "source");
    const packTarget = join(root, "pack-target");
    const profileTarget = join(root, "profile-target");

    await runCli(["scope", "init", "--scope", "project"], { cwd: sourceRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: packTarget });
    await runCli(["scope", "init", "--scope", "project"], { cwd: profileTarget });

    await runCli(
      ["subagent", "add", "--id", "backend", "--content", "You own backend.", "--targets", "codex"],
      { cwd: sourceRoot }
    );
    await runCli(
      ["secret", "add", "--id", "openai", "--env", "OPENAI_API_KEY", "--targets", "codex"],
      { cwd: sourceRoot }
    );
    await runCli(["pack", "init", "frontend", "--name", "acme/frontend", "--version", "1.0.0"], {
      cwd: sourceRoot
    });
    await runCli(["pack", "add", "frontend", "subagent:backend"], { cwd: sourceRoot });
    await runCli(["pack", "add", "frontend", "secret:openai"], { cwd: sourceRoot });
    await runCli(["profile", "create", "frontend", "--name", "Frontend"], { cwd: sourceRoot });
    await runCli(["profile", "add", "frontend", "pack:frontend"], { cwd: sourceRoot });

    await runCli(["pack", "install", "frontend", "--to", packTarget], { cwd: sourceRoot });
    await runCli(["profile", "sync", "frontend", "--to", profileTarget], { cwd: sourceRoot });

    const packManifest = await readFile(join(packTarget, "use0-kit.toml"), "utf8");
    const profileManifest = await readFile(join(profileTarget, "use0-kit.toml"), "utf8");
    expect(packManifest).toContain('[[subagents]]');
    expect(packManifest).toContain('[[secrets]]');
    expect(profileManifest).toContain('[[profiles]]');
    expect(profileManifest).toContain('[[packs]]');
    expect(profileManifest).toContain('[[subagents]]');
    expect(profileManifest).toContain('[[secrets]]');
  });

  test("pack install --apply and profile sync --apply materialize bundled resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-graph-apply-"));
    const sourceRoot = join(root, "source");
    const packTarget = join(root, "pack-target");
    const profileTarget = join(root, "profile-target");

    await runCli(["scope", "init", "--scope", "project"], { cwd: sourceRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: packTarget });
    await runCli(["scope", "init", "--scope", "project"], { cwd: profileTarget });

    await runCli(
      ["subagent", "add", "--id", "backend", "--content", "You own backend.", "--targets", "codex,cursor"],
      { cwd: sourceRoot }
    );
    await runCli(
      ["secret", "add", "--id", "openai", "--env", "OPENAI_API_KEY", "--targets", "codex,cursor"],
      { cwd: sourceRoot }
    );
    await runCli(["pack", "init", "frontend", "--name", "acme/frontend", "--version", "1.0.0"], {
      cwd: sourceRoot
    });
    await runCli(["pack", "add", "frontend", "subagent:backend"], { cwd: sourceRoot });
    await runCli(["pack", "add", "frontend", "secret:openai"], { cwd: sourceRoot });
    await runCli(["profile", "create", "frontend", "--name", "Frontend"], { cwd: sourceRoot });
    await runCli(["profile", "add", "frontend", "pack:frontend"], { cwd: sourceRoot });

    expect(
      await runCli(["pack", "install", "frontend", "--to", packTarget, "--apply", "--agent", "codex"], {
        cwd: sourceRoot
      })
    ).toContain("and applied");
    expect(
      await runCli(["profile", "sync", "frontend", "--to", profileTarget, "--apply", "--agent", "codex"], {
        cwd: sourceRoot
      })
    ).toContain("and applied");

    expect(await readFile(join(packTarget, ".codex", "subagents", "backend.md"), "utf8")).toContain(
      "You own backend."
    );
    expect(await readFile(join(packTarget, ".codex", "secrets", "openai.json"), "utf8")).toContain(
      "OPENAI_API_KEY"
    );
    expect(await readFile(join(profileTarget, ".codex", "subagents", "backend.md"), "utf8")).toContain(
      "You own backend."
    );
    expect(await readFile(join(profileTarget, ".codex", "secrets", "openai.json"), "utf8")).toContain(
      "OPENAI_API_KEY"
    );
  });

  test("profile sync honors reconciliation mode for bundled resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-profile-sync-mode-"));
    const sourceRoot = join(root, "source");
    const targetRoot = join(root, "target");

    await runCli(["scope", "init", "--scope", "project"], { cwd: sourceRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: targetRoot });

    await runCli(
      ["command", "add", "--id", "security-scan", "--content", "echo scan", "--targets", "codex"],
      { cwd: sourceRoot }
    );
    await runCli(["pack", "init", "frontend", "--name", "acme/frontend", "--version", "1.0.0"], {
      cwd: sourceRoot
    });
    await runCli(["pack", "add", "frontend", "command:security-scan"], { cwd: sourceRoot });
    await runCli(["profile", "create", "frontend", "--name", "Frontend"], { cwd: sourceRoot });
    await runCli(["profile", "add", "frontend", "pack:frontend"], { cwd: sourceRoot });

    expect(await runCli(["profile", "sync", "frontend", "--to", targetRoot, "--mode", "pin"], { cwd: sourceRoot })).toContain(
      "Synced"
    );

    const manifest = await readFile(join(targetRoot, "use0-kit.toml"), "utf8");
    expect(manifest).toContain('id = "frontend"');
    expect(manifest).toContain('scope_mode = "pin"');
    expect(manifest).toContain('pinned_digest = "');
    expect(manifest).toContain('id = "security-scan"');
  });
});
