import { join } from "node:path";

import { expandSupportedTargets, isKindSupported } from "./agent-profiles.js";
import { AGENTS } from "./agents.js";
import { renderInstructions } from "./instructions.js";
import { renderMcpConfig } from "./mcp.js";
import { applyHostOverlay } from "./overlay.js";
import { loadResourceContent } from "./resources.js";
import { resolveSkillSourcePath, resolveSourcePath } from "./source-resolver.js";
import { targetMatches } from "./targets.js";
import type {
  AgentId,
  CommandResource,
  HookResource,
  Manifest,
  MaterializationMode,
  MaterializationPlan,
  PackResource,
  PluginResource,
  SecretResource,
  SkillResource,
  SubagentResource
} from "./types.js";

const AGENTS_LIST = Object.keys(AGENTS) as AgentId[];

function canonicalStoreRoot(root: string, manifest: Manifest): string {
  const configured = manifest.scope?.canonicalStore;
  return join(root, configured ?? ".use0-kit/store");
}

async function buildTextResourceActions(
  root: string,
  storeRoot: string,
  kind: "command" | "subagent" | "hook",
  resource: CommandResource | SubagentResource | HookResource
) {
  const extension = kind === "hook" ? ".sh" : ".md";
  const storeDir = join(storeRoot, kind === "command" ? "commands" : kind === "subagent" ? "subagents" : "hooks");
  const storePath = join(storeDir, `${resource.id}${extension}`);
  const sourcePath = await resolveSourcePath(root, resource.source);
  const content = await loadResourceContent(root, resource.source);
  const actions: MaterializationPlan["actions"] = [
    {
      kind: "store-text-resource",
      resourceId: `${kind}:${resource.id}`,
      sourcePath,
      storePath
    }
  ];

  for (const agentId of expandSupportedTargets(resource.targets, AGENTS_LIST, kind)) {
    const destinationDir =
      kind === "command"
        ? AGENTS[agentId].commandDir(root)
        : kind === "subagent"
          ? AGENTS[agentId].subagentDir(root)
          : AGENTS[agentId].hookDir(root);
    actions.push({
      kind: "write-text-resource",
      resourceId: `${kind}:${resource.id}`,
      agentId,
      destinationPath: join(destinationDir, `${resource.id}${extension}`),
      content: kind === "hook" ? content : applyHostOverlay(content, agentId)
    });
  }

  return actions;
}

function buildSecretActions(root: string, storeRoot: string, secret: SecretResource) {
  const storePath = join(storeRoot, "secrets", `${secret.id}.json`);
  const content = JSON.stringify(
    {
      id: secret.id,
      env: secret.env,
      required: secret.required !== false,
      targets: secret.targets
    },
    null,
    2
  ) + "\n";

  const actions: MaterializationPlan["actions"] = [
    {
      kind: "write-generated-resource",
      resourceId: `secret:${secret.id}`,
      destinationPath: storePath,
      content
    }
  ];

  for (const agentId of expandSupportedTargets(secret.targets, AGENTS_LIST, "secret")) {
    actions.push({
      kind: "write-generated-resource",
      resourceId: `secret:${secret.id}`,
      agentId,
      destinationPath: join(AGENTS[agentId].secretDir(root), `${secret.id}.json`),
      content
    });
  }

  return actions;
}

function buildDescriptorActions(
  storeRoot: string,
  kind: "pack" | "plugin",
  resource: PackResource | PluginResource
) {
  const storePath = join(storeRoot, kind === "pack" ? "packs" : "plugins", `${resource.id}.json`);
  const content =
    JSON.stringify(
      kind === "pack"
        ? {
            id: resource.id,
            name: (resource as PackResource).name,
            version: (resource as PackResource).version,
            resources: (resource as PackResource).resources
          }
        : {
            id: resource.id,
            source: (resource as PluginResource).source,
            targets: (resource as PluginResource).targets
          },
      null,
      2
    ) + "\n";

  return [
    {
      kind: "write-generated-resource" as const,
      resourceId: `${kind}:${resource.id}`,
      destinationPath: storePath,
      content
    }
  ];
}

export async function buildPlan(input: {
  root: string;
  manifest: Manifest;
  materialization?: MaterializationMode;
}): Promise<MaterializationPlan> {
  const storeRoot = canonicalStoreRoot(input.root, input.manifest);
  const materialization = input.materialization ?? input.manifest.materialization;
  const skillActions = (
    await Promise.all(
      input.manifest.skills.map(async (skill) => {
        const storePath = join(storeRoot, "skills", skill.id);
        const sourcePath = await resolveSkillSourcePath(input.root, skill.source);
        const actions: MaterializationPlan["actions"] = [
          {
            kind: "store-skill",
            resourceId: `skill:${skill.id}`,
            skill,
            sourcePath,
            storePath
          }
        ];

        for (const agentId of expandSupportedTargets(skill.targets, AGENTS_LIST, "skill")) {
          actions.push({
            kind: "link-skill",
            resourceId: `skill:${skill.id}`,
            agentId,
            sourcePath: storePath,
            destinationPath: join(AGENTS[agentId].skillDir(input.root), skill.id),
            mode: materialization
          });
        }

        return actions;
      })
    )
  ).flat();
  const commandActions = (
    await Promise.all(
      input.manifest.commands.map((command) => buildTextResourceActions(input.root, storeRoot, "command", command))
    )
  ).flat();
  const subagentActions = (
    await Promise.all(
      input.manifest.subagents.map((subagent) =>
        buildTextResourceActions(input.root, storeRoot, "subagent", subagent)
      )
    )
  ).flat();
  const hookActions = (
    await Promise.all(input.manifest.hooks.map((hook) => buildTextResourceActions(input.root, storeRoot, "hook", hook)))
  ).flat();
  const secretActions = input.manifest.secrets.flatMap((secret) => buildSecretActions(input.root, storeRoot, secret));
  const packActions = input.manifest.packs.flatMap((pack) => buildDescriptorActions(storeRoot, "pack", pack));
  const pluginActions = input.manifest.plugins.flatMap((plugin) =>
    buildDescriptorActions(storeRoot, "plugin", plugin)
  );
  const mcpActions = input.manifest.agents
    .filter((agentId) => isKindSupported(agentId, "mcp"))
    .filter((agentId) => input.manifest.mcps.some((mcp) => targetMatches(mcp.targets, agentId)))
    .map((agentId) => {
      const rendered = renderMcpConfig({
        root: input.root,
        agentId,
        mcps: input.manifest.mcps
      });

      return {
        kind: "write-mcp-config" as const,
        resourceId: `mcp:${agentId}`,
        agentId,
        destinationPath: rendered.path,
        content: rendered.content
      };
    });
  const instructionActions = (
    await Promise.all(
      input.manifest.agents
        .filter((agentId) => isKindSupported(agentId, "instruction"))
        .filter((agentId) =>
          input.manifest.instructions.some((instruction) => targetMatches(instruction.targets, agentId))
        )
        .map(async (agentId) => {
          const rendered = await renderInstructions({
            root: input.root,
            instructions: input.manifest.instructions,
            agentId
          });

          return {
            kind: "write-instruction" as const,
            resourceId: `instruction:${agentId}`,
            agentId,
            destinationPath: rendered.path,
            content: rendered.content
          };
        })
    )
  ).filter((item) => item.content.trim().length > 0);

  return {
    actions: [
      ...skillActions,
      ...commandActions,
      ...subagentActions,
      ...hookActions,
      ...secretActions,
      ...packActions,
      ...pluginActions,
      ...mcpActions,
      ...instructionActions
    ]
  };
}
