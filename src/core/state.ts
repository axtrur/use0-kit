import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { detectAgents } from "./agents-runtime.js";
import type { AgentId } from "./types.js";

export type Use0KitState = {
  version: number;
  appliedAt: string | null;
  lastApply: string | null;
  backupId: string | null;
  backups: Array<{
    id: string;
    paths: string[];
  }>;
  detectedAgents: Partial<Record<AgentId, { found: boolean; path: string }>>;
  actions: Array<Record<string, string>>;
};

function defaultState(): Use0KitState {
  return {
    version: 1,
    appliedAt: null,
    lastApply: null,
    backupId: null,
    backups: [],
    detectedAgents: {},
    actions: []
  };
}

function normalizeState(value: Partial<Use0KitState> | null | undefined): Use0KitState {
  const base = defaultState();
  return {
    ...base,
    ...value,
    backups: Array.isArray(value?.backups) ? value.backups : base.backups,
    detectedAgents: value?.detectedAgents ?? base.detectedAgents,
    actions: Array.isArray(value?.actions) ? value.actions : base.actions
  };
}

export async function loadState(root: string): Promise<Use0KitState> {
  const statePath = join(root, ".use0-kit", "state.json");
  try {
    const raw = JSON.parse(await readFile(statePath, "utf8")) as Partial<Use0KitState>;
    return normalizeState(raw);
  } catch {
    return defaultState();
  }
}

export async function saveState(root: string, state: Use0KitState): Promise<void> {
  const statePath = join(root, ".use0-kit", "state.json");
  await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export async function recordBackupState(root: string, backupId: string, paths: string[]): Promise<void> {
  const state = await loadState(root);
  state.backups = state.backups.filter((entry) => entry.id !== backupId);
  state.backups.push({ id: backupId, paths });
  await saveState(root, state);
}

export async function writeApplyState(
  root: string,
  actions: Array<Record<string, string>>,
  backupId?: string
): Promise<void> {
  const state = await loadState(root);
  const appliedAt = new Date().toISOString();
  const detected = await detectAgents(root);

  state.appliedAt = appliedAt;
  state.lastApply = appliedAt;
  state.backupId = backupId ?? null;
  state.actions = actions;
  state.detectedAgents = Object.fromEntries(
    detected.map((agent) => [agent.id, { found: agent.detected, path: agent.path }])
  ) as Use0KitState["detectedAgents"];

  await saveState(root, state);
}
