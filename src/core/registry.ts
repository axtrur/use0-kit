import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { collectEffectiveGraph } from "./graph-state.js";
import { loadManifest, saveManifest } from "./manifest.js";
import { describeSelectorResource, findBySelector, type SelectorResource } from "./resource-graph.js";
import { parseSourceReference } from "./source-resolver.js";
import type { PackSignature } from "./types.js";

const execFileAsync = promisify(execFile);
let offlineMode = false;

export type RegistryItem = {
  kind: string;
  id: string;
  name: string;
  description?: string;
  source?: string;
  targets?: string[];
  version?: string;
  resources?: string[];
  exports?: string[];
  signature?: PackSignature;
  env?: string;
  required?: boolean;
  command?: string;
  args?: string[];
  transport?: string;
  heading?: string;
  body?: string;
  registry?: string;
  publishedAt?: string;
  provenance?: {
    source?: string;
    ref?: string;
    registry?: string;
    publishedAt?: string;
    digest?: string;
  };
  quality?: {
    score?: number;
    risk?: number;
    stars?: number;
    lastUpdated?: string;
    archived?: boolean;
    license?: string;
  };
  index?: {
    scheme?: string;
    host?: string;
    ref?: string;
    subpath?: string;
    verifiedAt?: string;
    verificationStatus?: "verified" | "error" | "skipped";
    verificationMessage?: string;
  };
};

type RegistryConfig = {
  registries: Array<{
    name: string;
    source: string;
    syncedAt?: string;
    indexedAt?: string;
    itemCount?: number;
    verifiedCount?: number;
    errorCount?: number;
  }>;
};

type RegistryPayload = {
  items: RegistryItem[];
};

export function setRegistryOfflineMode(offline: boolean): void {
  offlineMode = offline;
}

type RegistryIndexEntry = {
  selector: string;
  terms: string[];
  item: RegistryItem;
};

type RegistryIndexPayload = {
  items: RegistryIndexEntry[];
};

function isRemoteRegistrySource(source: string): boolean {
  return /^https?:\/\//.test(source);
}

