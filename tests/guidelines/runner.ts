import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { expect } from "vitest";

import { runCli } from "../../src/cli.js";

type AssertionBlock = {
  stdoutContains?: string[];
  stdoutNotContains?: string[];
  filesExist?: string[];
  filesAbsent?: string[];
  dirsExist?: string[];
  fileContains?: Record<string, string[]>;
  fileNotContains?: Record<string, string[]>;
};

type GuidelineStep = {
  id: string;
  cwd?: string;
  run?: string[];
  mkdir?: string[];
  writeFile?: {
    path: string;
    content: string;
  };
  writeJson?: {
    path: string;
    value: unknown;
  };
  assert?: AssertionBlock;
};

export type GuidelineSpec = {
  name: string;
  doc: string;
  rootPrefix?: string;
  env?: {
    isolatedXdg?: boolean;
  };
  vars?: Record<string, string>;
  steps: GuidelineStep[];
};

export type GuidelineSpecEntry = {
  fileName: string;
  spec: GuidelineSpec;
};

type GuidelineContext = {
  root: string;
  vars: Record<string, string>;
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function expand(value: string, vars: Record<string, string>): string {
  return value.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    if (!(key in vars)) {
      throw new Error(`Unknown guideline variable: ${key}`);
    }
    return vars[key];
  });
}

function expandVars(root: string, rawVars: Record<string, string> = {}): Record<string, string> {
  const vars: Record<string, string> = { root, ...rawVars };
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (const [key, value] of Object.entries(vars)) {
      const next = expand(value, vars);
      if (next !== value) {
        vars[key] = next;
        changed = true;
      }
    }
    if (!changed) {
      return vars;
    }
  }
  throw new Error("Guideline variables contain a recursive expansion loop.");
}

function resolvePath(path: string, cwd: string, vars: Record<string, string>): string {
  const expanded = expand(path, vars);
  return isAbsolute(expanded) ? expanded : join(cwd, expanded);
}

async function assertPathExists(path: string, kind: "file" | "dir"): Promise<void> {
  const item = await stat(path);
  if (kind === "file") {
    expect(item.isFile(), path).toBe(true);
  } else {
    expect(item.isDirectory(), path).toBe(true);
  }
}

async function runAssertions(
  spec: GuidelineSpec,
  step: GuidelineStep,
  cwd: string,
  output: string,
  vars: Record<string, string>
): Promise<void> {
  const assertion = step.assert;
  if (!assertion) {
    return;
  }

  for (const expected of assertion.stdoutContains ?? []) {
    expect(output, `${spec.name}:${step.id} stdout`).toContain(expand(expected, vars));
  }
  for (const unexpected of assertion.stdoutNotContains ?? []) {
    expect(output, `${spec.name}:${step.id} stdout`).not.toContain(expand(unexpected, vars));
  }

  for (const path of assertion.filesExist ?? []) {
    await assertPathExists(resolvePath(path, cwd, vars), "file");
  }
  for (const path of assertion.filesAbsent ?? []) {
    expect(await pathExists(resolvePath(path, cwd, vars)), `${spec.name}:${step.id} ${path}`).toBe(false);
  }
  for (const path of assertion.dirsExist ?? []) {
    await assertPathExists(resolvePath(path, cwd, vars), "dir");
  }

  for (const [path, values] of Object.entries(assertion.fileContains ?? {})) {
    const content = await readFile(resolvePath(path, cwd, vars), "utf8");
    for (const expected of values) {
      expect(content, `${spec.name}:${step.id} ${path}`).toContain(expand(expected, vars));
    }
  }
  for (const [path, values] of Object.entries(assertion.fileNotContains ?? {})) {
    const content = await readFile(resolvePath(path, cwd, vars), "utf8");
    for (const unexpected of values) {
      expect(content, `${spec.name}:${step.id} ${path}`).not.toContain(expand(unexpected, vars));
    }
  }
}

async function runStep(spec: GuidelineSpec, step: GuidelineStep, context: GuidelineContext): Promise<void> {
  const cwd = resolvePath(step.cwd ?? "${root}", context.root, context.vars);
  let output = "";

  if (step.mkdir) {
    for (const path of step.mkdir) {
      await mkdir(resolvePath(path, cwd, context.vars), { recursive: true });
    }
  }

  if (step.writeFile) {
    const path = resolvePath(step.writeFile.path, cwd, context.vars);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, expand(step.writeFile.content, context.vars), "utf8");
  }

  if (step.writeJson) {
    const path = resolvePath(step.writeJson.path, cwd, context.vars);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(step.writeJson.value, null, 2) + "\n", "utf8");
  }

  if (step.run) {
    output = await runCli(step.run.map((arg) => expand(arg, context.vars)), { cwd });
  }

  await runAssertions(spec, step, cwd, output, context.vars);
}

export async function loadGuidelineSpecEntries(specDir: string): Promise<GuidelineSpecEntry[]> {
  const entries = await readdir(specDir);
  const specs: GuidelineSpecEntry[] = [];
  for (const entry of entries.filter((item) => item.endsWith(".guideline.json")).sort()) {
    specs.push({
      fileName: entry,
      spec: JSON.parse(await readFile(join(specDir, entry), "utf8")) as GuidelineSpec
    });
  }
  return specs;
}

export async function runGuidelineSpec(spec: GuidelineSpec): Promise<void> {
  const previousXdgData = process.env.XDG_DATA_HOME;
  const previousXdgConfig = process.env.XDG_CONFIG_HOME;
  const root = await mkdtemp(join(tmpdir(), spec.rootPrefix ?? `use0-kit-${spec.name}-`));

  try {
    if (spec.env?.isolatedXdg) {
      process.env.XDG_DATA_HOME = join(root, "xdg-data");
      process.env.XDG_CONFIG_HOME = join(root, "xdg-config");
    }

    const vars = expandVars(root, spec.vars);
    const context: GuidelineContext = { root, vars };
    for (const step of spec.steps) {
      await runStep(spec, step, context);
    }
  } finally {
    if (previousXdgData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousXdgData;
    if (previousXdgConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdgConfig;
    await rm(root, { recursive: true, force: true });
  }
}
