import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
  await execFileAsync("git", args, { cwd, env: env ?? process.env });
}

describe("source resolver schemes", () => {
  test("supports url and inline sources for text resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-source-schemes-"));
    const server = createServer((_, res) => {
      res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
      res.end("---\nname: Security Scan\n---\n\nRun remote checks.\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind local test server");
    }
    const url = `http://127.0.0.1:${address.port}/security-scan.md`;

    try {
      await runCli(["scope", "init", "--scope", "project"], { cwd: root });
      await runCli(
        ["command", "add", "--id", "security-scan", "--source", `url:${url}`, "--targets", "claude-code"],
        { cwd: root }
      );
      await runCli(
        [
          "subagent",
          "add",
          "--id",
          "backend",
          "--source",
          `inline:${encodeURIComponent("---\nname: Backend Specialist\n---\n\nOwn API changes.\n")}`,
          "--targets",
          "claude-code"
        ],
        { cwd: root }
      );

      const renderedCommand = await runCli(
        ["command", "render", "security-scan", "--agent", "claude-code"],
        { cwd: root }
      );
      const renderedSubagent = await runCli(
        ["subagent", "render", "backend", "--agent", "claude-code"],
        { cwd: root }
      );

      expect(renderedCommand).toContain("Run remote checks.");
      expect(renderedSubagent).toContain("Own API changes.");

      await runCli(["apply"], { cwd: root });
      expect(await readFile(join(root, ".claude", "commands", "security-scan.md"), "utf8")).toContain(
        "Run remote checks."
      );
      expect(await readFile(join(root, ".claude", "agents", "backend.md"), "utf8")).toContain(
        "Own API changes."
      );
    } finally {
      server.close();
    }
  });

  test("supports offline cached URL rendering and rejects uncached remote reads", async () => {
    const cachedRoot = await mkdtemp(join(tmpdir(), "use0-kit-offline-cached-"));
    const uncachedRoot = await mkdtemp(join(tmpdir(), "use0-kit-offline-uncached-"));
    const server = createServer((_, res) => {
      res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
      res.end("Offline-capable command.\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind local test server");
    }
    const url = `http://127.0.0.1:${address.port}/offline-command.md`;

    try {
      await runCli(["scope", "init", "--scope", "project"], { cwd: cachedRoot });
      await runCli(["command", "add", "offline-command", `url:${url}`, "--targets", "claude-code"], { cwd: cachedRoot });
      expect(await runCli(["command", "render", "offline-command", "--agent", "claude-code"], { cwd: cachedRoot })).toContain(
        "Offline-capable command."
      );

      await runCli(["scope", "init", "--scope", "project"], { cwd: uncachedRoot });
      await runCli(["command", "add", "offline-command", `url:${url}`, "--targets", "claude-code"], { cwd: uncachedRoot });
    } finally {
      server.close();
    }

    expect(
      await runCli(["command", "render", "offline-command", "--agent", "claude-code", "--offline"], { cwd: cachedRoot })
    ).toContain("Offline-capable command.");
    await expect(
      runCli(["command", "render", "offline-command", "--agent", "claude-code", "--offline"], { cwd: uncachedRoot })
    ).rejects.toThrow(/Offline mode prevents fetching URL source/);
  });

  test("supports positional source arguments for namespaced add commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-namespaced-source-"));
    const server = createServer((req, res) => {
      if (req.url === "/command.md") {
        res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
        res.end("Run namespaced command.\n");
        return;
      }
      if (req.url === "/hook.sh") {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("echo namespaced hook\n");
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
    const base = `http://127.0.0.1:${address.port}`;

    try {
      await runCli(["scope", "init", "--scope", "project"], { cwd: root });
      await runCli(["command", "add", "namespaced-command", `url:${base}/command.md`, "--targets", "claude-code"], {
        cwd: root
      });
      await runCli(
        [
          "subagent",
          "add",
          "namespaced-backend",
          `inline:${encodeURIComponent("Own namespaced backend changes.")}`,
          "--targets",
          "claude-code"
        ],
        { cwd: root }
      );
      await runCli(["hook", "add", "namespaced-hook", `url:${base}/hook.sh`, "--targets", "codex"], {
        cwd: root
      });

      await runCli(["apply"], { cwd: root });
      expect(await readFile(join(root, ".claude", "commands", "namespaced-command.md"), "utf8")).toContain(
        "Run namespaced command."
      );
      expect(await readFile(join(root, ".claude", "agents", "namespaced-backend.md"), "utf8")).toContain(
        "Own namespaced backend changes."
      );
      expect(await readFile(join(root, ".codex", "hooks", "namespaced-hook.sh"), "utf8")).toContain(
        "echo namespaced hook"
      );
    } finally {
      server.close();
    }
  });

  test("rejects single-file well-known sources for skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-well-known-"));
    const server = createServer((req, res) => {
      if (req.url === "/.well-known/agent-skills") {
        res.writeHead(200, { "content-type": "text/markdown; charset=utf-8" });
        res.end("# Well Known Skill\n");
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
    const base = `http://127.0.0.1:${address.port}`;

    try {
      await runCli(["scope", "init", "--scope", "project"], { cwd: root });
      await expect(
        runCli(["skill", "add", "--id", "well-known-skill", "--source", `well-known:${base}`, "--targets", "codex"], {
          cwd: root
        })
      ).rejects.toThrow(/Skill source must be a directory/);
    } finally {
      server.close();
    }
  });

  test("supports gitlab and ssh git sources through local git rewrite rules", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-gitlike-schemes-"));
    const gitlabWorkspace = join(root, "gitlab-work");
    const gitlabBareParent = join(root, "gitlab-remotes", "acme");
    const gitlabBare = join(gitlabBareParent, "agent-resources.git");
    const sshWorkspace = join(root, "ssh-work");
    const sshBareParent = join(root, "ssh-remotes", "owner");
    const sshBare = join(sshBareParent, "repo.git");
    const gitConfig = join(root, "gitconfig");
    const previousGlobal = process.env.GIT_CONFIG_GLOBAL;

    process.env.GIT_CONFIG_GLOBAL = gitConfig;

    try {
      await mkdir(join(gitlabWorkspace, "skills", "frontend-review"), { recursive: true });
      await writeFile(join(gitlabWorkspace, "skills", "frontend-review", "SKILL.md"), "# Frontend Review\n", "utf8");
      await mkdir(gitlabBareParent, { recursive: true });
      await git(["init", "--bare", gitlabBare], root);
      await git(["init", "-b", "main"], gitlabWorkspace);
      await git(["config", "user.name", "Codex"], gitlabWorkspace);
      await git(["config", "user.email", "codex@example.com"], gitlabWorkspace);
      await git(["add", "."], gitlabWorkspace);
      await git(["commit", "-m", "initial"], gitlabWorkspace);
      await git(["remote", "add", "origin", gitlabBare], gitlabWorkspace);
      await git(["push", "-u", "origin", "main"], gitlabWorkspace);

      await mkdir(join(sshWorkspace, "commands"), { recursive: true });
      await writeFile(join(sshWorkspace, "commands", "security-scan.md"), "Run SSH-backed checks.\n", "utf8");
      await mkdir(sshBareParent, { recursive: true });
      await git(["init", "--bare", sshBare], root);
      await git(["init", "-b", "main"], sshWorkspace);
      await git(["config", "user.name", "Codex"], sshWorkspace);
      await git(["config", "user.email", "codex@example.com"], sshWorkspace);
      await git(["add", "."], sshWorkspace);
      await git(["commit", "-m", "initial"], sshWorkspace);
      await git(["remote", "add", "origin", sshBare], sshWorkspace);
      await git(["push", "-u", "origin", "main"], sshWorkspace);

      await writeFile(
        gitConfig,
        [
          `[url "file://${join(root, "gitlab-remotes")}/"]`,
          "\tinsteadOf = https://gitlab.com/",
          `[url "file://${join(root, "ssh-remotes")}/"]`,
          "\tinsteadOf = git@github.com:"
        ].join("\n") + "\n",
        "utf8"
      );

      await runCli(["scope", "init", "--scope", "project"], { cwd: root });
      await runCli(
        ["skill", "add", "gitlab:acme/agent-resources@main#skills/frontend-review", "--id", "frontend-review", "--targets", "codex"],
        { cwd: root }
      );
      await runCli(
        ["command", "add", "security-scan", "ssh:git@github.com:owner/repo.git@main#commands/security-scan.md", "--targets", "claude-code"],
        { cwd: root }
      );

      await runCli(["apply"], { cwd: root });
      expect(await readFile(join(root, ".codex", "skills", "frontend-review", "SKILL.md"), "utf8")).toContain(
        "Frontend Review"
      );
      expect(await readFile(join(root, ".claude", "commands", "security-scan.md"), "utf8")).toContain(
        "Run SSH-backed checks."
      );
    } finally {
      if (previousGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previousGlobal;
    }
  });
});
