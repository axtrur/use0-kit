import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("scope reconciliation", () => {
  test("classifies scope diff as ADDED CHANGED and SHADOWED", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-scope-diff-"));
    const globalRoot = join(root, "global");
    const projectRoot = join(root, "project");
    const globalSkill = join(globalRoot, "skills", "web-design");
    const projectSkill = join(projectRoot, "skills", "web-design");

    await mkdir(globalSkill, { recursive: true });
    await mkdir(projectSkill, { recursive: true });
    await writeFile(join(globalSkill, "SKILL.md"), "# Web Design\n", "utf8");
    await writeFile(join(projectSkill, "SKILL.md"), "# Web Design\n\nproject override\n", "utf8");

    await runCli(["scope", "init", "--scope", "global"], { cwd: globalRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });
    await runCli(
      ["skill", "add", "--id", "web-design", "--source", `path:${globalSkill}`, "--targets", "codex"],
      { cwd: globalRoot }
    );
    await runCli(
      ["mcp", "add", "--id", "context7", "--command", "npx", "--args", "-y,@upstash/context7-mcp", "--targets", "codex"],
      { cwd: globalRoot }
    );
    await runCli(
      ["skill", "add", "--id", "web-design", "--source", `path:${projectSkill}`, "--targets", "codex"],
      { cwd: projectRoot }
    );

    const diff = await runCli(
      ["scope", "diff", "--from", globalRoot, "--to", projectRoot, "--kind", "skill,mcp"],
      { cwd: root }
    );

    expect(diff).toContain("ADDED mcp:context7");
    expect(diff).toContain("SHADOWED skill:web-design");
    expect(diff).toContain("CHANGED skill:web-design");

    const diffJson = JSON.parse(
      await runCli(["scope", "diff", "--from", globalRoot, "--to", projectRoot, "--json"], { cwd: root })
    ) as {
      clean: boolean;
      changes: Array<{ status: string; selector: string }>;
    };
    expect(diffJson.clean).toBe(false);
    expect(diffJson.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "ADDED", selector: "mcp:context7" }),
        expect.objectContaining({ status: "CHANGED", selector: "skill:web-design" }),
        expect.objectContaining({ status: "SHADOWED", selector: "skill:web-design" })
      ])
    );
  });

  test("supports inherit pin fork and mirror sync semantics", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-scope-sync-"));
    const globalRoot = join(root, "global");
    const projectRoot = join(root, "project");
    const forkRoot = join(root, "fork");
    const mirrorRoot = join(root, "mirror");
    const skillDir = join(globalRoot, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");

    await runCli(["scope", "init", "--scope", "global"], { cwd: globalRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: forkRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: mirrorRoot });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: globalRoot }
    );

    await runCli(
      ["scope", "sync", "--from", globalRoot, "--to", projectRoot, "skill:repo-conventions", "--mode", "inherit"],
      { cwd: root }
    );
    await runCli(
      ["scope", "sync", "--from", globalRoot, "--to", forkRoot, "skill:repo-conventions", "--mode", "fork"],
      { cwd: root }
    );
    await runCli(
      ["scope", "sync", "--from", globalRoot, "--to", mirrorRoot, "--mode", "mirror", "--prune"],
      { cwd: root }
    );

    const inherited = await readFile(join(projectRoot, "use0-kit.toml"), "utf8");
    const forked = await readFile(join(forkRoot, "use0-kit.toml"), "utf8");
    const mirrored = await readFile(join(mirrorRoot, "use0-kit.toml"), "utf8");

    expect(inherited).toContain('origin_scope = "global"');
    expect(inherited).toContain('scope_mode = "inherit"');
    expect(forked).toContain(".agents/skills/repo-conventions");
    expect(forked).toContain('scope_mode = "fork"');
    expect(mirrored).toContain('scope_mode = "mirror"');
    expect(mirrored).toContain('id = "repo-conventions"');

    await runCli(
      ["scope", "sync", "--from", globalRoot, "--to", projectRoot, "skill:repo-conventions", "--mode", "pin"],
      { cwd: root }
    );
    const pinned = await readFile(join(projectRoot, "use0-kit.toml"), "utf8");
    expect(pinned).toContain('scope_mode = "pin"');
    expect(pinned).toContain('pinned_digest = "');
  });

  test("mirror prune with a selector only prunes the selected resource graph", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-mirror-prune-selective-"));
    const globalRoot = join(root, "global");
    const projectRoot = join(root, "project");
    const selectedSkill = join(globalRoot, "skills", "repo-conventions");
    const keepSkill = join(projectRoot, "skills", "local-only");

    await mkdir(selectedSkill, { recursive: true });
    await mkdir(keepSkill, { recursive: true });
    await writeFile(join(selectedSkill, "SKILL.md"), "# Repo Conventions\n", "utf8");
    await writeFile(join(keepSkill, "SKILL.md"), "# Local Only\n", "utf8");

    await runCli(["scope", "init", "--scope", "global"], { cwd: globalRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${selectedSkill}`, "--targets", "codex"],
      { cwd: globalRoot }
    );
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${keepSkill}`, "--targets", "codex"],
      { cwd: projectRoot }
    );
    await runCli(
      ["skill", "add", "--id", "local-only", "--source", `path:${keepSkill}`, "--targets", "codex"],
      { cwd: projectRoot }
    );

    await runCli(
      ["scope", "sync", "--from", globalRoot, "--to", projectRoot, "skill:repo-conventions", "--mode", "mirror", "--prune"],
      { cwd: root }
    );

    const manifest = await readFile(join(projectRoot, "use0-kit.toml"), "utf8");
    expect(manifest).toContain('id = "repo-conventions"');
    expect(manifest).toContain(`path:${selectedSkill}`);
    expect(manifest).toContain('id = "local-only"');
  });
});
