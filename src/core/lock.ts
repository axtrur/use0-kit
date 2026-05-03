import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  collectEffectiveGraph,
  collectMaterializedGraph,
  loadMaterializedGraph,
  normalizeMaterializedEntry
} from "./graph-state.js";
import { expandSelectors } from "./resource-graph.js";
import { loadManifest } from "./manifest.js";

type LockState = {
  version: number;
  scope: string;
  generatedAt: string;
  resources: Record<
    string,
    {
      kind: string;
      digest: string;
      source?: string;
      resolvedUrl?: string;
      resolvedRef?: string;
      originScope?: string;
      originProfile?: string;
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
    }
  >;
};

async function loadLock(root: string): Promise<LockState> {
  return JSON.parse(await readFile(join(root, "use0-kit.lock.json"), "utf8")) as LockState;
}

export async function refreshLock(root: string): Promise<LockState> {
  const manifest = await loadManifest(root);
  const next: LockState = {
    version: 1,
    scope: manifest.scope?.level ?? manifest.defaultScope,
    generatedAt: new Date().toISOString(),
    resources: await collectEffectiveGraph(root)
  };
  await writeFile(join(root, "use0-kit.lock.json"), JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

export async function verifyLock(root: string): Promise<boolean> {
  const lock = await loadLock(root);
  const current = await collectEffectiveGraph(root);
  return JSON.stringify(lock.resources) === JSON.stringify(current);
}

export async function explainLock(root: string): Promise<string> {
  const lock = await loadLock(root);
  return Object.entries(lock.resources)
    .map(([id, state]) => {
      const parts = [`${id}\t${state.kind}\t${state.digest.slice(0, 12)}`];
      if (state.resolvedRef) {
        parts.push(`resolvedRef=${state.resolvedRef}`);
      }
      if (state.originScope) {
        parts.push(`originScope=${state.originScope}`);
      }
      if (state.originProfile) {
        parts.push(`originProfile=${state.originProfile}`);
      }
      if (state.scopeMode) {
        parts.push(`scopeMode=${state.scopeMode}`);
      }
      if (state.resolvedUrl) {
        parts.push(`resolvedUrl=${state.resolvedUrl}`);
      }
      if (state.provenance?.registry) {
        parts.push(`registry=${state.provenance.registry}`);
      }
      if (state.materialized && Object.keys(state.materialized).length > 0) {
        parts.push(
          `materialized=${Object.entries(state.materialized)
            .map(([key, value]) => `${key}:${Array.isArray(value) ? value.join("|") : value}`)
            .join(",")}`
        );
      }
      return parts.join("\t");
    })
    .join("\n");
}

export async function diffState(root: string): Promise<"clean" | "pending"> {
  return (await verifyLock(root)) ? "clean" : "pending";
}

export async function verifyMaterialized(root: string): Promise<boolean> {
  let actual;
  try {
    actual = await loadMaterializedGraph(root);
  } catch {
    return false;
  }
  const expectedState = await collectMaterializedGraph(root);
  const expected = expectedState.entries.map(normalizeMaterializedEntry);
  const current = actual.entries.map(normalizeMaterializedEntry);
  return JSON.stringify(expected) === JSON.stringify(current);
}

export async function diffStateView(
  root: string,
  view: "effective" | "materialized"
): Promise<"clean" | "pending"> {
  if (view === "materialized") {
    return (await verifyMaterialized(root)) ? "clean" : "pending";
  }
  return (await verifyLock(root)) ? "clean" : "pending";
}

export async function pruneLock(root: string): Promise<number> {
  const lock = await loadLock(root);
  const current = await collectEffectiveGraph(root);
  const before = Object.keys(lock.resources).length;
  lock.resources = Object.fromEntries(
    Object.entries(lock.resources).filter(([key]) => key in current)
  );
  await writeFile(join(root, "use0-kit.lock.json"), JSON.stringify(lock, null, 2) + "\n", "utf8");
  return before - Object.keys(lock.resources).length;
}

export async function updateResources(root: string, selectors: string[] = []): Promise<number> {
  const current = await collectEffectiveGraph(root);
  const manifest = await loadManifest(root);
  await refreshLock(root);
  if (selectors.length === 0) {
    return Object.keys(current).length;
  }
  const selected = new Set(expandSelectors(manifest, selectors));
  return Object.keys(current).filter((selector) => selected.has(selector)).length;
}
