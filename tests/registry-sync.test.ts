import { createServer } from "node:http";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

async function createRegistrySkill(root: string, id: string, content: string): Promise<string> {
  const skillDir = join(root, "registry-skills", id);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), content, "utf8");
  return `path:${skillDir}`;
}

describe("registry sync", () => {
  test("syncs remote registry payloads into local cache for search, scoped info, and install", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-registry-sync-"));
    const officialSkillSource = await createRegistrySkill(root, "web-design", "# Remote design skill\n");
    const internalSkillSource = await createRegistrySkill(root, "internal-web-design", "# Internal Design System\n");
    let port = 0;
    const server = createServer((req, res) => {
      if (req.url === "/registry.json") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            items: [
              {
                kind: "skill",
                id: "web-design",
                name: "Web Design Guidelines",
                description: "Remote design skill",
                source: officialSkillSource,
                targets: ["codex"]
              },
              {
                kind: "mcp",
                id: "context7",
                name: "Context7",
                command: "npx",
                args: ["-y", "@upstash/context7-mcp"],
                transport: "stdio",
                targets: ["codex"]
              },
              {
                kind: "hook",
                id: "broken-hook",
                name: "Broken Hook",
                source: `url:http://127.0.0.1:${port}/missing.md`,
                targets: ["codex"]
              }
            ]
          })
        );
        return;
      }
      if (req.url === "/internal.json") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            items: [
              {
                kind: "skill",
                id: "web-design",
                name: "Internal Design System",
                description: "Private design skill",
                source: internalSkillSource,
                targets: ["cursor"]
              }
            ]
          })
        );
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind local test server");
    }
    port = address.port;
    const source = `http://127.0.0.1:${port}/registry.json`;
    const internalSource = `http://127.0.0.1:${port}/internal.json`;

    try {
      await runCli(["scope", "init", "--scope", "project"], { cwd: root });
      await runCli(["registry", "add", "official", source], { cwd: root });
      await runCli(["registry", "add", "internal", internalSource], { cwd: root });
      await expect(runCli(["search", "design"], { cwd: root })).rejects.toThrow(/has not been synced yet/);
      expect(await runCli(["registry", "sync"], { cwd: root })).toContain("Synced 2 registries");
      const allResults = await runCli(["search", "design"], { cwd: root });
      expect(allResults).toContain("skill:web-design\tWeb Design Guidelines\tofficial");
      expect(allResults).toContain("skill:web-design\tInternal Design System\tinternal");
      expect(await runCli(["registry", "list"], { cwd: root })).toContain("items=3");
      expect(await runCli(["registry", "list"], { cwd: root })).toContain("verified=0");
      expect(await runCli(["registry", "list"], { cwd: root })).toContain("errors=1");
      expect(await runCli(["registry", "search", "design"], { cwd: root })).toContain(
        "skill:web-design\tWeb Design Guidelines\tofficial"
      );
      expect(await runCli(["search", "design", "--registry", "official"], { cwd: root })).toContain(
        "skill:web-design\tWeb Design Guidelines\tofficial"
      );
      expect(await runCli(["search", "design", "--registry", "official"], { cwd: root })).not.toContain("internal");
      expect(await runCli(["registry", "search", "design", "--registry", "internal"], { cwd: root })).toContain(
        "skill:web-design\tInternal Design System\tinternal"
      );
      expect(await runCli(["registry", "search", "design", "--registry", "internal"], { cwd: root })).not.toContain(
        "official"
      );
      expect(await runCli(["registry", "info", "skill:web-design"], { cwd: root })).toContain(
        "Web Design Guidelines"
      );
      expect(await runCli(["registry", "info", "skill:web-design"], { cwd: root })).toContain(
        "quality.score="
      );
      expect(await runCli(["registry", "info", "skill:web-design"], { cwd: root })).toContain(
        "index.scheme=path"
      );
      expect(await runCli(["registry", "info", "skill:web-design"], { cwd: root })).toContain(
        "index.verification_status=skipped"
      );
      expect(await runCli(["registry", "info", "hook:broken-hook"], { cwd: root })).toContain(
        "index.verification_status=error"
      );
      expect(await runCli(["registry", "info", "skill:web-design", "--registry", "internal"], { cwd: root })).toContain(
        "Internal Design System"
      );
      expect(await runCli(["install", "skill:web-design", "--registry", "internal"], { cwd: root })).toContain(
        "Installed skill:web-design from registry:internal"
      );
      expect(await runCli(["registry", "install", "mcp:context7"], { cwd: root })).toContain(
        "Installed mcp:context7"
      );
      const installed = await runCli(["list", "skill:web-design", "mcp:context7"], { cwd: root });
      expect(installed).toContain("skill:web-design");
      expect(installed).toContain("mcp:context7");
      expect(await runCli(["info", "skill:web-design"], { cwd: root })).toContain("targets=cursor");
      expect(await runCli(["registry", "list"], { cwd: root })).toContain("official");
      expect(await runCli(["registry", "list"], { cwd: root })).toContain("internal");
    } finally {
      server.close();
    }
  });

  test("uses persisted registry index for search, info, and install after cache payload removal", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-registry-index-"));
    const indexedSkillSource = await createRegistrySkill(root, "indexed-design", "# Indexed Design Skill\n");
    let port = 0;
    const server = createServer((req, res) => {
      if (req.url === "/registry.json") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            items: [
              {
                kind: "skill",
                id: "indexed-design",
                name: "Indexed Design Skill",
                description: "Skill served through registry index",
                source: indexedSkillSource,
                targets: ["codex"]
              }
            ]
          })
        );
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind local test server");
    }
    port = address.port;

    try {
      await runCli(["scope", "init", "--scope", "project"], { cwd: root });
      const source = `http://127.0.0.1:${port}/registry.json`;
      await runCli(["registry", "add", "official", source], { cwd: root });
      await runCli(["registry", "sync", "official"], { cwd: root });

      const cacheDir = join(root, ".use0-kit", "registry-cache");
      const indexDir = join(root, ".use0-kit", "registry-index");
      const [cacheFile] = (await readdir(cacheDir)).filter((entry) => entry.endsWith(".json"));
      const [indexFile] = (await readdir(indexDir)).filter((entry) => entry.endsWith(".json"));
      await rm(join(cacheDir, cacheFile));

      expect(await readFile(join(indexDir, indexFile), "utf8")).toContain("indexed-design");
      expect(await runCli(["search", "indexed"], { cwd: root })).toContain("skill:indexed-design");
      expect(await runCli(["registry", "info", "skill:indexed-design"], { cwd: root })).toContain("Indexed Design Skill");
      expect(await runCli(["install", "skill:indexed-design", "--registry", "official"], { cwd: root })).toContain(
        "Installed skill:indexed-design from registry:official"
      );
      expect(await runCli(["list", "skill:indexed-design"], { cwd: root })).toContain("skill:indexed-design");
    } finally {
      server.close();
    }
  });

  test("supports registry install --apply with agent filtering and verify", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-registry-apply-"));
    const webDesignSkillSource = await createRegistrySkill(root, "web-design", "# Web Design Skill\n");
    const server = createServer((req, res) => {
      if (req.url === "/registry.json") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            items: [
              {
                kind: "skill",
                id: "web-design",
                name: "Web Design Guidelines",
                source: webDesignSkillSource,
                targets: ["codex", "cursor"],
                provenance: {
                  source: "registry:official",
                  digest: "sha256:01eb9d706f5b6e0a7646c303c6aa94825fde1a9f227fca428311eb8cffb428ea"
                }
              }
            ]
          })
        );
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind local test server");
    }

    try {
      await runCli(["scope", "init", "--scope", "project"], { cwd: root });
      await runCli(["registry", "add", "official", `http://127.0.0.1:${address.port}/registry.json`], { cwd: root });
      await runCli(["registry", "sync", "official"], { cwd: root });

      expect(
        await runCli(["registry", "install", "skill:web-design", "--registry", "official", "--apply", "--agent", "codex", "--verify"], {
          cwd: root
        })
      ).toContain("and applied");

      await access(join(root, ".codex", "skills", "web-design"));
      await expect(access(join(root, ".cursor", "skills", "web-design"))).rejects.toThrow();
      expect(await readFile(join(root, ".use0-kit", "state.json"), "utf8")).toContain("skill:web-design");
    } finally {
      server.close();
    }
  });

  test("supports install --apply --plan as a non-destructive registry preview", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-registry-install-plan-"));
    const webDesignSkillSource = await createRegistrySkill(root, "web-design", "# Web Design Skill\n");
    const server = createServer((req, res) => {
      if (req.url === "/registry.json") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            items: [
              {
                kind: "skill",
                id: "web-design",
                name: "Web Design Guidelines",
                source: webDesignSkillSource,
                targets: ["codex"],
                provenance: {
                  source: "registry:official",
                  digest: "sha256:01eb9d706f5b6e0a7646c303c6aa94825fde1a9f227fca428311eb8cffb428ea"
                }
              }
            ]
          })
        );
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind local test server");
    }

    try {
      await runCli(["scope", "init", "--scope", "project"], { cwd: root });
      await runCli(["registry", "add", "official", `http://127.0.0.1:${address.port}/registry.json`], { cwd: root });
      await runCli(["registry", "sync", "official"], { cwd: root });

      const output = await runCli(["install", "skill:web-design", "--registry", "official", "--apply", "--plan"], {
        cwd: root
      });
      expect(output).toContain("Installed skill:web-design from registry:official and planned");
      expect(output).toContain("STORE  skill skill:web-design");
      expect(await runCli(["list"], { cwd: root })).not.toContain("skill:web-design");
      await expect(access(join(root, ".codex", "skills", "web-design", "SKILL.md"))).rejects.toThrow();
    } finally {
      server.close();
    }
  });

  test("supports bare registry ids for info and install when the match is unique", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-registry-bare-id-"));
    const server = createServer((req, res) => {
      if (req.url === "/registry.json") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            items: [
              {
                kind: "mcp",
                id: "context7",
                name: "Context7",
                command: "npx",
                args: ["-y", "@upstash/context7-mcp"],
                transport: "stdio",
                targets: ["codex"]
              }
            ]
          })
        );
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind local test server");
    }

    try {
      await runCli(["scope", "init", "--scope", "project"], { cwd: root });
      await runCli(["registry", "add", "official", `http://127.0.0.1:${address.port}/registry.json`], { cwd: root });
      await runCli(["registry", "sync", "official"], { cwd: root });

      expect(await runCli(["registry", "info", "context7"], { cwd: root })).toContain("mcp:context7");
      expect(await runCli(["install", "context7", "--registry", "official"], { cwd: root })).toContain(
        "Installed mcp:context7 from registry:official"
      );
      expect(await runCli(["info", "mcp:context7"], { cwd: root })).toContain("command=npx");
    } finally {
      server.close();
    }
  });

  test("supports selector-style search queries like mcp:context7", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-registry-selector-search-"));
    const reactDesignSkillSource = await createRegistrySkill(root, "react-design", "# React Design\n");
    const server = createServer((req, res) => {
      if (req.url === "/registry.json") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            items: [
              {
                kind: "mcp",
                id: "context7",
                name: "Context7",
                command: "npx",
                args: ["-y", "@upstash/context7-mcp"],
                transport: "stdio",
                targets: ["codex"]
              },
              {
                kind: "skill",
                id: "react-design",
                name: "React Design",
                source: reactDesignSkillSource,
                targets: ["codex"]
              }
            ]
          })
        );
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind local test server");
    }

    try {
      await runCli(["scope", "init", "--scope", "project"], { cwd: root });
      await runCli(["registry", "add", "official", `http://127.0.0.1:${address.port}/registry.json`], { cwd: root });
      await runCli(["registry", "sync", "official"], { cwd: root });

      expect(await runCli(["search", "mcp:context7"], { cwd: root })).toContain("mcp:context7");
      expect(await runCli(["registry", "search", "mcp:context7"], { cwd: root })).toContain("mcp:context7");
      expect(await runCli(["search", "mcp:context7"], { cwd: root })).not.toContain("skill:react-design");
    } finally {
      server.close();
    }
  });

  test("supports offline registry reads from cached index while blocking remote sync", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-registry-offline-"));
    const offlineSkillSource = await createRegistrySkill(root, "offline-design", "# Offline Design Skill\n");
    const server = createServer((req, res) => {
      if (req.url === "/registry.json") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            items: [
              {
                kind: "skill",
                id: "offline-design",
                name: "Offline Design Skill",
                source: offlineSkillSource,
                targets: ["codex"]
              }
            ]
          })
        );
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind local test server");
    }

    try {
      await runCli(["scope", "init", "--scope", "project"], { cwd: root });
      await runCli(["registry", "add", "official", `http://127.0.0.1:${address.port}/registry.json`], { cwd: root });
      await runCli(["registry", "sync", "official"], { cwd: root });
    } finally {
      server.close();
    }

    expect(await runCli(["search", "offline", "--registry", "official", "--offline"], { cwd: root })).toContain(
      "skill:offline-design"
    );
    expect(await runCli(["registry", "info", "offline-design", "--registry", "official", "--offline"], { cwd: root })).toContain(
      "Offline Design Skill"
    );
    expect(await runCli(["install", "offline-design", "--registry", "official", "--offline"], { cwd: root })).toContain(
      "Installed skill:offline-design from registry:official"
    );
    await expect(runCli(["registry", "sync", "official", "--offline"], { cwd: root })).rejects.toThrow(
      /Offline mode prevents syncing remote registry official/
    );
  });

  test("orders registry search results by quality signals and exposes them in info", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-registry-quality-"));
    const lowSkillSource = await createRegistrySkill(root, "design-low", "# Design Starter\n");
    const highSkillSource = await createRegistrySkill(root, "design-high", "# Design Pro\n");
    const server = createServer((req, res) => {
      if (req.url === "/registry.json") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            items: [
              {
                kind: "skill",
                id: "design-low",
                name: "Design Starter",
                description: "Low-ranked design skill",
                source: lowSkillSource,
                quality: {
                  score: 42,
                  risk: 5,
                  stars: 10,
                  lastUpdated: "2026-01-01T00:00:00.000Z",
                  archived: false,
                  license: "MIT"
                }
              },
              {
                kind: "skill",
                id: "design-high",
                name: "Design Pro",
                description: "High-ranked design skill",
                source: highSkillSource,
                quality: {
                  score: 95,
                  risk: 1,
                  stars: 250,
                  lastUpdated: "2026-05-01T00:00:00.000Z",
                  archived: false,
                  license: "Apache-2.0"
                }
              }
            ]
          })
        );
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind local test server");
    }

    try {
      await runCli(["scope", "init", "--scope", "project"], { cwd: root });
      await runCli(["registry", "add", "official", `http://127.0.0.1:${address.port}/registry.json`], { cwd: root });
      await runCli(["registry", "sync", "official"], { cwd: root });

      const search = await runCli(["search", "design"], { cwd: root });
      const [first, second] = search.split("\n");
      expect(first).toContain("skill:design-high");
      expect(first).toContain("score=95");
      expect(second).toContain("skill:design-low");

      const info = await runCli(["registry", "info", "skill:design-high"], { cwd: root });
      expect(info).toContain("quality.score=95");
      expect(info).toContain("quality.risk=1");
      expect(info).toContain("quality.stars=250");
      expect(info).toContain("quality.license=Apache-2.0");
    } finally {
      server.close();
    }
  });

  test("supports install --scope for registry-backed resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-registry-scope-install-"));
    const webDesignSkillSource = await createRegistrySkill(root, "web-design", "# Web Design Skill\n");
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    const server = createServer((req, res) => {
      if (req.url === "/registry.json") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            items: [
              {
                kind: "skill",
                id: "web-design",
                name: "Web Design Guidelines",
                source: webDesignSkillSource,
                targets: ["codex"],
                provenance: {
                  source: "registry:official",
                  digest: "sha256:01eb9d706f5b6e0a7646c303c6aa94825fde1a9f227fca428311eb8cffb428ea"
                }
              }
            ]
          })
        );
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind local test server");
    }

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      const globalRoot = join(xdgData, "use0-kit", "global");
      await runCli(["registry", "add", "official", `http://127.0.0.1:${address.port}/registry.json`], { cwd: globalRoot });
      await runCli(["registry", "sync", "official"], { cwd: globalRoot });

      expect(await runCli(["install", "skill:web-design", "--scope", "global", "--registry", "official"], { cwd: root })).toContain(
        "Installed skill:web-design from registry:official"
      );
      expect(await runCli(["list", "--scope", "global"], { cwd: root })).toContain("skill:web-design");
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
      server.close();
    }
  });

  test("supports scoped registry list/search/info from outside the target root", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-registry-scope-ops-"));
    const webDesignSkillSource = await createRegistrySkill(root, "web-design", "# Web Design Skill\n");
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    const server = createServer((req, res) => {
      if (req.url === "/registry.json") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            items: [
              {
                kind: "skill",
                id: "web-design",
                name: "Web Design Guidelines",
                source: webDesignSkillSource,
                targets: ["codex"]
              }
            ]
          })
        );
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind local test server");
    }

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      const globalRoot = join(xdgData, "use0-kit", "global");
      await runCli(["registry", "add", "official", `http://127.0.0.1:${address.port}/registry.json`], { cwd: globalRoot });
      await runCli(["registry", "sync", "official"], { cwd: globalRoot });

      expect(await runCli(["registry", "list", "--scope", "global"], { cwd: root })).toContain("official");
      expect(await runCli(["search", "design", "--scope", "global"], { cwd: root })).toContain(
        "skill:web-design\tWeb Design Guidelines\tofficial"
      );
      expect(await runCli(["registry", "info", "skill:web-design", "--scope", "global"], { cwd: root })).toContain(
        "name=Web Design Guidelines"
      );
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
      server.close();
    }
  });

  test("supports scoped registry login logout and sync operations", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-registry-scope-auth-"));
    const xdgConfig = join(root, "xdg-config");
    const xdgData = join(root, "xdg-data");
    const previousConfig = process.env.XDG_CONFIG_HOME;
    const previousData = process.env.XDG_DATA_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfig;
    process.env.XDG_DATA_HOME = xdgData;

    const server = createServer((req, res) => {
      if (req.url === "/registry.json") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ items: [{ kind: "skill", id: "web-design", name: "Web Design Guidelines" }] }));
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind local test server");
    }

    try {
      await runCli(["scope", "init", "--scope", "global"], { cwd: root });
      const globalRoot = join(xdgData, "use0-kit", "global");
      const registryUrl = `http://127.0.0.1:${address.port}/registry.json`;

      expect(await runCli(["registry", "add", "official", registryUrl, "--scope", "global"], { cwd: root })).toContain(
        "Added registry:official"
      );
      expect(await runCli(["registry", "login", "official", "--scope", "global"], { cwd: root })).toContain(
        "Logged into registry:official"
      );
      expect(await readFile(join(globalRoot, ".use0-kit", "registry-auth.json"), "utf8")).toContain("official");
      expect(await runCli(["registry", "sync", "official", "--scope", "global"], { cwd: root })).toContain(
        "Synced 1 registry"
      );
      expect(await runCli(["registry", "logout", "official", "--scope", "global"], { cwd: root })).toContain(
        "Logged out registry:official"
      );
      expect(await readFile(join(globalRoot, ".use0-kit", "registry-auth.json"), "utf8")).not.toContain("official");
    } finally {
      if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfig;
      if (previousData === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousData;
      server.close();
    }
  });

  test("installs pack bundles from registry recursively before apply", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-registry-pack-"));
    const webDesignSkillSource = await createRegistrySkill(root, "web-design", "# Web Design Skill\n");
    const server = createServer((req, res) => {
      if (req.url === "/registry.json") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            items: [
              {
                kind: "skill",
                id: "web-design",
                name: "Web Design Guidelines",
                source: webDesignSkillSource,
                targets: ["codex"],
                provenance: {
                  source: "registry:official",
                  digest: "sha256:01eb9d706f5b6e0a7646c303c6aa94825fde1a9f227fca428311eb8cffb428ea"
                }
              },
              {
                kind: "pack",
                id: "frontend",
                name: "acme/frontend",
                version: "1.0.0",
                resources: ["skill:web-design"],
                provenance: {
                  source: "registry:official",
                  digest: "sha256:pack-digest"
                }
              }
            ]
          })
        );
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind local test server");
    }

    try {
      await runCli(["scope", "init", "--scope", "project"], { cwd: root });
      await runCli(["registry", "add", "official", `http://127.0.0.1:${address.port}/registry.json`], { cwd: root });
      await runCli(["registry", "sync", "official"], { cwd: root });

      expect(
        await runCli(["install", "pack:frontend", "--registry", "official", "--apply", "--agent", "codex"], {
          cwd: root
        })
      ).toContain("and applied");

      expect(await runCli(["list", "pack:frontend", "skill:web-design"], { cwd: root })).toContain("pack:frontend");
      expect(await runCli(["list", "pack:frontend", "skill:web-design"], { cwd: root })).toContain("skill:web-design");
      expect(await readFile(join(root, ".codex", "skills", "web-design", "SKILL.md"), "utf8")).toContain(
        "Web Design Skill"
      );
    } finally {
      server.close();
    }
  });

  test("rejects profile bundles from registries because pack is the only bundle model", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-registry-profile-"));
    const webDesignSkillSource = await createRegistrySkill(root, "web-design", "# Web Design Skill\n");
    const server = createServer((req, res) => {
      if (req.url === "/registry.json") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(
          JSON.stringify({
            items: [
              {
                kind: "skill",
                id: "web-design",
                name: "Web Design Guidelines",
                source: webDesignSkillSource,
                targets: ["codex"],
                provenance: {
                  source: "registry:official",
                  digest: "sha256:01eb9d706f5b6e0a7646c303c6aa94825fde1a9f227fca428311eb8cffb428ea"
                }
              },
              {
                kind: "pack",
                id: "frontend",
                name: "acme/frontend",
                version: "1.0.0",
                resources: ["skill:web-design"],
                provenance: {
                  source: "registry:official",
                  digest: "sha256:pack-digest"
                }
              },
              {
                kind: "profile",
                id: "developer",
                name: "Developer",
                exports: ["pack:frontend"],
                provenance: {
                  source: "registry:official",
                  digest: "sha256:profile-digest"
                }
              }
            ]
          })
        );
        return;
      }
      res.writeHead(404);
      res.end("missing");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind local test server");
    }

    try {
      await runCli(["scope", "init", "--scope", "project"], { cwd: root });
      await runCli(["registry", "add", "official", `http://127.0.0.1:${address.port}/registry.json`], { cwd: root });
      await runCli(["registry", "sync", "official"], { cwd: root });

      await expect(
        runCli(["registry", "install", "profile:developer", "--registry", "official", "--apply", "--agent", "codex"], {
          cwd: root
        })
      ).rejects.toThrow("Unsupported registry install kind: profile");
    } finally {
      server.close();
    }
  });
});
