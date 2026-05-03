import { lstat, readdir, readFile, realpath } from "node:fs/promises";

import { AGENTS } from "./agents.js";
import { loadManifest, saveManifest } from "./manifest.js";
import type { AgentId, ResourceTarget } from "./types.js";

type AdoptKind = "skill" | "mcp" | "instruction";
export type AdoptAction = "import" | "ignore" | "leave-external";

export type AdoptCandidate = {
  kind: AdoptKind;
  selector: string;
  agent: AgentId;
  source: string;
  targets: ResourceTarget[];
};

function parseKinds(raw?: string): AdoptKind[] {
  const kinds = (raw ?? "skill,mcp,instruction")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as AdoptKind[];
  return kinds.length === 0 ? ["skill", "mcp", "instruction"] : kinds;
}

async function listSkillCandidates(root: string, agent: AgentId): Promise<AdoptCandidate[]> {
  const skillDir = AGENTS[agent].skillDir(root);
  const entries = await readdir(skillDir, { withFileTypes: true }).catch(() => []);
  const adopted: AdoptCandidate[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }
    const candidatePath = `${skillDir}/${entry.name}`;
    const resolvedPath = await realpath(candidatePath).catch(() => candidatePath);
    const stat = await lstat(resolvedPath).catch(() => null);
    if (!stat?.isDirectory()) {
      continue;
    }
    const childEntries = await readdir(resolvedPath).catch((): string[] => []);
    if (!childEntries.includes("SKILL.md")) {
      continue;
    }
    adopted.push({
      kind: "skill",
      selector: `skill:${entry.name}`,
      agent,
      source: `path:${resolvedPath}`,
      targets: [agent]
    });
  }

  return adopted;
}

async function listInstructionCandidates(root: string, agent: AgentId): Promise<AdoptCandidate[]> {
  const instructionPath = AGENTS[agent].instructionPath(root);
  const body = await readFile(instructionPath, "utf8").catch(() => "");
  if (!body.trim()) {
    return [];
  }
  return [
    {
      kind: "instruction",
      selector: `instruction:${agent}-guidance`,
      agent,
      source: instructionPath,
      targets: [agent]
    }
  ];
}

async function listJsonMcpCandidates(root: string, agent: AgentId): Promise<AdoptCandidate[]> {
  const path = AGENTS[agent].mcpConfigPath(root);
  const raw = await readFile(path, "utf8").catch(() => "");
  if (!raw.trim()) {
    return [];
  }
  const parsed = JSON.parse(raw) as {
    mcpServers?: Record<string, { url?: string; command?: string }>;
  };
  return Object.keys(parsed.mcpServers ?? {}).map((id) => ({
    kind: "mcp",
    selector: `mcp:${id}`,
    agent,
    source: path,
    targets: [agent]
  }));
}

async function listCodexMcpCandidates(root: string): Promise<AdoptCandidate[]> {
  const path = AGENTS.codex.mcpConfigPath(root);
  const raw = await readFile(path, "utf8").catch(() => "");
  if (!raw.trim()) {
    return [];
  }
  const adopted: AdoptCandidate[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const sectionMatch = line.match(/^\[mcp_servers\.(.+)\]$/);
    if (!sectionMatch) continue;
    adopted.push({
      kind: "mcp",
      selector: `mcp:${sectionMatch[1]}`,
      agent: "codex",
      source: path,
      targets: ["codex"]
    });
  }
  return adopted;
}

async function adoptJsonMcp(root: string, agent: AgentId) {
  const path = AGENTS[agent].mcpConfigPath(root);
  const raw = await readFile(path, "utf8").catch(() => "");
  if (!raw.trim()) {
    return [];
  }
  const parsed = JSON.parse(raw) as {
    mcpServers?: Record<
      string,
      { command?: string; args?: string[]; url?: string; transport?: "stdio" | "http"; env?: string[] }
    >;
  };
  return Object.entries(parsed.mcpServers ?? {}).map(([id, server]) => ({
    id,
    command: server.command,
    args: server.args,
    url: server.url,
    transport: server.transport ?? (server.url ? "http" : "stdio"),
    env: server.env,
    targets: [agent] as ResourceTarget[]
  }));
}

