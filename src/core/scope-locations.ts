import { access } from "node:fs/promises";
import { dirname, join } from "node:path";

export type KnownScope = "builtin" | "global" | "user" | "workspace" | "project" | "session";

function xdgOrFallback(envKey: string, fallback: string): string {
  return process.env[envKey] ?? fallback;
}

export function getScopeRoots(cwd: string): Record<KnownScope, string> {
  const home = process.env.HOME ?? "~";
  return {
    builtin: "internal",
    global: join(xdgOrFallback("XDG_DATA_HOME", join(home, ".local", "share")), "use0-kit", "global"),
    user: join(xdgOrFallback("XDG_CONFIG_HOME", join(home, ".config")), "use0-kit"),
    workspace: cwd,
    project: cwd,
    session: join(cwd, ".use0-kit", "session")
  };
}

export function manifestPathForScope(scope: Exclude<KnownScope, "builtin">, root: string): string {
  return join(root, "use0-kit.toml");
}

export async function findWorkspaceRoot(cwd: string): Promise<string | null> {
  let current = dirname(cwd);

  while (current !== dirname(current)) {
    try {
      await access(join(current, "use0-kit.toml"));
      return current;
    } catch {
      current = dirname(current);
    }
  }

  return null;
}

export async function activeScopeRoots(cwd: string): Promise<Record<KnownScope, string | null>> {
  const roots = getScopeRoots(cwd);
  const workspace = await findWorkspaceRoot(cwd);
  const project = cwd;
  const session = roots.session;

  return {
    builtin: roots.builtin,
    global: roots.global,
    user: roots.user,
    workspace,
    project,
    session
  };
}