function cacheKey(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

function registryCachePath(root: string, source: string): string {
  return join(root, ".use0-kit", "registry-cache", `${cacheKey(source)}.json`);
}

function registryIndexPath(root: string, source: string): string {
  return join(root, ".use0-kit", "registry-index", `${cacheKey(source)}.json`);
}

async function loadRegistryConfig(root: string): Promise<RegistryConfig> {
  const path = join(root, ".use0-kit", "registries.json");
  try {
    return JSON.parse(await readFile(path, "utf8")) as RegistryConfig;
  } catch {
    return { registries: [] };
  }
}

async function saveRegistryConfig(root: string, config: RegistryConfig): Promise<void> {
  await mkdir(join(root, ".use0-kit"), { recursive: true });
  await writeFile(join(root, ".use0-kit", "registries.json"), JSON.stringify(config, null, 2) + "\n", "utf8");
}

async function loadRegistryPayload(path: string): Promise<RegistryPayload> {
  try {
    const payload = JSON.parse(await readFile(path, "utf8")) as RegistryPayload;
    return { items: payload.items ?? [] };
  } catch {
    return { items: [] };
  }
}

async function saveRegistryPayload(path: string, payload: RegistryPayload): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

async function loadRegistryIndex(path: string): Promise<RegistryIndexPayload> {
  try {
    const payload = JSON.parse(await readFile(path, "utf8")) as RegistryIndexPayload;
    return { items: payload.items ?? [] };
  } catch {
    return { items: [] };
  }
}

async function saveRegistryIndex(path: string, payload: RegistryIndexPayload): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

async function getReadableRegistryPath(root: string, registry: { name: string; source: string }): Promise<string> {
  if (!isRemoteRegistrySource(registry.source)) {
    return registry.source;
  }
  const cachePath = registryCachePath(root, registry.source);
  try {
    await readFile(cachePath, "utf8");
    return cachePath;
  } catch {
    throw new Error(`Registry ${registry.name} is remote and has not been synced yet.`);
  }
}

function toRegistryItem(selector: string, resource: SelectorResource, registryName: string): RegistryItem {
  const [kind, id] = selector.split(":");
  const base: RegistryItem = {
    kind,
    id,
    name: id,
    description: describeSelectorResource(selector, resource).split("\n").slice(1).join("; "),
    registry: registryName,
    publishedAt: new Date().toISOString()
  };

  if ("source" in resource) {
    base.source = resource.source;
  }
  if ("name" in resource && typeof resource.name === "string") {
    base.name = resource.name;
  }
  if ("targets" in resource) {
    base.targets = resource.targets;
  }
  if ("defaultTargets" in resource && Array.isArray(resource.defaultTargets)) {
    base.targets = resource.defaultTargets;
  }
  if ("version" in resource) {
    base.version = resource.version;
  }
  if ("resources" in resource) {
    base.resources = resource.resources;
  }
  if ("signature" in resource) {
    base.signature = resource.signature;
  }
  if ("exports" in resource) {
    base.exports = resource.exports;
  }
  if ("env" in resource && typeof resource.env === "string") {
    base.env = resource.env;
  }
  if ("required" in resource && typeof resource.required === "boolean") {
    base.required = resource.required;
  }
  if ("command" in resource && typeof resource.command === "string") {
    base.command = resource.command;
  }
  if ("args" in resource && Array.isArray(resource.args)) {
    base.args = resource.args;
  }
  if ("transport" in resource && typeof resource.transport === "string") {
    base.transport = resource.transport;
  }
  if ("heading" in resource && typeof resource.heading === "string") {
    base.heading = resource.heading;
  }
  if ("body" in resource && typeof resource.body === "string") {
    base.body = resource.body;
  }

  return base;
}

function deriveQualitySignals(item: RegistryItem): NonNullable<RegistryItem["quality"]> {
  let score = 50;
  let risk = 5;

  if (item.provenance?.digest) {
    score += 15;
    risk -= 2;
  }
  if (item.provenance?.ref) {
    score += 10;
    risk -= 1;
  }
  if ((item.targets?.length ?? 0) > 0) {
    score += 5;
  }
  if ((item.resources?.length ?? 0) > 0 || (item.exports?.length ?? 0) > 0) {
    score += 5;
  }
  if (item.signature?.digest) {
    score += 15;
    risk -= 1;
  }
  if (item.source?.startsWith("path:")) {
    score += 5;
  }
  if (item.source?.startsWith("inline:")) {
    risk += 1;
  }
  if (item.index?.verificationStatus === "verified") {
    score += 5;
    risk -= 1;
  }
  if (item.index?.verificationStatus === "error") {
    score -= 15;
    risk += 3;
  }

  score = Math.max(0, Math.min(100, score));
  risk = Math.max(0, Math.min(10, risk));

  return {
    score,
    risk,
    lastUpdated: item.publishedAt
  };
}

function normalizeRegistryItem(item: RegistryItem, registryName: string): RegistryItem {
  const normalized: RegistryItem = {
    ...item,
    registry: item.registry ?? registryName
  };
  normalized.quality = {
    ...deriveQualitySignals(normalized),
    ...(item.quality ?? {})
  };
  return normalized;
}

function buildRegistryIndex(items: RegistryItem[]): RegistryIndexPayload {
  return {
    items: items.map((item) => ({
      selector: `${item.kind}:${item.id}`,
      terms: [
        item.kind,
        item.id,
        item.name,
        item.description,
        item.registry,
        ...(item.targets ?? [])
      ]
        .filter((value): value is string => Boolean(value))
        .flatMap((value) => value.toLowerCase().split(/[^a-z0-9@._:/-]+/i).filter(Boolean)),
      item
    }))
  };
}

function extractHost(value: string): string | undefined {
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

async function verifyHttpSource(url: string): Promise<{ status: "verified" | "error" | "skipped"; message?: string }> {
  if (offlineMode) {
    return { status: "skipped", message: "offline-mode" };
  }
  let response = await fetch(url, { method: "HEAD" });
  if (response.ok) {
    return { status: "verified" };
  }
  if (response.status === 405 || response.status === 501) {
    response = await fetch(url);
    if (response.ok) {
      return { status: "verified" };
    }
  }
  return { status: "error", message: `HTTP ${response.status}` };
}

async function verifyGitSource(repo: string, ref?: string): Promise<{ status: "verified" | "error" | "skipped"; message?: string }> {
  if (offlineMode) {
    return { status: "skipped", message: "offline-mode" };
  }
  if (repo.startsWith("git@")) {
    return { status: "skipped", message: "ssh-verification-skipped" };
  }
  try {
    const args = ["ls-remote", repo];
    if (ref) {
      args.push(ref);
    }
    await execFileAsync("git", args, { timeout: 5000 });
    return { status: "verified" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", message };
  }
}

async function crawlRegistryItem(
  item: RegistryItem,
  registrySource: string
): Promise<RegistryItem> {
  if (!item.source) {
    return item;
  }

  const verifiedAt = new Date().toISOString();

  try {
    const parsed = /^https?:\/\//.test(item.source)
      ? { scheme: "url" as const, url: item.source }
      : parseSourceReference(item.source);
    const next: RegistryItem = {
      ...item,
      index: {
        ...item.index,
        scheme: parsed.scheme,
        verifiedAt
      }
    };

    if (parsed.scheme === "path") {
      if (/^https?:\/\//.test(registrySource)) {
        next.index = {
          ...next.index,
          verificationStatus: "skipped",
          verificationMessage: "path-source-from-remote-registry"
        };
        return next;
      }
      try {
        await access(join(dirname(registrySource), parsed.path));
        next.index = {
          ...next.index,
          verificationStatus: "verified"
        };
      } catch {
        next.index = {
          ...next.index,
          verificationStatus: "error",
          verificationMessage: "path-not-found"
        };
      }
      return next;
    }

    if (parsed.scheme === "inline" || parsed.scheme === "npm") {
      next.index = {
        ...next.index,
        verificationStatus: "verified"
      };
      return next;
    }

    if (parsed.scheme === "url") {
      next.index = {
        ...next.index,
        host: extractHost(parsed.url)
      };
      const verification = await verifyHttpSource(parsed.url);
      next.index = {
        ...next.index,
        verificationStatus: verification.status,
        verificationMessage: verification.message
      };
      return next;
    }

    if (parsed.scheme === "well-known") {
      const url = `${parsed.base}/.well-known/agent-skills`;
      next.index = {
        ...next.index,
        host: extractHost(parsed.base)
      };
      const verification = await verifyHttpSource(url);
      next.index = {
        ...next.index,
        verificationStatus: verification.status,
        verificationMessage: verification.message
      };
      return next;
    }

    if (parsed.scheme === "git") {
      next.index = {
        ...next.index,
        host: extractHost(parsed.repo) ?? (parsed.repo.includes("@") ? parsed.repo.split("@").pop()?.split(":")[0] : undefined),
        ref: parsed.ref,
        subpath: parsed.subpath
      };
      const verification = await verifyGitSource(parsed.repo, parsed.ref);
      next.index = {
        ...next.index,
        verificationStatus: verification.status,
        verificationMessage: verification.message
      };
      return next;
    }

    return next;
  } catch (error) {
    return {
      ...item,
      index: {
        ...item.index,
        verifiedAt,
        verificationStatus: "error",
        verificationMessage: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

export async function addRegistry(root: string, name: string, source: string): Promise<void> {
  const config = await loadRegistryConfig(root);
  config.registries = config.registries.filter((item) => item.name !== name);
  config.registries.push({ name, source });
  await saveRegistryConfig(root, config);
}

export async function listRegistries(root: string): Promise<
  Array<{
    name: string;
    source: string;
    syncedAt?: string;
    indexedAt?: string;
    itemCount?: number;
    verifiedCount?: number;
    errorCount?: number;
  }>
> {
  return (await loadRegistryConfig(root)).registries;
}

export async function removeRegistry(root: string, name: string): Promise<void> {
  const config = await loadRegistryConfig(root);
  config.registries = config.registries.filter((item) => item.name !== name);
  await saveRegistryConfig(root, config);
}

export async function syncRegistry(root: string, name?: string): Promise<number> {
  const config = await loadRegistryConfig(root);
  const targets = name ? config.registries.filter((item) => item.name === name) : config.registries;
  let synced = 0;

  for (const registry of targets) {
    let payload: RegistryPayload;
    if (!isRemoteRegistrySource(registry.source)) {
      payload = await loadRegistryPayload(registry.source);
    } else {
      if (offlineMode) {
        throw new Error(`Offline mode prevents syncing remote registry ${registry.name}`);
      }
      const response = await fetch(registry.source);
      if (!response.ok) {
        throw new Error(`Failed to sync registry ${registry.name}: ${response.status}`);
      }
      payload = JSON.parse(await response.text()) as RegistryPayload;
    }
    const items = await Promise.all(
      (payload.items ?? []).map(async (item) => normalizeRegistryItem(await crawlRegistryItem(item, registry.source), registry.name))
    );
    await saveRegistryIndex(registryIndexPath(root, registry.source), buildRegistryIndex(items));
    if (isRemoteRegistrySource(registry.source)) {
      await saveRegistryPayload(registryCachePath(root, registry.source), { items });
    }
    const now = new Date().toISOString();
    registry.syncedAt = now;
    registry.indexedAt = now;
    registry.itemCount = items.length;
    registry.verifiedCount = items.filter((item) => item.index?.verificationStatus === "verified").length;
    registry.errorCount = items.filter((item) => item.index?.verificationStatus === "error").length;
    synced += 1;
  }

  await saveRegistryConfig(root, config);
  return synced;
}

async function loadItems(root: string, registryName?: string): Promise<RegistryItem[]> {
  const registries = (await listRegistries(root)).filter((registry) => !registryName || registry.name === registryName);
  const items: RegistryItem[] = [];

  for (const registry of registries) {
    const indexPath = registryIndexPath(root, registry.source);
    const index = await loadRegistryIndex(indexPath);
    if (index.items.length > 0) {
      items.push(...index.items.map((entry) => normalizeRegistryItem(entry.item, registry.name)));
      continue;
    }

    const payload = await loadRegistryPayload(await getReadableRegistryPath(root, registry));
    const normalized = payload.items.map((item) => normalizeRegistryItem(item, registry.name));
    items.push(...normalized);
    await saveRegistryIndex(indexPath, buildRegistryIndex(normalized));
  }

  return items;
}

export async function searchRegistry(root: string, query: string, registryName?: string): Promise<RegistryItem[]> {
  const normalized = query.toLowerCase();
  const registries = (await listRegistries(root)).filter((registry) => !registryName || registry.name === registryName);
  const matches: RegistryItem[] = [];

  for (const registry of registries) {
    const indexPath = registryIndexPath(root, registry.source);
    const index = await loadRegistryIndex(indexPath);
    if (index.items.length === 0) {
      await loadItems(root, registry.name);
    }
    const refreshed = await loadRegistryIndex(indexPath);
    const selectorQuery = normalized.includes(":") ? normalized : undefined;
    matches.push(
      ...refreshed.items
        .filter((entry) =>
          selectorQuery
            ? entry.selector.toLowerCase().includes(selectorQuery)
            : entry.terms.some((term) => term.includes(normalized))
        )
        .map((entry) => normalizeRegistryItem(entry.item, registry.name))
    );
  }

  return matches
    .sort((left, right) => {
      const leftScore = left.quality?.score ?? 0;
      const rightScore = right.quality?.score ?? 0;
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      const leftRisk = left.quality?.risk ?? Number.POSITIVE_INFINITY;
      const rightRisk = right.quality?.risk ?? Number.POSITIVE_INFINITY;
      if (leftRisk !== rightRisk) {
        return leftRisk - rightRisk;
      }
      const leftUpdated = Date.parse(left.quality?.lastUpdated ?? "") || 0;
      const rightUpdated = Date.parse(right.quality?.lastUpdated ?? "") || 0;
      if (rightUpdated !== leftUpdated) {
        return rightUpdated - leftUpdated;
      }
      return left.name.localeCompare(right.name);
    });
}

export async function getRegistryInfo(
  root: string,
  selector: string,
  registryName?: string
): Promise<RegistryItem | undefined> {
  const [kind, id] = selector.split(":");
  return (await loadItems(root, registryName)).find((item) => item.kind === kind && item.id === id);
}

export async function resolveRegistrySelector(
  root: string,
  raw: string,
  registryName?: string
): Promise<string> {
  if (raw.includes(":")) {
    return raw;
  }
  const matches = (await loadItems(root, registryName)).filter((item) => item.id === raw);
  if (matches.length === 1) {
    return `${matches[0].kind}:${matches[0].id}`;
  }
  if (matches.length === 0) {
    throw new Error(`Unknown registry item: ${raw}`);
  }
  throw new Error(`Ambiguous registry item id: ${raw}`);
}

export async function publishToRegistry(
  root: string,
  selector: string,
  registryName: string
): Promise<RegistryItem> {
  const registries = await listRegistries(root);
  const registry = registries.find((item) => item.name === registryName);
  if (!registry) {
    throw new Error(`Unknown registry: ${registryName}`);
  }
  if (isRemoteRegistrySource(registry.source)) {
    throw new Error(`Registry ${registryName} is remote and cannot be published to directly.`);
  }

  const manifest = await loadManifest(root);
  const resource = findBySelector(manifest, selector);
  if (!resource) {
    throw new Error(`Unknown resource: ${selector}`);
  }
  const effectiveGraph = await collectEffectiveGraph(root);
  const effective = effectiveGraph[selector];

  const payload = await loadRegistryPayload(registry.source);
  const item = toRegistryItem(selector, resource, registry.name);
  item.provenance = {
    ...("provenance" in resource ? resource.provenance : undefined),
    source:
      ("source" in resource && typeof resource.source === "string" ? resource.source : undefined) ??
      ("env" in resource && typeof resource.env === "string" ? resource.env : undefined),
    registry: registry.name,
    publishedAt: item.publishedAt,
    digest: effective?.digest
  };
  item.quality = deriveQualitySignals(item);
  payload.items = payload.items.filter((entry) => !(entry.kind === item.kind && entry.id === item.id));
  payload.items.push(item);
  await saveRegistryPayload(registry.source, payload);
  await saveRegistryIndex(
    registryIndexPath(root, registry.source),
    buildRegistryIndex(payload.items.map((entry) => normalizeRegistryItem(entry, registry.name)))
  );
  return item;
}

export async function installFromRegistry(
  root: string,
  selector: string,
  registryName?: string,
  visited: Set<string> = new Set()
): Promise<void> {
  if (visited.has(selector)) {
    return;
  }
  visited.add(selector);
  const item = await getRegistryInfo(root, selector, registryName);
  if (!item) {
    throw new Error(`Unknown registry item: ${selector}`);
  }

  const manifest = await loadManifest(root);
  if (item.kind === "skill") {
    manifest.skills = manifest.skills.filter((entry) => entry.id !== item.id);
    manifest.skills.push({
      id: item.id,
      source: item.source ?? "",
      targets: (item.targets ?? []) as typeof manifest.skills[number]["targets"],
      provenance: item.provenance
    });
  } else if (item.kind === "mcp") {
    manifest.mcps = manifest.mcps.filter((entry) => entry.id !== item.id);
    manifest.mcps.push({
      id: item.id,
      command: item.command,
      args: item.args,
      url: item.source?.startsWith("http") ? item.source : undefined,
      transport: item.transport as "stdio" | "http" | undefined,
      targets: (item.targets ?? []) as typeof manifest.mcps[number]["targets"],
      provenance: item.provenance
    });
  } else if (item.kind === "instruction") {
    manifest.instructions = manifest.instructions.filter((entry) => entry.id !== item.id);
    manifest.instructions.push({
      id: item.id,
      heading: item.heading ?? item.name,
      body: item.body ?? "",
      targets: (item.targets ?? []) as typeof manifest.instructions[number]["targets"],
      provenance: item.provenance
    });
  } else if (item.kind === "command") {
    manifest.commands = manifest.commands.filter((entry) => entry.id !== item.id);
    manifest.commands.push({
      id: item.id,
      source: item.source ?? "",
      targets: (item.targets ?? []) as typeof manifest.commands[number]["targets"],
      provenance: item.provenance
    });
  } else if (item.kind === "subagent") {
    manifest.subagents = manifest.subagents.filter((entry) => entry.id !== item.id);
    manifest.subagents.push({
      id: item.id,
      source: item.source ?? "",
      targets: (item.targets ?? []) as typeof manifest.subagents[number]["targets"],
      provenance: item.provenance
    });
  } else if (item.kind === "hook") {
    manifest.hooks = manifest.hooks.filter((entry) => entry.id !== item.id);
    manifest.hooks.push({
      id: item.id,
      source: item.source ?? "",
      targets: (item.targets ?? []) as typeof manifest.hooks[number]["targets"],
      provenance: item.provenance
    });
  } else if (item.kind === "pack") {
    manifest.packs = manifest.packs.filter((entry) => entry.id !== item.id);
    manifest.packs.push({
      id: item.id,
      name: item.name,
      version: item.version ?? "0.0.0",
      resources: item.resources ?? [],
      signature: item.signature,
      provenance: item.provenance
    });
  } else if (item.kind === "profile") {
    manifest.profiles = manifest.profiles.filter((entry) => entry.id !== item.id);
    manifest.profiles.push({
      id: item.id,
      name: item.name,
      exports: item.exports ?? [],
      defaultTargets: item.targets as typeof manifest.profiles[number]["defaultTargets"],
      provenance: item.provenance
    });
  } else if (item.kind === "secret") {
    manifest.secrets = manifest.secrets.filter((entry) => entry.id !== item.id);
    manifest.secrets.push({
      id: item.id,
      env: item.env ?? "",
      required: item.required,
      targets: (item.targets ?? []) as typeof manifest.secrets[number]["targets"],
      provenance: item.provenance
    });
  } else if (item.kind === "plugin") {
    manifest.plugins = manifest.plugins.filter((entry) => entry.id !== item.id);
    manifest.plugins.push({
      id: item.id,
      source: item.source ?? "",
      targets: (item.targets ?? []) as typeof manifest.plugins[number]["targets"],
      provenance: item.provenance
    });
  } else {
    throw new Error(`Unsupported registry install kind: ${item.kind}`);
  }

  await saveManifest(root, manifest);

  if (item.kind === "pack") {
    for (const child of item.resources ?? []) {
      await installFromRegistry(root, child, registryName, visited);
    }
  }
  if (item.kind === "profile") {
    for (const child of item.exports ?? []) {
      await installFromRegistry(root, child, registryName, visited);
    }
  }
}
