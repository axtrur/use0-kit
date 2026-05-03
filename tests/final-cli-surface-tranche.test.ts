import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("final CLI surface tranche", () => {
  test("supports scope current-inspect-path, agent enable-disable, registry login-logout, and publish helpers", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-final-"));
    const registryPath = join(root, "registry.json");
    const skillDir = join(root, "skills", "repo-conventions");

    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");
    await writeFile(registryPath, JSON.stringify({ items: [] }, null, 2), "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"],
      { cwd: root }
    );
    await runCli(
      ["plugin", "add", "repo-helper", "path:./plugins/repo-helper", "--targets", "codex"],
      { cwd: root }
    );
    await runCli(["pack", "init", "frontend", "--name", "acme/frontend", "--version", "1.0.0"], { cwd: root });
    await runCli(["pack", "add", "frontend", "skill:repo-conventions"], { cwd: root });

    expect(await runCli(["scope", "current"], { cwd: root })).toContain("project");
    expect(await runCli(["scope", "path"], { cwd: root })).toContain(root);
    expect(await runCli(["scope", "inspect"], { cwd: root })).toContain("use0-kit.toml");

    expect(await runCli(["agent", "list"], { cwd: root })).toContain("codex");
    await runCli(["agent", "disable", "codex"], { cwd: root });
    expect(await runCli(["agent", "detect"], { cwd: root })).toContain("codex: missing");
    await runCli(["agent", "enable", "codex"], { cwd: root });

    await runCli(["registry", "add", "official", registryPath], { cwd: root });
    await runCli(["registry", "login", "official"], { cwd: root });
    expect(await readFile(join(root, ".use0-kit", "registry-auth.json"), "utf8")).toContain("official");
    await runCli(["publish", "skill:repo-conventions", "--registry", "official"], { cwd: root });
    const registryPayload = JSON.parse(await readFile(registryPath, "utf8")) as {
      items: Array<{ kind: string; id: string; name: string; source?: string; targets?: string[]; quality?: { score?: number; risk?: number } }>;
    };
    expect(registryPayload.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "skill",
          id: "repo-conventions",
          name: "repo-conventions",
          source: `path:${skillDir}`,
          targets: ["codex"],
          quality: expect.objectContaining({
            score: expect.any(Number),
            risk: expect.any(Number)
          })
        })
      ])
    );
    expect(await runCli(["registry", "info", "skill:repo-conventions"], { cwd: root })).toContain(
      "source=path:"
    );
    expect(await runCli(["registry", "info", "skill:repo-conventions"], { cwd: root })).toContain(
      "provenance.digest="
    );
    expect(await runCli(["registry", "info", "skill:repo-conventions"], { cwd: root })).toContain(
      "quality.score="
    );
    await runCli(["publish", "plugin:repo-helper", "--registry", "official"], { cwd: root });
    expect(await runCli(["registry", "info", "plugin:repo-helper"], { cwd: root })).toContain(
      "source=path:./plugins/repo-helper"
    );
    await runCli(["pack", "publish", "frontend", "--registry", "official"], { cwd: root });
    expect(await runCli(["registry", "info", "pack:frontend"], { cwd: root })).toContain("name=acme/frontend");
    expect(await runCli(["registry", "info", "pack:frontend"], { cwd: root })).toContain(
      "resources=skill:repo-conventions"
    );
    expect(await runCli(["search", "repo", "--registry", "official"], { cwd: root })).toContain("score=");
    await runCli(["registry", "logout", "official"], { cwd: root });
    expect(await readFile(join(root, ".use0-kit", "publish-log.json"), "utf8")).toContain("skill:repo-conventions");
    expect(await readFile(join(root, ".use0-kit", "publish-log.json"), "utf8")).toContain("plugin:repo-helper");
    expect(await readFile(join(root, ".use0-kit", "publish-log.json"), "utf8")).toContain("pack:frontend");
  });

  test("supports publishing from a scoped global root", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-publish-scope-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    const registryPath = join(root, "registry.json");

    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    try {
      await writeFile(registryPath, JSON.stringify({ items: [] }, null, 2), "utf8");
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      const globalRoot = join(xdgData, "use0-kit", "global");
      const skillDir = join(globalRoot, "skills", "global-skill");
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Global Skill\n", "utf8");

      await runCli(
        ["skill", "add", "--id", "global-skill", "--source", `path:${skillDir}`, "--targets", "codex"],
        { cwd: globalRoot }
      );
      await runCli(["registry", "add", "official", registryPath], { cwd: globalRoot });
      await runCli(["registry", "login", "official"], { cwd: globalRoot });

      expect(await runCli(["publish", "skill:global-skill", "--scope", "global", "--registry", "official"], { cwd: root })).toContain(
        "Published skill:global-skill"
      );
      expect(await runCli(["registry", "info", "skill:global-skill"], { cwd: globalRoot })).toContain(
        `source=path:${skillDir}`
      );
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
    }
  });
});
