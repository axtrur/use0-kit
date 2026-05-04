import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";

describe("secret resources", () => {
  test("supports secret add/list/info/env/remove surfaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-secret-"));
    await runCli(["scope", "init", "--scope", "project"], { cwd: root });

    await runCli(
      ["secret", "add", "--id", "openai", "--env", "OPENAI_API_KEY", "--targets", "claude-code,opencode"],
      { cwd: root }
    );

    expect(await runCli(["secret", "list"], { cwd: root })).toContain("openai");
    expect(await runCli(["secret", "env", "openai"], { cwd: root })).toContain("env=OPENAI_API_KEY");
    expect(await runCli(["list", "--kind", "secret"], { cwd: root })).toContain("secret:openai");
    expect(await runCli(["info", "secret:openai"], { cwd: root })).toContain("required=true");

    await runCli(["remove", "secret:openai"], { cwd: root });
    expect(await runCli(["secret", "list"], { cwd: root })).not.toContain("openai");
  });

  test("doctor reports missing required secrets", async () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const root = await mkdtemp(join(tmpdir(), "use0-kit-secret-doctor-"));
    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(
      ["secret", "add", "--id", "openai", "--env", "OPENAI_API_KEY", "--targets", "claude-code"],
      { cwd: root }
    );

    try {
      expect(await runCli(["doctor"], { cwd: root })).toContain("secrets: error");
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });
});
