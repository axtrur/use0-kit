import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type FleetMember = {
  name: string;
  root: string;
};

type FleetConfig = {
  members: FleetMember[];
};

async function loadFleetConfig(root: string): Promise<FleetConfig> {
  try {
    return JSON.parse(await readFile(join(root, ".use0-kit", "fleet.json"), "utf8")) as FleetConfig;
  } catch {
    return { members: [] };
  }
}

async function saveFleetConfig(root: string, config: FleetConfig): Promise<void> {
  await mkdir(join(root, ".use0-kit"), { recursive: true });
  await writeFile(join(root, ".use0-kit", "fleet.json"), JSON.stringify(config, null, 2) + "\n", "utf8");
}

export async function addFleetMember(root: string, name: string, memberRoot: string): Promise<void> {
  const config = await loadFleetConfig(root);
  config.members = config.members.filter((item) => item.name !== name);
  config.members.push({ name, root: memberRoot });
  await saveFleetConfig(root, config);
}

export async function listFleetMembers(root: string): Promise<FleetMember[]> {
  return (await loadFleetConfig(root)).members;
}

export async function removeFleetMember(root: string, name: string): Promise<void> {
  const config = await loadFleetConfig(root);
  config.members = config.members.filter((item) => item.name !== name);
  await saveFleetConfig(root, config);
}
