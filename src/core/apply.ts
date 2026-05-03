import { cp, link, lstat, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { refreshLock } from "./lock.js";
import { loadState } from "./state.js";
import { writeApplyState } from "./state.js";
import type { MaterializationPlan } from "./types.js";

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function loadManagedPaths(root: string): Promise<Set<string>> {
  const managed = new Set<string>();
  try {
    const state = await loadState(root);
    for (const action of state.actions) {
      if (typeof action.path === "string") {
        managed.add(action.path);
      }
    }
  } catch {
    // state is best-effort; materialized graph is checked below too.
  }

  try {
    const materialized = JSON.parse(await readFile(join(root, ".use0-kit", "materialized.json"), "utf8")) as {
      entries?: Array<{ path?: string }>;
    };
    for (const entry of materialized.entries ?? []) {
      if (typeof entry.path === "string") {
        managed.add(entry.path);
      }
    }
  } catch {
    // no prior materialization yet
  }

  return managed;
}

function isStorePath(root: string, path: string): boolean {
  return path.startsWith(join(root, ".use0-kit") + "/");
}

async function assertManagedDestination(root: string, path: string, managedPaths: Set<string>): Promise<void> {
  if (!(await pathExists(path))) {
    return;
  }
  if (isStorePath(root, path) || managedPaths.has(path)) {
    return;
  }
  throw new Error(`Refusing to overwrite unmanaged file: ${path}`);
}

async function ensureCleanPath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

async function storeSkill(root: string, sourcePath: string, destinationPath: string, managedPaths: Set<string>): Promise<void> {
  await assertManagedDestination(root, destinationPath, managedPaths);
  await ensureCleanPath(destinationPath);
  await mkdir(dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { recursive: true });
}

async function storeTextResource(root: string, sourcePath: string, destinationPath: string, managedPaths: Set<string>): Promise<void> {
  await assertManagedDestination(root, destinationPath, managedPaths);
  await ensureCleanPath(destinationPath);
  await mkdir(dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath);
}

async function hardlinkRecursive(sourcePath: string, destinationPath: string): Promise<void> {
  const sourceStat = await lstat(sourcePath);
  if (sourceStat.isDirectory()) {
    await mkdir(destinationPath, { recursive: true });
    for (const entry of await readdir(sourcePath)) {
      await hardlinkRecursive(join(sourcePath, entry), join(destinationPath, entry));
    }
    return;
  }

  await mkdir(dirname(destinationPath), { recursive: true });
  await link(sourcePath, destinationPath);
}

async function materializeSkill(
  root: string,
  sourcePath: string,
  destinationPath: string,
  mode: "symlink" | "copy" | "auto",
  managedPaths: Set<string>
): Promise<void> {
  await assertManagedDestination(root, destinationPath, managedPaths);
  await ensureCleanPath(destinationPath);
  await mkdir(dirname(destinationPath), { recursive: true });

  if (mode === "copy") {
    await cp(sourcePath, destinationPath, { recursive: true });
    return;
  }

  const relativeSource = relative(dirname(destinationPath), sourcePath);
  if (mode === "symlink") {
    await symlink(relativeSource, destinationPath);
    return;
  }

  try {
    await symlink(relativeSource, destinationPath);
    return;
  } catch {
    try {
      await hardlinkRecursive(sourcePath, destinationPath);
      return;
    } catch {
      await cp(sourcePath, destinationPath, { recursive: true });
    }
  }
}

export async function applyPlan(input: {
  root: string;
  plan: MaterializationPlan;
  backupId?: string;
}): Promise<void> {
  const applied: Array<Record<string, string>> = [];
  const managedPaths = await loadManagedPaths(input.root);

  for (const action of input.plan.actions) {
    if (action.kind === "store-skill") {
      await storeSkill(input.root, action.sourcePath, action.storePath, managedPaths);
      applied.push({ kind: action.kind, resourceId: action.resourceId, path: action.storePath });
      continue;
    }

    if (action.kind === "link-skill") {
      await materializeSkill(input.root, action.sourcePath, action.destinationPath, action.mode, managedPaths);
      applied.push({
        kind: action.kind,
        resourceId: action.resourceId,
        path: action.destinationPath,
        agentId: action.agentId
      });
      continue;
    }

    if (action.kind === "store-text-resource") {
      await storeTextResource(input.root, action.sourcePath, action.storePath, managedPaths);
      applied.push({ kind: action.kind, resourceId: action.resourceId, path: action.storePath });
      continue;
    }

    if (action.kind === "write-text-resource") {
      await assertManagedDestination(input.root, action.destinationPath, managedPaths);
      await mkdir(dirname(action.destinationPath), { recursive: true });
      await writeFile(action.destinationPath, action.content, "utf8");
      applied.push({
        kind: action.kind,
        resourceId: action.resourceId,
        path: action.destinationPath,
        agentId: action.agentId
      });
      continue;
    }

    if (action.kind === "write-generated-resource") {
      await assertManagedDestination(input.root, action.destinationPath, managedPaths);
      await mkdir(dirname(action.destinationPath), { recursive: true });
      await writeFile(action.destinationPath, action.content, "utf8");
      applied.push({
        kind: action.kind,
        resourceId: action.resourceId,
        path: action.destinationPath,
        ...(action.agentId ? { agentId: action.agentId } : {})
      });
      continue;
    }

    await assertManagedDestination(input.root, action.destinationPath, managedPaths);
    await mkdir(dirname(action.destinationPath), { recursive: true });
    await writeFile(action.destinationPath, action.content, "utf8");
    applied.push({
      kind: action.kind,
      resourceId: action.resourceId,
      path: action.destinationPath,
      agentId: action.agentId
    });
  }

  await writeApplyState(input.root, applied, input.backupId);

  await writeFile(
    join(input.root, ".use0-kit", "materialized.json"),
    JSON.stringify(
      {
        version: 1,
        root: input.root,
        entries: applied
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  await refreshLock(input.root);
}
