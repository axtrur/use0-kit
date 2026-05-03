import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { runCli } from "../src/cli.js";
import { loadManifest, saveManifest } from "../src/core/manifest.js";

describe("pack signatures", () => {
  test("supports pack sign and verify and detects tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-pack-sign-"));
    const skillDir = join(root, "skills", "repo-conventions");
    const anotherSkillDir = join(root, "skills", "web-design");

    await mkdir(skillDir, { recursive: true });
    await mkdir(anotherSkillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");
    await writeFile(join(anotherSkillDir, "SKILL.md"), "# Web Design\n", "utf8");

    await runCli(["scope", "init", "--scope", "project"], { cwd: root });
    await runCli(["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"], {
      cwd: root
    });
    await runCli(["skill", "add", "--id", "web-design", "--source", `path:${anotherSkillDir}`, "--targets", "codex"], {
      cwd: root
    });
    await runCli(["pack", "init", "frontend", "--name", "acme/frontend", "--version", "1.0.0"], { cwd: root });
    await runCli(["pack", "add", "frontend", "skill:repo-conventions"], { cwd: root });

    expect(await runCli(["pack", "sign", "frontend", "--key-id", "release", "--secret", "supersecret"], { cwd: root })).toContain(
      "Signed pack:frontend with key:release"
    );
    expect(await runCli(["pack", "verify", "frontend", "--secret", "supersecret"], { cwd: root })).toContain(
      "pack:frontend signature ok"
    );
    expect(await readFile(join(root, "use0-kit.toml"), "utf8")).toContain('signature_key_id = "release"');

    await runCli(["pack", "add", "frontend", "skill:web-design"], { cwd: root });
    expect(await runCli(["pack", "verify", "frontend", "--secret", "supersecret"], { cwd: root })).toContain(
      "pack:frontend signature invalid"
    );
  });

  test("doctor and policy enforce required signed packs", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-pack-policy-"));
    const skillDir = join(root, "skills", "repo-conventions");
    const previousSecret = process.env.USE0_KIT_SIGNER_RELEASE;
    process.env.USE0_KIT_SIGNER_RELEASE = "supersecret";

    try {
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");

      await runCli(["scope", "init", "--scope", "project"], { cwd: root });
      await runCli(["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"], {
        cwd: root
      });
      await runCli(["pack", "init", "frontend", "--name", "acme/frontend", "--version", "1.0.0"], { cwd: root });
      await runCli(["pack", "add", "frontend", "skill:repo-conventions"], { cwd: root });

      const manifest = await loadManifest(root);
      manifest.policy.requireSignedPacks = true;
      manifest.trust.allowedSigners = ["release"];
      await saveManifest(root, manifest);

      expect(await runCli(["doctor"], { cwd: root })).toContain("pack-signatures: error");

      await runCli(["pack", "sign", "frontend", "--key-id", "release"], { cwd: root });
      expect(await runCli(["doctor"], { cwd: root })).toContain("pack-signatures: ok");

      await runCli(["pack", "add", "frontend", "skill:repo-conventions"], { cwd: root });
      const signedManifest = await loadManifest(root);
      signedManifest.packs[0].version = "1.0.1";
      await saveManifest(root, signedManifest);

      expect(await runCli(["doctor"], { cwd: root })).toContain("pack-signatures: error");
      await expect(runCli(["apply"], { cwd: root })).rejects.toThrow(/invalid-pack-signature/);
    } finally {
      if (previousSecret === undefined) delete process.env.USE0_KIT_SIGNER_RELEASE;
      else process.env.USE0_KIT_SIGNER_RELEASE = previousSecret;
    }
  });

  test("signed packs keep signature metadata through registry publish and install", async () => {
    const root = await mkdtemp(join(tmpdir(), "use0-kit-pack-registry-sign-"));
    const targetRoot = await mkdtemp(join(tmpdir(), "use0-kit-pack-registry-target-"));
    const skillDir = join(root, "skills", "repo-conventions");
    const registryPath = join(root, "registry.json");
    const previousSecret = process.env.USE0_KIT_SIGNER_RELEASE;
    process.env.USE0_KIT_SIGNER_RELEASE = "supersecret";

    try {
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), "# Repo Conventions\n", "utf8");
      await writeFile(registryPath, JSON.stringify({ items: [] }, null, 2), "utf8");

      await runCli(["scope", "init", "--scope", "project"], { cwd: root });
      await runCli(["scope", "init", "--scope", "project"], { cwd: targetRoot });
      await runCli(["skill", "add", "--id", "repo-conventions", "--source", `path:${skillDir}`, "--targets", "codex"], {
        cwd: root
      });
      await runCli(["pack", "init", "frontend", "--name", "acme/frontend", "--version", "1.0.0"], { cwd: root });
      await runCli(["pack", "add", "frontend", "skill:repo-conventions"], { cwd: root });
      await runCli(["pack", "sign", "frontend", "--key-id", "release"], { cwd: root });
      await runCli(["registry", "add", "official", registryPath], { cwd: root });
      await runCli(["registry", "login", "official"], { cwd: root });

      await runCli(["publish", "skill:repo-conventions", "--registry", "official"], { cwd: root });
      expect(await runCli(["pack", "publish", "frontend", "--registry", "official"], { cwd: root })).toContain(
        "Published pack:frontend"
      );
      expect(await runCli(["registry", "info", "pack:frontend"], { cwd: root })).toContain("signature.key_id=release");

      await runCli(["registry", "add", "official", registryPath], { cwd: targetRoot });
      await runCli(["registry", "install", "pack:frontend", "--registry", "official"], { cwd: targetRoot });
      expect(await runCli(["info", "pack:frontend"], { cwd: targetRoot })).toContain("signature.key_id=release");
      expect(await runCli(["pack", "verify", "frontend"], { cwd: targetRoot })).toContain("pack:frontend signature ok");
    } finally {
      if (previousSecret === undefined) delete process.env.USE0_KIT_SIGNER_RELEASE;
      else process.env.USE0_KIT_SIGNER_RELEASE = previousSecret;
    }
  });
});
