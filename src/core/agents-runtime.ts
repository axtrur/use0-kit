import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { AGENT_PROFILES, listAgentIds, type ResourceKind } from "./agent-profiles.js";
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
  return Object.fromEntries(
    listAgentIds().map((agentId) => {
      const def = AGENTS[agentId];
      return [
        agentId,
        {
          markerPath: def.markerPath(root),
          skillDir: def.skillDir(root),
          commandDir: def.commandDir(root),
          subagentDir: def.subagentDir(root),
          hookDir: def.hookDir(root),
          secretDir: def.secretDir(root),
          mcpConfigPath: def.mcpConfigPath(root),
          instructionPath: def.instructionPath(root)
        }
      ];
    })
  ) as Record<AgentId, ReturnType<typeof getAgentPaths>[AgentId]>;
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
  return listAgentIds();
}

const ALL_KINDS: ResourceKind[] = [
  "skill",
  "command",
  "subagent",
  "instruction",
  "mcp",
  "hook",
  "secret",
  "plugin"
];

/**
 * Real per-agent capability snapshot derived from {@link AGENT_PROFILES}.
 * Returned as the list of resource kinds each agent actually supports.
 */
export function getAgentCapabilities(): Record<AgentId, ResourceKind[]> {
  return Object.fromEntries(
    listAgentIds().map((agentId) => [
      agentId,
      ALL_KINDS.filter((kind) => AGENT_PROFILES[agentId].kinds[kind].supported)
    ])
  ) as Record<AgentId, ResourceKind[]>;
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
