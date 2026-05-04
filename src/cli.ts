#!/usr/bin/env node

import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { adoptExisting, previewAdoptExisting } from "./core/adopt.js";
import { approveSelector, listApprovals, revokeApproval } from "./core/approvals.js";
import { applyPlan } from "./core/apply.js";
import {
  detectAgents,
  getAgentCapabilities,
  getAgentPaths,
  listAgents,
  setAgentDisabled
} from "./core/agents-runtime.js";
import { auditResources, auditResourcesFiltered, shouldFailAudit } from "./core/audit.js";
import { fixDoctorIssues, runDoctor, runDoctorForSelector } from "./core/doctor.js";
import { addFleetMember, listFleetMembers, removeFleetMember } from "./core/fleet.js";
import { renderInstructions } from "./core/instructions.js";
import {
  diffState,
  diffStateView,
  explainLock,
  pruneLock,
  refreshLock,
  updateResources,
  verifyLock
} from "./core/lock.js";
import { ensureProjectFiles, loadManifest, saveManifest } from "./core/manifest.js";
import { renderMcpConfig } from "./core/mcp.js";
import { mcpTools, type McpRequest } from "./core/mcp-server.js";
import { applyHostOverlay } from "./core/overlay.js";
import { lookupSignerSecret, signerEnvVar } from "./core/pack-signatures.js";
import {
  createBackup,
  exportPack,
  importPack,
  installPack,
  listBackups,
  restoreBackup,
  signPackResource,
  verifyPackResource
} from "./core/packs.js";
import { buildPlan } from "./core/planner.js";
import { diffScopesDetailed, previewSyncScopesDetailed, promoteResource, syncScopesDetailed } from "./core/reconciliation.js";
import { enforcePolicy } from "./core/policy.js";
import {
  addRegistry,
  getRegistryInfo,
  installFromRegistry,
  listRegistries,
  publishToRegistry,
  removeRegistry,
  resolveRegistrySelector,
  searchRegistry,
  setRegistryOfflineMode,
  syncRegistry
} from "./core/registry.js";
import {
  addCommand,
  addExclude,
  addHook,
  addInstruction,
  addMcpServer,
  addPackResource,
  addPlugin,
  addSkill,
  addSubagent,
  addSecret,
  getSkill,
  getCommand,
  getHook,
  getInstruction,
  getMcp,
  getPlugin,
  getSecret,
  getSubagent,
  initPack,
  loadResourceContent,
  listPacks,
  managedSkillSourceDir,
  removeCommand,
  removeHook,
  removeInstruction,
  removeMcpServer,
  removePack,
  removePlugin,
  removeSecret,
  removeSkill,
  removeSubagent,
  setMcpEnabled
} from "./core/resources.js";
import { ensureMetadataFrontmatter } from "./core/resource-content.js";
import {
  diffScopes,
  explainResource,
  currentScope,
  explainScopedResource,
  explainScopedSnapshot,
  initScope,
  inspectScopeDetailed,
  inspectScopeSnapshot,
  listScopes,
  defaultConflictMode,
  scopePath,
  syncDeclaredParents,
  syncScopes
} from "./core/scope.js";
import { activeScopeRoots } from "./core/scope-locations.js";
import {
  parseSourceReference,
  resolveSkillSourcePath,
  resolveSourcePath,
  setSourceResolverOfflineMode
} from "./core/source-resolver.js";
import { targetMatches } from "./core/targets.js";
import { scoreSkill, validateSkill } from "./core/skills.js";
import type { AgentId, PlanAction, ResourceTarget, ScopeName } from "./core/types.js";
import type { Manifest } from "./core/types.js";
import { findBySelector, listSelectors, type SelectorResource } from "./core/resource-graph.js";

type CliContext = {
  cwd: string;
};

export type CliExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

const KNOWN_AGENT_IDS: AgentId[] = ["claude-code", "cursor", "codex", "opencode"];
const KNOWN_SCOPE_NAMES: ScopeName[] = ["global", "user", "workspace", "project", "session"];
const execFileAsync = promisify(execFile);

function isFlagToken(value: string | undefined): value is string {
  return typeof value === "string" && /^--[A-Za-z0-9][A-Za-z0-9-]*$/.test(value);
}

function doctorExitCode(output: string): CliExitCode {
  const erroredChecks = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(": error"))
    .map((line) => line.slice(0, line.indexOf(":")));

  if (erroredChecks.length === 0) {
    return 0;
  }
  if (erroredChecks.some((id) => id === "mcp-envs" || id === "secrets")) {
    return 10;
  }
  if (erroredChecks.some((id) => id === "materialized-graph" || id === "symlinks")) {
    return 9;
  }
  if (erroredChecks.some((id) => id === "lockfile" || id === "effective-graph")) {
    return 8;
  }
  if (
    erroredChecks.some(
      (id) => id === "policy" || id === "provenance" || id === "pack-signatures" || id === "pack-approvals"
    )
  ) {
    return 5;
  }
  return 1;
}

export function successExitCodeForCli(args: string[], output: string): CliExitCode {
  const command = args[0];
  const subcommand = args[1];

  if (command === "plan") {
    return 0;
  }

  if (command === "diff") {
    return output.includes("pending") ? 3 : 0;
  }

  if (command === "lock" && subcommand === "verify") {
    return output.includes("lock mismatch") ? 8 : 0;
  }

  if (command === "doctor" || (command === "agent" && subcommand === "doctor")) {
    return doctorExitCode(output);
  }

  return 0;
}

export function errorExitCodeForCli(error: unknown): Exclude<CliExitCode, 0> {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  if (message.includes("policy violation") || message === "audit failed") {
    return 5;
  }
  if (message.includes("conflict on ")) {
    return 4;
  }
  if (
    message.includes("missing signer secret") ||
    message.includes("missing signing secret") ||
    message.includes("missing required env") ||
    message.includes("missing-secret") ||
    message.includes("missing-env")
  ) {
    return 10;
  }
  if (message.includes("apply verification failed")) {
    if (message.includes("mcp-envs") || message.includes("secrets")) return 10;
    if (message.includes("materialized-graph") || message.includes("symlinks")) return 9;
    if (message.includes("lockfile") || message.includes("effective-graph")) return 8;
    if (
      message.includes("policy") ||
      message.includes("provenance") ||
      message.includes("pack-signatures") ||
      message.includes("pack-approvals")
    ) {
      return 5;
    }
  }
  if (message.includes("lock mismatch")) {
    return 8;
  }
  if (message.includes("materialized") || message.includes("symlink")) {
    return 9;
  }
  if (message.includes("unsupported agent") || message.includes("unknown agent")) {
    return 6;
  }
  if (
    message.includes("unsupported resource source") ||
    message.includes("failed to fetch") ||
    message.includes("failed to sync registry") ||
    message.includes("has not been synced yet")
  ) {
    return 7;
  }
  if (
    message.startsWith("missing --") ||
    message === "missing approval digest" ||
    message.startsWith("unsupported ") ||
    message.startsWith("unknown ")
  ) {
    return 2;
  }
  return 1;
}

function formatExecutedCommandOutput(stdout?: string | Buffer, stderr?: string | Buffer): string {
  const combined = `${stdout ?? ""}${stderr ?? ""}`.trim();
  return combined.length > 0 ? combined : "ok";
}

function parseFlags(args: string[]): { positionals: string[]; flags: Record<string, string> } {
  const flags: Record<string, string> = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (isFlagToken(value)) {
      const next = args[index + 1];
      if (!next || isFlagToken(next)) {
        flags[value.slice(2)] = "true";
      } else {
        flags[value.slice(2)] = next;
        index += 1;
      }
      continue;
    }
    positionals.push(value);
  }

  return { positionals, flags };
}

function parseTargets(raw?: string): ResourceTarget[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as ResourceTarget[];
}

function forceOption(flags: Record<string, string>): { force: boolean } {
  return { force: flags.force === "true" };
}

function planResourceKind(resourceId: string): string {
  return resourceId.includes(":") ? resourceId.slice(0, resourceId.indexOf(":")) : "resource";
}

function formatPlanAction(action: PlanAction): string {
  switch (action.kind) {
    case "store-skill":
      return `STORE  skill ${action.resourceId} -> ${action.storePath}`;
    case "link-skill":
      return `${action.mode === "copy" ? "CREATE" : "LINK"}   skill ${action.destinationPath} <- ${action.sourcePath}`;
    case "store-text-resource":
      return `STORE  ${planResourceKind(action.resourceId)} ${action.resourceId} -> ${action.storePath}`;
    case "write-text-resource":
      return `WRITE  ${planResourceKind(action.resourceId)} ${action.resourceId} -> ${action.destinationPath}`;
    case "write-generated-resource":
      return `WRITE  ${planResourceKind(action.resourceId)} ${action.resourceId} -> ${action.destinationPath}`;
    case "write-mcp-config":
      return `PATCH  mcp ${action.resourceId} -> ${action.destinationPath}`;
    case "write-instruction":
      return `UPSERT instruction ${action.resourceId} -> ${action.destinationPath}`;
  }
}

function formatPlanActions(actions: Awaited<ReturnType<typeof buildPlan>>["actions"]): string {
  if (actions.length === 0) {
    return "No changes";
  }

  return actions.map((action) => formatPlanAction(action)).join("\n");
}

function appendVerboseOutput(
  output: string,
  meta: {
    command: string;
    subcommand?: string;
    root: string;
    flags: Record<string, string>;
    positionals?: string[];
  }
): string {
  if (meta.flags.verbose !== "true") {
    return output;
  }

  const details = [
    `verbose.command=${meta.subcommand ? `${meta.command} ${meta.subcommand}` : meta.command}`,
    `verbose.root=${meta.root}`,
    meta.flags.scope ? `verbose.scope=${meta.flags.scope}` : undefined,
    meta.positionals?.length ? `verbose.positionals=${meta.positionals.join(",")}` : undefined,
    getAgentFlag(meta.flags) ? `verbose.agents=${getAgentFlag(meta.flags)}` : undefined,
    meta.flags.materialize ? `verbose.materialize=${meta.flags.materialize}` : undefined,
    meta.flags.store ? `verbose.store=${meta.flags.store}` : undefined,
    meta.flags.registry ? `verbose.registry=${meta.flags.registry}` : undefined,
    meta.flags.offline === "true" ? "verbose.offline=true" : undefined,
    meta.flags.plan === "true" ? "verbose.plan=true" : undefined,
    meta.flags.verify === "true" ? "verbose.verify=true" : undefined,
    meta.flags.backup === "false" ? "verbose.backup=false" : undefined
  ].filter(Boolean);

  if (details.length === 0) {
    return output;
  }
  return [output, "", ...details].join("\n");
}

