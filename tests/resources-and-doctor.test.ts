import { access, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { applyPlan } from "../src/core/apply.js";
import { AGENTS } from "../src/core/agents.js";
import { detectAgents, getAgentPaths } from "../src/core/agents-runtime.js";
import { renderMcpConfig } from "../src/core/mcp.js";
import { loadManifest, saveManifest } from "../src/core/manifest.js";
import { buildPlan } from "../src/core/planner.js";
import { refreshLock } from "../src/core/lock.js";
import {
  addCommand,
  addInstruction,
  addMcpServer,
  addSkill,
  removeSkill
} from "../src/core/resources.js";
import { initScope } from "../src/core/scope.js";
import { runDoctor, runDoctorForSelector } from "../src/core/doctor.js";

describe("resource mutations and doctor", () => {
  test("adds and removes MVP1 resources from the manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-resources-"));
    const skillDir = join(root, "fixtures", "skills", "frontend-review");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Frontend Review", "utf8");

    await initScope({ cwd: root, scope: "project" });
    await addSkill(root, {
      id: "frontend-review",
      source: `path:${skillDir}`,
      targets: ["claude-code", "cursor"]
    });
    await addMcpServer(root, {
      id: "context7",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      targets: ["claude-code", "codex"]
    });
    await addInstruction(root, {
      id: "testing",
      heading: "Testing",
      body: "Run npm test before opening a PR.",
      targets: ["codex"]
    });
    await removeSkill(root, "frontend-review");

    const manifest = await loadManifest(root);

    expect(manifest.skills).toEqual([]);
    expect(manifest.mcps).toEqual([
      expect.objectContaining({
        id: "context7",
        command: "npx"
      })
    ]);
    expect(manifest.instructions).toEqual([
      expect.objectContaining({
        id: "testing",
        heading: "Testing"
      })
    ]);
  });

  test("renders MCP config and reports doctor health", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-doctor-"));
    const skillDir = join(root, "fixtures", "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions", "utf8");

    await initScope({ cwd: root, scope: "project" });
    await addSkill(root, {
      id: "repo-conventions",
      source: `path:${skillDir}`,
      targets: ["claude-code"]
    });
    await addMcpServer(root, {
      id: "context7",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      targets: ["codex"]
    });

    const manifest = await loadManifest(root);
    const codexMcp = renderMcpConfig({
      root,
      agentId: "codex",
      mcps: manifest.mcps
    });

    expect(codexMcp.path).toBe(join(root, ".codex", "config.toml"));
    expect(codexMcp.content).toContain("[mcp_servers.context7]");
    expect(codexMcp.content).toContain('command = "npx"');

    await refreshLock(root);
    const report = await runDoctor(root);
    expect(report.ok).toBe(true);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "manifest-parse", status: "ok" }),
        expect.objectContaining({ id: "lockfile", status: "ok" }),
        expect.objectContaining({ id: "local-sources", status: "ok" }),
        expect.objectContaining({ id: "effective-graph", status: "ok" })
      ])
    );
  });

  test("reports known agent paths and local detection", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-agents-"));

    await mkdir(join(root, ".claude", "skills"), { recursive: true });
    await mkdir(join(root, ".codex", "skills"), { recursive: true });

    const detected = await detectAgents(root);
    const paths = getAgentPaths(root);

    expect(detected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "claude-code", detected: true, path: join(root, ".claude") }),
        expect.objectContaining({ id: "codex", detected: true, path: join(root, ".codex", "config.toml") }),
        expect.objectContaining({ id: "cursor", detected: false, path: join(root, ".cursor") })
      ])
    );
    expect(paths.codex.markerPath).toBe(join(root, ".codex", "config.toml"));
    expect(paths.codex.skillDir).toBe(join(root, ".codex", "skills"));
    expect(paths.codex.mcpConfigPath).toBe(join(root, ".codex", "config.toml"));
    expect(paths["claude-code"].instructionPath).toBe(join(root, "CLAUDE.md"));
  });

  test("doctor reports unsupported targets, missing MCP commands, and broken symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-doctor-errors-"));
    const skillDir = join(root, "fixtures", "skills", "broken-skill");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Broken Skill", "utf8");

    await initScope({ cwd: root, scope: "project" });
    await addSkill(root, {
      id: "broken-skill",
      source: `path:${skillDir}`,
      targets: ["codex"]
    });
    await addMcpServer(root, {
      id: "missing-command",
      command: "definitely-not-a-real-command-use0-kit",
      targets: ["codex"]
    });
    await addInstruction(root, {
      id: "bad-target",
      heading: "Bad Target",
      body: "Unsupported target test",
      targets: ["codex", "ghost-agent" as never]
    });

    const manifest = await loadManifest(root);
    const plan = await buildPlan({ root, manifest });
    await applyPlan({ root, plan });
    await rm(join(root, ".use0-kit", "store", "skills", "broken-skill"), { recursive: true, force: true });

    const codexSkillPath = join(root, ".codex", "skills", "broken-skill");
    expect(await readlink(codexSkillPath)).toBeTruthy();

    const report = await runDoctor(root);
    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "unsupported-targets", status: "error" }),
        expect.objectContaining({ id: "mcp-commands", status: "error" }),
        expect.objectContaining({ id: "symlinks", status: "error" })
      ])
    );
  });

  test("doctor reports missing provenance digest for remote resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-doctor-provenance-"));

    await initScope({ cwd: root, scope: "project" });
    await addSkill(root, {
      id: "remote-skill",
      source: "github:acme/agent-skills",
      targets: ["codex"]
    });

    const report = await runDoctor(root);
    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "provenance", status: "error" })
      ])
    );
  });

  test("doctor reports mismatched provenance digest for source-based remote resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-doctor-provenance-mismatch-"));

    await initScope({ cwd: root, scope: "project" });
    await addCommand(root, {
      id: "security-scan",
      source: "inline:echo%20safe",
      targets: ["codex"]
    });

    const manifest = await loadManifest(root);
    manifest.commands[0].provenance = {
      source: "inline:echo%20safe",
      digest: "sha256:deadbeef"
    };
    await saveManifest(root, manifest);

    const report = await runDoctor(root);
    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "provenance",
          status: "error",
          detail: expect.stringContaining("command:security-scan")
        })
      ])
    );
  });

  test("doctor reports broken generated instruction markers", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-doctor-markers-"));

    await initScope({ cwd: root, scope: "project" });
    await addInstruction(root, {
      id: "testing",
      heading: "Testing",
      body: "Run npm test before opening a PR.",
      targets: ["codex"]
    });

    const manifest = await loadManifest(root);
    const plan = await buildPlan({ root, manifest });
    await applyPlan({ root, plan });
    await writeFile(join(root, "AGENTS.md"), "## Testing\n\nRun npm test before opening a PR.\n", "utf8");

    const report = await runDoctor(root);
    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "generated-markers", status: "error" })
      ])
    );
  });

  test("doctor reports invalid agent-native config syntax", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-doctor-agent-configs-"));

    await initScope({ cwd: root, scope: "project" });
    await addMcpServer(root, {
      id: "context7",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      targets: ["cursor"]
    });

    const manifest = await loadManifest(root);
    const plan = await buildPlan({ root, manifest });
    await applyPlan({ root, plan });
    await writeFile(join(root, ".cursor", "mcp.json"), "{invalid json", "utf8");

    const report = await runDoctor(root);
    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "agent-configs", status: "error" })
      ])
    );
  });

  test("doctor supports filtering by selector", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-doctor-selector-"));

    await initScope({ cwd: root, scope: "project" });
    await addMcpServer(root, {
      id: "context7",
      command: "definitely-missing-command",
      targets: ["codex"]
    });
    await addSkill(root, {
      id: "repo-conventions",
      source: "inline:Local%20skill",
      targets: ["codex"]
    });

    const report = await runDoctorForSelector(root, "mcp:context7");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "mcp-commands", status: "error" }),
        expect.objectContaining({ id: "provenance", status: "ok" })
      ])
    );
  });

  test("wildcard and universal targets materialize across all enabled agents without doctor errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-universal-targets-"));
    const skillDir = join(root, "fixtures", "skills", "universal-skill");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Universal Skill", "utf8");

    await initScope({ cwd: root, scope: "project" });
    await addSkill(root, {
      id: "universal-skill",
      source: `path:${skillDir}`,
      targets: ["*"]
    });
    await addInstruction(root, {
      id: "shared-guidance",
      heading: "Shared Guidance",
      body: "Applies everywhere.",
      targets: ["universal"]
    });
    await addMcpServer(root, {
      id: "context7",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      targets: ["universal"]
    });

    const manifest = await loadManifest(root);
    const plan = await buildPlan({ root, manifest });
    await applyPlan({ root, plan });

    for (const agentId of Object.keys(AGENTS) as Array<keyof typeof AGENTS>) {
      await access(join(AGENTS[agentId].skillDir(root), "universal-skill", "SKILL.md"));
      await access(AGENTS[agentId].instructionPath(root));
      const renderedMcp = renderMcpConfig({ root, agentId, mcps: manifest.mcps });
      await access(renderedMcp.path);
      expect(await readFile(renderedMcp.path, "utf8")).toContain("context7");
    }

    const report = await runDoctor(root);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "unsupported-targets", status: "ok" })
      ])
    );
  });

  test("doctor fix repairs lock and materialization state", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-doctor-fix-"));
    const skillDir = join(root, "fixtures", "skills", "repairable-skill");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repairable Skill", "utf8");

    await initScope({ cwd: root, scope: "project" });
    await addSkill(root, {
      id: "repairable-skill",
      source: `path:${skillDir}`,
      targets: ["codex"]
    });

    const manifest = await loadManifest(root);
    const plan = await buildPlan({ root, manifest });
    await applyPlan({ root, plan });
    await rm(join(root, "use0-kit.lock.json"));
    await rm(join(root, ".use0-kit", "store", "skills", "repairable-skill"), { recursive: true, force: true });

    const before = await runDoctor(root);
    expect(before.ok).toBe(false);

    const output = await import("../src/cli.js").then(({ runCli }) => runCli(["doctor", "--fix"], { cwd: root }));
    expect(output).toContain("fixes:");
    expect(output).toContain("lockfile: ok");
    expect(output).toContain("symlinks: ok");
    expect(await readFile(join(root, "use0-kit.lock.json"), "utf8")).toContain("repairable-skill");
    expect(await readFile(join(root, ".codex", "skills", "repairable-skill", "SKILL.md"), "utf8")).toContain(
      "Repairable Skill"
    );
  });
});
