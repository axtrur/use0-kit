import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";
import { loadManifest, saveManifest } from "../src/core/manifest.js";

describe("pack approvals", () => {
  test("doctor and apply enforce trusted pack approvals", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-pack-approval-"));
    const skillDir = join(root, "skills", "repo-conventions");
    const extraSkillDir = join(root, "skills", "web-design");
    const previousSecret = process.env.USE0_KIT_SIGNER_RELEASE;
    process.env.USE0_KIT_SIGNER_RELEASE = "supersecret";

    try {
      await mkdir(skillDir, { recursive: true });
      await mkdir(extraSkillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");
      await writeFile(join(extraSkillDir, "SKILL.md"), "# Web Design\n", "utf8");

      await runCli(["scope", "init", "--scope", "project"], { cwd: root });
      await runCli(["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"], {
        cwd: root
      });
      await runCli(["skill", "add", "--id", "web-design", "--source", `path:${extraSkillDir}`, "--targets", "codex"], {
        cwd: root
      });
      await runCli(["pack", "init", "frontend", "--name", "acme/frontend", "--version", "1.0.0"], { cwd: root });
      await runCli(["pack", "add", "frontend", "skill:repo-conventions"], { cwd: root });
      await runCli(["pack", "sign", "frontend", "--key-id", "release"], { cwd: root });

      const manifest = await loadManifest(root);
      manifest.policy.requireSignedPacks = true;
      manifest.policy.requirePackApprovals = true;
      manifest.trust.allowedSigners = ["release"];
      manifest.trust.allowedApprovers = ["alice"];
      manifest.trust.allowedApproverRoles = ["release-manager"];
      await saveManifest(root, manifest);

      expect(await runCli(["doctor"], { cwd: root })).toContain("pack-approvals: error");
      await expect(runCli(["apply"], { cwd: root })).rejects.toThrow(/missing-approval/);

      expect(
        await runCli(["approval", "add", "pack:frontend", "--by", "bob", "--role", "developer"], { cwd: root })
      ).toContain("Approved pack:frontend by bob");
      expect(await runCli(["doctor"], { cwd: root })).toContain("pack-approvals: error");

      expect(
        await runCli(["approval", "add", "pack:frontend", "--by", "alice", "--role", "release-manager"], { cwd: root })
      ).toContain("Approved pack:frontend by alice");
      expect(await runCli(["approval", "list"], { cwd: root })).toContain("pack:frontend");
      expect(await runCli(["doctor"], { cwd: root })).toContain("pack-approvals: ok");
      expect(await runCli(["apply"], { cwd: root })).toContain("Applied");

      expect(await runCli(["approval", "revoke", "pack:frontend"], { cwd: root })).toContain(
        "Revoked approval for pack:frontend"
      );
      expect(await runCli(["doctor"], { cwd: root })).toContain("pack-approvals: error");
      await expect(runCli(["apply"], { cwd: root })).rejects.toThrow(/missing-approval/);

      await runCli(["approval", "add", "pack:frontend", "--by", "alice", "--role", "release-manager"], { cwd: root });
      expect(await runCli(["doctor"], { cwd: root })).toContain("pack-approvals: ok");

      await runCli(["pack", "add", "frontend", "skill:web-design"], { cwd: root });
      expect(await runCli(["doctor"], { cwd: root })).toContain("pack-signatures: error");
      await expect(runCli(["apply"], { cwd: root })).rejects.toThrow(/invalid-pack-signature/);
    } finally {
      if (previousSecret === undefined) delete process.env.USE0_KIT_SIGNER_RELEASE;
      else process.env.USE0_KIT_SIGNER_RELEASE = previousSecret;
    }
  });
});
