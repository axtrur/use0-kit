import { loadManifest } from "./manifest.js";
import { loadResourceContent } from "./resources.js";

type Severity = "low" | "medium" | "high" | "critical";

const THRESHOLD_RANK: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

export async function auditResources(root: string): Promise<{
  findings: Array<{ id: string; severity: Severity; rule: string; detail: string }>;
}> {
  return auditResourcesFiltered(root);
}

export async function auditResourcesFiltered(
  root: string,
  options?: { kind?: string; selector?: string }
): Promise<{
  findings: Array<{ id: string; severity: Severity; rule: string; detail: string }>;
}> {
  const manifest = await loadManifest(root);
  const findings: Array<{ id: string; severity: Severity; rule: string; detail: string }> = [];
  const remoteResources = [
    ...manifest.skills.map((item) => ({ id: `skill:${item.id}`, source: item.source })),
    ...manifest.commands.map((item) => ({ id: `command:${item.id}`, source: item.source })),
    ...manifest.subagents.map((item) => ({ id: `subagent:${item.id}`, source: item.source })),
    ...manifest.hooks.map((item) => ({ id: `hook:${item.id}`, source: item.source }))
  ];

  for (const resource of remoteResources) {
    if (/^https?:\/\//.test(resource.source) && !/^https:\/\//.test(resource.source)) {
      findings.push({
        id: resource.id,
        severity: "medium",
        rule: "insecure-source-url",
        detail: `Resource source uses insecure HTTP: ${resource.source}`
      });
    }
    if (!resource.source.startsWith("path:") && !looksPinned(resource.source)) {
      findings.push({
        id: resource.id,
        severity: "medium",
        rule: "unpinned-source",
        detail: `Resource source does not look pinned: ${resource.source}`
      });
    }
  }

  for (const command of manifest.commands) {
    const content = await loadResourceContent(root, command.source);
    findings.push(...scanContent(`command:${command.id}`, content));
  }

  for (const subagent of manifest.subagents) {
    const content = await loadResourceContent(root, subagent.source);
    findings.push(...scanContent(`subagent:${subagent.id}`, content));
  }

  for (const hook of manifest.hooks) {
    const content = await loadResourceContent(root, hook.source);
    findings.push(...scanContent(`hook:${hook.id}`, content));
  }

  for (const instruction of manifest.instructions) {
    findings.push(...scanContent(`instruction:${instruction.id}`, instruction.body));
  }

  for (const mcp of manifest.mcps) {
    if (mcp.url && /^http:\/\//.test(mcp.url)) {
      findings.push({
        id: `mcp:${mcp.id}`,
        severity: "medium",
        rule: "insecure-mcp-url",
        detail: `MCP URL uses insecure HTTP: ${mcp.url}`
      });
    }
    if (mcp.command && /(sudo|rm\s+-rf\s+\/|chmod\s+777)/.test(mcp.command)) {
      findings.push({
        id: `mcp:${mcp.id}`,
        severity: "high",
        rule: "risky-mcp-command",
        detail: `MCP command looks high risk: ${mcp.command}`
      });
    }
  }

  return {
    findings: findings.filter(
      (finding) =>
        (!options?.kind || finding.id.startsWith(`${options.kind}:`)) &&
        (!options?.selector || finding.id === options.selector)
    )
  };
}

function scanContent(
  id: string,
  content: string
): Array<{ id: string; severity: Severity; rule: string; detail: string }> {
  const findings: Array<{ id: string; severity: Severity; rule: string; detail: string }> = [];

  if (/curl\s+.+\|\s*sh/.test(content)) {
    findings.push({
      id,
      severity: "high",
      rule: "curl-pipe-sh",
      detail: "Content includes curl piped into sh."
    });
  }
  if (/ghp_[A-Za-z0-9]+/.test(content) || /sk-[A-Za-z0-9]+/.test(content) || /AKIA[0-9A-Z]{16}/.test(content)) {
    findings.push({
      id,
      severity: "critical",
      rule: "secret-leak",
      detail: "Content looks like it contains a secret."
    });
  }
  if (/https?:\/\/[^\s)]+/.test(content) && /http:\/\//.test(content)) {
    findings.push({
      id,
      severity: "medium",
      rule: "suspicious-url",
      detail: "Content includes an insecure HTTP URL."
    });
  }
  if (/(ignore previous instructions|system prompt|developer message)/i.test(content)) {
    findings.push({
      id,
      severity: "medium",
      rule: "prompt-injection-pattern",
      detail: "Content includes prompt injection style phrases."
    });
  }

  return findings;
}

function looksPinned(source: string): boolean {
  return source.includes("#") || /@[A-Za-z0-9._-]+$/.test(source);
}

export function shouldFailAudit(
  findings: Array<{ severity: Severity }>,
  threshold: Severity
): boolean {
  return findings.some((finding) => THRESHOLD_RANK[finding.severity] >= THRESHOLD_RANK[threshold]);
}
