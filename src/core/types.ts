export type ScopeName = "project" | "workspace" | "user" | "global" | "session";
export type ConflictMode = "fail" | "ask" | "skip" | "parent-wins" | "child-wins" | "merge";
export type ResourceTarget = AgentId | "*" | "universal";

export interface ScopeParent {
  scope: ScopeName;
  selector?: string;
  mode?: "inherit" | "pin" | "copy" | "fork" | "mirror";
}

export interface ScopeConfig {
  id?: string;
  level: ScopeName;
  mode?: ScopeName;
  canonicalStore?: string;
  parents: ScopeParent[];
}

export type AgentId = "claude-code" | "cursor" | "codex" | "opencode";

export type MaterializationMode = "symlink" | "copy" | "auto";

export interface Provenance {
  source?: string;
  ref?: string;
  registry?: string;
  publishedAt?: string;
  digest?: string;
}

export interface PackSignature {
  algorithm: "hmac-sha256";
  keyId: string;
  digest: string;
  value: string;
  signedAt?: string;
}

export interface SkillResource {
  id: string;
  source: string;
  targets: ResourceTarget[];
  provenance?: Provenance;
  originScope?: string;
  originPack?: string;
  syncMode?: "inherit" | "pin" | "copy" | "fork" | "mirror";
  pinnedDigest?: string;
}

export interface InstructionResource {
  id: string;
  source: string;
  targets: ResourceTarget[];
  provenance?: Provenance;
  originScope?: string;
  originPack?: string;
  syncMode?: "inherit" | "pin" | "copy" | "fork" | "mirror";
  pinnedDigest?: string;
}

export interface McpResource {
  id: string;
  command?: string;
  args?: string[];
  url?: string;
  transport?: "stdio" | "http";
  enabled?: boolean;
  env?: string[];
  targets: ResourceTarget[];
  provenance?: Provenance;
}

export interface CommandResource {
  id: string;
  source: string;
  targets: ResourceTarget[];
  provenance?: Provenance;
  originScope?: string;
  originPack?: string;
  syncMode?: "inherit" | "pin" | "copy" | "fork" | "mirror";
  pinnedDigest?: string;
}

export interface SubagentResource {
  id: string;
  source: string;
  targets: ResourceTarget[];
  provenance?: Provenance;
  originScope?: string;
  originPack?: string;
  syncMode?: "inherit" | "pin" | "copy" | "fork" | "mirror";
  pinnedDigest?: string;
}

export interface PackResource {
  id: string;
  name: string;
  version: string;
  resources: string[];
  signature?: PackSignature;
  provenance?: Provenance;
  originScope?: string;
  originPack?: string;
  syncMode?: "inherit" | "pin" | "copy" | "fork" | "mirror";
  pinnedDigest?: string;
}

export interface HookResource {
  id: string;
  source: string;
  targets: ResourceTarget[];
  provenance?: Provenance;
  originScope?: string;
  originPack?: string;
  syncMode?: "inherit" | "pin" | "copy" | "fork" | "mirror";
  pinnedDigest?: string;
}

export interface SecretResource {
  id: string;
  env: string;
  required?: boolean;
  targets: ResourceTarget[];
  provenance?: Provenance;
}

export interface PluginResource {
  id: string;
  source: string;
  targets: ResourceTarget[];
  provenance?: Provenance;
  originScope?: string;
  originPack?: string;
  syncMode?: "inherit" | "pin" | "copy" | "fork" | "mirror";
  pinnedDigest?: string;
}

export interface ExcludeRule {
  selector: string;
}

export interface PolicyConfig {
  requirePinnedRefs?: boolean;
  allowUnpinnedGit?: boolean;
  allowRemoteHttpSkills?: boolean;
  requireDigest?: boolean;
  requireSignedPacks?: boolean;
  requirePackApprovals?: boolean;
  requireLockfile?: boolean;
  blockHighRisk?: boolean;
  allowUntrustedSources?: boolean;
  onConflict?: ConflictMode;
}

export interface TrustConfig {
  allowedSources: string[];
  githubOrgs?: string[];
  gitDomains?: string[];
  allowedSigners?: string[];
  allowedApprovers?: string[];
  allowedApproverRoles?: string[];
}

export interface Manifest {
  version: number;
  defaultScope: ScopeName;
  scope?: ScopeConfig;
  materialization: MaterializationMode;
  agents: AgentId[];
  skills: SkillResource[];
  mcps: McpResource[];
  instructions: InstructionResource[];
  commands: CommandResource[];
  subagents: SubagentResource[];
  packs: PackResource[];
  hooks: HookResource[];
  secrets: SecretResource[];
  plugins: PluginResource[];
  excludes: ExcludeRule[];
  policy: PolicyConfig;
  trust: TrustConfig;
}

export interface InitScopeOptions {
  cwd: string;
  scope: ScopeName;
}

export interface PlanActionBase {
  resourceId: string;
}

export interface StoreSkillAction extends PlanActionBase {
  kind: "store-skill";
  skill: SkillResource;
  sourcePath: string;
  storePath: string;
}

export interface LinkSkillAction extends PlanActionBase {
  kind: "link-skill";
  agentId: AgentId;
  sourcePath: string;
  destinationPath: string;
  mode: MaterializationMode;
}

export interface WriteMcpConfigAction extends PlanActionBase {
  kind: "write-mcp-config";
  agentId: AgentId;
  destinationPath: string;
  content: string;
}

export interface WriteInstructionAction extends PlanActionBase {
  kind: "write-instruction";
  agentId: AgentId;
  destinationPath: string;
  content: string;
}

export interface StoreTextResourceAction extends PlanActionBase {
  kind: "store-text-resource";
  sourcePath: string;
  storePath: string;
}

export interface WriteTextResourceAction extends PlanActionBase {
  kind: "write-text-resource";
  agentId: AgentId;
  destinationPath: string;
  content: string;
}

export interface WriteGeneratedResourceAction extends PlanActionBase {
  kind: "write-generated-resource";
  destinationPath: string;
  content: string;
  agentId?: AgentId;
}

export type PlanAction =
  | StoreSkillAction
  | LinkSkillAction
  | WriteMcpConfigAction
  | WriteInstructionAction
  | StoreTextResourceAction
  | WriteTextResourceAction
  | WriteGeneratedResourceAction;

export interface MaterializationPlan {
  actions: PlanAction[];
}
