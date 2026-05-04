import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("MVP2 features", () => {
  test("renders command and subagent resources with host overlays", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-overlay-"));

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      [
        "command",
        "add",
        "--id",
        "security-scan",
        "--content",
        [
          "---",
          "id: security-scan",
          "name: Security Scan",
          "description: Run security checks.",
          "agentkit/opencode/effort: high",
          "agentkit/claude-code/model: haiku",
          "---",
          "",
          "Run npm audit and report findings."
        ].join("\n"),
        "--targets",
        "opencode,claude-code"
      ],
      { cwd: root }
    );
    await runCli(
      [
        "subagent",
        "add",
        "--id",
        "backend",
        "--content",
        [
          "---",
          "id: backend",
          "name: Backend Specialist",
          "description: Focus on backend tasks.",
          "agentkit/opencode/effort: high",
          "agentkit/cursor/model: fast",
          "---",
          "",
          "You own API and storage changes."
        ].join("\n"),
        "--targets",
        "opencode,cursor"
      ],
      { cwd: root }
    );

    const opencodeCommand = await runCli(
      ["command", "render", "--id", "security-scan", "--agent", "opencode"],
      { cwd: root }
    );
    const claudeCommand = await runCli(
      ["command", "render", "--id", "security-scan", "--agent", "claude-code"],
      { cwd: root }
    );
    const opencodeSubagent = await runCli(
      ["subagent", "render", "--id", "backend", "--agent", "opencode"],
      { cwd: root }
    );

    expect(opencodeCommand).toContain("effort: high");
    expect(opencodeCommand).not.toContain("agentkit/opencode/effort");
    expect(opencodeCommand).not.toContain("agentkit/claude-code/model");
    expect(claudeCommand).toContain("model: haiku");
    expect(opencodeSubagent).toContain("effort: high");
    expect(opencodeSubagent).not.toContain("agentkit/cursor/model");
  });

  test("supports pack init add export install plus backup/restore", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-pack-"));
    const sourceRoot = join(root, "source");
    const targetRoot = join(root, "target");
    const skillDir = join(sourceRoot, "skills", "web-design");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Web Design", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: sourceRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: targetRoot });
    await runCli(
      [
        "skill",
        "add",
        "--id",
        "web-design",
        "--source",
        `path:${skillDir}`,
        "--targets",
        "codex"
      ],
      { cwd: sourceRoot }
    );
    await runCli(
      ["pack", "init", "frontend", "--name", "acme/frontend", "--version", "1.0.0"],
      { cwd: sourceRoot }
    );
    await runCli(["pack", "add", "frontend", "skill:web-design"], { cwd: sourceRoot });
    await runCli(["pack", "export", "frontend", "--out", join(root, "frontend.agentpack.json")], {
      cwd: sourceRoot
    });
    await runCli(["pack", "install", "frontend", "--to", targetRoot], { cwd: sourceRoot });

    const manifestAfterInstall = await readFile(join(targetRoot, "use0-kit.toml"), "utf8");
    expect(manifestAfterInstall).toContain('id = "web-design"');

    await runCli(["apply"], { cwd: targetRoot });
    const backupOutput = await runCli(["backup", "create"], { cwd: targetRoot });
    await writeFile(join(targetRoot, "use0-kit.toml"), "mutated\n", "utf8");
    const backupId = backupOutput.trim().split(": ").at(-1) ?? "";
    await runCli(["backup", "restore", backupId], { cwd: targetRoot });

    expect(await readFile(join(root, "frontend.agentpack.json"), "utf8")).toContain(
      '"name": "acme/frontend"'
    );
    expect(await readFile(join(targetRoot, ".codex", "skills", "web-design", "SKILL.md"), "utf8")).toContain(
      "Web Design"
    );
    expect(await readFile(join(targetRoot, "use0-kit.toml"), "utf8")).toContain('id = "web-design"');
  });

  test("adopts existing codex MCP config into the manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-adopt-"));

    await mkdir(join(root, ".codex"), { recursive: true });
    await writeFile(
      join(root, ".codex", "config.toml"),
      ['[mcp_servers.context7]', 'command = "npx"', 'args = ["-y", "@upstash/context7-mcp"]', ""].join("\n"),
      "utf8"
    );

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    const output = await runCli(["adopt"], { cwd: root });

    expect(output).toContain("Adopted 1 resource(s)");
    expect(await readFile(join(root, "use0-kit.toml"), "utf8")).toContain('id = "context7"');
  });

  test("supports adopt --scope and filtered adopt flags", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-adopt-scope-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      const globalRoot = join(xdgData, "use0-kit", "global");
      await mkdir(join(globalRoot, ".codex"), { recursive: true });
      await writeFile(
        join(globalRoot, ".codex", "config.toml"),
        ['[mcp_servers.context7]', 'command = "npx"', 'args = ["-y", "@upstash/context7-mcp"]', ""].join("\n"),
        "utf8"
      );

      expect(await runCli(["adopt", "--scope", "global", "--kind", "mcp", "--agent", "codex"], { cwd: root })).toContain(
        "Adopted 1 resource(s)"
      );
      expect(await readFile(join(globalRoot, "use0-kit.toml"), "utf8")).toContain('id = "context7"');
      await mkdir(join(globalRoot, ".cursor"), { recursive: true });
      await writeFile(
        join(globalRoot, ".cursor", "mcp.json"),
        JSON.stringify(
          {
            mcpServers: {
              github: {
                url: "https://example.com/mcp",
                transport: "http"
              }
            }
          },
          null,
          2
        ),
        "utf8"
      );
      expect(await runCli(["adopt", "--scope", "global", "--kind", "mcp", "--agent", "cursor"], { cwd: root })).toContain(
        "Adopted 1 resource(s)"
      );
      expect(await readFile(join(globalRoot, "use0-kit.toml"), "utf8")).toContain('id = "github"');
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });

  test("adopts claude-code skills, mcp, and instructions into the manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-adopt-claude-"));
    const skillDir = join(root, ".claude", "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");
    await writeFile(
      join(root, ".claude", "mcp.json"),
      JSON.stringify(
        {
          mcpServers: {
            context7: {
              command: "npx",
              args: ["-y", "@upstash/context7-mcp"],
              transport: "stdio",
              env: ["GITHUB_TOKEN"]
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(join(root, "CLAUDE.md"), "Run tests before PR.\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    expect(await runCli(["adopt", "--agent", "claude-code", "--kind", "skill,mcp,instruction"], { cwd: root })).toContain(
      "Adopted 3 resource(s)"
    );

    const manifest = await readFile(join(root, "use0-kit.toml"), "utf8");
    const resolvedSkillDir = await realpath(skillDir);
    expect(manifest).toContain('id = "repo-conventions"');
    expect(manifest).toContain(`source = "path:${resolvedSkillDir}"`);
    expect(manifest).toContain('id = "context7"');
    expect(manifest).toContain('id = "claude-code-guidance"');
    expect(manifest).toContain(".use0-kit/sources/instructions/claude-code-guidance.md");
    expect(manifest).not.toContain("heading =");
  });

  test("supports adopt action modes ignore and leave-external", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-adopt-actions-"));
    const skillDir = join(root, ".claude", "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");
    await runCli(["scope", "init", "--scope", "project"], { cwd: root });

    expect(await runCli(["adopt", "--agent", "claude-code", "--kind", "skill", "--action", "ignore"], { cwd: root })).toContain(
      "Adopted 0 resource(s)"
    );
    expect(await readFile(join(root, "use0-kit.toml"), "utf8")).not.toContain('id = "repo-conventions"');

    expect(
      await runCli(["adopt", "--agent", "claude-code", "--kind", "skill", "--action", "leave-external"], { cwd: root })
    ).toContain("Adopted 1 resource(s)");
    const manifest = await readFile(join(root, "use0-kit.toml"), "utf8");
    expect(manifest).toContain('id = "repo-conventions"');
    expect(manifest).toContain('provenance_source = "external:claude-code"');
  });

  test("supports adopt preview in text and json forms before importing", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-adopt-preview-"));
    const skillDir = join(root, ".claude", "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");
    await writeFile(join(root, "CLAUDE.md"), "Run tests before PR.\n", "utf8");
    await runCli(["scope", "init", "--scope", "project"], { cwd: root });

    const preview = await runCli(["adopt", "--agent", "claude-code", "--kind", "skill,instruction", "--preview"], {
      cwd: root
    });
    expect(preview).toContain("skill:repo-conventions");
    expect(preview).toContain("instruction:claude-code-guidance");
    expect(preview).toContain("agent=claude-code");

    const previewJson = JSON.parse(
      await runCli(["adopt", "--agent", "claude-code", "--kind", "skill,instruction", "--preview", "--json"], {
        cwd: root
      })
    ) as Array<{ selector: string; agent: string; source: string }>;
    expect(previewJson).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ selector: "skill:repo-conventions", agent: "claude-code" }),
        expect.objectContaining({ selector: "instruction:claude-code-guidance", agent: "claude-code" })
      ])
    );

    expect(await readFile(join(root, "use0-kit.toml"), "utf8")).not.toContain('id = "repo-conventions"');
  });
});
