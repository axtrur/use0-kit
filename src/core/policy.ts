import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { checkPackApprovals } from "./approvals.js";
import { auditResources } from "./audit.js";
import { loadManifest } from "./manifest.js";
import { lookupSignerSecret, verifyPackSignature } from "./pack-signatures.js";
import { parseSourceReference } from "./source-resolver.js";
import type { Manifest } from "./types.js";

type PolicyFinding = {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  rule: string;
  detail: string;
};

export async function evaluatePolicy(root: string): Promise<{ findings: PolicyFinding[] }> {
  const manifest = await loadManifest(root);
  const findings: PolicyFinding[] = [];

  if (manifest.policy.requireLockfile) {
    try {
      await access(resolve(root, "use0-kit.lock.json"));
    } catch {
      findings.push({
        id: "policy:lockfile",
        severity: "high",
        rule: "require-lockfile",
        detail: "Policy requires use0-kit.lock.json."
      });
    }
  }

  if (manifest.policy.blockHighRisk) {
    const audit = await auditResources(root);
    findings.push(
      ...audit.findings.filter((finding) => finding.severity === "high" || finding.severity === "critical")
    );
  }

  findings.push(...collectTrustFindings(root, manifest));
  findings.push(...collectPinnedFindings(manifest));
  findings.push(...collectUnpinnedGitFindings(manifest));
  findings.push(...collectRemoteHttpSkillFindings(manifest));
  findings.push(...collectDigestFindings(manifest));
  findings.push(...collectPackSignatureFindings(manifest));
  findings.push(...(await collectApprovalFindings(root, manifest)));
  findings.push(...collectEnvFindings(manifest));
  findings.push(...collectSecretFindings(manifest));

  return { findings };
}

export async function enforcePolicy(root: string): Promise<void> {
  const report = await evaluatePolicy(root);
  const blocking = report.findings.filter((finding) => finding.severity === "high" || finding.severity === "critical");
  if (blocking.length > 0) {
    throw new Error(
      `Policy violation: ${blocking.map((finding) => `${finding.id}:${finding.rule}`).join(", ")}`
    );
  }
}

function collectTrustFindings(root: string, manifest: Manifest): PolicyFinding[] {
  if (
    manifest.policy.allowUntrustedSources !== false &&
    manifest.trust.allowedSources.length === 0 &&
    (manifest.trust.githubOrgs?.length ?? 0) === 0 &&
    (manifest.trust.gitDomains?.length ?? 0) === 0
  ) {
    return [];
  }

  const findings: PolicyFinding[] = [];
  for (const resource of collectSources(manifest)) {
    if (isTrustedSource(root, resource.source, manifest.trust)) {
      continue;
    }
    findings.push({
      id: `${resource.kind}:${resource.id}`,
      severity: "high",
      rule: "untrusted-source",
      detail: `Source is not allowed by trust policy: ${resource.source}`
    });
  }
  return findings;
}

function collectPinnedFindings(manifest: Manifest): PolicyFinding[] {
  if (!manifest.policy.requirePinnedRefs) {
    return [];
  }

  const findings: PolicyFinding[] = [];
  for (const resource of collectSources(manifest)) {
    if (resource.source.startsWith("path:")) {
      continue;
    }
    if (looksPinned(resource.source)) {
      continue;
    }
    findings.push({
      id: `${resource.kind}:${resource.id}`,
      severity: "high",
      rule: "unpinned-source",
      detail: `Source is not pinned: ${resource.source}`
    });
  }
  return findings;
}

function collectUnpinnedGitFindings(manifest: Manifest): PolicyFinding[] {
  if (manifest.policy.allowUnpinnedGit !== false) {
    return [];
  }

  const findings: PolicyFinding[] = [];
  for (const resource of collectSources(manifest)) {
    if (!isGitLikeSource(resource.source)) {
      continue;
    }
    if (looksPinned(resource.source)) {
      continue;
    }
    findings.push({
      id: `${resource.kind}:${resource.id}`,
      severity: "high",
      rule: "unpinned-git-source",
      detail: `Git source is not pinned: ${resource.source}`
    });
  }
  return findings;
}

