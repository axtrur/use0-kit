import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { parseSourceReference, resolveSourcePath } from "./source-resolver.js";

export type MetadataResourceKind = "skill" | "command" | "subagent";

const REQUIRED_METADATA_FIELDS = ["name", "description"] as const;
const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function normalizeMetadataValue(value: string): string {
  return value.trim().replace(/^['"]/, "").replace(/['"]$/, "").trim();
}

export function parseMetadataFrontmatter(content: string): Record<string, string> | undefined {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return undefined;
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endIndex < 0) {
    return undefined;
  }

  const metadata: Record<string, string> = {};
  for (const line of lines.slice(1, endIndex)) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) {
      continue;
    }
    metadata[match[1]] = normalizeMetadataValue(match[2]);
  }
  return metadata;
}

function nameIssues(name: string): string[] {
  if (!NAME_PATTERN.test(name) || name.includes("--")) {
    return ["invalid-name"];
  }
  return [];
}

export function metadataIssues(content: string, expectedName?: string): string[] {
  const metadata = parseMetadataFrontmatter(content);
  if (!metadata) {
    return ["missing-frontmatter"];
  }

  const issues = REQUIRED_METADATA_FIELDS
    .filter((field) => !metadata[field])
    .map((field) => `missing-${field}`);

  if (metadata.id) {
    issues.push("unsupported-id-field");
  }
  if (metadata.name) {
    issues.push(...nameIssues(metadata.name));
    if (expectedName && metadata.name !== expectedName) {
      issues.push("name-mismatch");
    }
  }
  return issues;
}

export function ensureMetadataFrontmatter(
  content: string,
  input: { name: string; description: string }
): string {
  if (parseMetadataFrontmatter(content)) {
    return content;
  }

  return [
    "---",
    `name: ${input.name}`,
    `description: ${input.description}`,
    "---",
    "",
    content.trimEnd()
  ].join("\n");
}

async function readResourceContent(root: string, kind: MetadataResourceKind, source: string): Promise<string> {
  const sourcePath = await resolveSourcePath(root, source);

  if (kind === "skill") {
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isDirectory()) {
      throw new Error("skill-source-not-directory");
    }
    return readFile(join(sourcePath, "SKILL.md"), "utf8");
  }

  const sourceStat = await stat(sourcePath);
  if (sourceStat.isDirectory()) {
    throw new Error("source-is-directory");
  }
  return readFile(sourcePath, "utf8");
}

export async function validateResourceSourceContent(
  root: string,
  input: { kind: MetadataResourceKind; source: string; expectedName?: string }
): Promise<string[]> {
  const parsed = parseSourceReference(input.source);
  if (parsed.scheme !== "path" && parsed.scheme !== "inline") {
    return [];
  }

  try {
    return metadataIssues(await readResourceContent(root, input.kind, input.source), input.expectedName);
  } catch (error) {
    return [error instanceof Error ? error.message : "unreadable-source"];
  }
}
