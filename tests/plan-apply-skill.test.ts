import { mkdir, mkdtemp, readFile, lstat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { loadManifest, saveManifest } from "../src/core/manifest.js";
import { buildPlan } from "../src/core/planner.js";
import { applyPlan } from "../src/core/apply.js";
import { initScope } from "../src/core/scope.js";

describe("plan/apply", () => {
  test("stores a local skill canonically and symlinks it into agent targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-apply-"));
    const skillDir = join(root, "fixtures", "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "# Repo Conventions\n\nUse project-local rules."
    );

    await initScope({ cwd: root, scope: "project" });
    await writeFile(
      join(root, "use0-kit.toml"),
      [
        "version = 1",
        'default_scope = "project"',
        'materialization = "symlink"',
        'agents = ["claude-code", "cursor", "codex", "opencode"]',
        "",
        "[[skills]]",
        'id = "repo-conventions"',
        `source = "path:${skillDir}"`,
        'targets = ["claude-code", "codex"]',
        ""
      ].join("\n")
    );

    const manifest = await loadManifest(root);
    const plan = await buildPlan({
      root,
      manifest
    });

    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "store-skill",
          resourceId: "skill:repo-conventions"
        }),
        expect.objectContaining({
          kind: "link-skill",
          resourceId: "skill:repo-conventions",
          agentId: "claude-code"
        }),
        expect.objectContaining({
          kind: "link-skill",
          resourceId: "skill:repo-conventions",
          agentId: "codex"
        })
      ])
    );

    await applyPlan({
      root,
      plan
    });

    const claudeLink = join(root, ".claude", "skills", "repo-conventions");
    const codexLink = join(root, ".codex", "skills", "repo-conventions");
    const storeSkill = join(root, ".use0-kit", "store", "skills", "repo-conventions");

    expect((await lstat(claudeLink)).isSymbolicLink()).toBe(true);
    expect((await lstat(codexLink)).isSymbolicLink()).toBe(true);
    expect(await readFile(join(storeSkill, "SKILL.md"), "utf8")).toContain(
      "Repo Conventions"
    );
  });

  test("stores command and subagent canonically and writes agent materializations", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-apply-text-"));

    await initScope({ cwd: root, scope: "project" });
    await writeFile(
      join(root, "use0-kit.toml"),
      [
        "version = 1",
        'default_scope = "project"',
        'materialization = "symlink"',
        'agents = ["claude-code", "cursor", "codex", "opencode"]',
        "",
        "[[commands]]",
        'id = "security-scan"',
        `source = "path:${join(root, ".use0-kit", "sources", "commands", "security-scan.md")}"`,
        'targets = ["claude-code"]',
        "",
        "[[subagents]]",
        'id = "backend"',
        `source = "path:${join(root, ".use0-kit", "sources", "subagents", "backend.md")}"`,
        'targets = ["opencode", "claude-code"]',
        ""
      ].join("\n")
    );
    await mkdir(join(root, ".use0-kit", "sources", "commands"), { recursive: true });
    await mkdir(join(root, ".use0-kit", "sources", "subagents"), { recursive: true });
    await writeFile(
      join(root, ".use0-kit", "sources", "commands", "security-scan.md"),
      ["---", "agentkit/claude-code/effort: high", "---", "", "Run checks."].join("\n")
    );
    await writeFile(
      join(root, ".use0-kit", "sources", "subagents", "backend.md"),
      [
        "---",
        "name: backend",
        "description: Own backend implementation tasks.",
        "agentkit/opencode/model: fast",
        "---",
        "",
        "Own backend."
      ].join("\n")
    );

    const manifest = await loadManifest(root);
    const plan = await buildPlan({ root, manifest });

    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "store-text-resource", resourceId: "command:security-scan" }),
        expect.objectContaining({ kind: "write-text-resource", resourceId: "command:security-scan" }),
        expect.objectContaining({ kind: "store-text-resource", resourceId: "subagent:backend" }),
        expect.objectContaining({ kind: "write-text-resource", resourceId: "subagent:backend" })
      ])
    );

    await applyPlan({ root, plan });

    expect(await readFile(join(root, ".use0-kit", "store", "commands", "security-scan.md"), "utf8")).toContain(
      "Run checks."
    );
    expect(await readFile(join(root, ".use0-kit", "store", "subagents", "backend.md"), "utf8")).toContain(
      "Own backend."
    );
    expect(await readFile(join(root, ".claude", "commands", "security-scan.md"), "utf8")).toContain(
      "effort: high"
    );
    expect(await readFile(join(root, ".opencode", "subagents", "backend.md"), "utf8")).toContain(
      "model: fast"
    );
    const claudeSubagent = await readFile(join(root, ".claude", "agents", "backend.md"), "utf8");
    expect(claudeSubagent).toContain("name: backend");
    expect(claudeSubagent).toContain("description: Own backend implementation tasks.");
    expect(claudeSubagent).not.toContain("model: fast");
  });

  test("stores hook and secret bindings and writes materialized outputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-apply-hook-secret-"));

    await initScope({ cwd: root, scope: "project" });
    await mkdir(join(root, ".use0-kit", "sources", "hooks"), { recursive: true });
    await writeFile(
      join(root, ".use0-kit", "sources", "hooks", "pre-apply.sh"),
      "echo before\n"
    );
    await writeFile(
      join(root, "use0-kit.toml"),
      [
        "version = 1",
        'default_scope = "project"',
        'materialization = "symlink"',
        'agents = ["claude-code", "cursor", "codex", "opencode"]',
        "",
        "[[hooks]]",
        'id = "pre-apply"',
        `source = "path:${join(root, ".use0-kit", "sources", "hooks", "pre-apply.sh")}"`,
        'targets = ["codex"]',
        "",
        "[[secrets]]",
        'id = "openai"',
        'env = "OPENAI_API_KEY"',
        "required = true",
        'targets = ["claude-code"]',
        ""
      ].join("\n")
    );

    const manifest = await loadManifest(root);
    const plan = await buildPlan({ root, manifest });

    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "store-text-resource", resourceId: "hook:pre-apply" }),
        expect.objectContaining({ kind: "write-text-resource", resourceId: "hook:pre-apply" }),
        expect.objectContaining({ kind: "write-generated-resource", resourceId: "secret:openai" })
      ])
    );

    await applyPlan({ root, plan });

    expect(await readFile(join(root, ".use0-kit", "store", "hooks", "pre-apply.sh"), "utf8")).toContain(
      "echo before"
    );
    expect(await readFile(join(root, ".codex", "hooks", "pre-apply.sh"), "utf8")).toContain(
      "echo before"
    );
    expect(await readFile(join(root, ".use0-kit", "store", "secrets", "openai.json"), "utf8")).toContain(
      "OPENAI_API_KEY"
    );
    expect(await readFile(join(root, ".claude", "secrets", "openai.json"), "utf8")).toContain(
      "OPENAI_API_KEY"
    );
  });

  test("respects scope canonical_store and accepts materialize=auto", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-apply-canonical-store-"));
    const skillDir = join(root, "fixtures", "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");

    await initScope({ cwd: root, scope: "project" });
    await writeFile(
      join(root, "use0-kit.toml"),
      [
        "version = 1",
        'default_scope = "project"',
        "",
        "[scope]",
        'level = "project"',
        'mode = "project"',
        'materialize = "auto"',
        'canonical_store = ".agent-kit/store"',
        "parents = []",
        "",
        "[agents]",
        'enabled = ["codex"]',
        "",
        "[[skills]]",
        'id = "repo-conventions"',
        `source = "path:${skillDir}"`,
        'targets = ["codex"]',
        ""
      ].join("\n")
    );

    const manifest = await loadManifest(root);
    expect(manifest.scope?.canonicalStore).toBe(".agent-kit/store");
    expect(manifest.materialization).toBe("auto");

    const plan = await buildPlan({ root, manifest });
    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "store-skill",
          resourceId: "skill:repo-conventions",
          storePath: join(root, ".agent-kit", "store", "skills", "repo-conventions")
        }),
        expect.objectContaining({
          kind: "link-skill",
          resourceId: "skill:repo-conventions",
          agentId: "codex",
          sourcePath: join(root, ".agent-kit", "store", "skills", "repo-conventions"),
          mode: "auto"
        })
      ])
    );

    await applyPlan({ root, plan });
    expect((await lstat(join(root, ".codex", "skills", "repo-conventions"))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(root, ".agent-kit", "store", "skills", "repo-conventions", "SKILL.md"), "utf8")).toContain(
      "Repo Conventions"
    );
  });

  test("keeps parsing legacy agents.materialize manifests for compatibility", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-legacy-materialize-"));
    await initScope({ cwd: root, scope: "project" });
    await writeFile(
      join(root, "use0-kit.toml"),
      [
        "version = 1",
        'default_scope = "project"',
        "",
        "[scope]",
        'level = "project"',
        'mode = "project"',
        'canonical_store = ".use0-kit/store"',
        "parents = []",
        "",
        "[agents]",
        'enabled = ["codex"]',
        'materialize = "copy"',
        ""
      ].join("\n")
    );

    const manifest = await loadManifest(root);
    expect(manifest.materialization).toBe("copy");
  });

  test("keeps parsing legacy sync_mode fields while serializing scope_mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-legacy-sync-mode-"));
    const skillDir = join(root, "skills", "repo-conventions");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");
    await initScope({ cwd: root, scope: "project" });
    await writeFile(
      join(root, "use0-kit.toml"),
      [
        "version = 1",
        'default_scope = "project"',
        "",
        "[scope]",
        'level = "project"',
        'mode = "project"',
        'canonical_store = ".use0-kit/store"',
        "parents = []",
        "",
        "[agents]",
        'enabled = ["codex"]',
        'materialize = "symlink"',
        "",
        "[[skills]]",
        'id = "repo-conventions"',
        `source = "path:${skillDir}"`,
        'targets = ["codex"]',
        'sync_mode = "pin"',
        ""
      ].join("\n")
    );

    const manifest = await loadManifest(root);
    expect(manifest.skills[0]?.syncMode).toBe("pin");

    await saveManifest(root, manifest);
    const saved = await readFile(join(root, "use0-kit.toml"), "utf8");
    expect(saved).toContain('scope_mode = "pin"');
    expect(saved).not.toContain('sync_mode = "pin"');
  });

  test("supports resource ref alias in manifests for source-based resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-ref-alias-"));
    await initScope({ cwd: root, scope: "project" });
    await writeFile(
      join(root, "use0-kit.toml"),
      [
        "version = 1",
        'default_scope = "project"',
        "",
        "[scope]",
        'level = "project"',
        'mode = "project"',
        'materialize = "symlink"',
        'canonical_store = ".use0-kit/store"',
        "parents = []",
        "",
        "[agents]",
        'enabled = ["codex"]',
        "",
        "[[skills]]",
        'id = "web-design-guidelines"',
        'source = "github:vercel-labs/agent-skills#skills/web-design-guidelines"',
        'ref = "main"',
        'targets = ["codex"]',
        ""
      ].join("\n")
    );

    const manifest = await loadManifest(root);
    expect(manifest.skills[0]?.provenance?.ref).toBe("main");

    await saveManifest(root, manifest);
    const saved = await readFile(join(root, "use0-kit.toml"), "utf8");
    expect(saved).toContain('ref = "main"');
    expect(saved).not.toContain("provenance_ref");
  });
});