function collectRemoteHttpSkillFindings(manifest: Manifest): PolicyFinding[] {
  if (manifest.policy.allowRemoteHttpSkills !== false) {
    return [];
  }

  return manifest.skills
    .filter((skill) => skill.source.startsWith("url:") || skill.source.startsWith("well-known:"))
    .map((skill) => ({
      id: `skill:${skill.id}`,
      severity: "high" as const,
      rule: "remote-http-skill-source",
      detail: `Remote HTTP skill sources are disallowed: ${skill.source}`
    }));
}

function collectDigestFindings(manifest: Manifest): PolicyFinding[] {
  if (!manifest.policy.requireDigest) {
    return [];
  }

  const findings: PolicyFinding[] = [];
  for (const resource of collectSources(manifest)) {
    if (resource.source.startsWith("path:") || resource.source.startsWith("command:")) {
      continue;
    }
    if (resource.provenance?.digest) {
      continue;
    }
    findings.push({
      id: `${resource.kind}:${resource.id}`,
      severity: "high",
      rule: "missing-digest",
      detail: `Resource is missing provenance digest: ${resource.source}`
    });
  }
  return findings;
}

function collectPackSignatureFindings(manifest: Manifest): PolicyFinding[] {
  if (!manifest.policy.requireSignedPacks) {
    return [];
  }

  const findings: PolicyFinding[] = [];
  for (const pack of manifest.packs) {
    if (!pack.signature) {
      findings.push({
        id: `pack:${pack.id}`,
        severity: "high",
        rule: "unsigned-pack",
        detail: `Pack is missing a signature: ${pack.name}@${pack.version}`
      });
      continue;
    }
    if ((manifest.trust.allowedSigners?.length ?? 0) > 0 && !manifest.trust.allowedSigners?.includes(pack.signature.keyId)) {
      findings.push({
        id: `pack:${pack.id}`,
        severity: "high",
        rule: "untrusted-pack-signer",
        detail: `Pack signer is not trusted: ${pack.signature.keyId}`
      });
      continue;
    }
    const secret = lookupSignerSecret(pack.signature.keyId);
    if (!secret) {
      findings.push({
        id: `pack:${pack.id}`,
        severity: "high",
        rule: "missing-pack-signer-secret",
        detail: `Signer secret env is missing for key: ${pack.signature.keyId}`
      });
      continue;
    }
    if (!verifyPackSignature(pack, secret)) {
      findings.push({
        id: `pack:${pack.id}`,
        severity: "high",
        rule: "invalid-pack-signature",
        detail: `Pack signature verification failed for: ${pack.signature.keyId}`
      });
    }
  }
  return findings;
}

async function collectApprovalFindings(root: string, manifest: Manifest): Promise<PolicyFinding[]> {
  if (!manifest.policy.requirePackApprovals) {
    return [];
  }
  const issues = await checkPackApprovals(root);
  return issues.map((issue) => ({
    id: issue.selector,
    severity: "high" as const,
    rule: issue.reason,
    detail: `Approval check failed: ${issue.reason}`
  }));
}

function collectEnvFindings(manifest: Manifest): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  for (const mcp of manifest.mcps) {
    for (const envKey of mcp.env ?? []) {
      if (process.env[envKey]) {
        continue;
      }
      findings.push({
        id: `mcp:${mcp.id}`,
        severity: "medium",
        rule: "missing-env",
        detail: `Missing required env var: ${envKey}`
      });
    }
  }
  return findings;
}

function collectSecretFindings(manifest: Manifest): PolicyFinding[] {
  const findings: PolicyFinding[] = [];
  for (const secret of manifest.secrets) {
    if (secret.required === false) {
      continue;
    }
    if (process.env[secret.env]) {
      continue;
    }
    findings.push({
      id: `secret:${secret.id}`,
      severity: "medium",
      rule: "missing-secret",
      detail: `Missing required secret env var: ${secret.env}`
    });
  }
  return findings;
}

