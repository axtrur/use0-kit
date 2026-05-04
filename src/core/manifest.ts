import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  AgentId,
  CommandResource,
  ExcludeRule,
  InstructionResource,
  Manifest,
  McpResource,
  MaterializationMode,
  PackResource,
  PolicyConfig,
  ResourceTarget,
  SecretResource,
  PluginResource,
  ScopeConfig,
  ScopeParent,
  ScopeName,
  SubagentResource,
  TrustConfig,
  HookResource,
  SkillResource
} from "./types.js";
import { saveState } from "./state.js";

function hasProvenanceValue(
  provenance:
    | SkillResource["provenance"]
    | InstructionResource["provenance"]
    | McpResource["provenance"]
    | CommandResource["provenance"]
    | SubagentResource["provenance"]
    | PackResource["provenance"]
    | HookResource["provenance"]
    | SecretResource["provenance"]
    | PluginResource["provenance"]
): boolean {
  if (!provenance) {
    return false;
  }
  return Object.values(provenance).some((value) => value !== undefined && value !== "");
}

const DEFAULT_MANIFEST: Manifest = {
  version: 1,
  defaultScope: "project",
  scope: {
    level: "project",
    canonicalStore: ".use0-kit/store",
    parents: []
  },
  materialization: "symlink",
  agents: ["claude-code", "cursor", "codex", "opencode"],
  skills: [],
  mcps: [],
  instructions: [],
  commands: [],
  subagents: [],
  packs: [],
  hooks: [],
  secrets: [],
  plugins: [],
  excludes: [],
  policy: {},
  trust: { allowedSources: [] }
};

function parseString(raw: string): string {
  return raw.trim().replace(/^"/, "").replace(/"$/, "");
}

function parseStringArray(raw: string): string[] {
  return raw
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map(parseString);
}

function parseScopeParents(raw: string): ScopeParent[] {
  const matches = raw.trim().match(/\{[^}]+\}/g) ?? [];
  return matches.map((entry) => {
    const parent: Partial<ScopeParent> = {};
    for (const pair of entry.replace(/^\{\s*/, "").replace(/\s*\}$/, "").split(",")) {
      const [rawKey, rawValue] = pair.split("=").map((value) => value.trim());
      if (!rawKey || !rawValue) {
        continue;
      }
      if (rawKey === "scope") parent.scope = parseString(rawValue) as ScopeName;
      if (rawKey === "selector") parent.selector = parseString(rawValue);
      if (rawKey === "mode") parent.mode = parseString(rawValue) as ScopeParent["mode"];
    }
    return {
      scope: parent.scope ?? "project",
      selector: parent.selector,
      mode: parent.mode
    };
  });
}

