import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { collectEffectiveGraph } from "./graph-state.js";
import { loadManifest, saveManifest, ensureLockfile, ensureState } from "./manifest.js";
import {
  applySelectorToManifest,
  describeSelectorResource,
  findBySelector,
  listSelectors,
  type SelectorResource,
  summarizeSelectorResource
} from "./resource-graph.js";
import { syncScopesDetailed } from "./reconciliation.js";
import { managedSourceDir } from "./resources.js";
import { activeScopeRoots, getScopeRoots } from "./scope-locations.js";
import { targetMatches } from "./targets.js";
import type {
  AgentId,
  InitScopeOptions,
  Manifest,
} from "./types.js";

export async function initScope(options: InitScopeOptions): Promise<void> {
  const roots = getScopeRoots(options.cwd);
  const scopeRoot =
    options.scope === "global"
      ? process.env.XDG_DATA_HOME
        ? roots.global
        : options.cwd
      : options.scope === "user"
        ? process.env.XDG_CONFIG_HOME
          ? roots.user
          : options.cwd
        : options.scope === "session"
          ? roots.session
        : options.cwd;
  const manifest: Manifest = {
    version: 1,
    defaultScope: options.scope,
    scope: {
      level: options.scope,
      mode: options.scope,
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

  await mkdir(scopeRoot, { recursive: true });
  if (options.scope === "project" || options.scope === "workspace" || options.scope === "session") {
    await mkdir(join(scopeRoot, ".agents", "skills"), { recursive: true });
    await mkdir(join(scopeRoot, ".agents", "instructions"), { recursive: true });
    await mkdir(join(scopeRoot, ".agents", "commands"), { recursive: true });
    await mkdir(join(scopeRoot, ".agents", "subagents"), { recursive: true });
    await mkdir(join(scopeRoot, ".agents", "hooks"), { recursive: true });
    await mkdir(join(scopeRoot, ".agents", "plugins"), { recursive: true });
  }
  await mkdir(join(scopeRoot, ".use0-kit", "store", "skills"), { recursive: true });
  await mkdir(managedSourceDir(scopeRoot, "skills"), { recursive: true });
  await mkdir(managedSourceDir(scopeRoot, "instructions"), { recursive: true });
  await mkdir(managedSourceDir(scopeRoot, "commands"), { recursive: true });
  await mkdir(managedSourceDir(scopeRoot, "subagents"), { recursive: true });
  await mkdir(managedSourceDir(scopeRoot, "hooks"), { recursive: true });
  await mkdir(join(scopeRoot, ".use0-kit", "backups"), { recursive: true });
  await saveManifest(scopeRoot, manifest);
  await ensureLockfile(scopeRoot);
  await ensureState(scopeRoot);
}

export async function listScopes(cwd: string): Promise<
  Array<{ name: "builtin" | "project" | "workspace" | "user" | "global" | "session"; path: string; active: boolean }>
> {
  const roots = await activeScopeRoots(cwd);
  const scopes = [
    { name: "builtin" as const, path: "internal", active: true },
    { name: "global" as const, path: roots.global ?? "", active: false },
    { name: "user" as const, path: roots.user ?? "", active: false },
    { name: "workspace" as const, path: roots.workspace ?? "", active: false },
    { name: "project" as const, path: roots.project ?? "", active: false },
    { name: "session" as const, path: roots.session ?? "", active: false }
  ];

  for (const scope of scopes) {
    if (scope.name === "builtin") {
      continue;
    }
    try {
      await access(join(scope.path, "use0-kit.toml"));
      scope.active = true;
    } catch {
      scope.active = false;
    }
  }

  return scopes;
}

export async function currentScope(cwd: string): Promise<string> {
  const scopes = await listScopes(cwd);
  return scopes
    .filter((scope) => scope.active)
    .at(-1)?.name ?? "builtin";
}

export async function scopePath(cwd: string, scope?: string): Promise<string> {
  const scopes = await listScopes(cwd);
  if (!scope) {
    return scopes.filter((item) => item.active).at(-1)?.path ?? cwd;
  }
  return scopes.find((item) => item.name === scope)?.path ?? cwd;
}

export async function inspectScope(cwd: string, scope?: string): Promise<string> {
  return inspectScopeDetailed(cwd, { scope });
}

export async function inspectScopeSnapshot(
  cwd: string,
  options?: {
    scope?: string;
    kind?: string;
    agentId?: AgentId;
  }
): Promise<{
  scope: string;
  path: string;
  manifest: string;
  parents: number;
  parentEntries: Array<{ scope: string; selector?: string; mode?: string }>;
  resources: number;
  selectors: string[];
  materialized?: Record<string, Record<string, string | string[]>>;
}> {
  const path = await scopePath(cwd, options?.scope);
  if (path === "internal") {
    return {
      scope: "builtin",
      path,
      manifest: "internal",
      parents: 0,
      parentEntries: [],
      resources: 0,
      selectors: []
    };
  }
  const manifestPath = join(path, "use0-kit.toml");
  await access(manifestPath);
  const manifest = await loadManifest(path);
  const selectors = listSelectors(manifest)
    .filter((selector) => !options?.kind || selector.startsWith(`${options.kind}:`))
    .filter((selector) => {
      if (!options?.agentId) {
        return true;
      }
      const resource = findBySelector(manifest, selector);
      return resource ? resourceTargetsResource(resource, options.agentId) : false;
    });
  const graph: Record<string, { materialized?: Record<string, string | string[]> }> = await collectEffectiveGraph(path).catch(
    () => ({})
  );
  const materialized = Object.fromEntries(
    selectors
      .map((selector) => [selector, graph[selector]?.materialized] as const)
      .filter((entry): entry is [string, Record<string, string | string[]>] => Boolean(entry[1]))
  );

  return {
    scope: options?.scope ?? (await currentScope(cwd)),
    path,
    manifest: manifestPath,
    parents: manifest.scope?.parents.length ?? 0,
    parentEntries: (manifest.scope?.parents ?? []).map((parent) => ({
      scope: parent.scope,
      selector: parent.selector,
      mode: parent.mode
    })),
    resources: selectors.length,
    selectors,
    materialized
  };
}

export async function inspectScopeDetailed(
  cwd: string,
  options?: {
    scope?: string;
    kind?: string;
    agentId?: AgentId;
  }
): Promise<string> {
  const snapshot = await inspectScopeSnapshot(cwd, options);

  return [
    `scope=${snapshot.scope}`,
    `path=${snapshot.path}`,
    `manifest=${snapshot.manifest}`,
    `parents=${snapshot.parents}`,
    ...snapshot.parentEntries.map((parent, index) =>
      `parent[${index}]=scope:${parent.scope}${parent.selector ? `,selector:${parent.selector}` : ""}${parent.mode ? `,mode:${parent.mode}` : ""}`
    ),
    `resources=${snapshot.resources}`,
    ...Object.entries(snapshot.materialized ?? {}).map(
      ([selector, entries]) =>
        `materialized.${selector}=${Object.entries(entries)
          .map(([target, value]) => `${target}:${Array.isArray(value) ? value.join(",") : value}`)
          .join(";")}`
    ),
    ...snapshot.selectors
  ].join("\n");
}

function resourceTargetsResource(resource: SelectorResource, agentId: AgentId): boolean {
  return "targets" in resource && Array.isArray(resource.targets)
    ? targetMatches(resource.targets, agentId)
    : true;
}

export async function syncScopes(fromRoot: string, toRoot: string): Promise<number> {
  const source = await loadManifest(fromRoot);
  const target = await loadManifest(toRoot);
  let copied = 0;

  for (const selector of listSelectors(source)) {
    const resource = findBySelector(source, selector);
    if (!resource) {
      continue;
    }
    if (applySelectorToManifest(target, selector, resource)) {
      copied += 1;
    }
  }

  await saveManifest(toRoot, target);
  return copied;
}

export async function explainResource(root: string, selector: string): Promise<string> {
  const manifest = await loadManifest(root);
  const resource = findBySelector(manifest, selector);
  if (!resource) throw new Error(`Unknown resource: ${selector}`);
  return describeSelectorResource(selector, resource);
}

async function tryLoadManifest(root: string | null): Promise<Manifest | null> {
  if (!root || root === "internal") {
    return null;
  }
  try {
    return await loadManifest(root);
  } catch {
    return null;
  }
}

export async function explainScopedResource(
  cwd: string,
  selector: string,
  options?: { scope?: "global" | "user" | "workspace" | "project" | "session"; agentId?: AgentId }
): Promise<string> {
  const snapshot = await explainScopedSnapshot(cwd, selector, options);
  const lines = [snapshot.selector, ...snapshot.scopes.map((item) => `${item.scope}: ${item.status}`), `result: ${snapshot.result}`];
  return lines.join("\n");
}

export async function explainScopedSnapshot(
  cwd: string,
  selector: string,
  options?: { scope?: "global" | "user" | "workspace" | "project" | "session"; agentId?: AgentId }
): Promise<{
  selector: string;
  scopes: Array<{ scope: string; status: string }>;
  winnerScope?: string;
  winnerSummary?: string;
  result: string;
}> {
  const roots = await activeScopeRoots(cwd);
  const allScopes: Array<keyof typeof roots> = ["builtin", "global", "user", "workspace", "project", "session"];
  const orderedScopes = options?.scope
    ? allScopes.slice(0, allScopes.indexOf(options.scope) + 1)
    : allScopes;
  const manifests = {
    global: await tryLoadManifest(roots.global),
    user: await tryLoadManifest(roots.user),
    workspace: await tryLoadManifest(roots.workspace),
    project: await tryLoadManifest(roots.project),
    session: await tryLoadManifest(roots.session)
  };

  const entries: Array<{ scope: string; status: string }> = [];
  let winnerScope: string | null = null;
  let winnerSummary = "";

  for (const scope of orderedScopes) {
    if (scope === "builtin") {
      entries.push({ scope: "builtin", status: "not present" });
      continue;
    }
    const manifest = manifests[scope];
    if (manifest?.excludes.some((exclude) => exclude.selector === selector)) {
      entries.push({ scope, status: "excluded" });
      if (scope === "project") {
        return {
          selector,
          scopes: entries,
          result: "excluded"
        };
      }
      continue;
    }
    const resource = manifest ? findBySelector(manifest, selector) : undefined;
    if (!resource) {
      entries.push({ scope, status: "not present" });
      continue;
    }
    if (
      options?.agentId &&
      "targets" in resource &&
      Array.isArray(resource.targets) &&
      !targetMatches(resource.targets, options.agentId)
    ) {
      entries.push({ scope, status: `not targeted to ${options.agentId}` });
      continue;
    }
    const summary = summarizeSelectorResource(selector, resource);
    entries.push({ scope, status: summary });
    winnerScope = scope;
    winnerSummary = summary;
  }

  if (!winnerScope) {
    return {
      selector,
      scopes: entries,
      result: "not present"
    };
  }

  const shadowed = orderedScopes
    .filter((scope) => scope !== "builtin" && scope !== winnerScope)
    .some((scope) => {
      const manifest = manifests[scope as keyof typeof manifests];
      const resource = manifest ? findBySelector(manifest, selector) : undefined;
      if (!resource) {
        return false;
      }
      if (
        options?.agentId &&
        "targets" in resource &&
        Array.isArray(resource.targets) &&
        !targetMatches(resource.targets, options.agentId)
      ) {
        return false;
      }
      return true;
    });
  const overriddenParent = orderedScopes
    .filter((scope) => scope !== "builtin")
    .some((scope) => {
      if (scope === winnerScope) {
        return false;
      }
      const manifest = manifests[scope as keyof typeof manifests];
      const resource = manifest ? findBySelector(manifest, selector) : undefined;
      if (!resource) {
        return false;
      }
      if (
        options?.agentId &&
        "targets" in resource &&
        Array.isArray(resource.targets) &&
        !targetMatches(resource.targets, options.agentId)
      ) {
        return false;
      }
      return true;
    });

  return {
    selector,
    scopes: entries,
    winnerScope,
    winnerSummary,
    result: `${winnerScope} wins${shadowed || overriddenParent ? " shadowed" : ""} ${winnerSummary}`
  };
}

export async function diffScopes(fromRoot: string, toRoot: string): Promise<string[]> {
  const source = await loadManifest(fromRoot);
  const target = await loadManifest(toRoot);
  const diffs: string[] = [];

  for (const selector of source.skills.map((item) => `skill:${item.id}`)) {
    if (!target.skills.some((item) => `skill:${item.id}` === selector)) {
      diffs.push(`missing ${selector} in target`);
    }
  }
  for (const selector of source.mcps.map((item) => `mcp:${item.id}`)) {
    if (!target.mcps.some((item) => `mcp:${item.id}` === selector)) {
      diffs.push(`missing ${selector} in target`);
    }
  }
  for (const selector of source.instructions.map((item) => `instruction:${item.id}`)) {
    if (!target.instructions.some((item) => `instruction:${item.id}` === selector)) {
      diffs.push(`missing ${selector} in target`);
    }
  }

  return diffs;
}

export async function defaultConflictMode(root: string) {
  return (await loadManifest(root)).policy.onConflict;
}

export async function syncDeclaredParents(cwd: string): Promise<number> {
  const root = await scopePath(cwd);
  const manifest = await loadManifest(root);
  const parents = manifest.scope?.parents ?? [];
  const roots = await activeScopeRoots(root);
  let synced = 0;

  for (const parent of parents) {
    const fromRoot = roots[parent.scope];
    if (!fromRoot || fromRoot === "internal") {
      continue;
    }
    synced += await syncScopesDetailed({
      fromRoot,
      toRoot: root,
      selector: parent.selector,
      mode: parent.mode,
      conflict: manifest.policy.onConflict
    });
  }

  return synced;
}