function collectSources(manifest: Manifest): Array<{
  kind: string;
  id: string;
  source: string;
  provenance?: { digest?: string };
}> {
  return [
    ...manifest.skills.map((item) => ({
      kind: "skill",
      id: item.id,
      source: item.source,
      provenance: item.provenance
    })),
    ...manifest.commands.map((item) => ({
      kind: "command",
      id: item.id,
      source: item.source,
      provenance: item.provenance
    })),
    ...manifest.subagents.map((item) => ({
      kind: "subagent",
      id: item.id,
      source: item.source,
      provenance: item.provenance
    })),
    ...manifest.hooks.map((item) => ({
      kind: "hook",
      id: item.id,
      source: item.source,
      provenance: item.provenance
    })),
    ...manifest.plugins.map((item) => ({
      kind: "plugin",
      id: item.id,
      source: item.source,
      provenance: item.provenance
    })),
    ...manifest.mcps.flatMap((item) => {
      if (item.url) return [{ kind: "mcp", id: item.id, source: item.url, provenance: item.provenance }];
      if (item.command) {
        return [{ kind: "mcp", id: item.id, source: `command:${item.command}`, provenance: item.provenance }];
      }
      return [];
    })
  ];
}

function isTrustedSource(
  root: string,
  source: string,
  trust: { allowedSources: string[]; githubOrgs?: string[]; gitDomains?: string[] }
): boolean {
  if (
    trust.allowedSources.length === 0 &&
    (trust.githubOrgs?.length ?? 0) === 0 &&
    (trust.gitDomains?.length ?? 0) === 0
  ) {
    return source.startsWith("path:") || source.startsWith("command:");
  }

  if (source.startsWith("path:")) {
    const path = resolve(source.slice("path:".length));
    const cwd = resolve(root);
    return path.startsWith(cwd) || trust.allowedSources.some((item) => path.startsWith(resolveAllowed(item)));
  }

  if (trust.allowedSources.some((item) => source.startsWith(item))) {
    return true;
  }

  try {
    const parsed = parseSourceReference(source);
    if (parsed.scheme === "git") {
      const domain = extractGitDomain(parsed.repo) ?? extractDomainFromSource(source);
      if (domain && trust.gitDomains?.includes(domain)) {
        return true;
      }
      const githubOrg = extractGithubOrg(parsed.repo);
      if (githubOrg && trust.githubOrgs?.includes(githubOrg)) {
        return true;
      }
    }
  } catch {
    // ignore unparseable sources and fall through
  }

  if (source.startsWith("github:")) {
    const org = source.slice("github:".length).split(/[\/@#]/)[0];
    if (org && trust.githubOrgs?.includes(org)) {
      return true;
    }
  }

  return false;
}

function resolveAllowed(source: string): string {
  return source.startsWith("path:") ? resolve(source.slice("path:".length)) : source;
}

function extractGitDomain(repo: string): string | undefined {
  if (repo.startsWith("http://") || repo.startsWith("https://")) {
    try {
      return new URL(repo).hostname;
    } catch {
      return undefined;
    }
  }
  const sshMatch = repo.match(/^[^@]+@([^:]+):/);
  return sshMatch?.[1];
}

function extractDomainFromSource(source: string): string | undefined {
  const sshMatch = source.match(/^ssh:[^@]+@([^:#/]+)[:/]/);
  if (sshMatch) {
    return sshMatch[1];
  }
  const gitMatch = source.match(/^git:(https?:\/\/)?([^/#:]+)(?::\d+)?[/:]/);
  if (gitMatch) {
    return gitMatch[2];
  }
  const urlMatch = source.match(/^(?:url:|well-known:)(https?:\/\/[^/]+)/);
  if (urlMatch) {
    try {
      return new URL(urlMatch[1]).hostname;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function extractGithubOrg(repo: string): string | undefined {
  if (repo.includes("github.com/")) {
    const match = repo.match(/github\.com[:/]+([^/]+)/);
    return match?.[1];
  }
  const sshMatch = repo.match(/github\.com:([^/]+)/);
  return sshMatch?.[1];
}

function looksPinned(source: string): boolean {
  try {
    const parsed = parseSourceReference(source);
    if (parsed.scheme === "git") {
      return Boolean(parsed.ref);
    }
  } catch {
    // fall back to simple heuristics for non-resource strings
  }
  return source.includes("#") || /@[A-Za-z0-9._-]+$/.test(source);
}

function isGitLikeSource(source: string): boolean {
  try {
    return parseSourceReference(source).scheme === "git";
  } catch {
    return false;
  }
}
