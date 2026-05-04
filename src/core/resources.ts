import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { loadManifest, saveManifest } from "./manifest.js";
import { parseSourceReference, resolveSourcePath } from "./source-resolver.js";
import type {
  CommandResource,
  HookResource,
  InstructionResource,
  McpResource,
  PackResource,
  PluginResource,
  SecretResource,
  SkillResource,
  SubagentResource
} from "./types.js";

type MutationOptions = {
  force?: boolean;
};

type ManagedSourceKind = "skills" | "commands" | "subagents" | "instructions" | "hooks";

export function managedSourceDir(root: string, kind: ManagedSourceKind): string {
  return join(root, ".use0-kit", "sources", kind);
}

export function managedSkillSourceDir(root: string, id: string): string {
  return join(managedSourceDir(root, "skills"), id);
}

function scopeLabel(manifest: { scope?: { level?: string }; defaultScope?: string }): string {
  return `${manifest.scope?.level ?? manifest.defaultScope ?? "project"} scope`;
}

function assertCanReplaceResource(
  manifest: { scope?: { level?: string }; defaultScope?: string },
  kind: string,
  id: string,
  existing: boolean,
  options?: MutationOptions
): void {
  if (existing && !options?.force) {
    throw new Error(`${kind}:${id} already exists in ${scopeLabel(manifest)}. Use --force to replace it.`);
  }
}

export async function assertValidSkillSource(root: string, skill: SkillResource): Promise<void> {
  const parsed = parseSourceReference(skill.source);
  if (parsed.scheme === "inline" || parsed.scheme === "url" || parsed.scheme === "well-known" || parsed.scheme === "npm") {
    throw new Error(`Skill source must be a directory with SKILL.md: ${skill.source}`);
  }
  if (parsed.scheme !== "path") {
    return;
  }

  const sourcePath = isAbsolute(parsed.path) ? parsed.path : resolve(root, parsed.path);
  let sourceStat;
  try {
    sourceStat = await stat(sourcePath);
  } catch {
    throw new Error(`Skill source must be a directory with SKILL.md: ${skill.source}`);
  }
  if (!sourceStat.isDirectory()) {
    throw new Error(`Skill source must be a directory with SKILL.md: ${skill.source}`);
  }
  try {
    await access(join(sourcePath, "SKILL.md"));
  } catch {
    throw new Error(`Skill source directory is missing SKILL.md: ${skill.source}`);
  }
}

export async function addSkill(root: string, skill: SkillResource, options?: MutationOptions): Promise<void> {
  const manifest = await loadManifest(root);
  assertCanReplaceResource(manifest, "skill", skill.id, manifest.skills.some((item) => item.id === skill.id), options);
  await assertValidSkillSource(root, skill);
  manifest.skills = manifest.skills.filter((item) => item.id !== skill.id);
  manifest.skills.push(skill);
  await saveManifest(root, manifest);
}

export async function removeSkill(root: string, skillId: string): Promise<void> {
  const manifest = await loadManifest(root);
  manifest.skills = manifest.skills.filter((item) => item.id !== skillId);
  await saveManifest(root, manifest);
}

export async function getSkill(root: string, id: string): Promise<SkillResource> {
  const manifest = await loadManifest(root);
  const skill = manifest.skills.find((item) => item.id === id);
  if (!skill) throw new Error(`Unknown skill:${id}`);
  return skill;
}

export async function addMcpServer(root: string, mcp: McpResource, options?: MutationOptions): Promise<void> {
  const manifest = await loadManifest(root);
  assertCanReplaceResource(manifest, "mcp", mcp.id, manifest.mcps.some((item) => item.id === mcp.id), options);
  manifest.mcps = manifest.mcps.filter((item) => item.id !== mcp.id);
  manifest.mcps.push(mcp);
  await saveManifest(root, manifest);
}

export async function removeMcpServer(root: string, mcpId: string): Promise<void> {
  const manifest = await loadManifest(root);
  manifest.mcps = manifest.mcps.filter((item) => item.id !== mcpId);
  await saveManifest(root, manifest);
}

export async function addInstruction(
  root: string,
  input: Omit<InstructionResource, "source"> & { body?: string; source?: string; title?: string },
  options?: MutationOptions
): Promise<void> {
  const manifest = await loadManifest(root);
  assertCanReplaceResource(
    manifest,
    "instruction",
    input.id,
    manifest.instructions.some((item) => item.id === input.id),
    options
  );
  const source =
    input.source ??
    (await writeManagedResource(root, "instructions", input.id, formatInstructionBody(input.body ?? "", input.title)));
  manifest.instructions = manifest.instructions.filter((item) => item.id !== input.id);
  manifest.instructions.push({
    id: input.id,
    source: input.source ? input.source : `path:${source}`,
    targets: input.targets,
    provenance: input.provenance,
    originScope: input.originScope,
    originPack: input.originPack,
    syncMode: input.syncMode,
    pinnedDigest: input.pinnedDigest
  });
  await saveManifest(root, manifest);
}

