import { createHash } from "node:crypto";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { loadManifest, saveManifest } from "./manifest.js";
import { expandSelectors, findBySelector, listSelectors } from "./resource-graph.js";
import { loadResourceContent, managedSourceDir } from "./resources.js";
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

function digestResource(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function classifyByComparable(
  kind: string,
  id: string,
  changed: boolean
): string[] {
  const results: string[] = [];
  if (changed) {
    results.push(`CHANGED ${kind}:${id}`);
    results.push(`SHADOWED ${kind}:${id}`);
  }
  return results;
}

function comparableResource(selector: string, resource: unknown): unknown {
  const [kind] = selector.split(":");

  if (kind === "skill") {
    const value = resource as SkillResource;
    return { id: value.id, source: value.source, targets: value.targets };
  }
  if (kind === "mcp") {
    const value = resource as McpResource;
    return {
      id: value.id,
      command: value.command,
      args: value.args,
      url: value.url,
      transport: value.transport,
      enabled: value.enabled,
      env: value.env,
      targets: value.targets
    };
  }
  if (kind === "instruction") {
    const value = resource as InstructionResource;
    return {
      id: value.id,
      source: value.source,
      targets: value.targets
    };
  }
  if (kind === "command") {
    const value = resource as CommandResource;
    return { id: value.id, source: value.source, targets: value.targets };
  }
  if (kind === "subagent") {
    const value = resource as SubagentResource;
    return { id: value.id, source: value.source, targets: value.targets };
  }
  if (kind === "hook") {
    const value = resource as HookResource;
    return { id: value.id, source: value.source, targets: value.targets };
  }
  if (kind === "pack") {
    const value = resource as PackResource;
    return { id: value.id, name: value.name, version: value.version, resources: value.resources };
  }
  if (kind === "plugin") {
    const value = resource as PluginResource;
    return { id: value.id, source: value.source, targets: value.targets };
  }
  const value = resource as SecretResource;
  return { id: value.id, env: value.env, required: value.required, targets: value.targets };
}

function removeSelectorFromManifest(target: Awaited<ReturnType<typeof loadManifest>>, selector: string): void {
  const [kind, id] = selector.split(":");
  if (kind === "skill") target.skills = target.skills.filter((item) => item.id !== id);
  else if (kind === "mcp") target.mcps = target.mcps.filter((item) => item.id !== id);
  else if (kind === "instruction") target.instructions = target.instructions.filter((item) => item.id !== id);
  else if (kind === "command") target.commands = target.commands.filter((item) => item.id !== id);
  else if (kind === "hook") target.hooks = target.hooks.filter((item) => item.id !== id);
  else if (kind === "subagent") target.subagents = target.subagents.filter((item) => item.id !== id);
  else if (kind === "pack") target.packs = target.packs.filter((item) => item.id !== id);
  else if (kind === "secret") target.secrets = target.secrets.filter((item) => item.id !== id);
  else if (kind === "plugin") target.plugins = target.plugins.filter((item) => item.id !== id);
}

export async function diffScopesDetailed(
  fromRoot: string,
  toRoot: string,
  kinds?: string[]
): Promise<string[]> {
  const source = await loadManifest(fromRoot);
  const target = await loadManifest(toRoot);
  const diffs: string[] = [];
  const excluded = new Set(target.excludes.map((item) => item.selector));
  const include = (selector: string) => {
    if (!kinds) return true;
    const [kind] = selector.split(":");
    return kinds.includes(kind);
  };

  for (const selector of listSelectors(source)) {
    if (!include(selector)) {
      continue;
    }
    const [kind, id] = selector.split(":");
    const parent = findBySelector(source, selector);
    const child = findBySelector(target, selector);
    if (!parent) {
      continue;
    }
    if (excluded.has(selector)) {
      diffs.push(`REMOVED ${selector}`);
      continue;
    }
    if (!child) {
      diffs.push(`ADDED ${selector}`);
      continue;
    }
    const changed =
      JSON.stringify(comparableResource(selector, parent)) !==
      JSON.stringify(comparableResource(selector, child));
    if (!changed) {
      continue;
    }
    diffs.push(...classifyByComparable(kind, id, true));
  }

  return diffs.length === 0 ? ["CLEAN"] : diffs;
}

export async function syncScopesDetailed(input: {
  fromRoot: string;
  toRoot: string;
  selector?: string;
  originPack?: string;
  mode?: "inherit" | "pin" | "copy" | "fork" | "mirror";
  prune?: boolean;
  conflict?: "fail" | "ask" | "skip" | "parent-wins" | "child-wins" | "merge";
  conflictResolver?: (
    selector: string
  ) => Promise<"skip" | "parent-wins" | "child-wins" | "merge" | "fail">;
}): Promise<number> {
  const source = await loadManifest(input.fromRoot);
  const target = await loadManifest(input.toRoot);
  const originScope = source.scope?.level ?? source.defaultScope;
  const originPack = input.originPack ?? (input.selector?.startsWith("pack:") ? input.selector.slice("pack:".length) : undefined);
  const mode = input.mode ?? "inherit";
  const conflict = input.conflict ?? "fail";
  const selector = input.selector;
  const expandedSelectors = new Set(selector ? expandSelectors(source, [selector]) : []);
  const matchesSelector = (value: string) =>
    !selector || expandedSelectors.has(value);
  const selectedPacks = source.packs.filter((pack) => matchesSelector(`pack:${pack.id}`));
  const selectedSkills = source.skills.filter(
    (skill) => matchesSelector(`skill:${skill.id}`)
  );
  const selectedMcps = source.mcps.filter((mcp) => matchesSelector(`mcp:${mcp.id}`));
  const selectedInstructions = source.instructions.filter(
    (instruction) => matchesSelector(`instruction:${instruction.id}`)
  );
  const selectedCommands = source.commands.filter(
    (command) => matchesSelector(`command:${command.id}`)
  );
  const selectedHooks = source.hooks.filter((hook) => matchesSelector(`hook:${hook.id}`));
  const selectedSubagents = source.subagents.filter((item) =>
    matchesSelector(`subagent:${item.id}`)
  );
  const selectedSecrets = source.secrets.filter((item) => matchesSelector(`secret:${item.id}`));
  const selectedPlugins = source.plugins.filter((item) => matchesSelector(`plugin:${item.id}`));
  const resolveConflict = async (selector: string) => {
    if (conflict !== "ask") {
      return conflict;
    }
    if (!input.conflictResolver) {
      throw new Error(`Conflict on ${selector}`);
    }
    return input.conflictResolver(selector);
  };

  if (mode === "mirror" && input.prune) {
    if (selector) {
      for (const existingSelector of listSelectors(target)) {
        if (expandedSelectors.has(existingSelector)) {
          removeSelectorFromManifest(target, existingSelector);
        }
      }
    } else {
      target.skills = [];
      target.mcps = [];
      target.instructions = [];
      target.commands = [];
      target.hooks = [];
      target.subagents = [];
      target.packs = [];
      target.secrets = [];
      target.plugins = [];
    }
  }

  const resolveSkillConflict = async (skill: SkillResource): Promise<boolean> => {
    const existing = target.skills.find((item) => item.id === skill.id);
    const hasConflict =
      !!existing &&
      (existing.source !== skill.source ||
        JSON.stringify(existing.targets) !== JSON.stringify(skill.targets));
    if (!hasConflict) return true;
    const resolvedConflict = await resolveConflict(`skill:${skill.id}`);
    if (resolvedConflict === "fail") {
      throw new Error(`Conflict on skill:${skill.id}`);
    }
    if (resolvedConflict === "skip" || resolvedConflict === "child-wins") {
      return false;
    }
    return true;
  };

  for (const skill of selectedSkills) {
    if (!(await resolveSkillConflict(skill))) {
      continue;
    }
    const next: SkillResource = { ...skill, originScope, originPack, syncMode: mode };

    if (mode === "pin") {
      next.pinnedDigest = digestResource({
        id: skill.id,
        source: skill.source,
        targets: skill.targets
      });
    }

    if (mode === "fork") {
      const forkDir = join(input.toRoot, ".agents", "skills", skill.id);
      await mkdir(join(input.toRoot, ".agents", "skills"), { recursive: true });
      await cp(skill.source.replace(/^path:/, ""), forkDir, { recursive: true });
      next.source = `path:${forkDir}`;
    }

    target.skills = target.skills.filter((item) => item.id !== skill.id);
    target.skills.push(next);
  }

  for (const mcp of selectedMcps) {
    const next: McpResource = { ...mcp };
    target.mcps = target.mcps.filter((item) => item.id !== mcp.id);
    target.mcps.push(next);
  }

  for (const instruction of selectedInstructions) {
    const existing = target.instructions.find((item) => item.id === instruction.id);
    const hasConflict =
      !!existing &&
      (existing.source !== instruction.source ||
        JSON.stringify(existing.targets) !== JSON.stringify(instruction.targets));
    const resolvedConflict = hasConflict ? await resolveConflict(`instruction:${instruction.id}`) : conflict;
    if (hasConflict && resolvedConflict === "fail") {
      throw new Error(`Conflict on instruction:${instruction.id}`);
    }
    if (hasConflict && (resolvedConflict === "skip" || resolvedConflict === "child-wins")) {
      continue;
    }
    const next: InstructionResource = {
      ...instruction,
      originScope,
      originPack,
      syncMode: mode
    };
    if (mode === "pin") {
      next.pinnedDigest = digestResource({
        id: instruction.id,
        source: instruction.source,
        targets: instruction.targets
      });
    }
    if (mode === "fork") {
      const forkDir = join(input.toRoot, ".agents", "instructions");
      await mkdir(forkDir, { recursive: true });
      const forkPath = join(forkDir, `${instruction.id}.md`);
      await cp(instruction.source.replace(/^path:/, ""), forkPath);
      next.source = `path:${forkPath}`;
    }
    if (hasConflict && resolvedConflict === "merge" && existing) {
      const instructionDir = managedSourceDir(input.toRoot, "instructions");
      const mergedPath = join(instructionDir, `${instruction.id}.md`);
      const mergedContent = [
        (await loadResourceContent(input.toRoot, existing.source)).trimEnd(),
        (await loadResourceContent(input.fromRoot, instruction.source)).trim()
      ]
        .filter(Boolean)
        .join("\n");
      await mkdir(instructionDir, { recursive: true });
      await writeFile(mergedPath, `${mergedContent}\n`, "utf8");
      next.source = `path:${mergedPath}`;
    }
    target.instructions = target.instructions.filter((item) => item.id !== instruction.id);
    target.instructions.push(next);
  }

  for (const command of selectedCommands) {
    const next: CommandResource = {
      ...command,
      originScope,
      originPack,
      syncMode: mode
    };
    if (mode === "pin") {
      next.pinnedDigest = digestResource({
        id: command.id,
        source: command.source,
        targets: command.targets
      });
    }
    if (mode === "fork") {
      const forkDir = join(input.toRoot, ".agents", "commands");
      await mkdir(forkDir, { recursive: true });
      const forkPath = join(forkDir, `${command.id}.md`);
      await cp(command.source.replace(/^path:/, ""), forkPath);
      next.source = `path:${forkPath}`;
    }
    target.commands = target.commands.filter((item) => item.id !== command.id);
    target.commands.push(next);
  }

  for (const hook of selectedHooks) {
    const next: HookResource = {
      ...hook,
      originScope,
      originPack,
      syncMode: mode
    };
    if (mode === "pin") {
      next.pinnedDigest = digestResource({
        id: hook.id,
        source: hook.source,
        targets: hook.targets
      });
    }
    target.hooks = target.hooks.filter((item) => item.id !== hook.id);
    target.hooks.push(next);
  }

  for (const subagent of selectedSubagents) {
    const next = {
      ...subagent,
      originScope,
      originPack,
      syncMode: mode
    };
    if (mode === "pin") {
      next.pinnedDigest = digestResource({
        id: subagent.id,
        source: subagent.source,
        targets: subagent.targets
      });
    }
    if (mode === "fork") {
      const forkDir = join(input.toRoot, ".agents", "subagents");
      await mkdir(forkDir, { recursive: true });
      const forkPath = join(forkDir, `${subagent.id}.md`);
      await cp(subagent.source.replace(/^path:/, ""), forkPath);
      next.source = `path:${forkPath}`;
    }
    target.subagents = target.subagents.filter((item) => item.id !== subagent.id);
    target.subagents.push(next);
  }

  for (const pack of selectedPacks) {
    const next: PackResource = { ...pack, originScope, originPack, syncMode: mode };
    if (mode === "pin") {
      next.pinnedDigest = digestResource({
        id: pack.id,
        name: pack.name,
        version: pack.version,
        resources: pack.resources
      });
    }
    target.packs = target.packs.filter((item) => item.id !== pack.id);
    target.packs.push(next);
  }

  for (const secret of selectedSecrets) {
    target.secrets = target.secrets.filter((item) => item.id !== secret.id);
    target.secrets.push({ ...secret });
  }

  for (const plugin of selectedPlugins) {
    const next: PluginResource = { ...plugin, originScope, originPack, syncMode: mode };
    if (mode === "pin") {
      next.pinnedDigest = digestResource({
        id: plugin.id,
        source: plugin.source,
        targets: plugin.targets
      });
    }
    target.plugins = target.plugins.filter((item) => item.id !== plugin.id);
    target.plugins.push(next);
  }

  await saveManifest(input.toRoot, target);
  return (
    selectedSkills.length +
    selectedMcps.length +
    selectedInstructions.length +
    selectedCommands.length +
    selectedHooks.length +
    selectedSubagents.length +
    selectedPacks.length +
    selectedSecrets.length +
    selectedPlugins.length
  );
}

export async function previewSyncScopesDetailed(input: {
  fromRoot: string;
  toRoot: string;
  selector?: string;
  mode?: "inherit" | "pin" | "copy" | "fork" | "mirror";
  prune?: boolean;
  conflict?: "fail" | "ask" | "skip" | "parent-wins" | "child-wins" | "merge";
}): Promise<{
  fromRoot: string;
  toRoot: string;
  selector?: string;
  mode: "inherit" | "pin" | "copy" | "fork" | "mirror";
  prune: boolean;
  conflict: "fail" | "ask" | "skip" | "parent-wins" | "child-wins" | "merge";
  changes: Array<{ selector: string; action: "ADD" | "UPDATE" | "NOOP" | "REMOVE" }>;
}> {
  const source = await loadManifest(input.fromRoot);
  const target = await loadManifest(input.toRoot);
  const selector = input.selector;
  const mode = input.mode ?? "inherit";
  const prune = input.prune === true;
  const conflict = input.conflict ?? "fail";
  const selectedSelectors = selector ? expandSelectors(source, [selector]) : listSelectors(source);
  const changes: Array<{ selector: string; action: "ADD" | "UPDATE" | "NOOP" | "REMOVE" }> = [];

  for (const currentSelector of selectedSelectors) {
    const sourceResource = findBySelector(source, currentSelector);
    if (!sourceResource) {
      continue;
    }
    const targetResource = findBySelector(target, currentSelector);
    if (!targetResource) {
      changes.push({ selector: currentSelector, action: "ADD" });
      continue;
    }
    const changed =
      JSON.stringify(comparableResource(currentSelector, sourceResource)) !==
      JSON.stringify(comparableResource(currentSelector, targetResource));
    changes.push({ selector: currentSelector, action: changed ? "UPDATE" : "NOOP" });
  }

  if (mode === "mirror" && prune) {
    const selectedSet = new Set(selectedSelectors);
    for (const existingSelector of listSelectors(target)) {
      if (!selectedSet.has(existingSelector)) {
        changes.push({ selector: existingSelector, action: "REMOVE" });
      }
    }
  }

  return {
    fromRoot: input.fromRoot,
    toRoot: input.toRoot,
    selector,
    mode,
    prune,
    conflict,
    changes
  };
}

export async function promoteResource(input: {
  fromRoot: string;
  toRoot: string;
  selector: string;
  publishable?: boolean;
}): Promise<number> {
  const fromManifest = await loadManifest(input.fromRoot);
  const toManifest = await loadManifest(input.toRoot);
  const fromScope = fromManifest.scope?.level ?? fromManifest.defaultScope;
  const toScope = toManifest.scope?.level ?? toManifest.defaultScope;

  let mode: "inherit" | "pin" | "copy" | "fork" | "mirror" = "copy";
  if (fromScope === "project" && toScope === "global") {
    mode = "fork";
  } else if (fromScope === "project" && toScope === "user") {
    mode = "pin";
  } else if (fromScope === "user" && toScope === "global") {
    mode = "copy";
  }

  const count = await syncScopesDetailed({
    fromRoot: input.fromRoot,
    toRoot: input.toRoot,
    selector: input.selector,
    mode,
    conflict: "parent-wins"
  });
  if (input.publishable) {
    const manifest = await loadManifest(input.toRoot);
    const resource = findBySelector(manifest, input.selector);
    if (resource && "provenance" in resource) {
      resource.provenance = {
        ...resource.provenance,
        publishedAt: new Date().toISOString()
      };
      await saveManifest(input.toRoot, manifest);
    }
  }
  return count;
}