function applyStoreOverrideToManifest(manifest: Manifest, store?: string): Manifest {
  if (!store) {
    return manifest;
  }
  return {
    ...manifest,
    scope: {
      level: manifest.scope?.level ?? manifest.defaultScope,
      parents: manifest.scope?.parents ?? [],
      ...manifest.scope,
      canonicalStore: store
    }
  };
}

async function applyInitPack(root: string, packName: string): Promise<void> {
  const manifest = await loadManifest(root);

  if (packName === "blank" || packName === "minimal") {
    return;
  }

  if (packName === "frontend") {
    manifest.packs = manifest.packs.filter((item) => item.id !== "frontend");
    manifest.packs.push({
      id: "frontend",
      name: "pack/frontend",
      version: "0.1.0",
      resources: []
    });
    await saveManifest(root, manifest);
    return;
  }

  throw new Error(`Unknown init pack: ${packName}`);
}

function normalizeInstructionId(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function resolveInstructionSelector(root: string, selector: string): Promise<string> {
  const manifest = await loadManifest(root);
  const byId = manifest.instructions.find((instruction) => instruction.id === selector);
  if (byId) {
    return byId.id;
  }
  const normalized = normalizeInstructionId(selector);
  const byNormalizedId = manifest.instructions.find((instruction) => instruction.id === normalized);
  if (byNormalizedId) {
    return byNormalizedId.id;
  }
  return selector;
}

async function resolveLocalSelector(root: string, raw: string): Promise<string> {
  if (raw.includes(":")) {
    return raw;
  }
  const manifest = await loadManifest(root);
  const matches = listSelectors(manifest).filter((selector) => selector.split(":")[1] === raw);
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length === 0) {
    throw new Error(`Unknown resource: ${raw}`);
  }
  throw new Error(`Ambiguous resource id: ${raw}`);
}

function parseAgentId(raw?: string): AgentId | undefined {
  if (!raw) {
    return undefined;
  }
  if (KNOWN_AGENT_IDS.includes(raw as AgentId)) {
    return raw as AgentId;
  }
  throw new Error(`Unsupported agent: ${raw}`);
}

function requireAgentId(raw?: string): AgentId {
  const agentId = parseAgentId(raw);
  if (!agentId) {
    throw new Error("Missing --agent");
  }
  return agentId;
}

function getAgentFlag(flags: Record<string, string>): string | undefined {
  return flags.agents ?? flags.agent;
}

function parseAgentIds(raw?: string): AgentId[] {
  return parseCsv(raw).map((item) => {
    const agentId = parseAgentId(item);
    if (!agentId) {
      throw new Error(`Unsupported agent: ${item}`);
    }
    return agentId;
  });
}

function parseCsv(raw?: string): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function resolveMaybeScopeRoot(cwd: string, raw?: string): Promise<string | undefined> {
  if (!raw) {
    return undefined;
  }
  if (KNOWN_SCOPE_NAMES.includes(raw as ScopeName)) {
    return scopePath(cwd, raw as ScopeName);
  }
  return raw;
}

async function resolveCommandRoot(context: CliContext, rawScope?: string): Promise<string> {
  return rawScope ? scopePath(context.cwd, rawScope as ScopeName) : context.cwd;
}

function resolveCliContext(
  context: CliContext,
  options?: { root?: string; config?: string }
): CliContext {
  if (options?.config) {
    const resolvedConfig = resolve(context.cwd, options.config);
    if (basename(resolvedConfig) !== "use0-kit.toml") {
      throw new Error(`Unsupported --config path: ${options.config}`);
    }
    return { cwd: dirname(resolvedConfig) };
  }
  if (options?.root) {
    return { cwd: resolve(context.cwd, options.root) };
  }
  return context;
}

function ensureInteractiveConflictMode(conflict?: string): void {
  if (conflict === "ask" && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error("Conflict mode 'ask' requires an interactive TTY session");
  }
}

async function promptConflictResolution(
  selector: string
): Promise<"skip" | "parent-wins" | "child-wins" | "merge" | "fail"> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (
      await rl.question(
        `Conflict on ${selector}. Choose one of [fail|skip|parent-wins|child-wins|merge]: `
      )
    )
      .trim()
      .toLowerCase();
    if (
      answer === "fail" ||
      answer === "skip" ||
      answer === "parent-wins" ||
      answer === "child-wins" ||
      answer === "merge"
    ) {
      return answer;
    }
    return "fail";
  } finally {
    rl.close();
  }
}

function normalizeMcpSourceInput(input: {
  npm?: string;
  source?: string;
  url?: string;
  command?: string;
  args?: string;
  transport?: string;
}): {
  command?: string;
  args?: string[];
  url?: string;
  transport?: "stdio" | "http";
} {
  const source = input.source;
  if (source?.startsWith("npm:")) {
    const parsed = parseSourceReference(source);
    if (parsed.scheme === "npm") {
      return {
        command: "npx",
        args: ["-y", parsed.package],
        transport: "stdio"
      };
    }
  }
  if (source?.startsWith("url:")) {
    const parsed = parseSourceReference(source);
    if (parsed.scheme === "url") {
      return {
        url: parsed.url,
        transport: (input.transport as "stdio" | "http" | undefined) ?? "http"
      };
    }
  }

  const npmPackage = input.npm;
  return {
    command: input.command ?? (npmPackage ? "npx" : undefined),
    args: input.args?.split(",").filter(Boolean) ?? (npmPackage ? ["-y", npmPackage] : undefined),
    url: input.url,
    transport: (input.transport as "stdio" | "http" | undefined) ?? (npmPackage ? "stdio" : undefined)
  };
}

function resourceTargets(resource: SelectorResource): AgentId[] {
  return "targets" in resource && Array.isArray(resource.targets)
    ? (["claude-code", "cursor", "codex", "opencode"] as AgentId[]).filter((agentId) =>
        targetMatches(resource.targets, agentId)
      )
    : [];
}

async function loadEffectiveSelectors(cwd: string): Promise<Array<{ selector: string; resource: SelectorResource }>> {
  const roots = await activeScopeRoots(cwd);
  const orderedScopes: Array<keyof typeof roots> = ["global", "user", "workspace", "project", "session"];
  const winners = new Map<string, SelectorResource>();
  const excluded = new Set<string>();

  for (const scope of orderedScopes) {
    const root = roots[scope];
    if (!root || root === "internal") {
      continue;
    }
    let manifest: Manifest;
    try {
      manifest = await loadManifest(root);
    } catch {
      continue;
    }

    for (const rule of manifest.excludes) {
      excluded.add(rule.selector);
      winners.delete(rule.selector);
    }

    for (const selector of listSelectors(manifest)) {
      if (excluded.has(selector)) {
        continue;
      }
      const resource = findBySelector(manifest, selector);
      if (resource) {
        winners.set(selector, resource);
      }
    }
  }

  return Array.from(winners.entries()).map(([selector, resource]) => ({ selector, resource }));
}

async function publishSelector(root: string, selector: string, registryName?: string): Promise<void> {
  if (registryName) {
    const authPath = join(root, ".use0-kit", "registry-auth.json");
    let current: Record<string, boolean> = {};
    try {
      current = JSON.parse(await readFile(authPath, "utf8")) as Record<string, boolean>;
    } catch {
      current = {};
    }
    if (!current[registryName]) {
      throw new Error(`Not logged into registry: ${registryName}`);
    }
    await publishToRegistry(root, selector, registryName);
  }

  const path = join(root, ".use0-kit", "publish-log.json");
  let current: string[] = [];
  try {
    current = JSON.parse(await readFile(path, "utf8")) as string[];
  } catch {
    current = [];
  }
  current.push(selector);
  await writeFile(path, JSON.stringify(current, null, 2) + "\n", "utf8");
}

async function readRequestPayload(request?: string): Promise<string> {
  if (request) {
    return request;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

function toolCallToArgs(name?: string, input?: Record<string, unknown>): string[] {
  if (name === "use0.list") {
    const args = ["list"];
    const selectors = Array.isArray(input?.selectors) ? input.selectors.map(String) : [];
    args.push(...selectors);
    if (input?.scope) args.push("--scope", String(input.scope));
    if (input?.effective) args.push("--effective");
    if (input?.agent) args.push("--agent", String(input.agent));
    return args;
  }
  if (name === "use0.info") {
    return ["info", String(input?.selector ?? "")];
  }
  if (name === "use0.explain") {
    const args = ["scope", "explain", String(input?.selector ?? "")];
    if (input?.scope) args.push("--scope", String(input.scope));
    if (input?.agent) args.push("--agent", String(input.agent));
    if (input?.json) args.push("--json");
    return args;
  }
  if (name === "use0.plan") {
    const args = ["plan"];
    if (input?.scope) args.push("--scope", String(input.scope));
    if (input?.agent) args.push("--agent", String(input.agent));
    if (input?.materialize) args.push("--materialize", String(input.materialize));
    if (input?.json) args.push("--json");
    return args;
  }
  if (name === "use0.apply") {
    const args = ["apply"];
    if (input?.scope) args.push("--scope", String(input.scope));
    if (input?.agent) args.push("--agent", String(input.agent));
    if (input?.verify) args.push("--verify");
    if (input?.backup === false) args.push("--backup", "false");
    if (input?.materialize) args.push("--materialize", String(input.materialize));
    return args;
  }
  if (name === "use0.sync") {
    const args = ["sync"];
    if (input?.scope) args.push("--scope", String(input.scope));
    if (input?.agent) args.push("--agent", String(input.agent));
    if (input?.verify !== false) args.push("--verify");
    if (input?.backup === false) args.push("--backup", "false");
    if (input?.materialize) args.push("--materialize", String(input.materialize));
    return args;
  }
  if (name === "use0.doctor") {
    const args = ["doctor"];
    if (input?.scope) args.push("--scope", String(input.scope));
    if (input?.fix) args.push("--fix");
    return args;
  }
  throw new Error(`Unsupported MCP tool: ${name}`);
}

async function handleMcpRequest(payload: string, context: CliContext): Promise<string> {
  const request = JSON.parse(payload) as McpRequest;

  if (request.method === "initialize") {
    return JSON.stringify({
      jsonrpc: "2.0",
      id: request.id ?? null,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "use0-kit", version: "0.1.0" },
        capabilities: { tools: {} }
      }
    });
  }

  if (request.method === "tools/list") {
    return JSON.stringify({
      jsonrpc: "2.0",
      id: request.id ?? null,
      result: {
        tools: mcpTools()
      }
    });
  }

  if (request.method === "tools/call") {
    const output = await runCli(toolCallToArgs(request.params?.name, request.params?.arguments), context);
    return JSON.stringify({
      jsonrpc: "2.0",
      id: request.id ?? null,
      result: {
        content: [{ type: "text", text: output }]
      }
    });
  }

  return JSON.stringify({
    jsonrpc: "2.0",
    id: request.id ?? null,
    error: { code: -32601, message: `Unsupported method: ${request.method}` }
  });
}

