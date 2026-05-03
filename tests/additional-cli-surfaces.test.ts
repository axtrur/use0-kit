import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("additional CLI surfaces", () => {
  test("supports pack list/remove/build/import and profile list/remove/export/import/use", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-extra-"));
    const projectRoot = join(root, "project");
    const importedRoot = join(root, "imported");
    const skillDir = join(projectRoot, "skills", "repo-conventions");
    const packOut = join(root, "frontend.agentpack.json");
    const profileOut = join(root, "frontend.profile.toml");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: importedRoot });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: projectRoot }
    );
    await runCli(["pack", "init", "frontend", "--name", "acme/frontend", "--version", "1.0.0"], {
      cwd: projectRoot
    });
    await runCli(["pack", "add", "frontend", "skill:repo-conventions"], { cwd: projectRoot });
    await runCli(["profile", "create", "frontend", "--name", "Frontend Baseline"], {
      cwd: projectRoot
    });
    await runCli(["profile", "add", "frontend", "skill:repo-conventions"], { cwd: projectRoot });
    await runCli(["profile", "remove", "frontend"], { cwd: projectRoot });
    await runCli(["profile", "create", "frontend", "--name", "Frontend Baseline", "--targets", "codex,cursor"], {
      cwd: projectRoot
    });
    await runCli(["profile", "add", "frontend", "skill:repo-conventions"], { cwd: projectRoot });

    expect(await runCli(["pack", "list"], { cwd: projectRoot })).toContain("frontend");
    expect(await runCli(["profile", "list"], { cwd: projectRoot })).toContain("frontend");

    await runCli(["pack", "build", "frontend", "--out", packOut], { cwd: projectRoot });
    await runCli(["profile", "export", "frontend", "--out", profileOut], { cwd: projectRoot });
    expect(await readFile(profileOut, "utf8")).toContain("[profile]");
    expect(await readFile(profileOut, "utf8")).toContain('default_targets = ["codex", "cursor"]');
    await runCli(["pack", "import", packOut], { cwd: importedRoot });
    await runCli(["profile", "import", profileOut], { cwd: importedRoot });
    await runCli(["profile", "use", "frontend"], { cwd: importedRoot });

    expect(await readFile(join(importedRoot, "use0-kit.toml"), "utf8")).toContain('id = "frontend"');
    expect(await readFile(join(importedRoot, "use0-kit.toml"), "utf8")).toContain('id = "repo-conventions"');
    expect(await runCli(["info", "skill:repo-conventions"], { cwd: importedRoot })).toContain("source=path:");
    expect(await runCli(["info", "profile:frontend"], { cwd: importedRoot })).toContain("default_targets=codex,cursor");

    await runCli(["pack", "remove", "frontend"], { cwd: projectRoot });
    await runCli(["profile", "remove", "frontend"], { cwd: projectRoot });

    expect(await runCli(["pack", "list"], { cwd: projectRoot })).not.toContain("frontend");
    expect(await runCli(["profile", "list"], { cwd: projectRoot })).not.toContain("frontend");
  });

  test("supports ref alias round-trip for pack and profile manifests", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-pack-profile-ref-"));

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
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
        "[[packs]]",
        'id = "frontend"',
        'name = "acme/frontend"',
        'version = "1.0.0"',
        "resources = []",
        'ref = "v1.0.0"',
        "",
        "[[profiles]]",
        'id = "developer"',
        'name = "Developer"',
        "exports = []",
        'ref = "v2026.05"',
        ""
      ].join("\n")
    );

    const listed = await runCli(["list", "pack:frontend", "profile:developer"], { cwd: root });
    expect(listed).toContain("pack:frontend");
    expect(listed).toContain("profile:developer");

    expect(await runCli(["info", "pack:frontend"], { cwd: root })).toContain("ref=v1.0.0");
    expect(await runCli(["info", "profile:developer"], { cwd: root })).toContain("ref=v2026.05");

    const saved = await readFile(join(root, "use0-kit.toml"), "utf8");
    expect(saved).toContain('ref = "v1.0.0"');
    expect(saved).toContain('ref = "v2026.05"');
    expect(saved).not.toContain("provenance_ref");
  });

  test("supports top-level info with bare resource ids when the match is unique", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-bare-info-"));
    const skillDir = join(root, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );

    const info = await runCli(["info", "repo-conventions"], { cwd: root });
    expect(info).toContain("skill:repo-conventions");
    expect(info).toContain(`source=path:${skillDir}`);
  });

  test("supports agent list/capabilities/paths filters and agent doctor alias", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-agent-"));

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await mkdir(join(root, ".cursor", "skills"), { recursive: true });
    await mkdir(join(root, ".codex", "skills"), { recursive: true });

    expect(await runCli(["agent", "list"], { cwd: root })).toContain(`codex: detected\t${join(root, ".codex", "config.toml")}`);
    const listedJson = JSON.parse(await runCli(["agent", "list", "--json"], { cwd: root })) as Array<{
      id: string;
      detected: boolean;
      path: string;
    }>;
    expect(listedJson).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "codex", detected: true, path: join(root, ".codex", "config.toml") })])
    );
    expect(await runCli(["agent", "capabilities"], { cwd: root })).toContain("skills");
    const codexCapabilities = await runCli(["agent", "capabilities", "--agent", "codex"], { cwd: root });
    expect(codexCapabilities).toContain("codex");
    expect(codexCapabilities).not.toContain("cursor");
    const codexPaths = await runCli(["agent", "paths", "--agent", "codex"], { cwd: root });
    expect(codexPaths).toContain("codex");
    expect(codexPaths).toContain(`skills: ${join(root, ".codex", "skills")}`);
    expect(codexPaths).toContain(`mcp config: ${join(root, ".codex", "config.toml")}`);
    expect(codexPaths).toContain(`instructions: ${join(root, "AGENTS.md")}`);
    expect(codexPaths).not.toContain("cursor");
    expect(await runCli(["agent", "doctor"], { cwd: root })).toContain("manifest-parse: ok");
    await runCli(["agent", "disable", "cursor", "codex"], { cwd: root });
    expect(await runCli(["agent", "detect"], { cwd: root })).toContain("cursor: missing");
    expect(await runCli(["agent", "detect"], { cwd: root })).toContain("codex: missing");
    await runCli(["agent", "enable", "cursor", "codex"], { cwd: root });
    expect(await runCli(["agent", "detect"], { cwd: root })).toContain("cursor: detected");
    expect(await runCli(["agent", "detect"], { cwd: root })).toContain("codex: detected");
  });

  test("supports scoped doctor and agent detect for global scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-scope-agent-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      const globalRoot = join(xdgData, "use0-kit", "global");
      await mkdir(join(globalRoot, ".codex", "skills"), { recursive: true });

      expect(await runCli(["agent", "detect", "--scope", "global"], { cwd: root })).toContain(
        `codex: detected\t${join(globalRoot, ".codex", "config.toml")}`
      );
      const jsonOutput = await runCli(["agent", "detect", "--scope", "global", "--json"], { cwd: root });
      expect(JSON.parse(jsonOutput)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "codex", detected: true, path: join(globalRoot, ".codex", "config.toml") })
        ])
      );
      expect(await runCli(["doctor", "--scope", "global"], { cwd: root })).toContain("manifest-parse: ok");
      expect(await runCli(["agent", "doctor", "--scope", "global"], { cwd: root })).toContain("manifest-parse: ok");
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });

  test("supports list --scope, --effective, and --agent across layered scopes", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-list-scope-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const workspaceRoot = join(root, "workspace");
    const projectRoot = join(workspaceRoot, "project");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await mkdir(projectRoot, { recursive: true });

      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      await runCli(["scope", "init", "--scope", "user"], { cwd: root });
      await runCli(["scope", "init", "--scope", "project"], { cwd: workspaceRoot });
      await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });

      const globalRoot = join(xdgData, "use0-kit", "global");
      const userRoot = join(xdgConfig, "use0-kit");

      await runCli(["add", "skill", "inline:Global%20skill", "--id", "global-skill", "--targets", "codex"], {
        cwd: globalRoot
      });
      await runCli(
        ["add", "mcp", "--id", "context7", "--command", "npx", "--args", "-y,@upstash/context7-mcp", "--targets", "codex"],
        { cwd: userRoot }
      );
      await runCli(["add", "secret", "--id", "openai", "--env", "OPENAI_API_KEY", "--targets", "codex"], {
        cwd: userRoot
      });
      await runCli(["add", "command", "inline:echo%20workspace", "--id", "workspace-cmd", "--targets", "cursor"], {
        cwd: workspaceRoot
      });
      await runCli(["scope", "exclude", "mcp:context7"], { cwd: projectRoot });

      expect(await runCli(["list", "--scope", "global"], { cwd: projectRoot })).toContain("skill:global-skill");
      expect(await runCli(["list"], { cwd: projectRoot })).not.toContain("skill:global-skill");

      const effective = await runCli(["list", "--effective"], { cwd: projectRoot });
      expect(effective).toContain("skill:global-skill");
      expect(effective).toContain("secret:openai");
      expect(effective).toContain("command:workspace-cmd");
      expect(effective).not.toContain("mcp:context7");

      const codexOnly = await runCli(["list", "--effective", "--agent", "codex"], { cwd: projectRoot });
      expect(codexOnly).toContain("skill:global-skill");
      expect(codexOnly).toContain("secret:openai");
      expect(codexOnly).not.toContain("command:workspace-cmd");
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });
});
