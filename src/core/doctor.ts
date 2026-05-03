import { access, lstat, readFile } from "node:fs/promises";
import { delimiter } from "node:path";
import { join, resolve } from "node:path";

import { checkPackApprovals } from "./approvals.js";
import { AGENTS } from "./agents.js";
import { listAgents } from "./agents-runtime.js";
import { applyPlan } from "./apply.js";
import { collectEffectiveGraph } from "./graph-state.js";
import { instructionMarkerEnd, instructionMarkerStart } from "./instructions.js";
import { diffStateView, refreshLock, verifyLock } from "./lock.js";
import { loadManifest } from "./manifest.js";
import { lookupSignerSecret, verifyPackSignature } from "./pack-signatures.js";
import { createBackup } from "./packs.js";
import { buildPlan } from "./planner.js";
import { evaluatePolicy } from "./policy.js";
import { computeSourceDigest } from "./source-resolver.js";
import type { ResourceTarget } from "./types.js";

function isSupportedTarget(target: ResourceTarget, supportedAgents: Set<string>): boolean {
  return target === "*" || target === "universal" || supportedAgents.has(target);
}

async function commandExists(command: string): Promise<boolean> {
  if (command.includes("/")) {
    try {
      await access(resolve(command));
      return true;
    } catch {
      return false;
    }
  }

  for (const segment of (process.env.PATH ?? "").split(delimiter)) {
    if (!segment) {
      continue;
    }
    try {
      await access(join(segment, command));
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

function isValidGeneratedToml(content: string): boolean {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (/^\[.+\]$/.test(line)) {
      continue;
    }
    if (/^[A-Za-z0-9_.-]+\s*=\s*".*"$/.test(line)) {
      continue;
    }
    if (/^[A-Za-z0-9_.-]+\s*=\s*\[[^\]]*\]$/.test(line)) {
      continue;
    }
    return false;
  }

  return true;
}

export async function runDoctor(root: string): Promise<{
  ok: boolean;
  checks: Array<{ id: string; status: "ok" | "error"; detail: string }>;
}> {
  return runDoctorForSelector(root);
}

export async function runDoctorForSelector(root: string, selector?: string): Promise<{
  ok: boolean;
  checks: Array<{ id: string; status: "ok" | "error"; detail: string }>;
}> {
  const checks: Array<{ id: string; status: "ok" | "error"; detail: string }> = [];
  const matchesSelector = (id: string): boolean => !selector || id === selector;

  try {
    const manifest = await loadManifest(root);
    checks.push({ id: "manifest-parse", status: "ok", detail: "Manifest parsed successfully." });

    try {
      await access(join(root, "use0-kit.lock.json"));
      checks.push({ id: "lockfile", status: "ok", detail: "Lockfile exists." });
    } catch {
      checks.push({ id: "lockfile", status: "error", detail: "Missing use0-kit.lock.json." });
    }

    const localSourceSelectors = [
      ...manifest.skills.map((item) => ({ id: `skill:${item.id}`, source: item.source })),
      ...manifest.commands.map((item) => ({ id: `command:${item.id}`, source: item.source })),
      ...manifest.subagents.map((item) => ({ id: `subagent:${item.id}`, source: item.source })),
      ...manifest.hooks.map((item) => ({ id: `hook:${item.id}`, source: item.source })),
      ...manifest.plugins.map((item) => ({ id: `plugin:${item.id}`, source: item.source }))
    ].filter((item) => matchesSelector(item.id));
    let missing = 0;
    for (const resource of localSourceSelectors) {
      if (!resource.source.startsWith("path:")) {
        continue;
      }
      try {
        await access(resource.source.slice("path:".length));
      } catch {
        missing += 1;
      }
    }
    checks.push({
      id: "local-sources",
      status: missing === 0 ? "ok" : "error",
      detail: missing === 0 ? "All local resource sources exist." : `${missing} local source(s) missing.`
    });

    const supportedAgents = new Set(listAgents());
    const unsupportedTargets = [
      ...manifest.skills.flatMap((item) => item.targets.map((target) => ({ id: `skill:${item.id}`, target }))),
      ...manifest.mcps.flatMap((item) => item.targets.map((target) => ({ id: `mcp:${item.id}`, target }))),
      ...manifest.instructions.flatMap((item) => item.targets.map((target) => ({ id: `instruction:${item.id}`, target }))),
      ...manifest.commands.flatMap((item) => item.targets.map((target) => ({ id: `command:${item.id}`, target }))),
      ...manifest.subagents.flatMap((item) => item.targets.map((target) => ({ id: `subagent:${item.id}`, target }))),
      ...manifest.hooks.flatMap((item) => item.targets.map((target) => ({ id: `hook:${item.id}`, target }))),
      ...manifest.secrets.flatMap((item) => item.targets.map((target) => ({ id: `secret:${item.id}`, target })))
    ]
      .filter((entry) => matchesSelector(entry.id))
      .filter((entry) => !isSupportedTarget(entry.target, supportedAgents));
    checks.push({
      id: "unsupported-targets",
      status: unsupportedTargets.length === 0 ? "ok" : "error",
      detail:
        unsupportedTargets.length === 0
          ? "All resource targets are supported."
          : unsupportedTargets.map((entry) => `${entry.id}->${entry.target}`).join(", ")
    });

    const missingCommands: string[] = [];
    for (const mcp of manifest.mcps) {
      if (!matchesSelector(`mcp:${mcp.id}`)) {
        continue;
      }
      if (!mcp.command) {
        continue;
      }
      if (!(await commandExists(mcp.command))) {
        missingCommands.push(`mcp:${mcp.id}`);
      }
    }
    checks.push({
      id: "mcp-commands",
      status: missingCommands.length === 0 ? "ok" : "error",
      detail:
        missingCommands.length === 0
          ? "All MCP commands resolve from PATH."
          : `Missing MCP command(s): ${missingCommands.join(", ")}`
    });

    const configProblems: string[] = [];
    for (const agentId of manifest.agents) {
      const hasRelevantMcp = manifest.mcps.some(
        (mcp) => mcp.targets.includes("*") || mcp.targets.includes("universal") || mcp.targets.includes(agentId)
      );
      if (!hasRelevantMcp) {
        continue;
      }

      const configPath = AGENTS[agentId].mcpConfigPath(root);
      try {
        const content = await readFile(configPath, "utf8");
        if (agentId === "codex") {
          if (!isValidGeneratedToml(content)) {
            configProblems.push(`${agentId}:invalid-toml`);
          }
        } else {
          JSON.parse(content);
        }
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          continue;
        }
        configProblems.push(`${agentId}:${error instanceof SyntaxError ? "invalid-json" : "unreadable-config"}`);
      }
    }
    checks.push({
      id: "agent-configs",
      status: configProblems.length === 0 ? "ok" : "error",
      detail:
        configProblems.length === 0
          ? "Agent-native configs parse successfully."
          : `Agent config issue(s): ${configProblems.join(", ")}`
    });

    const effectiveGraph = await collectEffectiveGraph(root);
    const lockOk = await verifyLock(root);
    let materializedPresent = true;
    try {
      await access(join(root, ".use0-kit", "materialized.json"));
    } catch {
      materializedPresent = false;
    }
    const materializedOk = !materializedPresent || (await diffStateView(root, "materialized")) === "clean";
    checks.push({
      id: "effective-graph",
      status: lockOk ? "ok" : "error",
      detail:
        Object.keys(effectiveGraph).length === 0
          ? "Effective graph is empty."
          : `Effective graph has ${Object.keys(effectiveGraph).length} resource(s).`
    });
    checks.push({
      id: "materialized-graph",
      status: materializedOk ? "ok" : "error",
      detail:
        !materializedPresent
          ? "No materialized graph yet."
          : materializedOk
            ? "Materialized graph matches current plan."
          : "Materialized graph is stale or missing."
    });

    let brokenLinks = 0;
    if (materializedPresent) {
      try {
        const materialized = JSON.parse(
          await readFile(join(root, ".use0-kit", "materialized.json"), "utf8")
        ) as { entries?: Array<{ kind?: string; path?: string }> };
        for (const entry of materialized.entries ?? []) {
          if (!entry.path || entry.kind !== "link-skill") {
            continue;
          }
          try {
            await lstat(entry.path);
            await access(entry.path);
          } catch {
            brokenLinks += 1;
          }
        }
      } catch {
        brokenLinks += 1;
      }
    }
    checks.push({
      id: "symlinks",
      status: brokenLinks === 0 ? "ok" : "error",
      detail: brokenLinks === 0 ? "No broken managed symlinks found." : `${brokenLinks} broken symlink(s) found.`
    });

    const markerProblems: string[] = [];
    for (const agentId of manifest.agents) {
      const relevantInstructions = manifest.instructions.filter((instruction) =>
        instruction.targets.includes("*") || instruction.targets.includes("universal") || instruction.targets.includes(agentId)
      );
      if (relevantInstructions.length === 0) {
        continue;
      }
      const instructionPath = AGENTS[agentId].instructionPath(root);
      try {
        const content = await readFile(instructionPath, "utf8");
        for (const instruction of relevantInstructions) {
          const hasStart = content.includes(instructionMarkerStart(instruction.id));
          const hasEnd = content.includes(instructionMarkerEnd(instruction.id));
          if (!hasStart || !hasEnd) {
            markerProblems.push(`${agentId}:instruction:${instruction.id}`);
          }
        }
      } catch {
        markerProblems.push(`${agentId}:missing-instruction-file`);
      }
    }
    checks.push({
      id: "generated-markers",
      status: markerProblems.length === 0 ? "ok" : "error",
      detail:
        markerProblems.length === 0
          ? "Generated instruction markers are intact."
          : `Broken generated marker(s): ${markerProblems.join(", ")}`
    });

    const sourceDigestResources = [
      ...manifest.skills
        .filter((item) => matchesSelector(`skill:${item.id}`))
        .map((item) => ({ selector: `skill:${item.id}`, source: item.source, digest: item.provenance?.digest })),
      ...manifest.commands
        .filter((item) => matchesSelector(`command:${item.id}`))
        .map((item) => ({ selector: `command:${item.id}`, source: item.source, digest: item.provenance?.digest })),
      ...manifest.subagents
        .filter((item) => matchesSelector(`subagent:${item.id}`))
        .map((item) => ({ selector: `subagent:${item.id}`, source: item.source, digest: item.provenance?.digest })),
      ...manifest.hooks
        .filter((item) => matchesSelector(`hook:${item.id}`))
        .map((item) => ({ selector: `hook:${item.id}`, source: item.source, digest: item.provenance?.digest })),
      ...manifest.plugins
        .filter((item) => matchesSelector(`plugin:${item.id}`))
        .map((item) => ({ selector: `plugin:${item.id}`, source: item.source, digest: item.provenance?.digest }))
    ];
    const missingProvenance = [
      ...manifest.skills
        .filter((item) => matchesSelector(`skill:${item.id}`))
        .filter((item) => !item.source.startsWith("path:") && !item.provenance?.digest)
        .map((item) => `skill:${item.id}`),
      ...manifest.commands
        .filter((item) => matchesSelector(`command:${item.id}`))
        .filter((item) => !item.source.startsWith("path:") && !item.provenance?.digest)
        .map((item) => `command:${item.id}`),
      ...manifest.subagents
        .filter((item) => matchesSelector(`subagent:${item.id}`))
        .filter((item) => !item.source.startsWith("path:") && !item.provenance?.digest)
        .map((item) => `subagent:${item.id}`),
      ...manifest.hooks
        .filter((item) => matchesSelector(`hook:${item.id}`))
        .filter((item) => !item.source.startsWith("path:") && !item.provenance?.digest)
        .map((item) => `hook:${item.id}`),
      ...manifest.plugins
        .filter((item) => matchesSelector(`plugin:${item.id}`))
        .filter((item) => !item.source.startsWith("path:") && !item.provenance?.digest)
        .map((item) => `plugin:${item.id}`),
      ...manifest.mcps
        .filter((item) => matchesSelector(`mcp:${item.id}`))
        .filter((item) => item.url && !item.provenance?.digest)
        .map((item) => `mcp:${item.id}`)
    ];
    const mismatchedProvenance: string[] = [];
    for (const resource of sourceDigestResources) {
      if (resource.source.startsWith("path:") || !resource.digest?.startsWith("sha256:")) {
        continue;
      }
      try {
        const actualDigest = await computeSourceDigest(root, resource.source);
        if (actualDigest !== resource.digest) {
          mismatchedProvenance.push(resource.selector);
        }
      } catch {
        mismatchedProvenance.push(resource.selector);
      }
    }
    checks.push({
      id: "provenance",
      status: missingProvenance.length === 0 && mismatchedProvenance.length === 0 ? "ok" : "error",
      detail:
        missingProvenance.length === 0 && mismatchedProvenance.length === 0
          ? "All remote resources have matching provenance digest."
          : [
              missingProvenance.length > 0
                ? `Missing provenance digest for: ${missingProvenance.join(", ")}`
                : undefined,
              mismatchedProvenance.length > 0
                ? `Mismatched provenance digest for: ${mismatchedProvenance.join(", ")}`
                : undefined
            ]
              .filter(Boolean)
              .join("; ")
    });

    const packSignatureProblems: string[] = [];
    for (const pack of manifest.packs) {
      if (!matchesSelector(`pack:${pack.id}`)) {
        continue;
      }
      if (!pack.signature) {
        if (manifest.policy.requireSignedPacks) {
          packSignatureProblems.push(`pack:${pack.id}:unsigned`);
        }
        continue;
      }
      if ((manifest.trust.allowedSigners?.length ?? 0) > 0 && !manifest.trust.allowedSigners?.includes(pack.signature.keyId)) {
        packSignatureProblems.push(`pack:${pack.id}:untrusted-signer`);
        continue;
      }
      const secret = lookupSignerSecret(pack.signature.keyId);
      if (!secret) {
        packSignatureProblems.push(`pack:${pack.id}:missing-signer-secret`);
        continue;
      }
      if (!verifyPackSignature(pack, secret)) {
        packSignatureProblems.push(`pack:${pack.id}:invalid-signature`);
      }
    }
    checks.push({
      id: "pack-signatures",
      status: packSignatureProblems.length === 0 ? "ok" : "error",
      detail:
        packSignatureProblems.length === 0
          ? "Pack signatures verified."
          : `Pack signature issue(s): ${packSignatureProblems.join(", ")}`
    });

    const approvalProblems = (await checkPackApprovals(root)).filter((item) => matchesSelector(item.selector));
    checks.push({
      id: "pack-approvals",
      status: approvalProblems.length === 0 ? "ok" : "error",
      detail:
        approvalProblems.length === 0
          ? "Pack approvals satisfied."
          : `Pack approval issue(s): ${approvalProblems.map((item) => `${item.selector}:${item.reason}`).join(", ")}`
    });

    const policy = await evaluatePolicy(root);
    const missingEnv = policy.findings.filter(
      (finding) => finding.rule === "missing-env" && matchesSelector(finding.id)
    );
    checks.push({
      id: "mcp-env",
      status: missingEnv.length === 0 ? "ok" : "error",
      detail:
        missingEnv.length === 0
          ? "All required MCP env vars are present."
          : `${missingEnv.length} MCP env var(s) missing.`
    });
    const missingSecrets = policy.findings.filter(
      (finding) => finding.rule === "missing-secret" && matchesSelector(finding.id)
    );
    checks.push({
      id: "secrets",
      status: missingSecrets.length === 0 ? "ok" : "error",
      detail:
        missingSecrets.length === 0
          ? "All required secret env vars are present."
          : `${missingSecrets.length} secret env var(s) missing.`
    });
    const blocking = policy.findings.filter(
      (finding) => finding.rule !== "missing-env" && (!selector || matchesSelector(finding.id))
    );
    checks.push({
      id: "policy",
      status: blocking.length === 0 ? "ok" : "error",
      detail:
        blocking.length === 0
          ? "Policy checks passed."
          : blocking.map((finding) => `${finding.id}:${finding.rule}`).join(", ")
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    checks.push({ id: "manifest-parse", status: "error", detail });
  }

  return {
    ok: checks.every((check) => check.status === "ok"),
    checks
  };
}

export async function fixDoctorIssues(root: string): Promise<string[]> {
  const actions: string[] = [];
  let report = await runDoctor(root);
  let errored = new Set(report.checks.filter((check) => check.status === "error").map((check) => check.id));

  if (errored.has("lockfile") || errored.has("effective-graph")) {
    await refreshLock(root);
    actions.push("refreshed-lockfile");
    report = await runDoctor(root);
    errored = new Set(report.checks.filter((check) => check.status === "error").map((check) => check.id));
  }

  if (errored.has("materialized-graph") || errored.has("symlinks")) {
    const manifest = await loadManifest(root);
    const plan = await buildPlan({ root, manifest });
    const backupId = await createBackup(root);
    await applyPlan({ root, plan, backupId });
    actions.push("reapplied-materialization");
  }

  return actions;
}