function formatInstructionBody(body: string, title?: string): string {
  const normalizedTitle = title?.trim();
  if (!normalizedTitle || body.trimStart().startsWith("#")) {
    return body;
  }
  return `## ${normalizedTitle}\n\n${body}`;
}

export async function getInstruction(root: string, id: string): Promise<InstructionResource> {
  const manifest = await loadManifest(root);
  const instruction = manifest.instructions.find((item) => item.id === id);
  if (!instruction) throw new Error(`Unknown instruction:${id}`);
  return instruction;
}

export async function removeInstruction(root: string, id: string): Promise<void> {
  const manifest = await loadManifest(root);
  manifest.instructions = manifest.instructions.filter((item) => item.id !== id);
  await saveManifest(root, manifest);
}

export async function addExclude(root: string, selector: string): Promise<void> {
  const manifest = await loadManifest(root);
  if (!manifest.excludes.some((item) => item.selector === selector)) {
    manifest.excludes.push({ selector });
  }
  await saveManifest(root, manifest);
}

async function writeManagedResource(
  root: string,
  kind: "commands" | "subagents" | "instructions",
  id: string,
  content: string
) {
  const dir = managedSourceDir(root, kind);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.md`);
  await writeFile(path, content, "utf8");
  return path;
}

async function writeManagedHook(root: string, id: string, content: string) {
  const dir = managedSourceDir(root, "hooks");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.sh`);
  await writeFile(path, content, "utf8");
  return path;
}

export async function addCommand(
  root: string,
  input: { id: string; content?: string; source?: string; targets: CommandResource["targets"] },
  options?: MutationOptions
): Promise<void> {
  const manifest = await loadManifest(root);
  assertCanReplaceResource(manifest, "command", input.id, manifest.commands.some((item) => item.id === input.id), options);
  const source = input.source ?? (await writeManagedResource(root, "commands", input.id, input.content ?? ""));
  manifest.commands = manifest.commands.filter((item) => item.id !== input.id);
  manifest.commands.push({ id: input.id, source: `path:${source}`, targets: input.targets });
  if (input.source) {
    manifest.commands[manifest.commands.length - 1].source = input.source;
  }
  await saveManifest(root, manifest);
}

export async function addSubagent(
  root: string,
  input: { id: string; content?: string; source?: string; targets: SubagentResource["targets"] },
  options?: MutationOptions
): Promise<void> {
  const manifest = await loadManifest(root);
  assertCanReplaceResource(manifest, "subagent", input.id, manifest.subagents.some((item) => item.id === input.id), options);
  const source = input.source ?? (await writeManagedResource(root, "subagents", input.id, input.content ?? ""));
  manifest.subagents = manifest.subagents.filter((item) => item.id !== input.id);
  manifest.subagents.push({ id: input.id, source: `path:${source}`, targets: input.targets });
  if (input.source) {
    manifest.subagents[manifest.subagents.length - 1].source = input.source;
  }
  await saveManifest(root, manifest);
}

export async function getCommand(root: string, id: string): Promise<CommandResource> {
  const manifest = await loadManifest(root);
  const command = manifest.commands.find((item) => item.id === id);
  if (!command) throw new Error(`Unknown command:${id}`);
  return command;
}

export async function getSubagent(root: string, id: string): Promise<SubagentResource> {
  const manifest = await loadManifest(root);
  const subagent = manifest.subagents.find((item) => item.id === id);
  if (!subagent) throw new Error(`Unknown subagent:${id}`);
  return subagent;
}

export async function addHook(
  root: string,
  input: { id: string; content?: string; source?: string; targets: HookResource["targets"] },
  options?: MutationOptions
): Promise<void> {
  const manifest = await loadManifest(root);
  assertCanReplaceResource(manifest, "hook", input.id, manifest.hooks.some((item) => item.id === input.id), options);
  const source = input.source ?? (await writeManagedHook(root, input.id, input.content ?? ""));
  manifest.hooks = manifest.hooks.filter((item) => item.id !== input.id);
  manifest.hooks.push({ id: input.id, source: `path:${source}`, targets: input.targets });
  if (input.source) {
    manifest.hooks[manifest.hooks.length - 1].source = input.source;
  }
  await saveManifest(root, manifest);
}

export async function getHook(root: string, id: string): Promise<HookResource> {
  const manifest = await loadManifest(root);
  const hook = manifest.hooks.find((item) => item.id === id);
  if (!hook) throw new Error(`Unknown hook:${id}`);
  return hook;
}

export async function removeHook(root: string, id: string): Promise<void> {
  const manifest = await loadManifest(root);
  manifest.hooks = manifest.hooks.filter((item) => item.id !== id);
  await saveManifest(root, manifest);
}

