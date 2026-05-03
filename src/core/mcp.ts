import { join } from "node:path";

import { targetMatches } from "./targets.js";
import type { AgentId, McpResource } from "./types.js";

function renderJsonConfig(mcps: McpResource[]): string {
  const mcpServers = Object.fromEntries(
    mcps.map((mcp) => [
      mcp.id,
      {
        command: mcp.command,
        args: mcp.args ?? [],
        url: mcp.url,
        transport: mcp.transport ?? (mcp.url ? "http" : "stdio"),
        env: mcp.env ?? []
      }
    ])
  );

  return JSON.stringify({ mcpServers }, null, 2) + "\n";
}

function renderTomlConfig(mcps: McpResource[]): string {
  const sections: string[] = [];

  for (const mcp of mcps) {
    sections.push(`[mcp_servers.${mcp.id}]`);
    if (mcp.command) sections.push(`command = "${mcp.command}"`);
    if (mcp.args) sections.push(`args = [${mcp.args.map((arg) => `"${arg}"`).join(", ")}]`);
    if (mcp.url) sections.push(`url = "${mcp.url}"`);
    sections.push(`transport = "${mcp.transport ?? (mcp.url ? "http" : "stdio")}"`);
    if (mcp.env?.length) sections.push(`env = [${mcp.env.map((key) => `"${key}"`).join(", ")}]`);
    sections.push("");
  }

  return sections.join("\n").trimEnd() + "\n";
}

export function renderMcpConfig(input: {
  root: string;
  agentId: AgentId;
  mcps: McpResource[];
}): { path: string; content: string } {
  const relevant = input.mcps.filter((mcp) => targetMatches(mcp.targets, input.agentId));

  if (input.agentId === "codex") {
    return {
      path: join(input.root, ".codex", "config.toml"),
      content: renderTomlConfig(relevant)
    };
  }

  const relativePath =
    input.agentId === "claude-code"
      ? join(".claude", "mcp.json")
      : input.agentId === "cursor"
        ? join(".cursor", "mcp.json")
        : join(".opencode", "mcp.json");

  return {
    path: join(input.root, relativePath),
    content: renderJsonConfig(relevant)
  };
}
