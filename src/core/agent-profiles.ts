import { join } from "node:path";

import type { AgentId, ResourceTarget, ScopeName } from "./types.js";

export type ResourceKind =
  | "skill"
  | "command"
  | "subagent"
  | "instruction"
  | "mcp"
  | "hook"
  | "secret"
  | "plugin";

export type ResourceLayout = "file" | "folder";

export interface KindCapability {
  supported: boolean;
  /**
   * Scopes where the underlying agent actually consumes the resource.
   * Reserved for future scope-aware enforcement; currently informational.
   */
  scopes: ScopeName[];
  layout: ResourceLayout;
  /**
   * Destination directory (or single file's parent) for this kind under a given scope root.
   */
  dir(root: string): string;
  /**
   * Filename strategy when `layout === "file"`. Folder layouts ignore this.
   */
  filename?(id: string): string;
  /**
   * Human-readable reason surfaced when `supported === false`.
   */
  unsupportedReason?: string;
  /**
   * Soft warning surfaced even when supported. Useful for partial / no-op cases.
   */
  warning?: string;
}

export interface AgentProfile {
  id: AgentId;
  /**
   * Path used by detection / disambiguation (e.g. `.claude` or `.codex/config.toml`).
   */
  markerPath(root: string): string;
  instructionPath(root: string): string;
  mcpConfigPath(root: string): string;
  mcpFormat: "json" | "toml";
  /**
   * CLI binary name (best-effort). Reserved for future version-gated profiles.
   */
  cliPackage?: string;
  /**
   * Semver range describing the CLI version this profile applies to.
   * Reserved; not enforced today.
   */
  versionRange?: string;
  kinds: Record<ResourceKind, KindCapability>;
}

const ALL_SCOPES: ScopeName[] = ["project", "workspace", "user", "global", "session"];

export const AGENT_PROFILES: Record<AgentId, AgentProfile> = {
  "claude-code": {
    id: "claude-code",
    markerPath: (root) => join(root, ".claude"),
    instructionPath: (root) => join(root, "CLAUDE.md"),
    mcpConfigPath: (root) => join(root, ".claude", "mcp.json"),
    mcpFormat: "json",
    cliPackage: "claude",
    kinds: {
      skill: { supported: true, scopes: ALL_SCOPES, layout: "folder", dir: (root) => join(root, ".claude", "skills") },
      command: {
        supported: true,
        scopes: ALL_SCOPES,
        layout: "file",
        dir: (root) => join(root, ".claude", "commands"),
        filename: (id) => `${id}.md`
      },
      subagent: {
        supported: true,
        scopes: ALL_SCOPES,
        layout: "file",
        dir: (root) => join(root, ".claude", "agents"),
        filename: (id) => `${id}.md`
      },
      instruction: { supported: true, scopes: ALL_SCOPES, layout: "file", dir: (root) => root },
      mcp: { supported: true, scopes: ALL_SCOPES, layout: "file", dir: (root) => join(root, ".claude") },
      hook: {
        supported: true,
        scopes: ALL_SCOPES,
        layout: "file",
        dir: (root) => join(root, ".claude", "hooks"),
        filename: (id) => `${id}.sh`
      },
      secret: { supported: true, scopes: ALL_SCOPES, layout: "folder", dir: (root) => join(root, ".claude", "secrets") },
      plugin: { supported: true, scopes: ALL_SCOPES, layout: "folder", dir: (root) => join(root, ".claude", "plugins") }
    }
  },
  cursor: {
    id: "cursor",
    markerPath: (root) => join(root, ".cursor"),
    instructionPath: (root) => join(root, ".cursor", "AGENTS.md"),
    mcpConfigPath: (root) => join(root, ".cursor", "mcp.json"),
    mcpFormat: "json",
    cliPackage: "cursor",
    kinds: {
      skill: { supported: true, scopes: ALL_SCOPES, layout: "folder", dir: (root) => join(root, ".cursor", "skills") },
      command: {
        supported: true,
        scopes: ALL_SCOPES,
        layout: "file",
        dir: (root) => join(root, ".cursor", "commands"),
        filename: (id) => `${id}.md`
      },
      subagent: {
        supported: true,
        scopes: ALL_SCOPES,
        layout: "file",
        dir: (root) => join(root, ".cursor", "subagents"),
        filename: (id) => `${id}.md`
      },
      instruction: { supported: true, scopes: ALL_SCOPES, layout: "file", dir: (root) => join(root, ".cursor") },
      mcp: { supported: true, scopes: ALL_SCOPES, layout: "file", dir: (root) => join(root, ".cursor") },
      hook: {
        supported: true,
        scopes: ALL_SCOPES,
        layout: "file",
        dir: (root) => join(root, ".cursor", "hooks"),
        filename: (id) => `${id}.sh`
      },
      secret: { supported: true, scopes: ALL_SCOPES, layout: "folder", dir: (root) => join(root, ".cursor", "secrets") },
      plugin: { supported: true, scopes: ALL_SCOPES, layout: "folder", dir: (root) => join(root, ".cursor", "plugins") }
    }
  },
  codex: {
    id: "codex",
    markerPath: (root) => join(root, ".codex", "config.toml"),
    instructionPath: (root) => join(root, "AGENTS.md"),
    mcpConfigPath: (root) => join(root, ".codex", "config.toml"),
    mcpFormat: "toml",
    cliPackage: "codex",
    versionRange: ">=0.128",
    kinds: {
      skill: {
        supported: true,
        scopes: ["user"],
        layout: "folder",
        dir: (root) => join(root, ".codex", "skills")
      },
      command: {
        supported: false,
        scopes: [],
        layout: "file",
        dir: (root) => join(root, ".codex", "commands"),
        filename: (id) => `${id}.md`,
        unsupportedReason:
          "codex-cli >=0.128 has no user-defined slash commands; convert to a skill (SKILL.md with frontmatter) instead."
      },
      subagent: {
        supported: false,
        scopes: [],
        layout: "file",
        dir: (root) => join(root, ".codex", "subagents"),
        filename: (id) => `${id}.md`,
        unsupportedReason: "codex has no subagent concept; use a skill or an MCP server instead."
      },
      instruction: { supported: true, scopes: ALL_SCOPES, layout: "file", dir: (root) => root },
      mcp: { supported: true, scopes: ALL_SCOPES, layout: "file", dir: (root) => join(root, ".codex") },
      hook: {
        supported: true,
        scopes: ["user"],
        layout: "file",
        dir: (root) => join(root, ".codex", "hooks"),
        filename: (id) => `${id}.sh`,
        warning:
          "codex hooks are configured via ~/.codex/hooks.json with a custom schema; written files are not auto-registered."
      },
      secret: {
        supported: false,
        scopes: [],
        layout: "folder",
        dir: (root) => join(root, ".codex", "secrets"),
        unsupportedReason: "codex resolves secrets through environment variables only; no on-disk secret store is read."
      },
      plugin: {
        supported: true,
        scopes: ["user"],
        layout: "folder",
        dir: (root) => join(root, ".codex", "plugins"),
        warning:
          "codex plugins must be installed via `codex plugin marketplace add`; use0-kit only writes a descriptor for tracking."
      }
    }
  },
  opencode: {
    id: "opencode",
    markerPath: (root) => join(root, ".opencode"),
    instructionPath: (root) => join(root, "OPENCODE.md"),
    mcpConfigPath: (root) => join(root, ".opencode", "mcp.json"),
    mcpFormat: "json",
    cliPackage: "opencode",
    kinds: {
      skill: { supported: true, scopes: ALL_SCOPES, layout: "folder", dir: (root) => join(root, ".opencode", "skills") },
      command: {
        supported: true,
        scopes: ALL_SCOPES,
        layout: "file",
        dir: (root) => join(root, ".opencode", "commands"),
        filename: (id) => `${id}.md`
      },
      subagent: {
        supported: true,
        scopes: ALL_SCOPES,
        layout: "file",
        dir: (root) => join(root, ".opencode", "subagents"),
        filename: (id) => `${id}.md`
      },
      instruction: { supported: true, scopes: ALL_SCOPES, layout: "file", dir: (root) => root },
      mcp: { supported: true, scopes: ALL_SCOPES, layout: "file", dir: (root) => join(root, ".opencode") },
      hook: {
        supported: true,
        scopes: ALL_SCOPES,
        layout: "file",
        dir: (root) => join(root, ".opencode", "hooks"),
        filename: (id) => `${id}.sh`
      },
      secret: { supported: true, scopes: ALL_SCOPES, layout: "folder", dir: (root) => join(root, ".opencode", "secrets") },
      plugin: { supported: true, scopes: ALL_SCOPES, layout: "folder", dir: (root) => join(root, ".opencode", "plugins") }
    }
  }
};

