import type {
  CommandResource,
  HookResource,
  InstructionResource,
  Manifest,
  McpResource,
  PackResource,
  PluginResource,
  ProfileResource,
  SecretResource,
  SkillResource,
  SubagentResource
} from "./types.js";

export type SelectorResource =
  | SkillResource
  | McpResource
  | InstructionResource
  | CommandResource
  | SubagentResource
  | HookResource
  | PackResource
  | ProfileResource
  | SecretResource
  | PluginResource;

export function listSelectors(manifest: Manifest): string[] {
  return [
    ...manifest.skills.map((item) => `skill:${item.id}`),
    ...manifest.mcps.map((item) => `mcp:${item.id}`),
    ...manifest.instructions.map((item) => `instruction:${item.id}`),
    ...manifest.commands.map((item) => `command:${item.id}`),
    ...manifest.subagents.map((item) => `subagent:${item.id}`),
    ...manifest.hooks.map((item) => `hook:${item.id}`),
    ...manifest.packs.map((item) => `pack:${item.id}`),
    ...manifest.profiles.map((item) => `profile:${item.id}`),
    ...manifest.secrets.map((item) => `secret:${item.id}`),
    ...manifest.plugins.map((item) => `plugin:${item.id}`)
  ];
}

export function findBySelector(manifest: Manifest, selector: string): SelectorResource | undefined {
  const [kind, id] = selector.split(":");
  if (kind === "skill") return manifest.skills.find((item) => item.id === id);
  if (kind === "mcp") return manifest.mcps.find((item) => item.id === id);
  if (kind === "instruction") return manifest.instructions.find((item) => item.id === id);
  if (kind === "command") return manifest.commands.find((item) => item.id === id);
  if (kind === "subagent") return manifest.subagents.find((item) => item.id === id);
  if (kind === "hook") return manifest.hooks.find((item) => item.id === id);
  if (kind === "pack") return manifest.packs.find((item) => item.id === id);
  if (kind === "profile") return manifest.profiles.find((item) => item.id === id);
  if (kind === "secret") return manifest.secrets.find((item) => item.id === id);
  if (kind === "plugin") return manifest.plugins.find((item) => item.id === id);
  return undefined;
}

export function expandSelectors(manifest: Manifest, selectors: string[]): string[] {
  const visited = new Set<string>();
  const expanded: string[] = [];

  function visit(selector: string): void {
    if (visited.has(selector)) {
      return;
    }
    visited.add(selector);
    expanded.push(selector);

    const [kind] = selector.split(":");
    const resource = findBySelector(manifest, selector);
    if (!resource) {
      return;
    }
    if (kind === "pack") {
      for (const child of (resource as PackResource).resources) {
        visit(child);
      }
    }
    if (kind === "profile") {
      for (const child of (resource as ProfileResource).exports) {
        visit(child);
      }
    }
  }

  for (const selector of selectors) {
    visit(selector);
  }
  return expanded;
}

export function applySelectorToManifest(target: Manifest, selector: string, resource: SelectorResource): boolean {
  const [kind, id] = selector.split(":");

  if (kind === "skill") {
    target.skills = target.skills.filter((item) => item.id !== id);
    target.skills.push(resource as SkillResource);
    return true;
  }
  if (kind === "mcp") {
    target.mcps = target.mcps.filter((item) => item.id !== id);
    target.mcps.push(resource as McpResource);
    return true;
  }
  if (kind === "instruction") {
    target.instructions = target.instructions.filter((item) => item.id !== id);
    target.instructions.push(resource as InstructionResource);
    return true;
  }
  if (kind === "command") {
    target.commands = target.commands.filter((item) => item.id !== id);
    target.commands.push(resource as CommandResource);
    return true;
  }
  if (kind === "subagent") {
    target.subagents = target.subagents.filter((item) => item.id !== id);
    target.subagents.push(resource as SubagentResource);
    return true;
  }
  if (kind === "hook") {
    target.hooks = target.hooks.filter((item) => item.id !== id);
    target.hooks.push(resource as HookResource);
    return true;
  }
  if (kind === "pack") {
    target.packs = target.packs.filter((item) => item.id !== id);
    target.packs.push(resource as PackResource);
    return true;
  }
  if (kind === "profile") {
    target.profiles = target.profiles.filter((item) => item.id !== id);
    target.profiles.push(resource as ProfileResource);
    return true;
  }
  if (kind === "secret") {
    target.secrets = target.secrets.filter((item) => item.id !== id);
    target.secrets.push(resource as SecretResource);
    return true;
  }
  if (kind === "plugin") {
    target.plugins = target.plugins.filter((item) => item.id !== id);
    target.plugins.push(resource as PluginResource);
    return true;
  }
  return false;
}