export async function removeCommand(root: string, id: string): Promise<void> {
  const manifest = await loadManifest(root);
  manifest.commands = manifest.commands.filter((item) => item.id !== id);
  await saveManifest(root, manifest);
}

export async function removeSubagent(root: string, id: string): Promise<void> {
  const manifest = await loadManifest(root);
  manifest.subagents = manifest.subagents.filter((item) => item.id !== id);
  await saveManifest(root, manifest);
}

export async function getMcp(root: string, id: string): Promise<McpResource> {
  const manifest = await loadManifest(root);
  const mcp = manifest.mcps.find((item) => item.id === id);
  if (!mcp) throw new Error(`Unknown mcp:${id}`);
  return mcp;
}

export async function setMcpEnabled(root: string, id: string, enabled: boolean): Promise<void> {
  const manifest = await loadManifest(root);
  const mcp = manifest.mcps.find((item) => item.id === id);
  if (!mcp) throw new Error(`Unknown mcp:${id}`);
  mcp.enabled = enabled;
  await saveManifest(root, manifest);
}

export async function addSecret(root: string, secret: SecretResource, options?: MutationOptions): Promise<void> {
  const manifest = await loadManifest(root);
  assertCanReplaceResource(manifest, "secret", secret.id, manifest.secrets.some((item) => item.id === secret.id), options);
  manifest.secrets = manifest.secrets.filter((item) => item.id !== secret.id);
  manifest.secrets.push(secret);
  await saveManifest(root, manifest);
}

export async function addPlugin(root: string, plugin: PluginResource, options?: MutationOptions): Promise<void> {
  const manifest = await loadManifest(root);
  assertCanReplaceResource(manifest, "plugin", plugin.id, manifest.plugins.some((item) => item.id === plugin.id), options);
  manifest.plugins = manifest.plugins.filter((item) => item.id !== plugin.id);
  manifest.plugins.push(plugin);
  await saveManifest(root, manifest);
}

export async function getPlugin(root: string, id: string): Promise<PluginResource> {
  const manifest = await loadManifest(root);
  const plugin = manifest.plugins.find((item) => item.id === id);
  if (!plugin) throw new Error(`Unknown plugin:${id}`);
  return plugin;
}

export async function removePlugin(root: string, id: string): Promise<void> {
  const manifest = await loadManifest(root);
  manifest.plugins = manifest.plugins.filter((item) => item.id !== id);
  await saveManifest(root, manifest);
}

export async function initPlugin(
  root: string,
  input: { id: string; source: string; targets: PluginResource["targets"] },
  options?: MutationOptions
): Promise<void> {
  await addPlugin(root, {
    id: input.id,
    source: input.source,
    targets: input.targets
  }, options);
}

export async function getSecret(root: string, id: string): Promise<SecretResource> {
  const manifest = await loadManifest(root);
  const secret = manifest.secrets.find((item) => item.id === id);
  if (!secret) throw new Error(`Unknown secret:${id}`);
  return secret;
}

export async function removeSecret(root: string, id: string): Promise<void> {
  const manifest = await loadManifest(root);
  manifest.secrets = manifest.secrets.filter((item) => item.id !== id);
  await saveManifest(root, manifest);
}

export async function loadResourceContent(root: string, source: string): Promise<string> {
  return readFile(await resolveSourcePath(root, source), "utf8");
}

export async function initPack(
  root: string,
  input: { id: string; name: string; version: string },
  options?: MutationOptions
): Promise<void> {
  const manifest = await loadManifest(root);
  assertCanReplaceResource(manifest, "pack", input.id, manifest.packs.some((item) => item.id === input.id), options);
  manifest.packs = manifest.packs.filter((item) => item.id !== input.id);
  manifest.packs.push({ ...input, resources: [] });
  await saveManifest(root, manifest);
}

export async function addPackResource(root: string, packId: string, selector: string): Promise<void> {
  const manifest = await loadManifest(root);
  const pack = manifest.packs.find((item) => item.id === packId);
  if (!pack) throw new Error(`Unknown pack:${packId}`);
  if (!pack.resources.includes(selector)) {
    pack.resources.push(selector);
  }
  await saveManifest(root, manifest);
}

export async function getPack(root: string, packId: string): Promise<PackResource> {
  const manifest = await loadManifest(root);
  const pack = manifest.packs.find((item) => item.id === packId);
  if (!pack) throw new Error(`Unknown pack:${packId}`);
  return pack;
}

export async function listPacks(root: string): Promise<PackResource[]> {
  return (await loadManifest(root)).packs;
}

export async function removePack(root: string, packId: string): Promise<void> {
  const manifest = await loadManifest(root);
  manifest.packs = manifest.packs.filter((item) => item.id !== packId);
  await saveManifest(root, manifest);
}
