import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { loadManifest, saveManifest } from "./manifest.js";
import { signPack, verifyPackSignature } from "./pack-signatures.js";
import { applySelectorToManifest, expandSelectors, findBySelector, type SelectorResource } from "./resource-graph.js";
import { recordBackupState } from "./state.js";
import { getPack } from "./resources.js";

type ExportedPackAsset = { type: string; id: string } & Record<string, unknown>;

function assetSelector(asset: ExportedPackAsset): string {
  return `${asset.type}:${asset.id}`;
}

function assetToResource(asset: ExportedPackAsset): SelectorResource {
  const { type: _type, ...resource } = asset;
  switch (asset.type) {
    case "skill":
    case "mcp":
    case "instruction":
    case "command":
    case "subagent":
    case "hook":
    case "pack":
    case "secret":
    case "plugin":
      return resource as unknown as SelectorResource;
    default:
      throw new Error(`Unsupported pack asset type: ${asset.type}`);
  }
}

export async function exportPack(root: string, packId: string, outPath: string): Promise<void> {
  const manifest = await loadManifest(root);
  const pack = await getPack(root, packId);
  const assets = expandSelectors(manifest, [`pack:${pack.id}`])
    .filter((selector) => selector !== `pack:${pack.id}`)
    .map((selector) => {
      const resource = findBySelector(manifest, selector);
      if (!resource) {
        throw new Error(`Missing pack resource: ${selector}`);
      }
      return {
        type: selector.split(":")[0],
        ...resource
      };
    });

  await writeFile(
    outPath,
    JSON.stringify(
      {
        name: pack.name,
        version: pack.version,
        signature: pack.signature,
        assets
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

export async function importPack(root: string, sourcePath: string): Promise<void> {
  const imported = JSON.parse(await readFile(sourcePath, "utf8")) as {
    name: string;
    version: string;
    signature?: {
      algorithm: "hmac-sha256";
      keyId: string;
      digest: string;
      value: string;
      signedAt?: string;
    };
    assets: ExportedPackAsset[];
  };
  const manifest = await loadManifest(root);
  const id = imported.name.split("/").pop() ?? imported.name;
  for (const asset of imported.assets) {
    applySelectorToManifest(manifest, assetSelector(asset), assetToResource(asset));
  }
  manifest.packs = manifest.packs.filter((item) => item.id !== id);
  manifest.packs.push({
      id,
      name: imported.name,
      version: imported.version,
      resources: imported.assets.map((asset) => `${asset.type}:${asset.id}`),
      signature: imported.signature
    });
  await saveManifest(root, manifest);
}

export async function installPack(fromRoot: string, packId: string, toRoot: string): Promise<number> {
  const sourceManifest = await loadManifest(fromRoot);
  const targetManifest = await loadManifest(toRoot);
  const pack = await getPack(fromRoot, packId);
  let installed = 0;

  for (const selector of expandSelectors(sourceManifest, [`pack:${pack.id}`])) {
    const resource = findBySelector(sourceManifest, selector);
    if (!resource) {
      throw new Error(`Missing pack resource: ${selector}`);
    }
    if (selector !== `pack:${pack.id}` && "originPack" in resource) {
      resource.originPack = pack.id;
    }
    if (applySelectorToManifest(targetManifest, selector, resource)) {
      installed += 1;
    }
  }

  await saveManifest(toRoot, targetManifest);
  return installed;
}

export async function signPackResource(root: string, packId: string, keyId: string, secret: string): Promise<void> {
  const manifest = await loadManifest(root);
  const pack = manifest.packs.find((item) => item.id === packId);
  if (!pack) {
    throw new Error(`Unknown pack:${packId}`);
  }
  pack.signature = signPack(pack, keyId, secret);
  await saveManifest(root, manifest);
}

export async function verifyPackResource(root: string, packId: string, secret: string): Promise<boolean> {
  const pack = await getPack(root, packId);
  return verifyPackSignature(pack, secret);
}

export async function createBackup(root: string): Promise<string> {
  const backupId = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = join(root, ".use0-kit", "backups", backupId);
  await mkdir(backupRoot, { recursive: true });

  const paths = [
    "use0-kit.toml",
    "use0-kit.lock.json",
    ".use0-kit/state.json",
    ".use0-kit/sources",
    ".codex",
    ".claude",
    ".cursor",
    ".opencode",
    "AGENTS.md",
    "CLAUDE.md",
    "OPENCODE.md"
  ];
  const existing: string[] = [];

  for (const relativePath of paths) {
    try {
      await cp(join(root, relativePath), join(backupRoot, relativePath), { recursive: true });
      existing.push(relativePath);
    } catch {
      // ignore missing path
    }
  }

  await writeFile(join(backupRoot, "manifest.json"), JSON.stringify({ existing }, null, 2) + "\n", "utf8");
  await recordBackupState(root, backupId, existing);
  return backupId;
}

export async function restoreBackup(root: string, backupId: string): Promise<void> {
  const backupRoot = join(root, ".use0-kit", "backups", backupId);
  const manifest = JSON.parse(await readFile(join(backupRoot, "manifest.json"), "utf8")) as {
    existing: string[];
  };
  const managedPaths = [
    "use0-kit.toml",
    "use0-kit.lock.json",
    ".use0-kit/state.json",
    ".use0-kit/sources",
    ".codex",
    ".claude",
    ".cursor",
    ".opencode",
    "AGENTS.md",
    "CLAUDE.md",
    "OPENCODE.md"
  ];

  for (const relativePath of managedPaths) {
    await rm(join(root, relativePath), { recursive: true, force: true });
  }

  for (const relativePath of manifest.existing) {
    await cp(join(backupRoot, relativePath), join(root, relativePath), { recursive: true });
  }
}

export async function listBackups(root: string): Promise<string[]> {
  try {
    return (await readdir(join(root, ".use0-kit", "backups"))).sort();
  } catch {
    return [];
  }
}