export function summarizeSelectorResource(selector: string, resource: SelectorResource): string {
  const originSuffix =
    "originProfile" in resource && resource.originProfile
      ? ` inherited from profile ${resource.originProfile}`
      : "";
  const [kind] = selector.split(":");
  if (kind === "skill") {
    const value = resource as SkillResource;
    return `${value.source}${value.syncMode ? ` ${value.syncMode}` : ""}${originSuffix}`;
  }
  if (kind === "mcp") {
    const value = resource as McpResource;
    return `${value.command ?? value.url ?? "configured"}`;
  }
  if (kind === "instruction") {
    const value = resource as InstructionResource;
    return `${value.source}${value.syncMode ? ` ${value.syncMode}` : ""}${originSuffix}`;
  }
  if (kind === "command") {
    const value = resource as CommandResource;
    return `${value.source}${value.syncMode ? ` ${value.syncMode}` : ""}${originSuffix}`;
  }
  if (kind === "subagent") {
    const value = resource as SubagentResource;
    return `${value.source}${value.syncMode ? ` ${value.syncMode}` : ""}${originSuffix}`;
  }
  if (kind === "hook") {
    const value = resource as HookResource;
    return `${value.source}${value.syncMode ? ` ${value.syncMode}` : ""}${originSuffix}`;
  }
  if (kind === "pack") {
    const value = resource as PackResource;
    return `${value.name}@${value.version} ${value.resources.join(",")}${originSuffix}`;
  }
  if (kind === "profile") {
    const value = resource as ProfileResource;
    return `${value.name} ${value.exports.join(",")}${value.defaultTargets?.length ? ` targets=${value.defaultTargets.join(",")}` : ""}${originSuffix}`;
  }
  if (kind === "plugin") {
    const value = resource as PluginResource;
    return `${value.source}${value.syncMode ? ` ${value.syncMode}` : ""}${originSuffix}`;
  }
  const value = resource as SecretResource;
  return `${value.env}${value.required === false ? " optional" : " required"}`;
}

export function describeSelectorResource(selector: string, resource: SelectorResource): string {
  const provenanceLines = "provenance" in resource && resource.provenance
    ? [
        resource.provenance.source ? `provenance.source=${resource.provenance.source}` : "",
        resource.provenance.ref ? `ref=${resource.provenance.ref}` : "",
        resource.provenance.registry ? `provenance.registry=${resource.provenance.registry}` : "",
        resource.provenance.digest ? `provenance.digest=${resource.provenance.digest}` : ""
      ].filter(Boolean)
    : [];
  const originLines =
    "originScope" in resource
      ? [
          resource.originScope ? `origin_scope=${resource.originScope}` : "",
          "originProfile" in resource && resource.originProfile ? `origin_profile=${resource.originProfile}` : "",
          "syncMode" in resource && resource.syncMode ? `scope_mode=${resource.syncMode}` : ""
        ].filter(Boolean)
      : [];
  const [kind] = selector.split(":");
  if (kind === "skill") {
    const value = resource as SkillResource;
    return `${selector}\nsource=${value.source}\ntargets=${value.targets.join(",")}${originLines.length ? `\n${originLines.join("\n")}` : ""}${provenanceLines.length ? `\n${provenanceLines.join("\n")}` : ""}`;
  }
  if (kind === "mcp") {
    const value = resource as McpResource;
    return `${selector}\ncommand=${value.command ?? ""}\ntargets=${value.targets.join(",")}${provenanceLines.length ? `\n${provenanceLines.join("\n")}` : ""}`;
  }
  if (kind === "instruction") {
    const value = resource as InstructionResource;
    return `${selector}\nsource=${value.source}\ntargets=${value.targets.join(",")}${originLines.length ? `\n${originLines.join("\n")}` : ""}${provenanceLines.length ? `\n${provenanceLines.join("\n")}` : ""}`;
  }
  if (kind === "command") {
    const value = resource as CommandResource;
    return `${selector}\nsource=${value.source}\ntargets=${value.targets.join(",")}${originLines.length ? `\n${originLines.join("\n")}` : ""}${provenanceLines.length ? `\n${provenanceLines.join("\n")}` : ""}`;
  }
  if (kind === "subagent") {
    const value = resource as SubagentResource;
    return `${selector}\nsource=${value.source}\ntargets=${value.targets.join(",")}${originLines.length ? `\n${originLines.join("\n")}` : ""}${provenanceLines.length ? `\n${provenanceLines.join("\n")}` : ""}`;
  }
  if (kind === "hook") {
    const value = resource as HookResource;
    return `${selector}\nsource=${value.source}\ntargets=${value.targets.join(",")}${originLines.length ? `\n${originLines.join("\n")}` : ""}${provenanceLines.length ? `\n${provenanceLines.join("\n")}` : ""}`;
  }
  if (kind === "pack") {
    const value = resource as PackResource;
    return `${selector}\nname=${value.name}\nversion=${value.version}\nresources=${value.resources.join(",")}${originLines.length ? `\n${originLines.join("\n")}` : ""}${value.signature ? `\nsignature.key_id=${value.signature.keyId}\nsignature.digest=${value.signature.digest}` : ""}${provenanceLines.length ? `\n${provenanceLines.join("\n")}` : ""}`;
  }
  if (kind === "profile") {
    const value = resource as ProfileResource;
    return `${selector}\nname=${value.name}\nexports=${value.exports.join(",")}${value.defaultTargets?.length ? `\ndefault_targets=${value.defaultTargets.join(",")}` : ""}${originLines.length ? `\n${originLines.join("\n")}` : ""}${provenanceLines.length ? `\n${provenanceLines.join("\n")}` : ""}`;
  }
  if (kind === "plugin") {
    const value = resource as PluginResource;
    return `${selector}\nsource=${value.source}\ntargets=${value.targets.join(",")}${originLines.length ? `\n${originLines.join("\n")}` : ""}${provenanceLines.length ? `\n${provenanceLines.join("\n")}` : ""}`;
  }
  const value = resource as SecretResource;
  return `${selector}\nenv=${value.env}\nrequired=${value.required === false ? "false" : "true"}\ntargets=${value.targets.join(",")}${provenanceLines.length ? `\n${provenanceLines.join("\n")}` : ""}`;
}