async function adoptCodexMcp(root: string) {
  const raw = await readFile(AGENTS.codex.mcpConfigPath(root), "utf8").catch(() => "");
  if (!raw.trim()) {
    return [];
  }

  const lines = raw.split(/\r?\n/);
  const adopted: Array<{
    id: string;
    command?: string;
    args?: string[];
    url?: string;
    transport?: "stdio" | "http";
    env?: string[];
    targets: ResourceTarget[];
  }> = [];
  let currentId: string | null = null;
  let command: string | undefined;
  let args: string[] | undefined;
  let url: string | undefined;
  let transport: "stdio" | "http" | undefined;
  let env: string[] | undefined;

  function flush() {
    if (!currentId) return;
    adopted.push({
      id: currentId,
      command,
      args,
      url,
      transport: transport ?? (url ? "http" : "stdio"),
      env,
      targets: ["codex"]
    });
  }

  for (const line of lines) {
    const sectionMatch = line.match(/^\[mcp_servers\.(.+)\]$/);
    if (sectionMatch) {
      flush();
      currentId = sectionMatch[1];
      command = undefined;
      args = undefined;
      url = undefined;
      transport = undefined;
      env = undefined;
      continue;
    }
    const commandMatch = line.match(/^command = "(.+)"$/);
    if (commandMatch) {
      command = commandMatch[1];
      continue;
    }
    const urlMatch = line.match(/^url = "(.+)"$/);
    if (urlMatch) {
      url = urlMatch[1];
      continue;
    }
    const transportMatch = line.match(/^transport = "(.+)"$/);
    if (transportMatch) {
      transport = transportMatch[1] as "stdio" | "http";
      continue;
    }
    const argsMatch = line.match(/^args = \[(.+)\]$/);
    if (argsMatch) {
      args = argsMatch[1]
        .split(",")
        .map((part) => part.trim().replace(/^"/, "").replace(/"$/, ""))
        .filter(Boolean);
      continue;
    }
    const envMatch = line.match(/^env = \[(.+)\]$/);
    if (envMatch) {
      env = envMatch[1]
        .split(",")
        .map((part) => part.trim().replace(/^"/, "").replace(/"$/, ""))
        .filter(Boolean);
    }
  }

  flush();
  return adopted;
}

async function adoptMcps(root: string, agent: AgentId) {
  if (agent === "codex") {
    return adoptCodexMcp(root);
  }
  return adoptJsonMcp(root, agent);
}

function withExternalProvenance<T extends object & { provenance?: { source?: string } }>(
  value: T,
  action: AdoptAction,
  agent: AgentId
): T {
  if (action !== "leave-external") {
    return value;
  }
  return {
    ...value,
    provenance: {
      ...value.provenance,
      source: `external:${agent}`
    }
  };
}

export async function previewAdoptExisting(
  root: string,
  options?: { kind?: string; agent?: AgentId }
): Promise<AdoptCandidate[]> {
  const agents = options?.agent ? [options.agent] : (Object.keys(AGENTS) as AgentId[]);
  const kinds = parseKinds(options?.kind);
  const candidates: AdoptCandidate[] = [];

  for (const agent of agents) {
    if (kinds.includes("skill")) {
      candidates.push(...(await listSkillCandidates(root, agent)));
    }
    if (kinds.includes("mcp")) {
      candidates.push(...(agent === "codex" ? await listCodexMcpCandidates(root) : await listJsonMcpCandidates(root, agent)));
    }
    if (kinds.includes("instruction")) {
      candidates.push(...(await listInstructionCandidates(root, agent)));
    }
  }

  return candidates;
}

export async function adoptExisting(
  root: string,
  options?: { kind?: string; agent?: AgentId; action?: AdoptAction }
): Promise<number> {
  const action = options?.action ?? "import";
  if (action === "ignore") {
    return 0;
  }
  const manifest = await loadManifest(root);
  const agents = options?.agent ? [options.agent] : (Object.keys(AGENTS) as AgentId[]);
  const kinds = parseKinds(options?.kind);
  let adopted = 0;

  for (const agent of agents) {
    if (kinds.includes("skill")) {
      for (const skill of await listSkillCandidates(root, agent).catch(() => [])) {
        manifest.skills = manifest.skills.filter((item) => item.id !== skill.selector.slice("skill:".length));
        manifest.skills.push(
          withExternalProvenance(
            {
              id: skill.selector.slice("skill:".length),
              source: skill.source,
              targets: skill.targets
            },
            action,
            agent
          )
        );
        adopted += 1;
      }
    }

    if (kinds.includes("mcp")) {
      for (const mcp of await adoptMcps(root, agent).catch(() => [])) {
        manifest.mcps = manifest.mcps.filter((item) => item.id !== mcp.id);
        manifest.mcps.push(withExternalProvenance(mcp, action, agent));
        adopted += 1;
      }
    }

    if (kinds.includes("instruction")) {
      for (const instruction of await listInstructionCandidates(root, agent).catch(() => [])) {
        manifest.instructions = manifest.instructions.filter(
          (item) => item.id !== instruction.selector.slice("instruction:".length)
        );
        manifest.instructions.push(
          withExternalProvenance(
            {
              id: instruction.selector.slice("instruction:".length),
              heading: `${agent} guidance`,
              body: await readFile(instruction.source, "utf8"),
              placement: "section",
              targets: instruction.targets
            },
            action,
            agent
          )
        );
        adopted += 1;
      }
    }
  }

  await saveManifest(root, manifest);
  return adopted;
}