export function parseManifest(input: string): Manifest {
  const manifest: Manifest = structuredClone(DEFAULT_MANIFEST);
  let currentSkill: Partial<SkillResource> | null = null;
  let currentMcp: Partial<McpResource> | null = null;
  let currentInstruction: Partial<InstructionResource> | null = null;
  let currentCommand: Partial<CommandResource> | null = null;
  let currentSubagent: Partial<SubagentResource> | null = null;
  let currentPack: Partial<PackResource> | null = null;
  let currentHook: Partial<HookResource> | null = null;
  let currentSecret: Partial<SecretResource> | null = null;
  let currentPlugin: Partial<PluginResource> | null = null;
  let currentExclude: Partial<ExcludeRule> | null = null;
  let inPolicy = false;
  let inTrust = false;
  let inScope = false;
  let inAgents = false;

  const flushCurrent = (): void => {
    if (currentSkill) {
      manifest.skills.push({
        id: currentSkill.id ?? "",
        source: currentSkill.source ?? "",
        targets: (currentSkill.targets ?? []) as ResourceTarget[],
        provenance: currentSkill.provenance,
        originScope: currentSkill.originScope,
        originPack: currentSkill.originPack,
        syncMode: currentSkill.syncMode as SkillResource["syncMode"],
        pinnedDigest: currentSkill.pinnedDigest
      });
      currentSkill = null;
    }
    if (currentInstruction) {
      manifest.instructions.push({
        id: currentInstruction.id ?? "",
        source: currentInstruction.source ?? "",
        targets: (currentInstruction.targets ?? []) as ResourceTarget[],
        provenance: currentInstruction.provenance,
        originScope: currentInstruction.originScope,
        originPack: currentInstruction.originPack,
        syncMode: currentInstruction.syncMode as InstructionResource["syncMode"],
        pinnedDigest: currentInstruction.pinnedDigest
      });
      currentInstruction = null;
    }
    if (currentMcp) {
      manifest.mcps.push({
        id: currentMcp.id ?? "",
        command: currentMcp.command,
        args: currentMcp.args,
        url: currentMcp.url,
        transport: currentMcp.transport,
        enabled: currentMcp.enabled,
        env: currentMcp.env,
        targets: (currentMcp.targets ?? []) as ResourceTarget[],
        provenance: currentMcp.provenance
      });
      currentMcp = null;
    }
    if (currentCommand) {
      manifest.commands.push({
        id: currentCommand.id ?? "",
        source: currentCommand.source ?? "",
        targets: (currentCommand.targets ?? []) as ResourceTarget[],
        provenance: currentCommand.provenance,
        originScope: currentCommand.originScope,
        originPack: currentCommand.originPack,
        syncMode: currentCommand.syncMode as CommandResource["syncMode"],
        pinnedDigest: currentCommand.pinnedDigest
      });
      currentCommand = null;
    }
    if (currentSubagent) {
      manifest.subagents.push({
        id: currentSubagent.id ?? "",
        source: currentSubagent.source ?? "",
        targets: (currentSubagent.targets ?? []) as ResourceTarget[],
        provenance: currentSubagent.provenance,
        originScope: currentSubagent.originScope,
        originPack: currentSubagent.originPack,
        syncMode: currentSubagent.syncMode as SubagentResource["syncMode"],
        pinnedDigest: currentSubagent.pinnedDigest
      });
      currentSubagent = null;
    }
    if (currentPack) {
      manifest.packs.push({
        id: currentPack.id ?? "",
        name: currentPack.name ?? "",
        version: currentPack.version ?? "",
        resources: currentPack.resources ?? [],
        signature: currentPack.signature,
        provenance: currentPack.provenance,
        originScope: currentPack.originScope,
        originPack: currentPack.originPack,
        syncMode: currentPack.syncMode as PackResource["syncMode"],
        pinnedDigest: currentPack.pinnedDigest
      });
      currentPack = null;
    }
    if (currentHook) {
      manifest.hooks.push({
        id: currentHook.id ?? "",
        source: currentHook.source ?? "",
        targets: (currentHook.targets ?? []) as ResourceTarget[],
        provenance: currentHook.provenance,
        originScope: currentHook.originScope,
        originPack: currentHook.originPack,
        syncMode: currentHook.syncMode as HookResource["syncMode"],
        pinnedDigest: currentHook.pinnedDigest
      });
      currentHook = null;
    }
    if (currentSecret) {
      manifest.secrets.push({
        id: currentSecret.id ?? "",
        env: currentSecret.env ?? "",
        required: currentSecret.required,
        targets: (currentSecret.targets ?? []) as ResourceTarget[],
        provenance: currentSecret.provenance
      });
      currentSecret = null;
    }
    if (currentPlugin) {
      manifest.plugins.push({
        id: currentPlugin.id ?? "",
        source: currentPlugin.source ?? "",
        targets: (currentPlugin.targets ?? []) as ResourceTarget[],
        provenance: currentPlugin.provenance,
        originScope: currentPlugin.originScope,
        originPack: currentPlugin.originPack,
        syncMode: currentPlugin.syncMode as PluginResource["syncMode"],
        pinnedDigest: currentPlugin.pinnedDigest
      });
      currentPlugin = null;
    }
    if (currentExclude) {
      manifest.excludes.push({
        selector: currentExclude.selector ?? ""
      });
      currentExclude = null;
    }
  };

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (line === "[[skills]]") {
      flushCurrent();
      inPolicy = false;
      inTrust = false;
      inAgents = false;
      currentSkill = {};
      continue;
    }
    if (line === "[[instructions]]") {
      flushCurrent();
      inPolicy = false;
      inTrust = false;
      inAgents = false;
      currentInstruction = {};
      continue;
    }
    if (line === "[[mcp]]" || line === "[[mcps]]") {
      flushCurrent();
      inPolicy = false;
      inTrust = false;
      inAgents = false;
      currentMcp = {};
      continue;
    }
    if (line === "[[commands]]") {
      flushCurrent();
      inPolicy = false;
      inTrust = false;
      inAgents = false;
      currentCommand = {};
      continue;
    }
    if (line === "[[subagents]]") {
      flushCurrent();
      inPolicy = false;
      inTrust = false;
      inAgents = false;
      currentSubagent = {};
      continue;
    }
    if (line === "[[packs]]") {
      flushCurrent();
      inPolicy = false;
      inTrust = false;
      inAgents = false;
      currentPack = {};
      continue;
    }
    if (line === "[[hooks]]") {
      flushCurrent();
      inPolicy = false;
      inTrust = false;
      inAgents = false;
      currentHook = {};
      continue;
    }
    if (line === "[[secrets]]") {
      flushCurrent();
      inPolicy = false;
      inTrust = false;
      inAgents = false;
      currentSecret = {};
      continue;
    }
    if (line === "[[plugins]]") {
      flushCurrent();
      inPolicy = false;
      inTrust = false;
      inAgents = false;
      currentPlugin = {};
      continue;
    }
    if (line === "[[excludes]]") {
      flushCurrent();
      inPolicy = false;
      inTrust = false;
      inAgents = false;
      currentExclude = {};
      continue;
    }
    if (line === "[policy]") {
      flushCurrent();
      inPolicy = true;
      inTrust = false;
      inScope = false;
      inAgents = false;
      continue;
    }
    if (line === "[trust]") {
      flushCurrent();
      inPolicy = false;
      inTrust = true;
      inScope = false;
      inAgents = false;
      continue;
    }
    if (line === "[scope]") {
      flushCurrent();
      inPolicy = false;
      inTrust = false;
      inScope = true;
      inAgents = false;
      continue;
    }
    if (line === "[agents]") {
      flushCurrent();
      inPolicy = false;
      inTrust = false;
      inScope = false;
      inAgents = true;
      continue;
    }

    const [rawKey, ...rawValueParts] = line.split("=");
    if (!rawKey || rawValueParts.length === 0) {
      continue;
    }
    const key = rawKey.trim();
    const value = rawValueParts.join("=").trim();

    if (currentSkill) {
      if (key === "id") currentSkill.id = parseString(value);
      if (key === "source") currentSkill.source = parseString(value);
      if (key === "targets") currentSkill.targets = parseStringArray(value) as ResourceTarget[];
      if (key === "ref") {
        currentSkill.provenance ??= {};
        currentSkill.provenance.ref = parseString(value);
      }
      if (key.startsWith("provenance_")) {
        currentSkill.provenance ??= {};
        if (key === "provenance_source") currentSkill.provenance.source = parseString(value);
        if (key === "provenance_ref") currentSkill.provenance.ref = parseString(value);
        if (key === "provenance_registry") currentSkill.provenance.registry = parseString(value);
        if (key === "provenance_published_at") currentSkill.provenance.publishedAt = parseString(value);
        if (key === "provenance_digest") currentSkill.provenance.digest = parseString(value);
      }
      if (key === "origin_scope") currentSkill.originScope = parseString(value);
      if (key === "origin_pack") currentSkill.originPack = parseString(value);
      if (key === "sync_mode" || key === "scope_mode") {
        currentSkill.syncMode = parseString(value) as SkillResource["syncMode"];
      }
      if (key === "pinned_digest") currentSkill.pinnedDigest = parseString(value);
      continue;
    }

    if (currentCommand) {
      if (key === "id") currentCommand.id = parseString(value);
      if (key === "source") currentCommand.source = parseString(value);
      if (key === "targets") currentCommand.targets = parseStringArray(value) as ResourceTarget[];
      if (key === "ref") {
        currentCommand.provenance ??= {};
        currentCommand.provenance.ref = parseString(value);
      }
      if (key.startsWith("provenance_")) {
        currentCommand.provenance ??= {};
        if (key === "provenance_source") currentCommand.provenance.source = parseString(value);
        if (key === "provenance_ref") currentCommand.provenance.ref = parseString(value);
        if (key === "provenance_registry") currentCommand.provenance.registry = parseString(value);
        if (key === "provenance_published_at") currentCommand.provenance.publishedAt = parseString(value);
        if (key === "provenance_digest") currentCommand.provenance.digest = parseString(value);
      }
      if (key === "origin_scope") currentCommand.originScope = parseString(value);
      if (key === "origin_pack") currentCommand.originPack = parseString(value);
      if (key === "sync_mode" || key === "scope_mode") {
        currentCommand.syncMode = parseString(value) as CommandResource["syncMode"];
      }
      if (key === "pinned_digest") currentCommand.pinnedDigest = parseString(value);
      continue;
    }

    if (currentSubagent) {
      if (key === "id") currentSubagent.id = parseString(value);
      if (key === "source") currentSubagent.source = parseString(value);
      if (key === "targets") currentSubagent.targets = parseStringArray(value) as ResourceTarget[];
      if (key === "ref") {
        currentSubagent.provenance ??= {};
        currentSubagent.provenance.ref = parseString(value);
      }
      if (key.startsWith("provenance_")) {
        currentSubagent.provenance ??= {};
        if (key === "provenance_source") currentSubagent.provenance.source = parseString(value);
        if (key === "provenance_ref") currentSubagent.provenance.ref = parseString(value);
        if (key === "provenance_registry") currentSubagent.provenance.registry = parseString(value);
        if (key === "provenance_published_at") currentSubagent.provenance.publishedAt = parseString(value);
        if (key === "provenance_digest") currentSubagent.provenance.digest = parseString(value);
      }
      if (key === "origin_scope") currentSubagent.originScope = parseString(value);
      if (key === "origin_pack") currentSubagent.originPack = parseString(value);
      if (key === "sync_mode" || key === "scope_mode") currentSubagent.syncMode = parseString(value) as SubagentResource["syncMode"];
      if (key === "pinned_digest") currentSubagent.pinnedDigest = parseString(value);
      continue;
    }

    if (currentPack) {
      if (key === "id") currentPack.id = parseString(value);
      if (key === "name") currentPack.name = parseString(value);
      if (key === "version") currentPack.version = parseString(value);
      if (key === "resources") currentPack.resources = parseStringArray(value);
      if (key.startsWith("signature_")) {
        currentPack.signature ??= {
          algorithm: "hmac-sha256",
          keyId: "",
          digest: "",
          value: ""
        };
        if (key === "signature_algorithm") {
          currentPack.signature.algorithm = parseString(value) as "hmac-sha256";
        }
        if (key === "signature_key_id") currentPack.signature.keyId = parseString(value);
        if (key === "signature_digest") currentPack.signature.digest = parseString(value);
        if (key === "signature_value") currentPack.signature.value = parseString(value);
        if (key === "signature_signed_at") currentPack.signature.signedAt = parseString(value);
      }
      if (key === "ref") {
        currentPack.provenance ??= {};
        currentPack.provenance.ref = parseString(value);
      }
      if (key.startsWith("provenance_")) {
        currentPack.provenance ??= {};
        if (key === "provenance_source") currentPack.provenance.source = parseString(value);
        if (key === "provenance_ref") currentPack.provenance.ref = parseString(value);
        if (key === "provenance_registry") currentPack.provenance.registry = parseString(value);
        if (key === "provenance_published_at") currentPack.provenance.publishedAt = parseString(value);
        if (key === "provenance_digest") currentPack.provenance.digest = parseString(value);
      }
      if (key === "origin_scope") currentPack.originScope = parseString(value);
      if (key === "origin_pack") currentPack.originPack = parseString(value);
      if (key === "sync_mode" || key === "scope_mode") currentPack.syncMode = parseString(value) as PackResource["syncMode"];
      if (key === "pinned_digest") currentPack.pinnedDigest = parseString(value);
      continue;
    }


    if (currentHook) {
      if (key === "id") currentHook.id = parseString(value);
      if (key === "source") currentHook.source = parseString(value);
      if (key === "targets") currentHook.targets = parseStringArray(value) as ResourceTarget[];
      if (key === "ref") {
        currentHook.provenance ??= {};
        currentHook.provenance.ref = parseString(value);
      }
      if (key.startsWith("provenance_")) {
        currentHook.provenance ??= {};
        if (key === "provenance_source") currentHook.provenance.source = parseString(value);
        if (key === "provenance_ref") currentHook.provenance.ref = parseString(value);
        if (key === "provenance_registry") currentHook.provenance.registry = parseString(value);
        if (key === "provenance_published_at") currentHook.provenance.publishedAt = parseString(value);
        if (key === "provenance_digest") currentHook.provenance.digest = parseString(value);
      }
      if (key === "origin_scope") currentHook.originScope = parseString(value);
      if (key === "origin_pack") currentHook.originPack = parseString(value);
      if (key === "sync_mode" || key === "scope_mode") {
        currentHook.syncMode = parseString(value) as HookResource["syncMode"];
      }
      if (key === "pinned_digest") currentHook.pinnedDigest = parseString(value);
      continue;
    }

    if (currentExclude) {
      if (key === "selector") currentExclude.selector = parseString(value);
      continue;
    }

    if (currentSecret) {
      if (key === "id") currentSecret.id = parseString(value);
      if (key === "env") currentSecret.env = parseString(value);
      if (key === "required") currentSecret.required = value === "true";
      if (key === "targets") currentSecret.targets = parseStringArray(value) as ResourceTarget[];
      if (key.startsWith("provenance_")) {
        currentSecret.provenance ??= {};
        if (key === "provenance_source") currentSecret.provenance.source = parseString(value);
        if (key === "provenance_ref") currentSecret.provenance.ref = parseString(value);
        if (key === "provenance_registry") currentSecret.provenance.registry = parseString(value);
        if (key === "provenance_published_at") currentSecret.provenance.publishedAt = parseString(value);
        if (key === "provenance_digest") currentSecret.provenance.digest = parseString(value);
      }
      continue;
    }

    if (currentPlugin) {
      if (key === "id") currentPlugin.id = parseString(value);
      if (key === "source") currentPlugin.source = parseString(value);
      if (key === "targets") currentPlugin.targets = parseStringArray(value) as ResourceTarget[];
      if (key === "ref") {
        currentPlugin.provenance ??= {};
        currentPlugin.provenance.ref = parseString(value);
      }
      if (key.startsWith("provenance_")) {
        currentPlugin.provenance ??= {};
        if (key === "provenance_source") currentPlugin.provenance.source = parseString(value);
        if (key === "provenance_ref") currentPlugin.provenance.ref = parseString(value);
        if (key === "provenance_registry") currentPlugin.provenance.registry = parseString(value);
        if (key === "provenance_published_at") currentPlugin.provenance.publishedAt = parseString(value);
        if (key === "provenance_digest") currentPlugin.provenance.digest = parseString(value);
      }
      if (key === "origin_scope") currentPlugin.originScope = parseString(value);
      if (key === "origin_pack") currentPlugin.originPack = parseString(value);
      if (key === "sync_mode" || key === "scope_mode") currentPlugin.syncMode = parseString(value) as PluginResource["syncMode"];
      if (key === "pinned_digest") currentPlugin.pinnedDigest = parseString(value);
      continue;
    }

    if (currentMcp) {
      if (key === "id") currentMcp.id = parseString(value);
      if (key === "command") currentMcp.command = parseString(value);
      if (key === "args") currentMcp.args = parseStringArray(value);
      if (key === "url") currentMcp.url = parseString(value);
      if (key === "transport") {
        currentMcp.transport = parseString(value) as McpResource["transport"];
      }
      if (key === "enabled") currentMcp.enabled = value === "true";
      if (key === "env") currentMcp.env = parseStringArray(value);
      if (key === "targets") currentMcp.targets = parseStringArray(value) as ResourceTarget[];
      if (key.startsWith("provenance_")) {
        currentMcp.provenance ??= {};
        if (key === "provenance_source") currentMcp.provenance.source = parseString(value);
        if (key === "provenance_ref") currentMcp.provenance.ref = parseString(value);
        if (key === "provenance_registry") currentMcp.provenance.registry = parseString(value);
        if (key === "provenance_published_at") currentMcp.provenance.publishedAt = parseString(value);
        if (key === "provenance_digest") currentMcp.provenance.digest = parseString(value);
      }
      continue;
    }

    if (currentInstruction) {
      if (key === "id") currentInstruction.id = parseString(value);
      if (key === "source") currentInstruction.source = parseString(value);
      if (key === "targets") {
        currentInstruction.targets = parseStringArray(value) as ResourceTarget[];
      }
      if (key.startsWith("provenance_")) {
        currentInstruction.provenance ??= {};
        if (key === "provenance_source") currentInstruction.provenance.source = parseString(value);
        if (key === "provenance_ref") currentInstruction.provenance.ref = parseString(value);
        if (key === "provenance_registry") currentInstruction.provenance.registry = parseString(value);
        if (key === "provenance_published_at") currentInstruction.provenance.publishedAt = parseString(value);
        if (key === "provenance_digest") currentInstruction.provenance.digest = parseString(value);
      }
      if (key === "origin_scope") currentInstruction.originScope = parseString(value);
      if (key === "origin_pack") currentInstruction.originPack = parseString(value);
      if (key === "sync_mode" || key === "scope_mode") {
        currentInstruction.syncMode = parseString(value) as InstructionResource["syncMode"];
      }
      if (key === "pinned_digest") currentInstruction.pinnedDigest = parseString(value);
      continue;
    }

    if (key === "version") manifest.version = Number.parseInt(value, 10);
    if (key === "default_scope") manifest.defaultScope = parseString(value) as ScopeName;
    if (inAgents) {
      if (key === "enabled") manifest.agents = parseStringArray(value) as AgentId[];
      if (key === "materialize") manifest.materialization = parseString(value) as MaterializationMode;
    }
    if (inScope) {
      manifest.scope ??= { level: manifest.defaultScope, parents: [] };
      if (key === "id") manifest.scope.id = parseString(value);
      if (key === "level" || key === "mode") {
        manifest.scope.level = parseString(value) as ScopeName;
        manifest.scope.mode = manifest.scope.level;
        manifest.defaultScope = manifest.scope.level;
      }
      if (key === "materialize") manifest.materialization = parseString(value) as MaterializationMode;
      if (key === "canonical_store") manifest.scope.canonicalStore = parseString(value);
      if (key === "parents") manifest.scope.parents = parseScopeParents(value);
    }
    if (key === "materialization") {
      manifest.materialization = parseString(value) as MaterializationMode;
    }
    if (key === "agents") manifest.agents = parseStringArray(value) as AgentId[];
    if (inPolicy) {
      if (key === "require_pinned_refs") manifest.policy.requirePinnedRefs = value === "true";
      if (key === "allow_unpinned_git") manifest.policy.allowUnpinnedGit = value === "true";
      if (key === "allow_remote_http_skills") manifest.policy.allowRemoteHttpSkills = value === "true";
      if (key === "require_digest") manifest.policy.requireDigest = value === "true";
      if (key === "require_signed_packs") manifest.policy.requireSignedPacks = value === "true";
      if (key === "require_pack_approvals") manifest.policy.requirePackApprovals = value === "true";
      if (key === "require_lockfile") manifest.policy.requireLockfile = value === "true";
      if (key === "block_high_risk") manifest.policy.blockHighRisk = value === "true";
      if (key === "allow_untrusted_sources") {
        manifest.policy.allowUntrustedSources = value === "true";
      }
      if (key === "on_conflict") manifest.policy.onConflict = parseString(value) as PolicyConfig["onConflict"];
    }
    if (inTrust) {
      if (key === "allowed_sources") manifest.trust.allowedSources = parseStringArray(value);
      if (key === "github_orgs") manifest.trust.githubOrgs = parseStringArray(value);
      if (key === "git_domains") manifest.trust.gitDomains = parseStringArray(value);
      if (key === "allowed_signers") manifest.trust.allowedSigners = parseStringArray(value);
      if (key === "allowed_approvers") manifest.trust.allowedApprovers = parseStringArray(value);
      if (key === "allowed_approver_roles") manifest.trust.allowedApproverRoles = parseStringArray(value);
    }
  }

  flushCurrent();

  return manifest;
}

