import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { errorExitCodeForCli, runCli, successExitCodeForCli } from "../src/cli.js";

describe("cli exit codes", () => {
  test("maps successful diff, plan, lock, and doctor outputs to documented exit codes", () => {
    expect(successExitCodeForCli(["plan"], "[]")).toBe(0);
    expect(successExitCodeForCli(["plan"], '[{"kind":"link-skill"}]')).toBe(3);
    expect(successExitCodeForCli(["plan"], "No changes")).toBe(0);
    expect(successExitCodeForCli(["plan"], "STORE  skill skill:repo-conventions -> .use0-kit/store/skills/repo-conventions")).toBe(3);
    expect(successExitCodeForCli(["diff", "--effective"], "effective: pending")).toBe(3);
    expect(successExitCodeForCli(["lock", "verify"], "lock mismatch")).toBe(8);
    expect(successExitCodeForCli(["doctor"], "policy: error")).toBe(5);
    expect(successExitCodeForCli(["doctor"], "materialized-graph: error")).toBe(9);
    expect(successExitCodeForCli(["agent", "doctor"], "secrets: error")).toBe(10);
  });

  test("maps failures to documented exit codes", () => {
    expect(errorExitCodeForCli(new Error("Policy violation: policy:lockfile:require-lockfile"))).toBe(5);
    expect(errorExitCodeForCli(new Error("Conflict on skill:repo-conventions"))).toBe(4);
    expect(errorExitCodeForCli(new Error("Unsupported agent: bogus"))).toBe(6);
    expect(errorExitCodeForCli(new Error("Failed to fetch resource source: https://example.com/skill.md (500)"))).toBe(7);
    expect(errorExitCodeForCli(new Error("Missing signer secret. Set --secret or USE0_KIT_SIGNER_RELEASE"))).toBe(10);
    expect(errorExitCodeForCli(new Error("Unknown registry item: skill:web-design"))).toBe(2);
  });

  test("rejects invalid agent ids instead of silently coercing them", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-invalid-agent-"));
    await expect(runCli(["agent", "enable", "bogus"], { cwd: root })).rejects.toThrow(
      "Unsupported agent: bogus"
    );
  });
});