const AGENT_IDS = Object.keys(AGENT_PROFILES) as AgentId[];

export function listAgentIds(): AgentId[] {
  return [...AGENT_IDS];
}

export function getAgentProfile(agentId: AgentId): AgentProfile {
  const profile = AGENT_PROFILES[agentId];
  if (!profile) {
    throw new Error(`Unknown agent: ${agentId}`);
  }
  return profile;
}

export function isKindSupported(agentId: AgentId, kind: ResourceKind): boolean {
  return getAgentProfile(agentId).kinds[kind].supported;
}

export function unsupportedReasonFor(agentId: AgentId, kind: ResourceKind): string | undefined {
  return getAgentProfile(agentId).kinds[kind].unsupportedReason;
}

/**
 * Validate that every explicit agent target supports the given resource kind.
 * `*` and `universal` targets are tolerated here — they are filtered to supported
 * agents at plan time via {@link expandSupportedTargets}. Unknown agent ids are
 * also tolerated; the doctor `unsupported-targets` check surfaces them.
 */
export function assertKindSupported(targets: ResourceTarget[], kind: ResourceKind): void {
  const offenders = targets
    .filter((target): target is AgentId => target !== "*" && target !== "universal")
    .filter((target) => target in AGENT_PROFILES)
    .filter((target) => !isKindSupported(target, kind));

  if (offenders.length === 0) {
    return;
  }

  const reasons = offenders.map((agentId) => {
    const reason = unsupportedReasonFor(agentId, kind) ?? `${agentId} does not support ${kind}`;
    return `${agentId}: ${reason}`;
  });

  throw new Error(`${kind} is not supported by target agent(s):\n  - ${reasons.join("\n  - ")}`);
}

/**
 * Expand `*`/`universal` targets to the set of agents that actually support `kind`,
 * and drop any explicit agent target that does not support it.
 */
export function expandSupportedTargets(
  targets: ResourceTarget[],
  enabledAgents: AgentId[],
  kind: ResourceKind
): AgentId[] {
  const supported = enabledAgents.filter((agentId) => isKindSupported(agentId, kind));
  if (targets.includes("*") || targets.includes("universal")) {
    return supported;
  }
  return targets.filter(
    (target): target is AgentId => supported.includes(target as AgentId)
  );
}
