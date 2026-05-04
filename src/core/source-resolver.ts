import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extname, isAbsolute, join, resolve } from "node:path";

const execFileAsync = promisify(execFile);
let offlineMode = false;

type ResolvedSource =
  | { kind: "path"; path: string }
  | { kind: "git"; repo: string; ref?: string; subpath?: string; path: string }
  | { kind: "url"; url: string; path: string }
  | { kind: "well-known"; url: string; path: string }
  | { kind: "inline"; path: string };

export type ParsedSourceReference =
  | { scheme: "path"; path: string }
  | { scheme: "git"; repo: string; ref?: string; subpath?: string }
  | { scheme: "npm"; package: string }
  | { scheme: "url"; url: string }
  | { scheme: "well-known"; base: string }
  | { scheme: "inline"; content: string };

function cacheKey(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

function parseGitLikeSource(source: string): { repo: string; ref?: string; subpath?: string } {
  const [base, subpath] = source.split("#", 2);
  const atIndex = base.lastIndexOf("@");
  if (atIndex > 0) {
    return {
      repo: base.slice(0, atIndex),
      ref: base.slice(atIndex + 1),
      subpath
    };
  }
  return { repo: base, subpath };
}

export function parseSourceReference(source: string): ParsedSourceReference {
  if (source.startsWith("path:")) {
    return { scheme: "path", path: source.slice("path:".length) };
  }

  if (source.startsWith("github:")) {
    const parsed = parseGitLikeSource(source.slice("github:".length));
    return {
      scheme: "git",
      repo: `https://github.com/${parsed.repo}.git`,
      ref: parsed.ref,
      subpath: parsed.subpath
    };
  }

  if (source.startsWith("gitlab:")) {
    const parsed = parseGitLikeSource(source.slice("gitlab:".length));
    return {
      scheme: "git",
      repo: `https://gitlab.com/${parsed.repo}.git`,
      ref: parsed.ref,
      subpath: parsed.subpath
    };
  }

  if (source.startsWith("git:")) {
    const parsed = parseGitLikeSource(source.slice("git:".length));
    return { scheme: "git", repo: parsed.repo, ref: parsed.ref, subpath: parsed.subpath };
  }

  if (source.startsWith("ssh:")) {
    const parsed = parseGitLikeSource(source.slice("ssh:".length));
    return { scheme: "git", repo: parsed.repo, ref: parsed.ref, subpath: parsed.subpath };
  }

  if (source.startsWith("url:")) {
    return { scheme: "url", url: source.slice("url:".length) };
  }

  if (source.startsWith("npm:")) {
    return { scheme: "npm", package: source.slice("npm:".length) };
  }

  if (source.startsWith("well-known:")) {
    return { scheme: "well-known", base: source.slice("well-known:".length).replace(/\/$/, "") };
  }

  if (source.startsWith("inline:")) {
    return { scheme: "inline", content: decodeURIComponent(source.slice("inline:".length)) };
  }

  throw new Error(`Unsupported resource source: ${source}`);
}

export function setSourceResolverOfflineMode(offline: boolean): void {
  offlineMode = offline;
}

async function ensureGitCheckout(root: string, source: string, repo: string, ref?: string): Promise<string> {
  const cacheRoot = join(root, ".use0-kit", "cache", "git");
  const checkoutRoot = join(cacheRoot, cacheKey(source));

  try {
    await access(join(checkoutRoot, ".git"));
    return checkoutRoot;
  } catch {
    if (offlineMode) {
      throw new Error(`Offline mode prevents fetching git source: ${source}`);
    }
    await mkdir(cacheRoot, { recursive: true });
  }

  const cloneArgs = ["clone", "--depth", "1"];
  if (ref) {
    cloneArgs.push("--branch", ref);
  }
  cloneArgs.push(repo, checkoutRoot);
  await execFileAsync("git", cloneArgs);
  return checkoutRoot;
}

export async function resolveSource(root: string, source: string): Promise<ResolvedSource> {
  const parsed = parseSourceReference(source);

  if (parsed.scheme === "path") {
    const rawPath = parsed.path;
    return { kind: "path", path: isAbsolute(rawPath) ? rawPath : resolve(root, rawPath) };
  }

  if (parsed.scheme === "git") {
    const checkoutRoot = await ensureGitCheckout(root, source, parsed.repo, parsed.ref);
    return {
      kind: "git",
      repo: parsed.repo,
      ref: parsed.ref,
      subpath: parsed.subpath,
      path: parsed.subpath ? join(checkoutRoot, parsed.subpath) : checkoutRoot
    };
  }

  if (parsed.scheme === "url") {
    const url = parsed.url;
    const cacheRoot = join(root, ".use0-kit", "cache", "url");
    const extension = extname(new URL(url).pathname) || ".txt";
    const cachedPath = join(cacheRoot, `${cacheKey(source)}${extension}`);
    try {
      await stat(cachedPath);
    } catch {
      if (offlineMode) {
        throw new Error(`Offline mode prevents fetching URL source: ${url}`);
      }
      await mkdir(cacheRoot, { recursive: true });
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch resource source: ${url} (${response.status})`);
      }
      await writeFile(cachedPath, await response.text(), "utf8");
    }
    return { kind: "url", url, path: cachedPath };
  }

  if (parsed.scheme === "well-known") {
    const url = `${parsed.base}/.well-known/agent-skills`;
    const cacheRoot = join(root, ".use0-kit", "cache", "well-known");
    const cachedPath = join(cacheRoot, `${cacheKey(source)}.md`);
    try {
      await stat(cachedPath);
    } catch {
      if (offlineMode) {
        throw new Error(`Offline mode prevents fetching well-known source: ${url}`);
      }
      await mkdir(cacheRoot, { recursive: true });
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch well-known source: ${url} (${response.status})`);
      }
      await writeFile(cachedPath, await response.text(), "utf8");
    }
    return { kind: "well-known", url, path: cachedPath };
  }

  if (parsed.scheme === "inline") {
    const content = parsed.content;
    const cacheRoot = join(root, ".use0-kit", "cache", "inline");
    const cachedPath = join(cacheRoot, `${cacheKey(source)}.md`);
    try {
      await stat(cachedPath);
    } catch {
      await mkdir(cacheRoot, { recursive: true });
      await writeFile(cachedPath, content, "utf8");
    }
    return { kind: "inline", path: cachedPath };
  }

  throw new Error(`Unsupported resource source: ${source}`);
}

