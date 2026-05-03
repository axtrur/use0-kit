import { basename } from "node:path";

import type { AgentId } from "./types.js";

interface ParsedFrontmatter {
  fields: Array<[string, string]>;
  body: string;
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith("---\n")) {
    return { fields: [], body: content };
  }

  const endIndex = content.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return { fields: [], body: content };
  }

  const rawFields = content
    .slice(4, endIndex)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(":");
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as [string, string];
    });

  return {
    fields: rawFields,
    body: content.slice(endIndex + "\n---\n".length + 1)
  };
}

export function applyHostOverlay(content: string, agentId: AgentId): string {
  const parsed = parseFrontmatter(content);
  if (parsed.fields.length === 0) {
    return content;
  }

  const promoted: Array<[string, string]> = [];

  for (const [key, value] of parsed.fields) {
    const prefix = `agentkit/${agentId}/`;
    if (key.startsWith("agentkit/")) {
      if (key.startsWith(prefix)) {
        promoted.push([key.slice(prefix.length), value]);
      }
      continue;
    }
    promoted.push([key, value]);
  }

  const frontmatter = promoted.map(([key, value]) => `${key}: ${value}`).join("\n");
  return `---\n${frontmatter}\n---\n\n${parsed.body.trim()}\n`;
}
