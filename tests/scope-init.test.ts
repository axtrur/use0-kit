import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { initScope } from "../src/core/scope.js";
import { loadManifest, saveManifest } from "../src/core/manifest.js";

describe("initScope", () => {
  test("creates a project manifest with MVP1 defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-scope-"));

    await initScope({
      cwd: root,
      scope: "project"
    });

    const manifest = await readFile(join(root, "use0-kit.toml"), "utf8");

    await expect(access(join(root, ".agents", "skills"))).resolves.toBeUndefined();
    await expect(access(join(root, ".agents", "commands"))).resolves.toBeUndefined();
    await expect(access(join(root, ".agents", "subagents"))).resolves.toBeUndefined();
    await expect(access(join(root, ".agents", "hooks"))).resolves.toBeUndefined();
    await expect(access(join(root, ".agents", "plugins"))).resolves.toBeUndefined();
    await expect(access(join(root, ".use0-kit", "store", "skills"))).resolves.toBeUndefined();
    await expect(access(join(root, ".use0-kit", "sources", "skills"))).resolves.toBeUndefined();
    await expect(access(join(root, ".use0-kit", "sources", "instructions"))).resolves.toBeUndefined();
    await expect(access(join(root, ".use0-kit", "sources", "commands"))).resolves.toBeUndefined();
    await expect(access(join(root, ".use0-kit", "sources", "subagents"))).resolves.toBeUndefined();
    await expect(access(join(root, ".use0-kit", "sources", "hooks"))).resolves.toBeUndefined();

    expect(manifest).toContain('version = 1');
    expect(manifest).toContain('default_scope = "project"');
    expect(manifest).toContain('[scope]');
    expect(manifest).toContain('level = "project"');
    expect(manifest).toContain('mode = "project"');
    expect(manifest).toContain('[agents]\nenabled = ["claude-code", "cursor", "codex", "opencode"]\nmaterialize = "symlink"');
    expect(manifest).toContain('"claude-code"');
    expect(manifest).toContain('"cursor"');
    expect(manifest).toContain('"codex"');
    expect(manifest).toContain('"opencode"');
  });

  test("serializes mcp resources using [[mcp]] while keeping parser compatibility", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-scope-mcp-schema-"));

    await initScope({
      cwd: root,
      scope: "project"
    });

    const manifest = await loadManifest(root);
    manifest.mcps.push({
      id: "context7",
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      targets: ["codex"]
    });
    await saveManifest(root, manifest);

    const saved = await readFile(join(root, "use0-kit.toml"), "utf8");
    expect(saved).toContain("[[mcp]]");
    expect(saved).not.toContain("[[mcps]]");

    const reparsed = await loadManifest(root);
    expect(reparsed.mcps.map((item) => item.id)).toContain("context7");
  });
});
