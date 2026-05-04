import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("use0-kit CLI", () => {
  test("supports MVP1 scope/resource/materialization workflows", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-cli-"));
    const globalRoot = join(root, "global-scope");
    const projectRoot = join(root, "project-scope");
    const skillDir = join(globalRoot, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions", "utf8");

    await runCli(["scope", "init", "--scope", "global"], { cwd: globalRoot });
    await runCli(["scope", "init", "--scope", "project"], { cwd: projectRoot });

    await runCli(
      [
        "skill",
        "add",
        "--id",
        "repo-conventions",
        "--source",
        `path:${skillDir}`,
        "--targets",
        "claude-code,codex"
      ],
      { cwd: globalRoot }
    );
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
      { cwd: globalRoot }
    );
    await runCli(
      [
        "instruction",
        "set-section",
        "Testing",
        "--id",
        "testing",
        "--body",
        "Run npm test before opening a PR.",
        "--targets",
        "codex"
      ],
      { cwd: globalRoot }
    );
    expect(await readFile(join(globalRoot, "use0-kit.toml"), "utf8")).toContain(
      `source = "path:${join(globalRoot, ".use0-kit", "sources", "instructions", "testing.md")}"`
    );
    expect(await readFile(join(globalRoot, "use0-kit.toml"), "utf8")).not.toContain("placement =");
    expect(await readFile(join(globalRoot, "use0-kit.toml"), "utf8")).not.toContain("heading =");
    expect(
      await readFile(join(globalRoot, ".use0-kit", "sources", "instructions", "testing.md"), "utf8")
    ).toContain("## Testing");
    expect(
      await readFile(join(globalRoot, ".use0-kit", "sources", "instructions", "testing.md"), "utf8")
    ).toContain("Run npm test before opening a PR.");

    const syncOutput = await runCli(
      ["scope", "sync", "--from", globalRoot, "--to", projectRoot],
      { cwd: root }
    );
    const diffOutput = await runCli(
      ["scope", "diff", "--from", globalRoot, "--to", projectRoot],
      { cwd: root }
    );
    const explainOutput = await runCli(["scope", "explain", "skill:repo-conventions"], {
      cwd: projectRoot
    });
    const skillListOutput = await runCli(["skill", "list"], { cwd: projectRoot });
    const mcpListOutput = await runCli(["mcp", "list"], { cwd: projectRoot });
    const planOutput = await runCli(["plan"], { cwd: projectRoot });
    const applyOutput = await runCli(["apply"], { cwd: projectRoot });
    const doctorOutput = await runCli(["doctor"], { cwd: projectRoot });
    const mcpOutput = await runCli(["mcp", "render", "--agent", "codex"], {
      cwd: projectRoot
    });
    const instructionOutput = await runCli(["instruction", "render", "--agent", "codex"], {
      cwd: projectRoot
    });
    const listOutput = await runCli(["scope", "list"], { cwd: projectRoot });

    expect(syncOutput).toContain("Synced 3 resource(s)");
    expect(diffOutput).toContain("No scope diff");
    expect(explainOutput).toContain("skill:repo-conventions");
    expect(skillListOutput).toContain("repo-conventions");
    expect(mcpListOutput).toContain("context7");
    expect(planOutput).toContain("STORE  skill skill:repo-conventions");
    expect(applyOutput).toContain("Applied");
    expect(doctorOutput).toContain("manifest-parse: ok");
    expect(mcpOutput).toContain("[mcp_servers.context7]");
    expect(instructionOutput).toContain("## Testing");
    expect(listOutput).toContain("project");

    expect(await readFile(join(projectRoot, "AGENTS.md"), "utf8")).toContain("## Testing");
    expect(await readFile(join(projectRoot, ".codex", "config.toml"), "utf8")).toContain(
      "context7"
    );
  });
});
