import { access, lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("CLI completeness helpers", () => {
  test("supports top-level init with scope and agents options", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-top-init-"));

    expect(await runCli(["init", "--scope", "project", "--agents", "codex,cursor"], { cwd: root })).toContain(
      "Initialized project scope"
    );
    await expect(access(join(root, ".agents", "skills"))).resolves.toBeUndefined();
    await expect(access(join(root, ".agents", "commands"))).resolves.toBeUndefined();
    await expect(access(join(root, ".use0-kit", "store", "skills"))).resolves.toBeUndefined();
    const manifest = await readFile(join(root, "use0-kit.toml"), "utf8");
    expect(manifest).toContain("[agents]");
    expect(manifest).toContain('enabled = ["codex", "cursor"]');
  });

  test("supports init --template frontend by scaffolding starter pack/profile resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-top-init-template-"));

    expect(await runCli(["init", "--scope", "project", "--template", "frontend", "--agents", "codex,cursor"], { cwd: root })).toContain(
      "Initialized project scope"
    );
    const manifest = await readFile(join(root, "use0-kit.toml"), "utf8");
    expect(manifest).toContain('[[packs]]');
    expect(manifest).toContain('id = "frontend"');
    expect(manifest).toContain('name = "template/frontend"');
    expect(manifest).toContain('[[profiles]]');
    expect(manifest).toContain('exports = ["pack:frontend"]');
    expect(manifest).toContain('default_targets = ["codex", "cursor"]');
  });

  test("supports init --yes by generating recommended project gitignore entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-top-init-yes-"));

    expect(await runCli(["init", "--scope", "project", "--yes"], { cwd: root })).toContain(
      "Initialized project scope"
    );
    const gitignore = await readFile(join(root, ".gitignore"), "utf8");
    expect(gitignore).toContain(".use0-kit/");
    expect(gitignore).toContain(".claude/skills/");
    expect(gitignore).toContain(".cursor/skills/");
    expect(gitignore).toContain(".codex/skills/");
    expect(gitignore).toContain(".opencode/skills/");
  });

  test("supports top-level init for workspace scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-top-init-workspace-"));

    expect(await runCli(["init", "--scope", "workspace"], { cwd: root })).toContain("Initialized workspace scope");
    expect(await readFile(join(root, "use0-kit.toml"), "utf8")).toContain('default_scope = "workspace"');
  });

  test("supports scope init with explicit agents selection", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-scope-init-agents-"));

    expect(await runCli(["scope", "init", "--scope", "project", "--agents", "codex,cursor"], { cwd: root })).toContain(
      "Initialized project scope"
    );
    const manifest = await readFile(join(root, "use0-kit.toml"), "utf8");
    expect(manifest).toContain('enabled = ["codex", "cursor"]');
    expect(manifest).not.toContain('"claude-code"');
    expect(manifest).not.toContain('"opencode"');
  });

  test("supports scope init --template frontend", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-scope-init-template-"));

    expect(await runCli(["scope", "init", "--scope", "project", "--template", "frontend"], { cwd: root })).toContain(
      "Initialized project scope"
    );
    const manifest = await readFile(join(root, "use0-kit.toml"), "utf8");
    expect(manifest).toContain('[[packs]]');
    expect(manifest).toContain('[[profiles]]');
    expect(manifest).toContain('exports = ["pack:frontend"]');
  });

  test("supports command/subagent list-remove, backup list, and skill validate-score", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-cli2-"));
    const skillDir = join(root, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n\nUse local rules.\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );
    await runCli(
      ["command", "add", "--id", "security-scan", "--content", "echo hi", "--targets", "codex"],
      { cwd: root }
    );
    await runCli(
      ["subagent", "add", "--id", "backend", "--content", "You own backend changes.", "--targets", "codex"],
      { cwd: root }
    );
    await runCli(["backup", "create"], { cwd: root });

    expect(await runCli(["command", "list"], { cwd: root })).toContain("security-scan");
    expect(await runCli(["subagent", "list"], { cwd: root })).toContain("backend");
    expect(await runCli(["backup", "list"], { cwd: root })).toContain("T");
    expect(await runCli(["skill", "validate", skillDir], { cwd: root })).toContain("valid");
    expect(await runCli(["skill", "score", skillDir], { cwd: root })).toContain("score:");

    await runCli(["command", "remove", "security-scan"], { cwd: root });
    await runCli(["subagent", "remove", "backend"], { cwd: root });

    expect(await runCli(["command", "list"], { cwd: root })).not.toContain("security-scan");
    expect(await runCli(["subagent", "list"], { cwd: root })).not.toContain("backend");
  });

  test("supports scoped backup create/list and top-level restore for global scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-backup-scope-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      const globalRoot = join(xdgData, "use0-kit", "global");
      const manifestPath = join(globalRoot, "use0-kit.toml");
      const before = await readFile(manifestPath, "utf8");
      const backupOutput = await runCli(["backup", "create", "--scope", "global"], { cwd: root });
      const backupId = backupOutput.trim().split(": ").at(-1) ?? "";
      expect(backupOutput).toContain("Backup created:");
      expect(await runCli(["backup", "list", "--scope", "global"], { cwd: root })).toContain("T");
      await writeFile(manifestPath, `${before}\n# changed\n`, "utf8");
      expect(await runCli(["restore", backupId, "--scope", "global"], { cwd: root })).toContain(
        `Backup restored: ${backupId}`
      );
      expect(await readFile(manifestPath, "utf8")).toBe(before);
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });

  test("supports plan --scope and --json for global scope resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-plan-scope-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      const globalRoot = join(xdgData, "use0-kit", "global");
      const skillDir = join(globalRoot, "skills", "global-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Global Skill\n", "utf8");
      await runCli(
        ["skill", "add", "--id", "global-skill", "--source", `path:${skillDir}`, "--targets", "codex"],
        { cwd: globalRoot }
      );

      const planJson = await runCli(["plan", "--scope", "global", "--json"], { cwd: root });
      const parsed = JSON.parse(planJson) as Array<{ resourceId?: string }>;
      expect(parsed).toEqual(expect.arrayContaining([expect.objectContaining({ resourceId: "skill:global-skill" })]));
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });

  test("supports apply --scope with post-apply verify for global scope resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-apply-scope-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      const globalRoot = join(xdgData, "use0-kit", "global");
      const skillDir = join(globalRoot, "skills", "global-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Global Skill\n", "utf8");
      await runCli(
        ["skill", "add", "--id", "global-skill", "--source", `path:${skillDir}`, "--targets", "codex"],
        { cwd: globalRoot }
      );

      expect(await runCli(["apply", "--scope", "global", "--verify"], { cwd: root })).toContain("Applied");
      expect(await runCli(["doctor", "--scope", "global"], { cwd: root })).toContain("materialized-graph: ok");
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });

  test("supports apply --plan as a non-destructive materialization preview", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-apply-plan-"));
    const skillDir = join(root, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"], {
      cwd: root
    });

    const output = await runCli(["apply", "--plan", "--agent", "codex"], { cwd: root });
    expect(output).toContain("STORE  skill skill:repo-conventions");
    await expect(access(join(root, ".codex", "skills", "repo-conventions", "SKILL.md"))).rejects.toThrow();
  });

  test("supports --verbose on plan/apply/sync by appending execution context", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-verbose-"));
    const skillDir = join(root, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"], {
      cwd: root
    });

    const planOutput = await runCli(["plan", "--verbose", "--agent", "codex"], { cwd: root });
    expect(planOutput).toContain("STORE  skill skill:repo-conventions");
    expect(planOutput).toContain("verbose.command=plan");
    expect(planOutput).toContain(`verbose.root=${root}`);
    expect(planOutput).toContain("verbose.agents=codex");

    const applyOutput = await runCli(["apply", "--verbose", "--agent", "codex"], { cwd: root });
    expect(applyOutput).toContain("Applied");
    expect(applyOutput).toContain("verbose.command=apply");
    expect(applyOutput).toContain("verbose.agents=codex");

    const syncOutput = await runCli(["sync", "--verbose", "--agent", "codex"], { cwd: root });
    expect(syncOutput).toContain("Synced");
    expect(syncOutput).toContain("verbose.command=sync");
    expect(syncOutput).toContain("verbose.agents=codex");
  });

  test("supports resource mutation commands against named scopes without cd into the scope root", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-scope-resource-mutations-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      const globalRoot = join(xdgData, "use0-kit", "global");
      const skillDir = join(globalRoot, "skills", "web-design");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Web Design\n", "utf8");

      expect(
        await runCli(
          ["skill", "add", "--scope", "global", "--id", "web-design", "--source", `path:${skillDir}`, "--targets", "*"],
          { cwd: root }
        )
      ).toContain("Added skill:web-design");
      expect(await runCli(["mcp", "add", "context7", "--scope", "global", "--url", "https://mcp.context7.com/mcp"], { cwd: root })).toContain(
        "Added mcp:context7"
      );
      expect(await runCli(["pack", "init", "frontend", "--scope", "global"], { cwd: root })).toContain(
        "Initialized pack:frontend"
      );
      expect(await runCli(["pack", "add", "frontend", "skill:web-design", "--scope", "global"], { cwd: root })).toContain(
        "Added skill:web-design to pack:frontend"
      );
      expect(await runCli(["pack", "add", "frontend", "mcp:context7", "--scope", "global"], { cwd: root })).toContain(
        "Added mcp:context7 to pack:frontend"
      );

      expect(await runCli(["skill", "list", "--scope", "global"], { cwd: root })).toContain("web-design");
      expect(await runCli(["mcp", "list", "--scope", "global"], { cwd: root })).toContain("context7");
      expect(await runCli(["pack", "list", "--scope", "global"], { cwd: root })).toContain("frontend");
      expect(await runCli(["list", "--scope", "global"], { cwd: root })).toContain("pack:frontend");

      const manifest = await readFile(join(globalRoot, "use0-kit.toml"), "utf8");
      expect(manifest).toContain('id = "web-design"');
      expect(manifest).toContain('id = "context7"');
      expect(manifest).toContain('id = "frontend"');
      expect(manifest).toContain('resources = ["skill:web-design", "mcp:context7"]');
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });

  test("supports scope exclude against named scopes without cd into the scope root", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-scope-exclude-target-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      await runCli(["mcp", "add", "context7", "--scope", "global", "--url", "https://mcp.context7.com/mcp"], { cwd: root });
      expect(await runCli(["scope", "exclude", "mcp:context7", "--scope", "global"], { cwd: root })).toContain(
        "Excluded mcp:context7"
      );

      const globalRoot = join(xdgData, "use0-kit", "global");
      const manifest = await readFile(join(globalRoot, "use0-kit.toml"), "utf8");
      expect(manifest).toContain('selector = "mcp:context7"');
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });

  test("supports global --root as the base project root across scope and resource commands", async () => {
    const outerRoot = await mkdtemp(join(tmpdir(), "use0-kit-cli-root-outer-"));
    const targetRoot = join(outerRoot, "workspace", "project");
    const skillDir = join(targetRoot, "skills", "rooted-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Rooted Skill\n", "utf8");

    expect(
      await runCli(["scope", "init", "--scope", "project", "--root", targetRoot, "--agents", "codex"], {
        cwd: outerRoot
      })
    ).toContain(`Initialized project scope at ${targetRoot}`);

    expect(await runCli(["scope", "current", "--root", targetRoot], { cwd: outerRoot })).toContain("project");
    expect(await runCli(["scope", "path", "--root", targetRoot, "--scope", "project"], { cwd: outerRoot })).toContain(
      targetRoot
    );
    expect(
      await runCli(
        ["skill", "add", "--root", targetRoot, "--id", "rooted-skill", "--source", `path:${skillDir}`, "--targets", "codex"],
        {
          cwd: outerRoot
        }
      )
    ).toContain("Added skill:rooted-skill");
    expect(await runCli(["list", "--root", targetRoot, "skill:rooted-skill"], { cwd: outerRoot })).toContain(
      "skill:rooted-skill"
    );
    expect(await runCli(["scope", "inspect", "--root", targetRoot], { cwd: outerRoot })).toContain(
      join(targetRoot, "use0-kit.toml")
    );
  });

  test("supports --config pointing at a concrete use0-kit.toml from outside the project", async () => {
    const outerRoot = await mkdtemp(join(tmpdir(), "use0-kit-cli-config-outer-"));
    const targetRoot = join(outerRoot, "workspace", "project");
    const skillDir = join(targetRoot, "skills", "config-skill");
    const configPath = join(targetRoot, "use0-kit.toml");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Config Skill\n", "utf8");

    expect(
      await runCli(["scope", "init", "--scope", "project", "--root", targetRoot, "--agents", "codex"], {
        cwd: outerRoot
      })
    ).toContain(`Initialized project scope at ${targetRoot}`);

    expect(await runCli(["scope", "current", "--config", configPath], { cwd: outerRoot })).toContain("project");
    expect(
      await runCli(
        ["skill", "add", "--config", configPath, "--id", "config-skill", "--source", `path:${skillDir}`, "--targets", "codex"],
        { cwd: outerRoot }
      )
    ).toContain("Added skill:config-skill");
    expect(await runCli(["list", "--config", configPath, "skill:config-skill"], { cwd: outerRoot })).toContain(
      "skill:config-skill"
    );
  });

  test("supports scoped profile lifecycle against global profile libraries", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-profile-scope-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const targetRoot = join(root, "project-target");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      await runCli(["scope", "init", "--scope", "project"], { cwd: targetRoot });

      const globalRoot = join(xdgData, "use0-kit", "global");
      const skillDir = join(globalRoot, "skills", "global-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Global Skill\n\nFrom global profile library.\n", "utf8");
      await runCli(
        ["skill", "add", "--id", "global-skill", "--source", `path:${skillDir}`, "--targets", "codex"],
        { cwd: globalRoot }
      );

      expect(await runCli(["profile", "create", "frontend", "--scope", "global", "--name", "Frontend"], { cwd: root })).toContain(
        "Created profile:frontend"
      );
      expect(await runCli(["profile", "add", "frontend", "skill:global-skill", "--scope", "global"], { cwd: root })).toContain(
        "Added skill:global-skill to profile:frontend"
      );
      expect(await runCli(["profile", "list", "--scope", "global"], { cwd: root })).toContain("frontend");
      expect(await runCli(["profile", "use", "frontend", "--scope", "global"], { cwd: root })).toContain(
        "Using profile:frontend"
      );
      expect(await readFile(join(globalRoot, ".use0-kit", "state.json"), "utf8")).toContain('"activeProfile": "frontend"');

      expect(
        await runCli(["profile", "sync", "frontend", "--scope", "global", "--to", targetRoot, "--apply", "--agent", "codex"], {
          cwd: root
        })
      ).toContain("and applied");

      expect(await readFile(join(targetRoot, "use0-kit.toml"), "utf8")).toContain('id = "frontend"');
      expect(await readFile(join(targetRoot, "use0-kit.toml"), "utf8")).toContain('id = "global-skill"');
      await access(join(targetRoot, ".codex", "skills", "global-skill", "SKILL.md"));
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });

  test("supports profile sync with scope-name target roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-profile-sync-scope-name-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const projectRoot = join(root, "project");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });

      const globalRoot = join(xdgData, "use0-kit", "global");
      const skillDir = join(globalRoot, "skills", "global-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Global Skill\n", "utf8");
      await runCli(
        ["skill", "add", "--id", "global-skill", "--source", `path:${skillDir}`, "--targets", "codex"],
        { cwd: globalRoot }
      );
      await runCli(["profile", "create", "frontend", "--name", "Frontend"], { cwd: globalRoot });
      await runCli(["profile", "add", "frontend", "skill:global-skill"], { cwd: globalRoot });

      expect(
        await runCli(
          ["profile", "sync", "frontend", "--scope", "global", "--to", "project", "--apply", "--agent", "codex"],
          { cwd: projectRoot }
        )
      ).toContain(`Synced 2 export(s) from profile:frontend to ${projectRoot} and applied`);

      expect(await readFile(join(projectRoot, "use0-kit.toml"), "utf8")).toContain('id = "global-skill"');
      await access(join(projectRoot, ".codex", "skills", "global-skill", "SKILL.md"));
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });

  test("profile use can activate a global profile into user scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-profile-use-user-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      await runCli(["scope", "init", "--scope", "user"], { cwd: root });

      const globalRoot = join(xdgData, "use0-kit", "global");
      const userRoot = join(xdgConfig, "use0-kit");
      const skillDir = join(globalRoot, "skills", "global-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Global Skill\n", "utf8");

      await runCli(
        ["skill", "add", "--id", "global-skill", "--source", `path:${skillDir}`, "--targets", "codex"],
        { cwd: globalRoot }
      );
      await runCli(["profile", "create", "frontend", "--name", "Frontend"], { cwd: globalRoot });
      await runCli(["profile", "add", "frontend", "skill:global-skill"], { cwd: globalRoot });

      expect(await runCli(["profile", "use", "frontend", "--scope", "user"], { cwd: root })).toContain(
        "Using profile:frontend"
      );
      expect(await readFile(join(userRoot, ".use0-kit", "state.json"), "utf8")).toContain('"activeProfile": "frontend"');
      const userManifest = await readFile(join(userRoot, "use0-kit.toml"), "utf8");
      expect(userManifest).toContain('[[profiles]]');
      expect(userManifest).toContain('id = "frontend"');
      expect(userManifest).toContain('[[skills]]');
      expect(userManifest).toContain('id = "global-skill"');
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });

  test("supports pack install with --scope project as target root", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-pack-install-scope-name-"));
    const skillDir = join(root, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );
    await runCli(["pack", "init", "frontend", "--name", "acme/frontend", "--version", "1.0.0"], { cwd: root });
    await runCli(["pack", "add", "frontend", "skill:repo-conventions"], { cwd: root });

    expect(
      await runCli(["pack", "install", "frontend", "--scope", "project", "--apply", "--agent", "codex"], {
        cwd: root
      })
    ).toContain(`Installed 2 resource(s) from pack:frontend to ${root} and applied`);

    expect(await readFile(join(root, "use0-kit.toml"), "utf8")).toContain('id = "repo-conventions"');
    await access(join(root, ".codex", "skills", "repo-conventions", "SKILL.md"));
  });

  test("supports top-level sync as a current-scope parent-resolve plus apply flow", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-top-sync-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const projectRoot = join(root, "project");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });

      const globalRoot = join(xdgData, "use0-kit", "global");
      const skillDir = join(globalRoot, "skills", "global-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Global Skill\n", "utf8");
      await runCli(
        ["skill", "add", "--id", "global-skill", "--source", `path:${skillDir}`, "--targets", "codex"],
        { cwd: globalRoot }
      );
      await runCli(["profile", "create", "frontend", "--scope", "global", "--name", "Frontend"], { cwd: root });
      await runCli(["profile", "add", "frontend", "skill:global-skill", "--scope", "global"], { cwd: root });
      await writeFile(
        join(projectRoot, "use0-kit.toml"),
        [
          'version = 1',
          'default_scope = "project"',
          "",
          "[scope]",
          'level = "project"',
          'mode = "project"',
          'canonical_store = ".use0-kit/store"',
          'materialize = "symlink"',
          'parents = [{ scope = "global", profile = "frontend", mode = "pin" }]',
          "",
          "[agents]",
          'enabled = ["codex"]'
        ].join("\n") + "\n",
        "utf8"
      );

      expect(await runCli(["sync"], { cwd: projectRoot })).toContain("Synced 2 resource(s) from declared parents and applied");
      expect(await readFile(join(projectRoot, "use0-kit.toml"), "utf8")).toContain('id = "global-skill"');
      await access(join(projectRoot, ".codex", "skills", "global-skill", "SKILL.md"));
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });

  test("supports top-level sync --profile to activate a global profile into the current scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-sync-profile-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const projectRoot = join(root, "project");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await mkdir(projectRoot, { recursive: true });
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });

      const globalRoot = join(xdgData, "use0-kit", "global");
      const skillDir = join(globalRoot, "skills", "global-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Global Skill\n\nFrom sync profile.\n", "utf8");
      await runCli(
        ["skill", "add", "--id", "global-skill", "--source", `path:${skillDir}`, "--targets", "codex"],
        { cwd: globalRoot }
      );
      await runCli(["profile", "create", "frontend", "--name", "Frontend"], { cwd: globalRoot });
      await runCli(["profile", "add", "frontend", "skill:global-skill"], { cwd: globalRoot });

      expect(await runCli(["sync", "--profile", "frontend", "--agent", "codex"], { cwd: projectRoot })).toContain(
        "Synced 2 resource(s) from profile:frontend"
      );
      expect(await readFile(join(projectRoot, "use0-kit.toml"), "utf8")).toContain('id = "global-skill"');
      await access(join(projectRoot, ".codex", "skills", "global-skill", "SKILL.md"));
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });

  test("top-level sync refreshes lock state before parent sync/apply", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-top-sync-lock-refresh-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const projectRoot = join(root, "project");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });

      const globalRoot = join(xdgData, "use0-kit", "global");
      const skillDir = join(globalRoot, "skills", "global-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Global Skill\n", "utf8");
      await runCli(
        ["skill", "add", "--id", "global-skill", "--source", `path:${skillDir}`, "--targets", "codex"],
        { cwd: globalRoot }
      );
      await writeFile(
        join(projectRoot, "use0-kit.toml"),
        [
          'version = 1',
          'default_scope = "project"',
          "",
          "[scope]",
          'level = "project"',
          'mode = "project"',
          'canonical_store = ".use0-kit/store"',
          'materialize = "symlink"',
          'parents = [{ scope = "global", mode = "inherit" }]',
          "",
          "[agents]",
          'enabled = ["codex"]'
        ].join("\n") + "\n",
        "utf8"
      );

      await runCli(["sync"], { cwd: projectRoot });
      const lock = await readFile(join(projectRoot, "use0-kit.lock.json"), "utf8");
      expect(lock).toContain('"generatedAt"');
      expect(lock).toContain('"skill:global-skill"');
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });

  test("supports scope-name from/to arguments for scope sync", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-scope-name-sync-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const projectRoot = join(root, "project");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });

      const globalRoot = join(xdgData, "use0-kit", "global");
      const skillDir = join(globalRoot, "skills", "global-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Global Skill\n", "utf8");
      await runCli(
        ["skill", "add", "--id", "global-skill", "--source", `path:${skillDir}`, "--targets", "codex"],
        { cwd: globalRoot }
      );

      expect(
        await runCli(
          ["scope", "sync", "--from", "global", "--to", "project", "skill:global-skill", "--mode", "pin", "--apply", "--agent", "codex"],
          { cwd: projectRoot }
        )
      ).toContain("Synced 1 resource(s) from global to project and applied");

      expect(await readFile(join(projectRoot, "use0-kit.toml"), "utf8")).toContain('id = "global-skill"');
      await access(join(projectRoot, ".codex", "skills", "global-skill", "SKILL.md"));
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });

  test("supports apply --backup false without creating a backup snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-apply-nobackup-"));
    const skillDir = join(root, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");
    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );

    expect(await runCli(["apply", "--backup", "false"], { cwd: root })).toContain("Applied");
    expect(await runCli(["backup", "list"], { cwd: root })).toBe("");
    expect(await readFile(join(root, ".use0-kit", "state.json"), "utf8")).toContain('"backupId": null');
    expect(await readFile(join(root, ".use0-kit", "state.json"), "utf8")).toContain('"backups": []');
  });

  test("supports plan/apply --agent to materialize only one agent projection", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-plan-apply-agent-"));
    const skillDir = join(root, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");
    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex,cursor"],
      { cwd: root }
    );
    await runCli(
      ["instruction", "set-section", "--heading", "Testing", "--body", "Run tests.", "--targets", "codex,cursor", "--id", "testing"],
      { cwd: root }
    );

    const codexPlan = JSON.parse(await runCli(["plan", "--agent", "codex", "--json"], { cwd: root })) as Array<{
      agentId?: string;
      resourceId?: string;
    }>;
    expect(codexPlan.some((action) => action.agentId === "cursor")).toBe(false);
    expect(codexPlan).toEqual(expect.arrayContaining([expect.objectContaining({ agentId: "codex" })]));

    expect(await runCli(["apply", "--agent", "codex"], { cwd: root })).toContain("Applied");
    await access(join(root, ".codex", "skills", "repo-conventions"));
    await access(join(root, "AGENTS.md"));
    await expect(access(join(root, ".cursor", "skills", "repo-conventions"))).rejects.toThrow();
    await expect(access(join(root, ".cursor", "AGENTS.md"))).rejects.toThrow();
  });

  test("supports plan/apply --agent with multiple agent ids", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-plan-apply-multi-agent-"));
    const skillDir = join(root, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");
    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex,cursor,claude-code"],
      { cwd: root }
    );

    const filteredPlan = JSON.parse(await runCli(["plan", "--agent", "codex,cursor", "--json"], { cwd: root })) as Array<{
      agentId?: string;
      resourceId?: string;
    }>;
    expect(filteredPlan.some((action) => action.agentId === "claude-code")).toBe(false);
    expect(filteredPlan).toEqual(expect.arrayContaining([expect.objectContaining({ agentId: "codex" })]));
    expect(filteredPlan).toEqual(expect.arrayContaining([expect.objectContaining({ agentId: "cursor" })]));

    expect(await runCli(["apply", "--agent", "codex,cursor"], { cwd: root })).toContain("Applied");
    await access(join(root, ".codex", "skills", "repo-conventions"));
    await access(join(root, ".cursor", "skills", "repo-conventions"));
    await expect(access(join(root, ".claude", "skills", "repo-conventions"))).rejects.toThrow();
  });

  test("supports --agents as an alias for multi-agent plan/apply filtering", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-plan-apply-agents-alias-"));
    const skillDir = join(root, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex,cursor,claude-code"],
      { cwd: root }
    );

    const filteredPlan = JSON.parse(await runCli(["plan", "--agents", "codex,cursor", "--json"], { cwd: root })) as Array<{
      agentId?: string;
    }>;
    expect(filteredPlan.some((action) => action.agentId === "claude-code")).toBe(false);
    expect(filteredPlan.some((action) => action.agentId === "codex")).toBe(true);
    expect(filteredPlan.some((action) => action.agentId === "cursor")).toBe(true);

    expect(await runCli(["apply", "--agents", "codex,cursor"], { cwd: root })).toContain("Applied");
    await access(join(root, ".codex", "skills", "repo-conventions"));
    await access(join(root, ".cursor", "skills", "repo-conventions"));
    await expect(access(join(root, ".claude", "skills", "repo-conventions"))).rejects.toThrow();
  });

  test("supports --store as a runtime canonical store override for plan/apply", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-store-override-"));
    const skillDir = join(root, "skills", "repo-conventions");
    const runtimeStore = ".runtime-store";

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );

    const plan = await runCli(["plan", "--store", runtimeStore], { cwd: root });
    expect(plan).toContain(join(root, runtimeStore, "skills", "repo-conventions"));

    expect(await runCli(["apply", "--store", runtimeStore], { cwd: root })).toContain("Applied");
    await access(join(root, runtimeStore, "skills", "repo-conventions", "SKILL.md"));
    await access(join(root, ".codex", "skills", "repo-conventions", "SKILL.md"));
  });

  test("supports plan/apply --materialize override independently of manifest defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-plan-apply-materialize-"));
    const skillDir = join(root, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");
    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );

    const plan = JSON.parse(await runCli(["plan", "--materialize", "copy", "--json"], { cwd: root })) as Array<{
      kind?: string;
      mode?: string;
      resourceId?: string;
    }>;
    expect(plan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "link-skill",
          resourceId: "skill:repo-conventions",
          mode: "copy"
        })
      ])
    );

    expect(await runCli(["apply", "--materialize", "copy"], { cwd: root })).toContain("Applied");
    expect((await lstat(join(root, ".codex", "skills", "repo-conventions"))).isSymbolicLink()).toBe(false);
    expect(await readFile(join(root, ".codex", "skills", "repo-conventions", "SKILL.md"), "utf8")).toContain(
      "Repo Conventions"
    );
  });

  test("supports human-readable plan output by default and json when requested", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-plan-text-"));
    const skillDir = join(root, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");
    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );

    const textPlan = await runCli(["plan"], { cwd: root });
    expect(textPlan).toContain("STORE  skill skill:repo-conventions");
    expect(textPlan).toContain("LINK   skill");

    const jsonPlan = await runCli(["plan", "--json"], { cwd: root });
    expect(JSON.parse(jsonPlan)).toEqual(expect.any(Array));
  });

  test("supports top-level rollback to the last apply backup", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-rollback-"));
    const skillDir = join(root, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");
    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );

    const beforeApply = await readFile(join(root, "use0-kit.toml"), "utf8");
    expect(await runCli(["apply"], { cwd: root })).toContain("Applied");
    await writeFile(join(root, "use0-kit.toml"), `${beforeApply}\n# drifted\n`, "utf8");

    const output = await runCli(["rollback"], { cwd: root });
    expect(output).toContain("Rolled back");
    expect(await readFile(join(root, "use0-kit.toml"), "utf8")).toBe(beforeApply);
  });
});