export function serializeManifest(manifest: Manifest): string {
  const lines = [
    `version = ${manifest.version}`,
    `default_scope = "${manifest.defaultScope}"`
  ];

  if (manifest.scope) {
    lines.push("", "[scope]");
    if (manifest.scope.id) lines.push(`id = "${manifest.scope.id}"`);
    lines.push(`level = "${manifest.scope.level}"`);
    lines.push(`mode = "${manifest.scope.mode ?? manifest.scope.level}"`);
    lines.push(`canonical_store = "${manifest.scope.canonicalStore ?? ".use0-kit/store"}"`);
    lines.push(
      `parents = [${
        manifest.scope.parents
          .map((parent) => {
            const parts = [`scope = "${parent.scope}"`];
            if (parent.selector) parts.push(`selector = "${parent.selector}"`);
            if (parent.mode) parts.push(`mode = "${parent.mode}"`);
            return `{ ${parts.join(", ")} }`;
          })
          .join(", ")
      }]`
    );
  }

  lines.push("", "[agents]");
  lines.push(`enabled = [${manifest.agents.map((agent) => `"${agent}"`).join(", ")}]`);
  lines.push(`materialize = "${manifest.materialization}"`);

  for (const skill of manifest.skills) {
    lines.push("", "[[skills]]");
    lines.push(`id = "${skill.id}"`);
    lines.push(`source = "${skill.source}"`);
    lines.push(`targets = [${skill.targets.map((target) => `"${target}"`).join(", ")}]`);
    if (hasProvenanceValue(skill.provenance)) {
      if (skill.provenance?.source) lines.push(`provenance_source = "${skill.provenance.source}"`);
      if (skill.provenance?.ref) lines.push(`ref = "${skill.provenance.ref}"`);
      if (skill.provenance?.registry) lines.push(`provenance_registry = "${skill.provenance.registry}"`);
      if (skill.provenance?.publishedAt) lines.push(`provenance_published_at = "${skill.provenance.publishedAt}"`);
      if (skill.provenance?.digest) lines.push(`provenance_digest = "${skill.provenance.digest}"`);
    }
    if (skill.originScope) lines.push(`origin_scope = "${skill.originScope}"`);
    if (skill.originPack) lines.push(`origin_pack = "${skill.originPack}"`);
    if (skill.syncMode) lines.push(`scope_mode = "${skill.syncMode}"`);
    if (skill.pinnedDigest) lines.push(`pinned_digest = "${skill.pinnedDigest}"`);
  }

  for (const instruction of manifest.instructions) {
    lines.push("", "[[instructions]]");
    lines.push(`id = "${instruction.id}"`);
    lines.push(`source = "${instruction.source}"`);
    lines.push(
      `targets = [${instruction.targets.map((target) => `"${target}"`).join(", ")}]`
    );
    if (hasProvenanceValue(instruction.provenance)) {
      if (instruction.provenance?.source) lines.push(`provenance_source = "${instruction.provenance.source}"`);
      if (instruction.provenance?.ref) lines.push(`provenance_ref = "${instruction.provenance.ref}"`);
      if (instruction.provenance?.registry) lines.push(`provenance_registry = "${instruction.provenance.registry}"`);
      if (instruction.provenance?.publishedAt) lines.push(`provenance_published_at = "${instruction.provenance.publishedAt}"`);
      if (instruction.provenance?.digest) lines.push(`provenance_digest = "${instruction.provenance.digest}"`);
    }
    if (instruction.originScope) lines.push(`origin_scope = "${instruction.originScope}"`);
    if (instruction.originPack) lines.push(`origin_pack = "${instruction.originPack}"`);
    if (instruction.syncMode) lines.push(`scope_mode = "${instruction.syncMode}"`);
    if (instruction.pinnedDigest) lines.push(`pinned_digest = "${instruction.pinnedDigest}"`);
  }

  for (const mcp of manifest.mcps) {
    lines.push("", "[[mcp]]");
    lines.push(`id = "${mcp.id}"`);
    if (mcp.command) lines.push(`command = "${mcp.command}"`);
    if (mcp.args) lines.push(`args = [${mcp.args.map((arg) => `"${arg}"`).join(", ")}]`);
    if (mcp.url) lines.push(`url = "${mcp.url}"`);
    if (mcp.transport) lines.push(`transport = "${mcp.transport}"`);
    if (mcp.enabled !== undefined) lines.push(`enabled = ${mcp.enabled ? "true" : "false"}`);
    if (mcp.env?.length) lines.push(`env = [${mcp.env.map((key) => `"${key}"`).join(", ")}]`);
    lines.push(`targets = [${mcp.targets.map((target) => `"${target}"`).join(", ")}]`);
    if (hasProvenanceValue(mcp.provenance)) {
      if (mcp.provenance?.source) lines.push(`provenance_source = "${mcp.provenance.source}"`);
      if (mcp.provenance?.ref) lines.push(`provenance_ref = "${mcp.provenance.ref}"`);
      if (mcp.provenance?.registry) lines.push(`provenance_registry = "${mcp.provenance.registry}"`);
      if (mcp.provenance?.publishedAt) lines.push(`provenance_published_at = "${mcp.provenance.publishedAt}"`);
      if (mcp.provenance?.digest) lines.push(`provenance_digest = "${mcp.provenance.digest}"`);
    }
  }

  for (const command of manifest.commands) {
    lines.push("", "[[commands]]");
    lines.push(`id = "${command.id}"`);
    lines.push(`source = "${command.source}"`);
    lines.push(`targets = [${command.targets.map((target) => `"${target}"`).join(", ")}]`);
    if (hasProvenanceValue(command.provenance)) {
      if (command.provenance?.source) lines.push(`provenance_source = "${command.provenance.source}"`);
      if (command.provenance?.ref) lines.push(`ref = "${command.provenance.ref}"`);
      if (command.provenance?.registry) lines.push(`provenance_registry = "${command.provenance.registry}"`);
      if (command.provenance?.publishedAt) lines.push(`provenance_published_at = "${command.provenance.publishedAt}"`);
      if (command.provenance?.digest) lines.push(`provenance_digest = "${command.provenance.digest}"`);
    }
    if (command.originScope) lines.push(`origin_scope = "${command.originScope}"`);
    if (command.originPack) lines.push(`origin_pack = "${command.originPack}"`);
    if (command.syncMode) lines.push(`scope_mode = "${command.syncMode}"`);
    if (command.pinnedDigest) lines.push(`pinned_digest = "${command.pinnedDigest}"`);
  }

  for (const subagent of manifest.subagents) {
    lines.push("", "[[subagents]]");
    lines.push(`id = "${subagent.id}"`);
    lines.push(`source = "${subagent.source}"`);
    lines.push(`targets = [${subagent.targets.map((target) => `"${target}"`).join(", ")}]`);
    if (hasProvenanceValue(subagent.provenance)) {
      if (subagent.provenance?.source) lines.push(`provenance_source = "${subagent.provenance.source}"`);
      if (subagent.provenance?.ref) lines.push(`ref = "${subagent.provenance.ref}"`);
      if (subagent.provenance?.registry) lines.push(`provenance_registry = "${subagent.provenance.registry}"`);
      if (subagent.provenance?.publishedAt) lines.push(`provenance_published_at = "${subagent.provenance.publishedAt}"`);
      if (subagent.provenance?.digest) lines.push(`provenance_digest = "${subagent.provenance.digest}"`);
    }
    if (subagent.originScope) lines.push(`origin_scope = "${subagent.originScope}"`);
    if (subagent.originPack) lines.push(`origin_pack = "${subagent.originPack}"`);
    if (subagent.syncMode) lines.push(`scope_mode = "${subagent.syncMode}"`);
    if (subagent.pinnedDigest) lines.push(`pinned_digest = "${subagent.pinnedDigest}"`);
  }

  for (const pack of manifest.packs) {
    lines.push("", "[[packs]]");
    lines.push(`id = "${pack.id}"`);
    lines.push(`name = "${pack.name}"`);
    lines.push(`version = "${pack.version}"`);
    lines.push(`resources = [${pack.resources.map((item) => `"${item}"`).join(", ")}]`);
    if (pack.signature) {
      lines.push(`signature_algorithm = "${pack.signature.algorithm}"`);
      lines.push(`signature_key_id = "${pack.signature.keyId}"`);
      lines.push(`signature_digest = "${pack.signature.digest}"`);
      lines.push(`signature_value = "${pack.signature.value}"`);
      if (pack.signature.signedAt) lines.push(`signature_signed_at = "${pack.signature.signedAt}"`);
    }
    if (hasProvenanceValue(pack.provenance)) {
      if (pack.provenance?.source) lines.push(`provenance_source = "${pack.provenance.source}"`);
      if (pack.provenance?.ref) lines.push(`ref = "${pack.provenance.ref}"`);
      if (pack.provenance?.registry) lines.push(`provenance_registry = "${pack.provenance.registry}"`);
      if (pack.provenance?.publishedAt) lines.push(`provenance_published_at = "${pack.provenance.publishedAt}"`);
      if (pack.provenance?.digest) lines.push(`provenance_digest = "${pack.provenance.digest}"`);
    }
    if (pack.originScope) lines.push(`origin_scope = "${pack.originScope}"`);
    if (pack.originPack) lines.push(`origin_pack = "${pack.originPack}"`);
    if (pack.syncMode) lines.push(`scope_mode = "${pack.syncMode}"`);
    if (pack.pinnedDigest) lines.push(`pinned_digest = "${pack.pinnedDigest}"`);
  }

  for (const hook of manifest.hooks) {
    lines.push("", "[[hooks]]");
    lines.push(`id = "${hook.id}"`);
    lines.push(`source = "${hook.source}"`);
    lines.push(`targets = [${hook.targets.map((target) => `"${target}"`).join(", ")}]`);
    if (hasProvenanceValue(hook.provenance)) {
      if (hook.provenance?.source) lines.push(`provenance_source = "${hook.provenance.source}"`);
      if (hook.provenance?.ref) lines.push(`ref = "${hook.provenance.ref}"`);
      if (hook.provenance?.registry) lines.push(`provenance_registry = "${hook.provenance.registry}"`);
      if (hook.provenance?.publishedAt) lines.push(`provenance_published_at = "${hook.provenance.publishedAt}"`);
      if (hook.provenance?.digest) lines.push(`provenance_digest = "${hook.provenance.digest}"`);
    }
    if (hook.originScope) lines.push(`origin_scope = "${hook.originScope}"`);
    if (hook.originPack) lines.push(`origin_pack = "${hook.originPack}"`);
    if (hook.syncMode) lines.push(`scope_mode = "${hook.syncMode}"`);
    if (hook.pinnedDigest) lines.push(`pinned_digest = "${hook.pinnedDigest}"`);
  }

  for (const secret of manifest.secrets) {
    lines.push("", "[[secrets]]");
    lines.push(`id = "${secret.id}"`);
    lines.push(`env = "${secret.env}"`);
    if (secret.required !== undefined) lines.push(`required = ${secret.required ? "true" : "false"}`);
    lines.push(`targets = [${secret.targets.map((target) => `"${target}"`).join(", ")}]`);
    if (hasProvenanceValue(secret.provenance)) {
      if (secret.provenance?.source) lines.push(`provenance_source = "${secret.provenance.source}"`);
      if (secret.provenance?.ref) lines.push(`provenance_ref = "${secret.provenance.ref}"`);
      if (secret.provenance?.registry) lines.push(`provenance_registry = "${secret.provenance.registry}"`);
      if (secret.provenance?.publishedAt) lines.push(`provenance_published_at = "${secret.provenance.publishedAt}"`);
      if (secret.provenance?.digest) lines.push(`provenance_digest = "${secret.provenance.digest}"`);
    }
  }

  for (const plugin of manifest.plugins) {
    lines.push("", "[[plugins]]");
    lines.push(`id = "${plugin.id}"`);
    lines.push(`source = "${plugin.source}"`);
    lines.push(`targets = [${plugin.targets.map((target) => `"${target}"`).join(", ")}]`);
    if (hasProvenanceValue(plugin.provenance)) {
      if (plugin.provenance?.source) lines.push(`provenance_source = "${plugin.provenance.source}"`);
      if (plugin.provenance?.ref) lines.push(`ref = "${plugin.provenance.ref}"`);
      if (plugin.provenance?.registry) lines.push(`provenance_registry = "${plugin.provenance.registry}"`);
      if (plugin.provenance?.publishedAt) lines.push(`provenance_published_at = "${plugin.provenance.publishedAt}"`);
      if (plugin.provenance?.digest) lines.push(`provenance_digest = "${plugin.provenance.digest}"`);
    }
    if (plugin.originScope) lines.push(`origin_scope = "${plugin.originScope}"`);
    if (plugin.originPack) lines.push(`origin_pack = "${plugin.originPack}"`);
    if (plugin.syncMode) lines.push(`scope_mode = "${plugin.syncMode}"`);
    if (plugin.pinnedDigest) lines.push(`pinned_digest = "${plugin.pinnedDigest}"`);
  }

  for (const exclude of manifest.excludes) {
    lines.push("", "[[excludes]]");
    lines.push(`selector = "${exclude.selector}"`);
  }

  if (hasPolicyValues(manifest.policy)) {
    lines.push("", "[policy]");
    if (manifest.policy.requirePinnedRefs !== undefined) {
      lines.push(`require_pinned_refs = ${manifest.policy.requirePinnedRefs ? "true" : "false"}`);
    }
    if (manifest.policy.allowUnpinnedGit !== undefined) {
      lines.push(`allow_unpinned_git = ${manifest.policy.allowUnpinnedGit ? "true" : "false"}`);
    }
    if (manifest.policy.allowRemoteHttpSkills !== undefined) {
      lines.push(
        `allow_remote_http_skills = ${manifest.policy.allowRemoteHttpSkills ? "true" : "false"}`
      );
    }
    if (manifest.policy.requireDigest !== undefined) {
      lines.push(`require_digest = ${manifest.policy.requireDigest ? "true" : "false"}`);
    }
    if (manifest.policy.requireSignedPacks !== undefined) {
      lines.push(`require_signed_packs = ${manifest.policy.requireSignedPacks ? "true" : "false"}`);
    }
    if (manifest.policy.requirePackApprovals !== undefined) {
      lines.push(`require_pack_approvals = ${manifest.policy.requirePackApprovals ? "true" : "false"}`);
    }
    if (manifest.policy.requireLockfile !== undefined) {
      lines.push(`require_lockfile = ${manifest.policy.requireLockfile ? "true" : "false"}`);
    }
    if (manifest.policy.blockHighRisk !== undefined) {
      lines.push(`block_high_risk = ${manifest.policy.blockHighRisk ? "true" : "false"}`);
    }
    if (manifest.policy.allowUntrustedSources !== undefined) {
      lines.push(
        `allow_untrusted_sources = ${manifest.policy.allowUntrustedSources ? "true" : "false"}`
      );
    }
    if (manifest.policy.onConflict) {
      lines.push(`on_conflict = "${manifest.policy.onConflict}"`);
    }
  }

  if (
    manifest.trust.allowedSources.length > 0 ||
    (manifest.trust.githubOrgs?.length ?? 0) > 0 ||
    (manifest.trust.gitDomains?.length ?? 0) > 0 ||
    (manifest.trust.allowedSigners?.length ?? 0) > 0 ||
    (manifest.trust.allowedApprovers?.length ?? 0) > 0 ||
    (manifest.trust.allowedApproverRoles?.length ?? 0) > 0
  ) {
    lines.push("", "[trust]");
    if (manifest.trust.allowedSources.length > 0) {
      lines.push(
        `allowed_sources = [${manifest.trust.allowedSources.map((item) => `"${item}"`).join(", ")}]`
      );
    }
    if ((manifest.trust.githubOrgs?.length ?? 0) > 0) {
      lines.push(`github_orgs = [${manifest.trust.githubOrgs?.map((item) => `"${item}"`).join(", ")}]`);
    }
    if ((manifest.trust.gitDomains?.length ?? 0) > 0) {
      lines.push(`git_domains = [${manifest.trust.gitDomains?.map((item) => `"${item}"`).join(", ")}]`);
    }
    if ((manifest.trust.allowedSigners?.length ?? 0) > 0) {
      lines.push(
        `allowed_signers = [${manifest.trust.allowedSigners?.map((item) => `"${item}"`).join(", ")}]`
      );
    }
    if ((manifest.trust.allowedApprovers?.length ?? 0) > 0) {
      lines.push(
        `allowed_approvers = [${manifest.trust.allowedApprovers?.map((item) => `"${item}"`).join(", ")}]`
      );
    }
    if ((manifest.trust.allowedApproverRoles?.length ?? 0) > 0) {
      lines.push(
        `allowed_approver_roles = [${manifest.trust.allowedApproverRoles?.map((item) => `"${item}"`).join(", ")}]`
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

function hasPolicyValues(policy: PolicyConfig): boolean {
  return Object.values(policy).some((value) => value !== undefined);
}

export async function loadManifest(root: string): Promise<Manifest> {
  const manifestPath = join(root, "use0-kit.toml");
  const raw = await readFile(manifestPath, "utf8");
  return parseManifest(raw);
}

export async function saveManifest(root: string, manifest: Manifest): Promise<void> {
  const manifestPath = join(root, "use0-kit.toml");
  await writeFile(manifestPath, serializeManifest(manifest), "utf8");
}

export async function ensureLockfile(root: string): Promise<void> {
  const lockPath = join(root, "use0-kit.lock.json");
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    resources: {}
  };
  await writeFile(lockPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

export async function ensureState(root: string): Promise<void> {
  await saveState(root, {
    version: 1,
    appliedAt: null,
    lastApply: null,
    backupId: null,
    backups: [],
    detectedAgents: {},
    actions: []
  });
}

export async function ensureProjectFiles(root: string): Promise<void> {
  const gitignorePath = join(root, ".gitignore");
  const recommendedEntries = [
    ".use0-kit/",
    ".claude/skills/",
    ".cursor/skills/",
    ".codex/skills/",
    ".opencode/skills/"
  ];
  let existing = "";
  try {
    existing = await readFile(gitignorePath, "utf8");
  } catch {
    existing = "";
  }
  const existingLines = new Set(
    existing
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  );
  const missing = recommendedEntries.filter((entry) => !existingLines.has(entry));
  if (missing.length > 0) {
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    const next = `${existing}${prefix}${missing.join("\n")}\n`;
    await writeFile(gitignorePath, next, "utf8");
  }
  await writeFile(join(dirname(join(root, ".use0-kit", "state.json")), ".keep"), "", "utf8");
}
