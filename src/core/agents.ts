import { AGENT_PROFILES, type AgentProfile } from "./agent-profiles.js";
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

function fromProfile(profile: AgentProfile): AgentDefinition {
  return {
    id: profile.id,
    markerPath: profile.markerPath,
    skillDir: profile.kinds.skill.dir,
    commandDir: profile.kinds.command.dir,
    subagentDir: profile.kinds.subagent.dir,
    hookDir: profile.kinds.hook.dir,
    secretDir: profile.kinds.secret.dir,
    mcpConfigPath: profile.mcpConfigPath,
    instructionPath: profile.instructionPath
  };
}

export const AGENTS: Record<AgentId, AgentDefinition> = {
  "claude-code": fromProfile(AGENT_PROFILES["claude-code"]),
  cursor: fromProfile(AGENT_PROFILES.cursor),
  codex: fromProfile(AGENT_PROFILES.codex),
  opencode: fromProfile(AGENT_PROFILES.opencode)
};
