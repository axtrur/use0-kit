import { join } from "node:path";

import type { AgentId } from "./types.js";

export interface AgentDefinition {
  id: AgentId;
  markerPath(root: string): string;
  skillDir(root: string): string;
  commandDir(root: string): string;
  subagentDir(root: string): string;
  hookDir(root: string): string;
  secretDir(root: string): string;
  mcpConfigPath(root: string): string;
  instructionPath(root: string): string;
}

export const AGENTS: Record<AgentId, AgentDefinition> = {
  "claude-code": {
    id: "claude-code",
    markerPath: (root) => join(root, ".claude"),
    skillDir: (root) => join(root, ".claude", "skills"),
    commandDir: (root) => join(root, ".claude", "commands"),
    subagentDir: (root) => join(root, ".claude", "subagents"),
    hookDir: (root) => join(root, ".claude", "hooks"),
    secretDir: (root) => join(root, ".claude", "secrets"),
    mcpConfigPath: (root) => join(root, ".claude", "mcp.json"),
    instructionPath: (root) => join(root, "CLAUDE.md")
  },
  cursor: {
    id: "cursor",
    markerPath: (root) => join(root, ".cursor"),
    skillDir: (root) => join(root, ".cursor", "skills"),
    commandDir: (root) => join(root, ".cursor", "commands"),
    subagentDir: (root) => join(root, ".cursor", "subagents"),
    hookDir: (root) => join(root, ".cursor", "hooks"),
    secretDir: (root) => join(root, ".cursor", "secrets"),
    mcpConfigPath: (root) => join(root, ".cursor", "mcp.json"),
    instructionPath: (root) => join(root, ".cursor", "AGENTS.md")
  },
  codex: {
    id: "codex",
    markerPath: (root) => join(root, ".codex", "config.toml"),
    skillDir: (root) => join(root, ".codex", "skills"),
    commandDir: (root) => join(root, ".codex", "commands"),
    subagentDir: (root) => join(root, ".codex", "subagents"),
    hookDir: (root) => join(root, ".codex", "hooks"),
    secretDir: (root) => join(root, ".codex", "secrets"),
    mcpConfigPath: (root) => join(root, ".codex", "config.toml"),
    instructionPath: (root) => join(root, "AGENTS.md")
  },
  opencode: {
    id: "opencode",
    markerPath: (root) => join(root, ".opencode"),
    skillDir: (root) => join(root, ".opencode", "skills"),
    commandDir: (root) => join(root, ".opencode", "commands"),
    subagentDir: (root) => join(root, ".opencode", "subagents"),
    hookDir: (root) => join(root, ".opencode", "hooks"),
    secretDir: (root) => join(root, ".opencode", "secrets"),
    mcpConfigPath: (root) => join(root, ".opencode", "mcp.json"),
    instructionPath: (root) => join(root, "OPENCODE.md")
  }
};
