import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { loadManifest } from "./manifest.js";
import { buildPlan } from "./planner.js";
import { parseSourceReference } from "./source-resolver.js";

export type EffectiveGraphEntry = {
  kind: string;
  digest: string;
  source?: string;
  resolvedUrl?: string;
  resolvedRef?: string;
  originScope?: string;
  originPack?: string;
  scopeMode?: string;
  targets?: string[];
  materialized?: Record<string, string | string[]>;
  provenance?: {
    source?: string;
    ref?: string;
    registry?: string;
    publishedAt?: string;
    digest?: string;
  };
};

export type EffectiveGraphState = Record<string, EffectiveGraphEntry>;

export type MaterializedGraphEntry = {
  kind: string;
  resourceId: string;
  path: string;
  agentId?: string;
};

export type MaterializedGraphState = {
  version: number;
  root: string;
  entries: MaterializedGraphEntry[];
};

function digest(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function appendMaterializedPath(
  materialized: Record<string, string | string[]>,
  key: string,
  path: string
) {
  const existing = materialized[key];
  if (!existing) {
    materialized[key] = path;
    return;
  }
  if (Array.isArray(existing)) {
    materialized[key] = [...existing, path];
    return;
  }
  materialized[key] = [existing, path];
}

function groupMaterializedEntries(entries: MaterializedGraphEntry[]): Record<string, Record<string, string | string[]>> {
  const grouped: Record<string, Record<string, string | string[]>> = {};
  for (const entry of entries) {
    const bucket = (grouped[entry.resourceId] ??= {});
    appendMaterializedPath(bucket, entry.agentId ?? "store", entry.path);
  }
  return grouped;
}

function resolveSourceMetadata(source?: string, provenance?: EffectiveGraphEntry["provenance"]): {
  resolvedUrl?: string;
  resolvedRef?: string;
} {
  if (!source) {
    return { resolvedRef: provenance?.ref };
  }
  try {
    const parsed = parseSourceReference(source);
    if (parsed.scheme === "git") {
      return {
        resolvedUrl: parsed.repo,
        resolvedRef: provenance?.ref ?? parsed.ref
      };
    }
    if (parsed.scheme === "url") {
      return {
        resolvedUrl: parsed.url,
        resolvedRef: provenance?.ref
      };
    }
    if (parsed.scheme === "well-known") {
      return {
        resolvedUrl: `${parsed.base}/.well-known/agent-skills`,
        resolvedRef: provenance?.ref
      };
    }
    if (parsed.scheme === "path") {
      return {
        resolvedUrl: parsed.path,
        resolvedRef: provenance?.ref
      };
    }
  } catch {
    // Not every source-like field is a formal source ref, e.g. stdio commands.
  }
  return { resolvedRef: provenance?.ref };
}

async function digestWithOptionalSource(value: unknown, source?: string): Promise<string> {
  if (source?.startsWith("path:")) {
    try {
      const sourcePath = source.slice("path:".length);
      const sourceStat = await stat(sourcePath);
      let body: string;
      if (sourceStat.isDirectory()) {
        const entries = await readdir(sourcePath);
        const primaryFile = entries.includes("SKILL.md")
          ? "SKILL.md"
          : entries.includes("README.md")
            ? "README.md"
            : entries[0];
        body = primaryFile ? await readFile(join(sourcePath, primaryFile), "utf8") : "";
      } else {
        body = await readFile(sourcePath, "utf8");
      }
      return digest(JSON.stringify({ value, body }));
    } catch {
      return digest(JSON.stringify({ value, body: null }));
    }
  }
  return digest(JSON.stringify(value));
}

export async function collectEffectiveGraph(root: string): Promise<EffectiveGraphState> {
  const manifest = await loadManifest(root);
  let materialized: Record<string, Record<string, string | string[]>> = {};
  try {
    materialized = groupMaterializedEntries((await loadMaterializedGraph(root)).entries);
  } catch {
    materialized = {};
  }
  const resources: EffectiveGraphState = {};

  for (const skill of manifest.skills) {
    const metadata = resolveSourceMetadata(skill.source, skill.provenance);
    resources[`skill:${skill.id}`] = {
      kind: "skill",
      digest: await digestWithOptionalSource(skill, skill.source),
      source: skill.source,
      resolvedUrl: metadata.resolvedUrl,
      resolvedRef: metadata.resolvedRef,
      originScope: skill.originScope,
      originPack: skill.originPack,
      scopeMode: skill.syncMode,
      targets: skill.targets,
      materialized: materialized[`skill:${skill.id}`],
      provenance: skill.provenance
    };
  }
  for (const mcp of manifest.mcps) {
    const metadata = resolveSourceMetadata(mcp.url, mcp.provenance);
    resources[`mcp:${mcp.id}`] = {
      kind: "mcp",
      digest: await digestWithOptionalSource(mcp),
      source: mcp.command ?? mcp.url,
      resolvedUrl: metadata.resolvedUrl,
      resolvedRef: metadata.resolvedRef,
      targets: mcp.targets,
      materialized: materialized[`mcp:${mcp.id}`],
      provenance: mcp.provenance
    };
  }
  for (const instruction of manifest.instructions) {
    const metadata = resolveSourceMetadata(instruction.source, instruction.provenance);
    resources[`instruction:${instruction.id}`] = {
      kind: "instruction",
      digest: await digestWithOptionalSource(instruction, instruction.source),
      source: instruction.source,
      resolvedUrl: metadata.resolvedUrl,
      resolvedRef: metadata.resolvedRef,
      originScope: instruction.originScope,
      originPack: instruction.originPack,
      scopeMode: instruction.syncMode,
      targets: instruction.targets,
      materialized: materialized[`instruction:${instruction.id}`],
      provenance: instruction.provenance
    };
  }
  for (const command of manifest.commands) {
    const metadata = resolveSourceMetadata(command.source, command.provenance);
    resources[`command:${command.id}`] = {
      kind: "command",
      digest: await digestWithOptionalSource(command, command.source),
      source: command.source,
      resolvedUrl: metadata.resolvedUrl,
      resolvedRef: metadata.resolvedRef,
      originScope: command.originScope,
      originPack: command.originPack,
      scopeMode: command.syncMode,
      targets: command.targets,
      materialized: materialized[`command:${command.id}`],
      provenance: command.provenance
    };
  }
  for (const subagent of manifest.subagents) {
    const metadata = resolveSourceMetadata(subagent.source, subagent.provenance);
    resources[`subagent:${subagent.id}`] = {
      kind: "subagent",
      digest: await digestWithOptionalSource(subagent, subagent.source),
      source: subagent.source,
      resolvedUrl: metadata.resolvedUrl,
      resolvedRef: metadata.resolvedRef,
      originScope: subagent.originScope,
      originPack: subagent.originPack,
      scopeMode: subagent.syncMode,
      targets: subagent.targets,
      materialized: materialized[`subagent:${subagent.id}`],
      provenance: subagent.provenance
    };
  }
  for (const hook of manifest.hooks) {
    const metadata = resolveSourceMetadata(hook.source, hook.provenance);
    resources[`hook:${hook.id}`] = {
      kind: "hook",
      digest: await digestWithOptionalSource(hook, hook.source),
      source: hook.source,
      resolvedUrl: metadata.resolvedUrl,
      resolvedRef: metadata.resolvedRef,
      originScope: hook.originScope,
      originPack: hook.originPack,
      scopeMode: hook.syncMode,
      targets: hook.targets,
      materialized: materialized[`hook:${hook.id}`],
      provenance: hook.provenance
    };
  }
  for (const pack of manifest.packs) {
    const metadata = resolveSourceMetadata(pack.provenance?.source, pack.provenance);
    resources[`pack:${pack.id}`] = {
      kind: "pack",
      digest: await digestWithOptionalSource(pack),
      source: pack.name,
      resolvedUrl: metadata.resolvedUrl,
      resolvedRef: metadata.resolvedRef,
      originScope: pack.originScope,
      originPack: pack.originPack,
      scopeMode: pack.syncMode,
      targets: [],
      materialized: materialized[`pack:${pack.id}`],
      provenance: pack.provenance
    };
  }
  for (const secret of manifest.secrets) {
    const metadata = resolveSourceMetadata(secret.provenance?.source, secret.provenance);
    resources[`secret:${secret.id}`] = {
      kind: "secret",
      digest: await digestWithOptionalSource(secret),
      source: secret.env,
      resolvedUrl: metadata.resolvedUrl,
      resolvedRef: metadata.resolvedRef,
      targets: secret.targets,
      materialized: materialized[`secret:${secret.id}`],
      provenance: secret.provenance
    };
  }
  for (const plugin of manifest.plugins) {
    const metadata = resolveSourceMetadata(plugin.source, plugin.provenance);
    resources[`plugin:${plugin.id}`] = {
      kind: "plugin",
      digest: await digestWithOptionalSource(plugin, plugin.source),
      source: plugin.source,
      resolvedUrl: metadata.resolvedUrl,
      resolvedRef: metadata.resolvedRef,
      originScope: plugin.originScope,
      originPack: plugin.originPack,
      scopeMode: plugin.syncMode,
      targets: plugin.targets,
      materialized: materialized[`plugin:${plugin.id}`],
      provenance: plugin.provenance
    };
  }

  return resources;
}

export async function collectMaterializedGraph(root: string): Promise<MaterializedGraphState> {
  const manifest = await loadManifest(root);
  const plan = await buildPlan({ root, manifest });
  return {
    version: 1,
    root,
    entries: plan.actions.map((action) => ({
      kind: action.kind,
      resourceId: action.resourceId,
      path:
        "storePath" in action
          ? action.storePath
          : "destinationPath" in action
            ? action.destinationPath
            : "",
      ...( "agentId" in action && action.agentId ? { agentId: action.agentId } : {})
    }))
  };
}

export async function loadMaterializedGraph(root: string): Promise<MaterializedGraphState> {
  return JSON.parse(await readFile(join(root, ".use0-kit", "materialized.json"), "utf8")) as MaterializedGraphState;
}

export function normalizeMaterializedEntry(entry: MaterializedGraphEntry): string {
  return JSON.stringify({
    kind: entry.kind,
    resourceId: entry.resourceId,
    path: entry.path,
    agentId: entry.agentId ?? null
  });
}
