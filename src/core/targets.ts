import type { AgentId, ResourceTarget } from "./types.js";

export function targetMatches(targets: ResourceTarget[], agentId: AgentId): boolean {
  return targets.includes(agentId) || targets.includes("*") || targets.includes("universal");
}

export function expandTargets(targets: ResourceTarget[], enabledAgents: AgentId[]): AgentId[] {
  if (targets.includes("*") || targets.includes("universal")) {
    return enabledAgents;
  }
  return targets.filter((target): target is AgentId => enabledAgents.includes(target as AgentId));
}