function filterPlanActionsForAgent(
  actions: Awaited<ReturnType<typeof buildPlan>>["actions"],
  agentIds?: AgentId[]
) {
  if (!agentIds || agentIds.length === 0) {
    return actions;
  }
  const selected = new Set(agentIds);
  return actions.filter((action) => !("agentId" in action) || action.agentId === undefined || selected.has(action.agentId));
}

async function applyCurrentManifest(
  root: string,
  options?: {
    agentIds?: AgentId[];
    verify?: boolean;
    backup?: boolean;
    materialization?: "symlink" | "copy" | "auto";
    store?: string;
    plan?: boolean;
  }
): Promise<{ actions: number; output: string; planned: boolean }> {
  await enforcePolicy(root);
  const manifest = applyStoreOverrideToManifest(await loadManifest(root), options?.store);
  const plan = await buildPlan({ root, manifest, materialization: options?.materialization });
  const filteredPlan = {
    actions: filterPlanActionsForAgent(plan.actions, options?.agentIds)
  };
  if (options?.plan) {
    return {
      actions: filteredPlan.actions.length,
      output: formatPlanActions(filteredPlan.actions),
      planned: true
    };
  }
  const backupId = options?.backup === false ? undefined : await createBackup(root);
  await applyPlan({ root, plan: filteredPlan, backupId });
  const selectedAgents = options?.agentIds?.length ? options.agentIds : manifest.agents;
  for (const agentId of selectedAgents) {
    if (manifest.instructions.some((instruction) => targetMatches(instruction.targets, agentId))) {
      const rendered = await renderInstructions({
        root,
        instructions: manifest.instructions,
        agentId
      });
      await writeFile(rendered.path, rendered.content, "utf8");
    }
    if (manifest.mcps.some((mcp) => targetMatches(mcp.targets, agentId))) {
      const rendered = renderMcpConfig({
        root,
        agentId,
        mcps: manifest.mcps
      });
      await writeFile(rendered.path, rendered.content, "utf8");
    }
  }
  if (options?.verify) {
    const report = await runDoctor(root);
    const failures = report.checks.filter(
      (check) =>
        check.status !== "ok" &&
        !(options.agentIds?.length && check.id === "materialized-graph")
    );
    if (failures.length > 0) {
      throw new Error(`Apply verification failed: ${failures.map((check) => check.id).join(", ")}`);
    }
  }
  return {
    actions: filteredPlan.actions.length,
    output: `Applied ${filteredPlan.actions.length} action(s)`,
    planned: false
  };
}

async function withPreviewRoot<T>(root: string, fn: (previewRoot: string) => Promise<T>): Promise<T> {
  const previewBase = await mkdtemp(join(tmpdir(), "use0-kit-preview-"));
  const previewRoot = join(previewBase, basename(root));
  await cp(root, previewRoot, { recursive: true, dereference: false });
  try {
    return await fn(previewRoot);
  } finally {
    await rm(previewBase, { recursive: true, force: true });
  }
}

function formatPlannedWorkflow(summary: string, result: { actions: number; output: string }): string {
  return `${summary} and planned ${result.actions} action(s)\n${result.output}`;
}