export async function resolveSourcePath(root: string, source: string): Promise<string> {
  return (await resolveSource(root, source)).path;
}

export async function resolveSkillSourcePath(root: string, source: string): Promise<string> {
  const resolved = await resolveSource(root, source);
  const sourcePath = resolved.path;
  const sourceStat = await stat(sourcePath);
  if (!sourceStat.isDirectory()) {
    throw new Error(`Skill source must resolve to a directory with SKILL.md: ${source}`);
  }

  try {
    await access(join(sourcePath, "SKILL.md"));
  } catch {
    throw new Error(`Skill source directory is missing SKILL.md: ${source}`);
  }

  return sourcePath;
}

async function readDigestibleSourceContent(sourcePath: string): Promise<string> {
  const sourceStat = await stat(sourcePath);
  if (!sourceStat.isDirectory()) {
    return readFile(sourcePath, "utf8");
  }

  const entries = await readdir(sourcePath);
  const primaryFile = entries.includes("SKILL.md")
    ? "SKILL.md"
    : entries.includes("README.md")
      ? "README.md"
      : entries[0];
  if (!primaryFile) {
    return "";
  }
  return readFile(join(sourcePath, primaryFile), "utf8");
}

export async function computeSourceDigest(root: string, source: string): Promise<string> {
  const resolvedPath = await resolveSourcePath(root, source);
  const body = await readDigestibleSourceContent(resolvedPath);
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}
