import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { AGENTS } from "./agents.js";
import type { AgentId } from "./types.js";

export function getAgentPaths(root: string): Record<
  AgentId,
  {
    markerPath: string;
    skillDir: string;
    commandDir: string;
    subagentDir: string;
    hookDir: string;
    secretDir: string;
    mcpConfigPath: string;
    instructionPath: string;
  }
> {
  return {
    "claude-code": {
      markerPath: AGENTS["claude-code"].markerPath(root),
      skillDir: AGENTS["claude-code"].skillDir(root),
      commandDir: AGENTS["claude-code"].commandDir(root),
      subagentDir: AGENTS["claude-code"].subagentDir(root),
      hookDir: AGENTS["claude-code"].hookDir(root),
      secretDir: AGENTS["claude-code"].secretDir(root),
      mcpConfigPath: AGENTS["claude-code"].mcpConfigPath(root),
      instructionPath: AGENTS["claude-code"].instructionPath(root)
    },
    cursor: {
      markerPath: AGENTS.cursor.markerPath(root),
      skillDir: AGENTS.cursor.skillDir(root),
      commandDir: AGENTS.cursor.commandDir(root),
      subagentDir: AGENTS.cursor.subagentDir(root),
      hookDir: AGENTS.cursor.hookDir(root),
      secretDir: AGENTS.cursor.secretDir(root),
      mcpConfigPath: AGENTS.cursor.mcpConfigPath(root),
      instructionPath: AGENTS.cursor.instructionPath(root)
    },
    codex: {
      markerPath: AGENTS.codex.markerPath(root),
      skillDir: AGENTS.codex.skillDir(root),
      commandDir: AGENTS.codex.commandDir(root),
      subagentDir: AGENTS.codex.subagentDir(root),
      hookDir: AGENTS.codex.hookDir(root),
      secretDir: AGENTS.codex.secretDir(root),
      mcpConfigPath: AGENTS.codex.mcpConfigPath(root),
      instructionPath: AGENTS.codex.instructionPath(root)
    },
    opencode: {
      markerPath: AGENTS.opencode.markerPath(root),
      skillDir: AGENTS.opencode.skillDir(root),
      commandDir: AGENTS.opencode.commandDir(root),
      subagentDir: AGENTS.opencode.subagentDir(root),
      hookDir: AGENTS.opencode.hookDir(root),
      secretDir: AGENTS.opencode.secretDir(root),
      mcpConfigPath: AGENTS.opencode.mcpConfigPath(root),
      instructionPath: AGENTS.opencode.instructionPath(root)
    }
  };
}

export async function detectAgents(root: string): Promise<
  Array<{ id: AgentId; detected: boolean; path: string }>
> {
  const paths = getAgentPaths(root);
  let disabled = new Set<AgentId>();

  try {
    const raw = JSON.parse(await readFile(join(root, ".use0-kit", "disabled-agents.json"), "utf8")) as {
      disabled: AgentId[];
    };
    disabled = new Set(raw.disabled);
  } catch {
    disabled = new Set<AgentId>();
  }

  return Promise.all(
    (Object.keys(paths) as AgentId[]).map(async (agentId) => {
      if (disabled.has(agentId)) {
        return { id: agentId, detected: false, path: paths[agentId].markerPath };
      }
      try {
        await access(paths[agentId].skillDir);
        return { id: agentId, detected: true, path: paths[agentId].markerPath };
      } catch {
        return { id: agentId, detected: false, path: paths[agentId].markerPath };
      }
    })
  );
}

export function listAgents(): AgentId[] {
  return Object.keys(AGENTS) as AgentId[];
}

export function getAgentCapabilities(): Record<AgentId, string[]> {
  return {
    "claude-code": ["skills", "instructions", "mcp"],
    cursor: ["skills", "instructions", "mcp"],
    codex: ["skills", "instructions", "mcp"],
    opencode: ["skills", "instructions", "mcp"]
  };
}

export async function setAgentDisabled(root: string, agentId: AgentId, disabled: boolean): Promise<void> {
  const path = join(root, ".use0-kit", "disabled-agents.json");
  let current = new Set<AgentId>();
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as { disabled: AgentId[] };
    current = new Set(raw.disabled);
  } catch {
    current = new Set<AgentId>();
  }

  if (disabled) {
    current.add(agentId);
  } else {
    current.delete(agentId);
  }

  await writeFile(path, JSON.stringify({ disabled: [...current] }, null, 2) + "\n", "utf8");
}