export async function runCli(args: string[], context: CliContext): Promise<string> {
  const command = args[0];
  const topLevelOnly = new Set([
    "init",
    "plan",
    "apply",
    "doctor",
    "audit",
    "adopt",
    "search",
    "add",
    "remove",
    "list",
    "info",
    "edit",
    "enable",
    "disable",
    "validate",
    "score",
    "diff",
    "update",
    "publish",
    "install",
    "prune",
    "restore",
    "rollback"
  ]);
  const hasSubcommand = !topLevelOnly.has(command) && args[1] !== undefined && !isFlagToken(args[1]);
  const subcommand = hasSubcommand ? args[1] : undefined;
  const rest = hasSubcommand ? args.slice(2) : args.slice(1);
  const { positionals, flags } = parseFlags(rest);
  context = resolveCliContext(context, { root: flags.root, config: flags.config });
  setSourceResolverOfflineMode(flags.offline === "true");
  setRegistryOfflineMode(flags.offline === "true");

  try {

  if (command === "init") {
    const scope = (flags.scope as ScopeName | undefined) ?? "project";
    const root = context.cwd;
    await initScope({
      cwd: root,
      scope
    });
    if (flags.yes === "true" && (scope === "project" || scope === "workspace" || scope === "session")) {
      await ensureProjectFiles(root);
    }
    if (flags.agents) {
      const manifest = await loadManifest(root);
      manifest.agents = parseAgentIds(flags.agents);
      await saveManifest(root, manifest);
    }
    if (flags.with) {
      await applyInitPack(root, flags.with);
    }
    return `Initialized ${scope} scope at ${root}`;
  }

  if (command === "scope" && subcommand === "init") {
    const scope = (flags.scope as ScopeName | undefined) ?? "project";
    const root = context.cwd;
    await initScope({
      cwd: root,
      scope
    });
    if (flags.yes === "true" && (scope === "project" || scope === "workspace" || scope === "session")) {
      await ensureProjectFiles(root);
    }
    if (flags.agents) {
      const manifest = await loadManifest(root);
      manifest.agents = parseAgentIds(flags.agents);
      await saveManifest(root, manifest);
    }
    if (flags.with) {
      await applyInitPack(root, flags.with);
    }
    return `Initialized ${scope} scope at ${root}`;
  }

  if (command === "scope" && subcommand === "list") {
    const scopes = await listScopes(context.cwd);
    if (flags.json === "true") {
      return JSON.stringify(
        {
          scopes,
          effectiveOrder: ["builtin", "global", "user", "workspace", "project", "session"]
        },
        null,
        2
      );
    }
    return (
      scopes
      .map((scope) => `${scope.name}\t${scope.active ? "active" : "inactive"}\t${scope.path}`)
      .join("\n") + "\neffective order:\nbuiltin < global < user < workspace < project < session"
    );
  }

  if (command === "scope" && subcommand === "sync") {
    if (flags["from-parents"] === "true") {
      const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
      if (flags.apply && flags.plan === "true") {
        return withPreviewRoot(root, async (previewRoot) => {
          const count = await syncDeclaredParents(previewRoot);
          const planned = await applyCurrentManifest(previewRoot, {
            agentIds: parseAgentIds(getAgentFlag(flags)),
            verify: flags.verify === "true",
            backup: flags.backup !== "false",
            materialization: flags.materialize as "symlink" | "copy" | "auto" | undefined,
            store: flags.store,
            plan: true
          });
          return appendVerboseOutput(formatPlannedWorkflow(`Synced ${count} resource(s) from declared parents`, planned), {
            command,
            subcommand,
            root,
            flags,
            positionals
          });
        });
      }
      const count = await syncDeclaredParents(root);
      if (flags.apply) {
        const applied = await applyCurrentManifest(root, {
          agentIds: parseAgentIds(getAgentFlag(flags)),
          verify: flags.verify === "true",
          backup: flags.backup !== "false",
          materialization: flags.materialize as "symlink" | "copy" | "auto" | undefined,
          store: flags.store
        });
        return appendVerboseOutput(`Synced ${count} resource(s) from declared parents and applied ${applied.actions} action(s)`, {
          command,
          subcommand,
          root,
          flags,
          positionals
        });
      }
      return appendVerboseOutput(`Synced ${count} resource(s) from declared parents`, {
        command,
        subcommand,
        root,
        flags,
        positionals
      });
    }
    const fromRoot = await resolveMaybeScopeRoot(context.cwd, flags.from);
    const toRoot = await resolveMaybeScopeRoot(context.cwd, flags.to);
    if (!fromRoot || !toRoot) {
      throw new Error("Missing --from or --to for scope sync");
    }
    const resolvedConflict =
      (flags.conflict as
        | "fail"
        | "ask"
        | "skip"
        | "parent-wins"
        | "child-wins"
        | "merge"
        | undefined) ?? (await defaultConflictMode(toRoot));
    ensureInteractiveConflictMode(resolvedConflict);
    const selector = positionals[0];
    if (flags["dry-run"] === "true") {
      const preview = await previewSyncScopesDetailed({
        fromRoot,
        toRoot,
        selector,
        mode: flags.mode as "inherit" | "pin" | "copy" | "fork" | "mirror" | undefined,
        prune: flags.prune === "true",
        conflict: resolvedConflict
      });
      if (flags.json === "true") {
        return JSON.stringify(preview, null, 2);
      }
      return preview.changes.map((item) => `${item.action}\t${item.selector}`).join("\n");
    }
    const count = await syncScopesDetailed({
      fromRoot,
      toRoot,
      selector,
      mode: flags.mode as "inherit" | "pin" | "copy" | "fork" | "mirror" | undefined,
      prune: flags.prune === "true",
      conflict: resolvedConflict,
      conflictResolver: resolvedConflict === "ask" ? promptConflictResolution : undefined
    });
    if (flags.apply) {
      if (flags.plan === "true") {
        return withPreviewRoot(toRoot, async (previewRoot) => {
          const previewCount = await syncScopesDetailed({
            fromRoot,
            toRoot: previewRoot,
            selector,
            mode: flags.mode as "inherit" | "pin" | "copy" | "fork" | "mirror" | undefined,
            prune: flags.prune === "true",
            conflict: resolvedConflict,
            conflictResolver: resolvedConflict === "ask" ? promptConflictResolution : undefined
          });
          const planned = await applyCurrentManifest(previewRoot, {
            agentIds: parseAgentIds(getAgentFlag(flags)),
            verify: flags.verify === "true",
            backup: flags.backup !== "false",
            materialization: flags.materialize as "symlink" | "copy" | "auto" | undefined,
            store: flags.store,
            plan: true
          });
          return appendVerboseOutput(
            formatPlannedWorkflow(`Synced ${previewCount} resource(s) from ${flags.from} to ${flags.to}`, planned),
            {
              command,
              subcommand,
              root: toRoot,
              flags,
              positionals
            }
          );
        });
      }
      const applied = await applyCurrentManifest(toRoot!, {
        agentIds: parseAgentIds(getAgentFlag(flags)),
        verify: flags.verify === "true",
        backup: flags.backup !== "false",
        materialization: flags.materialize as "symlink" | "copy" | "auto" | undefined,
        store: flags.store
      });
      return appendVerboseOutput(`Synced ${count} resource(s) from ${flags.from} to ${flags.to} and applied ${applied.actions} action(s)`, {
        command,
        subcommand,
        root: toRoot,
        flags,
        positionals
      });
    }
    return appendVerboseOutput(`Synced ${count} resource(s) from ${flags.from} to ${flags.to}`, {
      command,
      subcommand,
      root: toRoot,
      flags,
      positionals
    });
  }

  if (command === "scope" && subcommand === "diff") {
    const fromRoot = await resolveMaybeScopeRoot(context.cwd, flags.from);
    const toRoot = await resolveMaybeScopeRoot(context.cwd, flags.to);
    if (!fromRoot || !toRoot) {
      throw new Error("Missing --from or --to for scope diff");
    }
    const kinds = flags.kind?.split(",").filter(Boolean);
    const diffs = await diffScopesDetailed(fromRoot, toRoot, kinds);
    if (flags.json === "true") {
      return JSON.stringify(
        {
          from: flags.from,
          to: flags.to,
          clean: diffs.length === 1 && diffs[0] === "CLEAN",
          changes:
            diffs.length === 1 && diffs[0] === "CLEAN"
              ? []
              : diffs.map((entry) => {
                  const [status, selector] = entry.split(" ", 2);
                  return { status, selector };
                })
        },
        null,
        2
      );
    }
    if (diffs.length === 1 && diffs[0] === "CLEAN") {
      return "No scope diff";
    }
    return diffs.join("\n");
  }

  if (command === "scope" && subcommand === "explain") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    if (flags.json === "true") {
      return JSON.stringify(
        await explainScopedSnapshot(root, positionals[0], {
          scope: flags.scope as "global" | "user" | "workspace" | "project" | "session" | undefined,
          agentId: parseAgentId(flags.agent)
        }),
        null,
        2
      );
    }
    return explainScopedResource(root, positionals[0], {
      scope: flags.scope as "global" | "user" | "workspace" | "project" | "session" | undefined,
      agentId: parseAgentId(flags.agent)
    });
  }

  if (command === "scope" && subcommand === "promote") {
    const fromRoot = await resolveMaybeScopeRoot(context.cwd, flags.from);
    const toRoot = await resolveMaybeScopeRoot(context.cwd, flags.to);
    if (!fromRoot || !toRoot) {
      throw new Error("Missing --from or --to for scope promote");
    }
    const count = await promoteResource({
      fromRoot,
      toRoot,
      selector: positionals[0],
      publishable: flags.publishable === "true"
    });
    return `Promoted ${positionals[0]} from ${flags.from} to ${flags.to} (${count} resource(s))`;
  }

  if (command === "scope" && subcommand === "fork") {
    const fromRoot = await resolveMaybeScopeRoot(context.cwd, flags.from);
    const toRoot = await resolveMaybeScopeRoot(context.cwd, flags.to);
    if (!fromRoot || !toRoot) {
      throw new Error("Missing --from or --to for scope fork");
    }
    ensureInteractiveConflictMode(flags.conflict as string | undefined);
    const count = await syncScopesDetailed({
      fromRoot,
      toRoot,
      selector: positionals[0],
      mode: "fork",
      conflict: flags.conflict as
        | "fail"
        | "ask"
        | "skip"
        | "parent-wins"
        | "child-wins"
        | "merge"
        | undefined,
      conflictResolver: flags.conflict === "ask" ? promptConflictResolution : undefined
    });
    return `Forked ${positionals[0]} from ${flags.from} to ${flags.to} (${count} resource(s))`;
  }

  if (command === "scope" && subcommand === "exclude") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    await addExclude(root, positionals[0]);
    return `Excluded ${positionals[0]}`;
  }

  if (command === "scope" && subcommand === "current") {
    return await currentScope(context.cwd);
  }

  if (command === "scope" && subcommand === "path") {
    return await scopePath(context.cwd, flags.scope);
  }

  if (command === "scope" && subcommand === "inspect") {
    if (flags.json === "true") {
      return JSON.stringify(
        await inspectScopeSnapshot(context.cwd, {
          scope: flags.scope,
          kind: flags.kind,
          agentId: parseAgentId(flags.agent)
        }),
        null,
        2
      );
    }
    return await inspectScopeDetailed(context.cwd, {
      scope: flags.scope,
      kind: flags.kind,
      agentId: parseAgentId(flags.agent)
    });
  }

  if (command === "add") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    if (positionals[0] === "skill") {
      await addSkill(root, {
        id: flags.id,
        source: positionals[1] ?? flags.source,
        targets: parseTargets(flags.targets)
      }, forceOption(flags));
      return `Added skill:${flags.id}`;
    }
    if (positionals[0] === "mcp") {
      const id = flags.id ?? positionals[1];
      const resolved = normalizeMcpSourceInput({
        npm: flags.npm,
        source: flags.source,
        url: flags.url,
        command: flags.command,
        args: flags.args,
        transport: flags.transport
      });
      await addMcpServer(root, {
        id,
        command: resolved.command,
        args: resolved.args,
        env: flags.env?.split(",").map((item) => item.trim()).filter(Boolean),
        url: resolved.url,
        transport: resolved.transport,
        targets: parseTargets(flags.targets)
      }, forceOption(flags));
      return `Added mcp:${id}`;
    }
    if (positionals[0] === "instruction") {
      const id = flags.id ?? positionals[1];
      await addInstruction(root, {
        id,
        title: flags.title,
        body: flags.body ?? flags.content ?? positionals[2],
        source: flags.source,
        targets: parseTargets(flags.targets)
      }, forceOption(flags));
      return `Added instruction:${id}`;
    }
    if (positionals[0] === "command") {
      const id = flags.id ?? positionals[1];
      await addCommand(root, {
        id,
        content: flags.content,
        source: positionals[2] ?? flags.source,
        targets: parseTargets(flags.targets)
      }, forceOption(flags));
      return `Added command:${id}`;
    }
    if (positionals[0] === "subagent") {
      const id = flags.id ?? positionals[1];
      await addSubagent(root, {
        id,
        content: flags.content,
        source: positionals[2] ?? flags.source,
        targets: parseTargets(flags.targets)
      }, forceOption(flags));
      return `Added subagent:${id}`;
    }
    if (positionals[0] === "hook") {
      const id = flags.id ?? positionals[1];
      await addHook(root, {
        id,
        content: flags.content,
        source: positionals[2] ?? flags.source,
        targets: parseTargets(flags.targets)
      }, forceOption(flags));
      return `Added hook:${id}`;
    }
    if (positionals[0] === "pack") {
      const id = flags.id ?? positionals[1];
      await initPack(root, {
        id,
        name: flags.name,
        version: flags.version
      }, forceOption(flags));
      return `Added pack:${id}`;
    }
    if (positionals[0] === "secret") {
      const id = flags.id ?? positionals[1];
      await addSecret(root, {
        id,
        env: flags.env,
        required: flags.required !== "false",
        targets: parseTargets(flags.targets)
      }, forceOption(flags));
      return `Added secret:${id}`;
    }
    if (positionals[0] === "plugin") {
      const id = flags.id ?? positionals[1];
      await addPlugin(root, {
        id,
        source: positionals[2] ?? flags.source,
        targets: parseTargets(flags.targets)
      }, forceOption(flags));
      return `Added plugin:${id}`;
    }
    throw new Error(`Unsupported add kind: ${positionals[0]}`);
  }

  if (command === "remove") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const selector = positionals[0];
    const [kind, id] = selector.split(":");
    if (kind === "skill") {
      await removeSkill(root, id);
      return `Removed ${selector}`;
    }
    if (kind === "secret") {
      await removeSecret(root, id);
      return `Removed ${selector}`;
    }
    if (kind === "mcp") {
      await removeMcpServer(root, id);
      return `Removed ${selector}`;
    }
    if (kind === "instruction") {
      await removeInstruction(root, id);
      return `Removed ${selector}`;
    }
    if (kind === "command") {
      await removeCommand(root, id);
      return `Removed ${selector}`;
    }
    if (kind === "subagent") {
      await removeSubagent(root, id);
      return `Removed ${selector}`;
    }
    if (kind === "hook") {
      await removeHook(root, id);
      return `Removed ${selector}`;
    }
    if (kind === "pack") {
      await removePack(root, id);
      return `Removed ${selector}`;
    }
    if (kind === "plugin") {
      await removePlugin(root, id);
      return `Removed ${selector}`;
    }
    throw new Error(`Unsupported remove selector: ${selector}`);
  }

  if (command === "list") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    let normalizedItems: Array<{ selector: string; resource: SelectorResource }>;
    if (flags.effective) {
      normalizedItems = await loadEffectiveSelectors(root);
    } else {
      const manifest = await loadManifest(root);
      normalizedItems = listSelectors(manifest).map((selector) => ({
        selector,
        resource: findBySelector(manifest, selector)!
      }));
    }
    const requested = new Set(positionals.filter(Boolean));
    return normalizedItems
      .filter((item) => !flags.kind || item.selector.startsWith(`${flags.kind}:`))
      .filter(
        (item) =>
          requested.size === 0 || requested.has(item.selector) || requested.has(item.selector.split(":")[0])
      )
      .filter((item) => {
        const agentId = parseAgentId(flags.agent);
        return !agentId || resourceTargets(item.resource).includes(agentId);
      })
      .map((item) => item.selector)
      .join("\n");
  }

  if (command === "info") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    return explainResource(root, await resolveLocalSelector(root, positionals[0]));
  }

  if (command === "validate") {
    if (positionals[0] === "skill") {
      const result = await validateSkill(positionals[1]);
      return result.valid ? "valid" : `invalid: ${result.issues.join("; ")}`;
    }
    throw new Error(`Unsupported validate kind: ${positionals[0]}`);
  }

  if (command === "score") {
    if (positionals[0] === "skill") {
      return `score: ${await scoreSkill(positionals[1])}`;
    }
    throw new Error(`Unsupported score kind: ${positionals[0]}`);
  }

  if (command === "edit") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const selector = positionals[0];
    const [kind, id] = selector.split(":");
    if (kind === "skill") {
      const manifest = await loadManifest(root);
      const skill = manifest.skills.find((item) => item.id === id);
      if (!skill) {
        throw new Error(`Unknown ${selector}`);
      }
      return await resolveSkillSourcePath(root, skill.source);
    }
    if (kind === "command") {
      const resource = await getCommand(root, id);
      return await resolveSourcePath(root, resource.source);
    }
    if (kind === "instruction") {
      const resource = await getInstruction(root, id);
      return await resolveSourcePath(root, resource.source);
    }
    if (kind === "subagent") {
      const resource = await getSubagent(root, id);
      return await resolveSourcePath(root, resource.source);
    }
    if (kind === "hook") {
      const resource = await getHook(root, id);
      return await resolveSourcePath(root, resource.source);
    }
    if (kind === "plugin") {
      const resource = await getPlugin(root, id);
      return await resolveSourcePath(root, resource.source);
    }
    throw new Error(`Unsupported edit selector: ${selector}`);
  }

  if (command === "enable") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const selector = positionals[0];
    const [kind, id] = selector.split(":");
    if (kind === "mcp") {
      await setMcpEnabled(root, id, true);
      return `Enabled ${selector}`;
    }
    if (kind === "agent") {
      await setAgentDisabled(root, requireAgentId(id), false);
      return `Enabled ${selector}`;
    }
    throw new Error(`Unsupported enable selector: ${selector}`);
  }

  if (command === "disable") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const selector = positionals[0];
    const [kind, id] = selector.split(":");
    if (kind === "mcp") {
      await setMcpEnabled(root, id, false);
      return `Disabled ${selector}`;
    }
    if (kind === "agent") {
      await setAgentDisabled(root, requireAgentId(id), true);
      return `Disabled ${selector}`;
    }
    throw new Error(`Unsupported disable selector: ${selector}`);
  }

  if (command === "skill" && subcommand === "add") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    await addSkill(root, {
      id: flags.id,
      source: positionals[0] ?? flags.source,
      targets: parseTargets(flags.targets)
    }, forceOption(flags));
    return `Added skill:${flags.id}`;
  }

  if (command === "skill" && subcommand === "init") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const id = positionals[0] ?? flags.id;
    const skillDir = managedSkillSourceDir(root, id);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      ensureMetadataFrontmatter(`# ${id}\n\n## Instructions\n\nDescribe the ${id} skill here.`, {
        name: id,
        description: `Use the ${id} skill.`
      }),
      "utf8"
    );
    await addSkill(root, {
      id,
      source: `path:${skillDir}`,
      targets: parseTargets(flags.targets)
    }, forceOption(flags));
    return `Initialized skill:${id}`;
  }

  if (command === "skill" && subcommand === "update") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const id = positionals[0] ?? flags.id;
    const existing = await getSkill(root, id);
    await addSkill(root, {
      id,
      source: positionals[1] ?? flags.source ?? existing.source,
      targets: flags.targets ? parseTargets(flags.targets) : existing.targets,
      provenance: existing.provenance,
      originScope: existing.originScope,
      syncMode: existing.syncMode,
      pinnedDigest: existing.pinnedDigest
    }, { force: true });
    return `Updated skill:${id}`;
  }

  if (command === "skill" && subcommand === "remove") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    await removeSkill(root, positionals[0] ?? flags.id);
    return `Removed skill:${positionals[0] ?? flags.id}`;
  }

  if (command === "skill" && subcommand === "list") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const manifest = await loadManifest(root);
    return manifest.skills.map((skill) => skill.id).join("\n");
  }

  if (command === "skill" && subcommand === "validate") {
    const result = await validateSkill(positionals[0]);
    return result.valid ? "valid" : `invalid: ${result.issues.join("; ")}`;
  }

  if (command === "skill" && subcommand === "score") {
    return `score: ${await scoreSkill(positionals[0])}`;
  }

  if (command === "mcp" && subcommand === "add") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const id = flags.id ?? positionals[0];
    const resolved = normalizeMcpSourceInput({
      npm: flags.npm,
      source: flags.source,
      url: flags.url,
      command: flags.command,
      args: flags.args,
      transport: flags.transport
    });
    await addMcpServer(root, {
      id,
      command: resolved.command,
      args: resolved.args,
      env: flags.env?.split(",").map((item) => item.trim()).filter(Boolean),
      url: resolved.url,
      transport: resolved.transport,
      targets: parseTargets(flags.targets)
    }, forceOption(flags));
    return `Added mcp:${id}`;
  }

  if (command === "mcp" && subcommand === "remove") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    await removeMcpServer(root, positionals[0] ?? flags.id);
    return `Removed mcp:${positionals[0] ?? flags.id}`;
  }

  if (command === "mcp" && subcommand === "list") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const manifest = await loadManifest(root);
    return manifest.mcps
      .map((mcp) => `${mcp.id}${mcp.enabled === false ? " (disabled)" : ""}`)
      .join("\n");
  }

  if (command === "mcp" && subcommand === "render") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const manifest = await loadManifest(root);
    return renderMcpConfig({
      root,
      agentId: requireAgentId(flags.agent),
      mcps: manifest.mcps
    }).content;
  }

  if (command === "mcp" && subcommand === "test") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const mcp = await getMcp(root, positionals[0]);
    return mcp.command || mcp.url ? "ok" : "missing";
  }

  if (command === "mcp" && subcommand === "env") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const mcp = await getMcp(root, positionals[0]);
    return `command=${mcp.command ?? ""}\ntransport=${mcp.transport ?? ""}\nenv=${(mcp.env ?? []).join(",")}`;
  }

  if (command === "mcp" && subcommand === "disable") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    await setMcpEnabled(root, positionals[0], false);
    return `Disabled mcp:${positionals[0]}`;
  }

  if (command === "mcp" && subcommand === "enable") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    await setMcpEnabled(root, positionals[0], true);
    return `Enabled mcp:${positionals[0]}`;
  }

  if (command === "mcp" && subcommand === "serve") {
    return handleMcpRequest(await readRequestPayload(flags.request), context);
  }

  if (command === "instruction" && subcommand === "set-section") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const title = flags.title ?? positionals[0];
    const id = flags.id ?? (title ? normalizeInstructionId(title) : undefined);
    await addInstruction(root, {
      id,
      title,
      body: flags.body ?? flags.content ?? positionals[1],
      source: flags.source,
      targets: parseTargets(flags.targets)
    }, forceOption(flags));
    return `Added instruction:${id}`;
  }

  if (command === "instruction" && subcommand === "init") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const title = flags.title ?? positionals[0];
    const id = flags.id ?? (title ? normalizeInstructionId(title) : undefined);
    await addInstruction(root, {
      id,
      title,
      body: flags.body ?? flags.content ?? positionals[1],
      source: flags.source,
      targets: parseTargets(flags.targets)
    }, forceOption(flags));
    return `Added instruction:${id}`;
  }

  if (command === "instruction" && subcommand === "render") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const manifest = await loadManifest(root);
    return (
      await renderInstructions({
        root,
        instructions: manifest.instructions,
        agentId: requireAgentId(flags.agent)
      })
    ).content;
  }

  if (command === "instruction" && subcommand === "read") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    try {
      const instruction = await getInstruction(root, await resolveInstructionSelector(root, positionals[0]));
      return await loadResourceContent(root, instruction.source);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  if (command === "instruction" && subcommand === "remove-section") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const id = await resolveInstructionSelector(root, positionals[0]);
    await removeInstruction(root, id);
    return `Removed instruction:${id}`;
  }

  if (command === "instruction" && subcommand === "link") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const manifest = await loadManifest(root);
    const rendered = await renderInstructions({
      root,
      instructions: manifest.instructions,
      agentId: requireAgentId(flags.agent)
    });
    await writeFile(rendered.path, rendered.content, "utf8");
    return `Linked instructions for ${flags.agent}`;
  }

  if (command === "command" && subcommand === "add") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const id = flags.id ?? positionals[0];
    await addCommand(root, {
      id,
      content: flags.content,
      source: positionals[1] ?? flags.source,
      targets: parseTargets(flags.targets)
    }, forceOption(flags));
    return `Added command:${id}`;
  }

  if (command === "command" && subcommand === "render") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const resource = await getCommand(root, positionals[0] ?? flags.id);
    return applyHostOverlay(await loadResourceContent(root, resource.source), requireAgentId(flags.agent));
  }

  if (command === "command" && subcommand === "list") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const manifest = await loadManifest(root);
    return manifest.commands.map((item) => item.id).join("\n");
  }

  if (command === "command" && subcommand === "remove") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    await removeCommand(root, positionals[0] ?? flags.id);
    return `Removed command:${positionals[0] ?? flags.id}`;
  }

  if (command === "subagent" && subcommand === "add") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const id = flags.id ?? positionals[0];
    await addSubagent(root, {
      id,
      content: flags.content,
      source: positionals[1] ?? flags.source,
      targets: parseTargets(flags.targets)
    }, forceOption(flags));
    return `Added subagent:${id}`;
  }

  if (command === "subagent" && subcommand === "render") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const resource = await getSubagent(root, positionals[0] ?? flags.id);
    return applyHostOverlay(await loadResourceContent(root, resource.source), requireAgentId(flags.agent));
  }

  if (command === "subagent" && subcommand === "list") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const manifest = await loadManifest(root);
    return manifest.subagents.map((item) => item.id).join("\n");
  }

  if (command === "subagent" && subcommand === "remove") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    await removeSubagent(root, positionals[0] ?? flags.id);
    return `Removed subagent:${positionals[0] ?? flags.id}`;
  }

  if (command === "hook" && subcommand === "add") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const id = flags.id ?? positionals[0];
    await addHook(root, {
      id,
      content: flags.content,
      source: positionals[1] ?? flags.source,
      targets: parseTargets(flags.targets)
    }, forceOption(flags));
    return `Added hook:${id}`;
  }

  if (command === "hook" && subcommand === "list") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const manifest = await loadManifest(root);
    return manifest.hooks.map((item) => item.id).join("\n");
  }

  if (command === "hook" && subcommand === "remove") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    await removeHook(root, positionals[0] ?? flags.id);
    return `Removed hook:${positionals[0] ?? flags.id}`;
  }

  if (command === "hook" && subcommand === "test") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const hook = await getHook(root, positionals[0]);
    const hookPath = await resolveSourcePath(root, hook.source);
    try {
      const { stdout, stderr } = await execFileAsync("/bin/sh", [hookPath], { cwd: root });
      return formatExecutedCommandOutput(stdout, stderr);
    } catch (error) {
      if (typeof error === "object" && error !== null && ("stdout" in error || "stderr" in error)) {
        const failure = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
        const output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`.trim();
        throw new Error(output || failure.message || "Hook failed");
      }
      throw error;
    }
  }

  if (command === "secret" && subcommand === "add") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    await addSecret(root, {
      id: flags.id,
      env: flags.env,
      required: flags.required !== "false",
      targets: parseTargets(flags.targets)
    }, forceOption(flags));
    return `Added secret:${flags.id}`;
  }

  if (command === "secret" && subcommand === "list") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const manifest = await loadManifest(root);
    return manifest.secrets.map((item) => item.id).join("\n");
  }

  if (command === "secret" && subcommand === "remove") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    await removeSecret(root, positionals[0] ?? flags.id);
    return `Removed secret:${positionals[0] ?? flags.id}`;
  }

  if (command === "secret" && subcommand === "env") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const secret = await getSecret(root, positionals[0] ?? flags.id);
    return `env=${secret.env}\nrequired=${secret.required === false ? "false" : "true"}`;
  }

  if (command === "plugin" && subcommand === "add") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const id = flags.id ?? positionals[0];
    await addPlugin(root, {
      id,
      source: positionals[1] ?? flags.source,
      targets: parseTargets(flags.targets)
    }, forceOption(flags));
    return `Added plugin:${id}`;
  }

  if (command === "plugin" && subcommand === "list") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const manifest = await loadManifest(root);
    return manifest.plugins.map((item) => item.id).join("\n");
  }

  if (command === "plugin" && subcommand === "remove") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    await removePlugin(root, positionals[0] ?? flags.id);
    return `Removed plugin:${positionals[0] ?? flags.id}`;
  }

  if (command === "pack" && subcommand === "init") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    await initPack(root, {
      id: positionals[0],
      name: flags.name ?? positionals[0],
      version: flags.version ?? "0.1.0"
    }, forceOption(flags));
    return `Initialized pack:${positionals[0]}`;
  }

  if (command === "pack" && subcommand === "add") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    await addPackResource(root, positionals[0], positionals[1]);
    return `Added ${positionals[1]} to pack:${positionals[0]}`;
  }

  if (command === "pack" && subcommand === "export") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    await exportPack(root, positionals[0], flags.out);
    return `Exported pack:${positionals[0]} to ${flags.out}`;
  }

  if (command === "pack" && subcommand === "sign") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const keyId = flags["key-id"] ?? flags.key;
    if (!keyId) {
      throw new Error("Missing --key-id for pack sign");
    }
    const secret = flags.secret ?? lookupSignerSecret(keyId);
    if (!secret) {
      throw new Error(`Missing signing secret. Set --secret or ${signerEnvVar(keyId)}`);
    }
    await signPackResource(root, positionals[0], keyId, secret);
    return `Signed pack:${positionals[0]} with key:${keyId}`;
  }

  if (command === "pack" && subcommand === "verify") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const manifest = await loadManifest(root);
    const pack = manifest.packs.find((item) => item.id === positionals[0]);
    if (!pack) {
      throw new Error(`Unknown pack:${positionals[0]}`);
    }
    if (!pack.signature) {
      return `pack:${positionals[0]} unsigned`;
    }
    const secret = flags.secret ?? lookupSignerSecret(pack.signature.keyId);
    if (!secret) {
      throw new Error(`Missing signer secret. Set --secret or ${signerEnvVar(pack.signature.keyId)}`);
    }
    return (await verifyPackResource(root, positionals[0], secret))
      ? `pack:${positionals[0]} signature ok`
      : `pack:${positionals[0]} signature invalid`;
  }

  if (command === "pack" && subcommand === "install") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    const targetRoot =
      (await resolveMaybeScopeRoot(context.cwd, flags.to)) ??
      root;
    if (flags.apply && flags.plan === "true") {
      return withPreviewRoot(targetRoot, async (previewRoot) => {
        const count = await installPack(root, positionals[0], previewRoot);
        const planned = await applyCurrentManifest(previewRoot, {
          agentIds: parseAgentIds(getAgentFlag(flags)),
          verify: flags.verify === "true",
          backup: flags.backup !== "false",
          materialization: flags.materialize as "symlink" | "copy" | "auto" | undefined,
          store: flags.store,
          plan: true
        });
        return formatPlannedWorkflow(`Installed ${count} resource(s) from pack:${positionals[0]} to ${targetRoot}`, planned);
      });
    }
    const count = await installPack(root, positionals[0], targetRoot);
    if (flags.apply) {
      const applied = await applyCurrentManifest(targetRoot, {
        agentIds: parseAgentIds(getAgentFlag(flags)),
        verify: flags.verify === "true",
        backup: flags.backup !== "false",
        materialization: flags.materialize as "symlink" | "copy" | "auto" | undefined,
        store: flags.store
      });
      return `Installed ${count} resource(s) from pack:${positionals[0]} to ${targetRoot} and applied ${applied.actions} action(s)`;
    }
    return `Installed ${count} resource(s) from pack:${positionals[0]} to ${targetRoot}`;
  }

  if (command === "pack" && subcommand === "list") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    return (await listPacks(root)).map((item) => item.id).join("\n");
  }

  if (command === "pack" && subcommand === "remove") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    await removePack(root, positionals[0]);
    return `Removed pack:${positionals[0]}`;
  }

  if (command === "pack" && subcommand === "build") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    await exportPack(root, positionals[0], flags.out);
    return `Built pack:${positionals[0]} to ${flags.out}`;
  }

  if (command === "pack" && subcommand === "publish") {
    const selector = `pack:${positionals[0]}`;
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    await publishSelector(root, selector, flags.registry);
    return `Published ${selector}`;
  }

  if (command === "pack" && subcommand === "import") {
    const root = await resolveCommandRoot(context, flags.scope as string | undefined);
    await importPack(root, positionals[0]);
    return `Imported pack from ${positionals[0]}`;
  }

  if (command === "approval" && subcommand === "add") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const selector = positionals[0];
    let digest = flags.digest;
    if (!digest && selector.startsWith("pack:")) {
      const manifest = await loadManifest(root);
      const pack = manifest.packs.find((item) => item.id === selector.slice("pack:".length));
      digest = pack?.signature?.digest ?? digest;
    }
    if (!digest) {
      throw new Error("Missing approval digest");
    }
    if (!flags.by) {
      throw new Error("Missing --by for approval add");
    }
    await approveSelector(root, selector, digest, flags.by, flags.role);
    return `Approved ${selector} by ${flags.by}`;
  }

  if (command === "approval" && subcommand === "list") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    return (await listApprovals(root))
      .map((item) => `${item.selector}\t${item.digest}\t${item.approvedBy}${item.role ? `\t${item.role}` : ""}`)
      .join("\n");
  }

  if (command === "approval" && subcommand === "revoke") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    await revokeApproval(root, positionals[0], flags.digest);
    return `Revoked approval for ${positionals[0]}`;
  }

  if (command === "backup" && subcommand === "create") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const backupId = await createBackup(root);
    return `Backup created: ${backupId}`;
  }

  if (command === "backup" && subcommand === "restore") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    await restoreBackup(root, positionals[0]);
    return `Backup restored: ${positionals[0]}`;
  }

  if (command === "backup" && subcommand === "list") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    return (await listBackups(root)).join("\n");
  }

  if (command === "restore") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    await restoreBackup(root, positionals[0]);
    return `Backup restored: ${positionals[0]}`;
  }

  if (command === "rollback") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const backupId =
      positionals[0] ??
      (() => {
        const statePath = join(root, ".use0-kit", "state.json");
        return readFile(statePath, "utf8")
          .then((content) => {
            const state = JSON.parse(content) as { backupId?: string | null };
            return state.backupId ?? undefined;
          })
          .catch(() => undefined);
      })();
    const resolved = typeof backupId === "string" ? backupId : await backupId;
    if (!resolved) {
      throw new Error("No rollback backup available");
    }
    await restoreBackup(root, resolved);
    return `Rolled back to backup: ${resolved}`;
  }

  if (command === "lock" && subcommand === "refresh") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    await refreshLock(root);
    return "lock refreshed";
  }

  if (command === "lock" && subcommand === "verify") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    return (await verifyLock(root)) ? "lock ok" : "lock mismatch";
  }

  if (command === "lock" && subcommand === "explain") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    return explainLock(root);
  }

  if (command === "lock" && subcommand === "prune") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    return `pruned ${await pruneLock(root)} resource(s)`;
  }

  if (command === "prune") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    return `pruned ${await pruneLock(root)} resource(s)`;
  }

  if (command === "adopt") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    if (flags.preview === "true") {
      const preview = await previewAdoptExisting(root, {
        kind: flags.kind,
        agent: parseAgentId(flags.agent)
      });
      if (flags.json === "true") {
        return JSON.stringify(preview, null, 2);
      }
      return preview.map((item) => `${item.selector}\tagent=${item.agent}\tsource=${item.source}`).join("\n");
    }
    const adopted = await adoptExisting(root, {
      kind: flags.kind,
      agent: parseAgentId(flags.agent),
      action: flags.action as "import" | "ignore" | "leave-external" | undefined
    });
    return `Adopted ${adopted} resource(s)`;
  }

  if (command === "audit") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const selector = positionals[0] ? await resolveLocalSelector(root, positionals[0]) : undefined;
    const report = await auditResourcesFiltered(root, { kind: flags.kind, selector });
    if (flags["fail-on"] && shouldFailAudit(report.findings, flags["fail-on"] as never)) {
      throw new Error("Audit failed");
    }
    return appendVerboseOutput(
      report.findings
        .map((finding) => `${finding.id}\t${finding.severity}\t${finding.rule}`)
        .join("\n"),
      {
        command,
        root,
        flags,
        positionals
      }
    );
  }

  if (command === "registry" && subcommand === "add") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    await addRegistry(root, positionals[0], positionals[1]);
    return `Added registry:${positionals[0]}`;
  }

  if (command === "registry" && subcommand === "list") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const registries = await listRegistries(root);
    return registries
      .map(
        (item) =>
          `${item.name}\t${item.source}${item.syncedAt ? `\t${item.syncedAt}` : ""}${
            item.itemCount !== undefined ? `\titems=${item.itemCount}` : ""
          }${item.verifiedCount !== undefined ? `\tverified=${item.verifiedCount}` : ""}${
            item.errorCount !== undefined ? `\terrors=${item.errorCount}` : ""
          }`
      )
      .join("\n");
  }

  if (command === "registry" && subcommand === "remove") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    await removeRegistry(root, positionals[0]);
    return `Removed registry:${positionals[0]}`;
  }

  if (command === "registry" && subcommand === "sync") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    return `Synced ${await syncRegistry(root, positionals[0])} registr${positionals[0] ? "y" : "ies"}`;
  }

  if (command === "registry" && subcommand === "install") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const selector = await resolveRegistrySelector(root, positionals[0], flags.registry);
    if (flags.apply && flags.plan === "true") {
      return withPreviewRoot(root, async (previewRoot) => {
        await installFromRegistry(previewRoot, selector, flags.registry);
        const planned = await applyCurrentManifest(previewRoot, {
          agentIds: parseAgentIds(getAgentFlag(flags)),
          verify: flags.verify === "true",
          backup: flags.backup !== "false",
          materialization: flags.materialize as "symlink" | "copy" | "auto" | undefined,
          store: flags.store,
          plan: true
        });
        const suffix = flags.registry ? `:${flags.registry}` : "";
        return appendVerboseOutput(formatPlannedWorkflow(`Installed ${selector} from registry${suffix}`, planned), {
          command,
          subcommand,
          root,
          flags,
          positionals
        });
      });
    }
    await installFromRegistry(root, selector, flags.registry);
    const suffix = flags.registry ? `:${flags.registry}` : "";
    if (flags.apply) {
      const applied = await applyCurrentManifest(root, {
        agentIds: parseAgentIds(getAgentFlag(flags)),
        verify: flags.verify === "true",
        backup: flags.backup !== "false",
        materialization: flags.materialize as "symlink" | "copy" | "auto" | undefined,
        store: flags.store
      });
      return appendVerboseOutput(`Installed ${selector} from registry${suffix} and applied ${applied.actions} action(s)`, {
        command,
        subcommand,
        root,
        flags,
        positionals
      });
    }
    return appendVerboseOutput(`Installed ${selector} from registry${suffix}`, {
      command,
      subcommand,
      root,
      flags,
      positionals
    });
  }

  if (command === "registry" && subcommand === "search") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const results = await searchRegistry(root, positionals[0], flags.registry);
    return results
      .map(
        (item) =>
          `${item.kind}:${item.id}\t${item.name}${item.registry ? `\t${item.registry}` : ""}${
            item.quality?.score !== undefined ? `\tscore=${item.quality.score}` : ""
          }`
      )
      .join("\n");
  }

  if (command === "registry" && subcommand === "login") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const path = join(root, ".use0-kit", "registry-auth.json");
    let current: Record<string, boolean> = {};
    try {
      current = JSON.parse(await readFile(path, "utf8")) as Record<string, boolean>;
    } catch {
      current = {};
    }
    current[positionals[0]] = true;
    await writeFile(path, JSON.stringify(current, null, 2) + "\n", "utf8");
    return `Logged into registry:${positionals[0]}`;
  }

  if (command === "registry" && subcommand === "logout") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const path = join(root, ".use0-kit", "registry-auth.json");
    let current: Record<string, boolean> = {};
    try {
      current = JSON.parse(await readFile(path, "utf8")) as Record<string, boolean>;
    } catch {
      current = {};
    }
    delete current[positionals[0]];
    await writeFile(path, JSON.stringify(current, null, 2) + "\n", "utf8");
    return `Logged out registry:${positionals[0]}`;
  }

  if (command === "registry" && subcommand === "info") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const selector = await resolveRegistrySelector(root, positionals[0], flags.registry);
    const item = await getRegistryInfo(root, selector, flags.registry);
    if (!item) {
      throw new Error(`Unknown registry item: ${selector}`);
    }
    const details = [
      `${item.kind}:${item.id}`,
      `name=${item.name}`,
      item.description ? `description=${item.description}` : undefined,
      item.registry ? `registry=${item.registry}` : undefined,
      item.source ? `source=${item.source}` : undefined,
      item.targets?.length ? `targets=${item.targets.join(",")}` : undefined,
      item.version ? `version=${item.version}` : undefined,
      item.resources?.length ? `resources=${item.resources.join(",")}` : undefined,
      item.signature?.keyId ? `signature.key_id=${item.signature.keyId}` : undefined,
      item.signature?.digest ? `signature.digest=${item.signature.digest}` : undefined,
      item.env ? `env=${item.env}` : undefined,
      item.required !== undefined ? `required=${item.required ? "true" : "false"}` : undefined,
      item.command ? `command=${item.command}` : undefined,
      item.transport ? `transport=${item.transport}` : undefined,
      item.quality?.score !== undefined ? `quality.score=${item.quality.score}` : undefined,
      item.quality?.risk !== undefined ? `quality.risk=${item.quality.risk}` : undefined,
      item.quality?.stars !== undefined ? `quality.stars=${item.quality.stars}` : undefined,
      item.quality?.lastUpdated ? `quality.last_updated=${item.quality.lastUpdated}` : undefined,
      item.quality?.archived !== undefined ? `quality.archived=${item.quality.archived ? "true" : "false"}` : undefined,
      item.quality?.license ? `quality.license=${item.quality.license}` : undefined,
      item.index?.scheme ? `index.scheme=${item.index.scheme}` : undefined,
      item.index?.host ? `index.host=${item.index.host}` : undefined,
      item.index?.ref ? `index.ref=${item.index.ref}` : undefined,
      item.index?.subpath ? `index.subpath=${item.index.subpath}` : undefined,
      item.index?.verifiedAt ? `index.verified_at=${item.index.verifiedAt}` : undefined,
      item.index?.verificationStatus ? `index.verification_status=${item.index.verificationStatus}` : undefined,
      item.index?.verificationMessage ? `index.verification_message=${item.index.verificationMessage}` : undefined,
      item.provenance?.source ? `provenance.source=${item.provenance.source}` : undefined,
      item.provenance?.ref ? `provenance.ref=${item.provenance.ref}` : undefined,
      item.provenance?.registry ? `provenance.registry=${item.provenance.registry}` : undefined,
      item.provenance?.publishedAt ? `provenance.published_at=${item.provenance.publishedAt}` : undefined,
      item.provenance?.digest ? `provenance.digest=${item.provenance.digest}` : undefined
    ].filter(Boolean);
    return details.join("\n");
  }

  if (command === "search") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const results = await searchRegistry(root, positionals[0], flags.registry);
    return results
      .map(
        (item) =>
          `${item.kind}:${item.id}\t${item.name}${item.registry ? `\t${item.registry}` : ""}${
            item.quality?.score !== undefined ? `\tscore=${item.quality.score}` : ""
          }`
      )
      .join("\n");
  }

  if (command === "install") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const selector = await resolveRegistrySelector(root, positionals[0], flags.registry);
    if (flags.apply && flags.plan === "true") {
      return withPreviewRoot(root, async (previewRoot) => {
        await installFromRegistry(previewRoot, selector, flags.registry);
        const planned = await applyCurrentManifest(previewRoot, {
          agentIds: parseAgentIds(getAgentFlag(flags)),
          verify: flags.verify === "true",
          backup: flags.backup !== "false",
          materialization: flags.materialize as "symlink" | "copy" | "auto" | undefined,
          store: flags.store,
          plan: true
        });
        return appendVerboseOutput(
          formatPlannedWorkflow(
            `Installed ${selector}${flags.registry ? ` from registry:${flags.registry}` : " from registry"}`,
            planned
          ),
          {
            command,
            root,
            flags,
            positionals
          }
        );
      });
    }
    await installFromRegistry(root, selector, flags.registry);
    if (flags.apply) {
      const applied = await applyCurrentManifest(root, {
        agentIds: parseAgentIds(getAgentFlag(flags)),
        verify: flags.verify === "true",
        backup: flags.backup !== "false",
        materialization: flags.materialize as "symlink" | "copy" | "auto" | undefined,
        store: flags.store
      });
      return appendVerboseOutput(`Installed ${selector}${flags.registry ? ` from registry:${flags.registry}` : " from registry"} and applied ${applied.actions} action(s)`, {
        command,
        root,
        flags,
        positionals
      });
    }
    return appendVerboseOutput(`Installed ${selector}${flags.registry ? ` from registry:${flags.registry}` : " from registry"}`, {
      command,
      root,
      flags,
      positionals
    });
  }

  if (command === "publish") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    await publishSelector(root, positionals[0], flags.registry);
    return `Published ${positionals[0]}`;
  }

  if (command === "diff") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    if (flags.effective) {
      return `effective: ${await diffStateView(root, "effective")}`;
    }
    if (flags.materialized) {
      return `materialized: ${await diffStateView(root, "materialized")}`;
    }
    return await diffState(root);
  }

  if (command === "update") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const selectors = flags.all ? [] : positionals;
    if (flags.recursive) {
      const roots = await findNestedManifestRoots(root);
      let updated = 0;
      for (const root of roots) {
        if (flags.lock) {
          updated += await updateResources(root, selectors);
        }
      }
      return `updated ${updated} resource(s)`;
    }
    return `updated ${await updateResources(root, selectors)} resource(s)`;
  }

  if (command === "sync") {
    if (!flags.from && !flags.to) {
      const root = flags.scope ? await scopePath(context.cwd, flags.scope) : await scopePath(context.cwd);
      await updateResources(root, []);
      if (flags.plan === "true") {
        return withPreviewRoot(root, async (previewRoot) => {
          const count = await syncDeclaredParents(previewRoot);
          const planned = await applyCurrentManifest(previewRoot, {
            agentIds: parseAgentIds(getAgentFlag(flags)),
            verify: flags.verify !== "false",
            backup: flags.backup !== "false",
            materialization: flags.materialize as "symlink" | "copy" | "auto" | undefined,
            store: flags.store,
            plan: true
          });
          return appendVerboseOutput(formatPlannedWorkflow(`Synced ${count} resource(s) from declared parents`, planned), {
            command,
            root,
            flags,
            positionals
          });
        });
      }
      const count = await syncDeclaredParents(root);
      const applied = await applyCurrentManifest(root, {
        agentIds: parseAgentIds(getAgentFlag(flags)),
        verify: flags.verify !== "false",
        backup: flags.backup !== "false",
        materialization: flags.materialize as "symlink" | "copy" | "auto" | undefined,
        store: flags.store
      });
      return appendVerboseOutput(`Synced ${count} resource(s) from declared parents and applied ${applied.actions} action(s)`, {
        command,
        root,
        flags,
        positionals
      });
    }
    const fromRoot = await resolveMaybeScopeRoot(context.cwd, flags.from);
    const toRoot = await resolveMaybeScopeRoot(context.cwd, flags.to);
    if (!fromRoot || !toRoot) {
      throw new Error("Missing --from or --to for sync");
    }
    const resolvedConflict =
      (flags.conflict as
        | "fail"
        | "ask"
        | "skip"
        | "parent-wins"
        | "child-wins"
        | "merge"
        | undefined) ?? (await defaultConflictMode(toRoot));
    ensureInteractiveConflictMode(resolvedConflict);
    const count = await syncScopesDetailed({
      fromRoot,
      toRoot,
      mode: flags.mode as "inherit" | "pin" | "copy" | "fork" | "mirror" | undefined,
      prune: flags.prune === "true",
      conflict: resolvedConflict,
      conflictResolver: resolvedConflict === "ask" ? promptConflictResolution : undefined
    });
    if (flags.apply) {
      if (flags.plan === "true") {
        return withPreviewRoot(toRoot, async (previewRoot) => {
          const previewCount = await syncScopesDetailed({
            fromRoot,
            toRoot: previewRoot,
            mode: flags.mode as "inherit" | "pin" | "copy" | "fork" | "mirror" | undefined,
            prune: flags.prune === "true",
            conflict: resolvedConflict,
            conflictResolver: resolvedConflict === "ask" ? promptConflictResolution : undefined
          });
          const planned = await applyCurrentManifest(previewRoot, {
            agentIds: parseAgentIds(getAgentFlag(flags)),
            verify: flags.verify === "true",
            backup: flags.backup !== "false",
            materialization: flags.materialize as "symlink" | "copy" | "auto" | undefined,
            store: flags.store,
            plan: true
          });
          return appendVerboseOutput(
            formatPlannedWorkflow(`Synced ${previewCount} resource(s) from ${flags.from} to ${flags.to}`, planned),
            {
              command,
              root: toRoot,
              flags,
              positionals
            }
          );
        });
      }
      await applyCurrentManifest(toRoot!, {
        agentIds: parseAgentIds(getAgentFlag(flags)),
        verify: flags.verify === "true",
        backup: flags.backup !== "false",
        materialization: flags.materialize as "symlink" | "copy" | "auto" | undefined,
        store: flags.store
      });
    }
    return appendVerboseOutput(`Synced ${count} resource(s) from ${flags.from} to ${flags.to}`, {
      command,
      root: toRoot,
      flags,
      positionals
    });
  }

  if (command === "fleet" && subcommand === "add") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    await addFleetMember(root, positionals[0], positionals[1]);
    return `Added fleet:${positionals[0]}`;
  }

  if (command === "fleet" && subcommand === "list") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    return (await listFleetMembers(root)).map((item) => `${item.name}\t${item.root}`).join("\n");
  }

  if (command === "fleet" && subcommand === "remove") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    await removeFleetMember(root, positionals[0]);
    return `Removed fleet:${positionals[0]}`;
  }

  if (command === "fleet" && subcommand === "sync") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const fromRoot = flags.from ?? root;
    const members = await listFleetMembers(root);
    const selectedMembers = new Set(parseCsv(flags.member));
    const targets = members.filter((item) => selectedMembers.size === 0 || selectedMembers.has(item.name));
    const selectors = positionals;
    let totalResources = 0;
    let appliedTargets = 0;

    for (const member of targets) {
      const resolvedConflict =
        (flags.conflict as
          | "fail"
          | "ask"
          | "skip"
          | "parent-wins"
          | "child-wins"
          | "merge"
          | undefined) ?? (await defaultConflictMode(member.root));
      ensureInteractiveConflictMode(resolvedConflict);
      if (selectors.length === 0) {
          totalResources += await syncScopesDetailed({
            fromRoot,
            toRoot: member.root,
            mode: flags.mode as "inherit" | "pin" | "copy" | "fork" | "mirror" | undefined,
            prune: flags.prune === "true",
            conflict: resolvedConflict,
            conflictResolver: resolvedConflict === "ask" ? promptConflictResolution : undefined
          });
      } else {
        for (const selector of selectors) {
          totalResources += await syncScopesDetailed({
            fromRoot,
            toRoot: member.root,
            selector,
            mode: flags.mode as "inherit" | "pin" | "copy" | "fork" | "mirror" | undefined,
            prune: flags.prune === "true",
            conflict: resolvedConflict,
            conflictResolver: resolvedConflict === "ask" ? promptConflictResolution : undefined
          });
        }
      }

      if (flags.apply) {
        if (flags.plan === "true") {
          await withPreviewRoot(member.root, async (previewRoot) => {
            await applyCurrentManifest(previewRoot, {
              agentIds: parseAgentIds(getAgentFlag(flags)),
              verify: flags.verify === "true",
              backup: flags.backup !== "false",
              materialization: flags.materialize as "symlink" | "copy" | "auto" | undefined,
              store: flags.store,
              plan: true
            });
          });
        } else {
          await applyCurrentManifest(member.root, {
            agentIds: parseAgentIds(getAgentFlag(flags)),
            verify: flags.verify === "true",
            backup: flags.backup !== "false",
            materialization: flags.materialize as "symlink" | "copy" | "auto" | undefined,
            store: flags.store
          });
        }
        appliedTargets += 1;
      }
    }

    return `Fleet synced ${totalResources} resource(s) to ${targets.length} target(s)${
      flags.apply ? ` and ${flags.plan === "true" ? "planned" : "applied"} ${appliedTargets} target(s)` : ""
    }`;
  }

  if (command === "agent" && subcommand === "detect") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const detected = await detectAgents(root);
    if (flags.json === "true") {
      return JSON.stringify(detected, null, 2);
    }
    return detected
      .map((item) => `${item.id}: ${item.detected ? "detected" : "missing"}\t${item.path}`)
      .join("\n");
  }

  if (command === "agent" && subcommand === "list") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const detected = await detectAgents(root);
    if (flags.json === "true") {
      return JSON.stringify(detected, null, 2);
    }
    return detected
      .map((item) => `${item.id}: ${item.detected ? "detected" : "missing"}\t${item.path}`)
      .join("\n");
  }

  if (command === "agent" && subcommand === "paths") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const paths = getAgentPaths(root);
    const selectedAgent = parseAgentId(flags.agent);
    return Object.entries(paths)
      .filter(([agentId]) => !selectedAgent || agentId === selectedAgent)
      .map(
        ([agentId, pathInfo]) =>
          `${agentId}:\n` +
          `  skills: ${pathInfo.skillDir}\n` +
          `  commands: ${pathInfo.commandDir}\n` +
          `  subagents: ${pathInfo.subagentDir}\n` +
          `  hooks: ${pathInfo.hookDir}\n` +
          `  secrets: ${pathInfo.secretDir}\n` +
          `  mcp config: ${pathInfo.mcpConfigPath}\n` +
          `  instructions: ${pathInfo.instructionPath}`
      )
      .join("\n");
  }

  if (command === "agent" && subcommand === "capabilities") {
    const capabilities = getAgentCapabilities();
    const selectedAgent = parseAgentId(flags.agent);
    return Object.entries(capabilities)
      .filter(([agentId]) => !selectedAgent || agentId === selectedAgent)
      .map(([agentId, values]) => `${agentId}\t${values.join(",")}`)
      .join("\n");
  }

  if (command === "agent" && subcommand === "doctor") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const selector = positionals[0] ? await resolveLocalSelector(root, positionals[0]) : undefined;
    if (flags.fix) {
      const actions = await fixDoctorIssues(root);
      const report = await runDoctorForSelector(root, selector);
      return [
        `fixes: ${actions.length === 0 ? "none" : actions.join(",")}`,
        ...report.checks.map((check) => `${check.id}: ${check.status}`)
      ].join("\n");
    }
    const report = await runDoctorForSelector(root, selector);
    return report.checks.map((check) => `${check.id}: ${check.status}`).join("\n");
  }

  if (command === "agent" && subcommand === "disable") {
    for (const agentId of positionals.map((item) => requireAgentId(item))) {
      await setAgentDisabled(context.cwd, agentId, true);
    }
    return `Disabled agent:${positionals.join(",")}`;
  }

  if (command === "agent" && subcommand === "enable") {
    for (const agentId of positionals.map((item) => requireAgentId(item))) {
      await setAgentDisabled(context.cwd, agentId, false);
    }
    return `Enabled agent:${positionals.join(",")}`;
  }

  if (command === "plan") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const manifest = await loadManifest(root);
    const plan = await buildPlan({
      root,
      manifest: applyStoreOverrideToManifest(manifest, flags.store),
      materialization: flags.materialize as "symlink" | "copy" | "auto" | undefined
    });
    const filtered = filterPlanActionsForAgent(plan.actions, parseAgentIds(getAgentFlag(flags)));
    if (flags.json === "true") {
      return JSON.stringify(filtered, null, 2);
    }
    return appendVerboseOutput(formatPlanActions(filtered), {
      command,
      root,
      flags,
      positionals
    });
  }

  if (command === "apply") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const applied = await applyCurrentManifest(root, {
      agentIds: parseAgentIds(getAgentFlag(flags)),
      verify: flags.verify === "true",
      backup: flags.backup !== "false",
      materialization: flags.materialize as "symlink" | "copy" | "auto" | undefined,
      store: flags.store,
      plan: flags.plan === "true"
    });
    return appendVerboseOutput(applied.planned ? applied.output : `Applied ${applied.actions} action(s)`, {
      command,
      root,
      flags,
      positionals
    });
  }

  if (command === "doctor") {
    const root = flags.scope ? await scopePath(context.cwd, flags.scope) : context.cwd;
    const selector = positionals[0] ? await resolveLocalSelector(root, positionals[0]) : undefined;
    if (flags.fix) {
      const actions = await fixDoctorIssues(root);
      const report = await runDoctorForSelector(root, selector);
      return appendVerboseOutput(
        [
          `fixes: ${actions.length === 0 ? "none" : actions.join(",")}`,
          ...report.checks.map((check) => `${check.id}: ${check.status}`)
        ].join("\n"),
        {
          command,
          root,
          flags,
          positionals
        }
      );
    }
    const report = await runDoctorForSelector(root, selector);
    return appendVerboseOutput(report.checks.map((check) => `${check.id}: ${check.status}`).join("\n"), {
      command,
      root,
      flags,
      positionals
    });
  }

  throw new Error(`Unsupported command: ${args.join(" ")}`);
  } finally {
    setSourceResolverOfflineMode(false);
    setRegistryOfflineMode(false);
  }
}

async function findNestedManifestRoots(root: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    const hasManifest = entries.some((entry) => entry.isFile() && entry.name === "use0-kit.toml");
    if (hasManifest) {
      results.push(dir);
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      await walk(join(dir, entry.name));
    }
  }

  await walk(root);
  return results;
}

function isCliEntrypoint(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (isCliEntrypoint()) {
  runCli(process.argv.slice(2), { cwd: process.cwd() })
    .then((output) => {
      if (output) {
        process.stdout.write(output + "\n");
      }
      process.exitCode = successExitCodeForCli(process.argv.slice(2), output);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(message + "\n");
      process.exitCode = errorExitCodeForCli(error);
    });
}
