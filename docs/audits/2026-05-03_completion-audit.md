# use0-kit Completion Audit

Date: 2026-05-03

Source objective:

- Implement the `agent-kit` project described by `docs/plans/2026-05-02_chatgpt-open-source-agent-kit.md`, renamed to `use0-kit`.

This audit is intentionally prompt-to-artifact, not effort-based. Items below are only marked covered when there is concrete code, CLI surface, and at least one direct verification path.

## Success Criteria

The objective is achieved only if all explicit non-optional deliverables in the plan are implemented and evidenced:

1. Local-first core:
   - `use0-kit.toml`
   - `use0-kit.lock.json`
   - canonical store + materialized agent views
   - `scope/skill/mcp/instruction`
   - `plan/apply/sync/doctor`
2. Multi-resource expansion:
   - `command/subagent/hook/pack/profile/plugin/secret`
   - host overlay
   - backup/restore/rollback
   - adopt
3. Registry + policy + audit:
   - registry search/info/install/publish/sync
   - audit/policy/trust/provenance/digest/security gates
   - profile sync
4. Team/platform MVP:
   - remote global profiles
   - internal registry
   - approvals / signed packs
   - fleet sync
   - MCP server mode for self-management
5. The explicit command surfaces and named workflows shown in the plan must be backed by real code and tests, not only mentioned in a command list.

## Covered Deliverables

### Core Files

- `use0-kit.toml`
  - parser/serializer and schema evolution in `src/core/manifest.ts`
  - exercised broadly by all CLI tests, especially:
    - `tests/scope-init.test.ts`
    - `tests/cli-completeness.test.ts`
    - `tests/plan-apply-skill.test.ts`
- `use0-kit.lock.json`
  - lock lifecycle in `src/core/lock.ts`
  - effective graph source in `src/core/graph-state.ts`
  - exercised by:
    - `tests/lock-update-lifecycle.test.ts`
    - `tests/state-lock-graph.test.ts`
- `.use0-kit/state.json`
  - state lifecycle in `src/core/state.ts`
  - exercised by:
    - `tests/state-lock-graph.test.ts`
    - `tests/cli-completeness.test.ts`

### Scope System

- Implemented command family:
  - `scope init/list/current/inspect/path/diff/sync/promote/fork/exclude/explain`
  - code in `src/cli.ts`, `src/core/scope.ts`, `src/core/reconciliation.ts`
- Covered workflows:
  - XDG `global/user`, hierarchical `workspace/project/session`
  - declared `[scope].parents`
  - `scope sync --from-parents`
  - conflict modes including `ask`
  - `exclude`
  - `scope explain --scope --agent --json`
  - `scope inspect --json`
- Evidence:
  - `tests/scope-init.test.ts`
  - `tests/scope-model.test.ts`
  - `tests/scope-promote-conflicts.test.ts`
  - `tests/scope-reconciliation.test.ts`
  - `tests/scope-exclude-graphs.test.ts`
  - `tests/scope-explain.test.ts`

### Resource Families

- Implemented resource kinds:
  - `skill`
  - `mcp`
  - `instruction`
  - `command`
  - `subagent`
  - `hook`
  - `pack`
  - `profile`
  - `secret`
  - `plugin`
- Generic surfaces implemented:
  - `add/remove/list/info/edit/enable/disable`
- Namespaced surfaces implemented and tested:
  - `skill init/update/validate/score`
  - `mcp test/env/render`
  - `instruction init/set-section/read/remove-section/render/link`
  - `command render`
  - `subagent render`
  - `hook test`
  - `pack init/add/remove/list/install/build/export/import/publish/sign/verify`
  - `profile create/add/remove/list/use/sync/export/import`
  - `secret add/list/remove/env`
  - `plugin add/list/remove`
- Evidence:
  - `tests/generic-add-remove.test.ts`
  - `tests/generic-edit.test.ts`
  - `tests/generic-enable-disable.test.ts`
  - `tests/skill-init-update.test.ts`
  - `tests/mcp-npm-source.test.ts`
  - `tests/instruction-render.test.ts`
  - `tests/remaining-command-surfaces.test.ts`
  - `tests/final-cli-surface-tranche.test.ts`

### Materialization / Plan / Apply / Sync

- Canonical store + projection model implemented in:
  - `src/core/planner.ts`
  - `src/core/apply.ts`
  - `src/core/agents.ts`
  - `src/core/agents-runtime.ts`
- Covered workflows:
  - `plan --json`
  - human-readable `plan`
  - apply-like `--plan` preview without writing real manifest/materialized artifacts
  - `apply --verify`
  - `apply --backup false`
  - `apply --materialize`
  - `apply --force` refuses unmanaged destinations while still recreating managed artifacts
  - top-level `sync`
  - top-level `sync --profile`
  - `scope sync --apply`
  - `pack install --apply`
  - `profile sync --apply`
  - `install --apply`
  - `registry install --apply`
  - agent filtering via `--agent` / `--agents`
- Evidence:
  - `tests/plan-apply-skill.test.ts`
  - `tests/cli-completeness.test.ts`
  - `tests/bundle-graph.test.ts`
  - `tests/cli-workflows.test.ts`
  - `tests/force-semantics.test.ts`

### Global Options

- Implemented:
  - `--root`
  - `--config`
  - `--store`
  - `--offline`
  - `--json`
  - `--yes`
  - `--plan`
  - `--verbose`
  - `--force`
- `--plan` evidence:
  - `apply --plan` returns plan actions without materializing agent files.
  - `install --apply --plan` uses a preview root, so registry install mutations and apply output are simulated without changing the real manifest or filesystem.
- `--verbose` evidence:
  - core workflows append execution context such as command, root, agent selection, materialization, store, profile, registry, plan, verify, backup, and offline state.
- `--force` evidence:
  - duplicate resource declarations fail by default and require `--force` to replace in the selected scope.
  - `--force` does not bypass policy/trust gates.
  - `apply --force` still refuses to overwrite unmanaged user-owned materialization targets.
- Evidence:
  - `tests/cli-completeness.test.ts`
  - `tests/registry-sync.test.ts`
  - `tests/force-semantics.test.ts`
  - `tests/policy-trust.test.ts`

### Backup / Restore / Rollback

- Implemented:
  - `backup create/list/restore`
  - top-level `restore`
  - top-level `rollback`
- backup auto-creation during apply lifecycle is implemented
- Evidence:
  - `tests/cli-completeness.test.ts`
  - `tests/state-lock-graph.test.ts`

### Adopt

- Implemented:
  - multi-agent / multi-kind adopt
  - `--preview`
  - `--action import|ignore|leave-external`
- current agent coverage evidenced:
  - `claude-code`
  - `cursor`
  - `codex`
- Evidence:
  - `tests/mvp2-features.test.ts`

### Registry / Search / Publish / Index

- Implemented:
  - `registry add/list/remove/login/logout/sync/info/search/install`
  - top-level `search/info/install/publish`
  - persisted registry cache
  - persisted registry index
  - quality/ranking signals
  - verifier metadata (`verification_status`)
  - offline behavior on cached index
- Evidence:
  - `src/core/registry.ts`
  - `tests/registry-sync.test.ts`
  - `tests/final-cli-surface-tranche.test.ts`

### Policy / Audit / Trust / Provenance / Digest

- Implemented:
  - `audit`
  - `audit --kind`
  - `audit <selector>`
  - `audit --fail-on`
  - `doctor`
  - `doctor --fix`
  - `doctor <selector>`
  - trust allowlists:
    - `allowed_sources`
    - `github_orgs`
    - `git_domains`
  - policy gates:
    - `require_lockfile`
    - `block_high_risk`
    - `require_digest`
    - `allow_untrusted_sources = false`
    - `allow_unpinned_git = false`
    - `allow_remote_http_skills = false`
  - provenance:
    - presence check
    - actual digest match for source-based remote resources
- Evidence:
  - `tests/mvp3-features.test.ts`
  - `tests/policy-trust.test.ts`
  - `tests/resources-and-doctor.test.ts`
  - `tests/exit-codes.test.ts`

### Team / Platform MVP

- Implemented:
  - remote global profiles
  - internal registry
  - signed packs
  - approvals / RBAC gates
  - fleet sync
  - MCP server mode for self-management
- Evidence:
  - `tests/pack-signatures.test.ts`
  - `tests/pack-approvals.test.ts`
  - `tests/fleet-sync.test.ts`
  - `tests/mcp-server-mode.test.ts`
  - `tests/cli-completeness.test.ts` for global profile workflows

## Explicitly Excluded Optional Area

### Optional UI/server tree

The architecture tree explicitly lists:

- `optional UI/server`
  - `desktop manager`
  - `team dashboard`

Current state:

- `mcp serve` exists and is tested.
- There is no desktop manager.
- There is no team dashboard.

Audit conclusion:

- The user explicitly confirmed on 2026-05-03 that optional UI/server is not in scope for this implementation phase.
- Therefore `desktop manager` and `team dashboard` are excluded from the current completion criteria.

## Final Scoped Assessment

The repository now covers:

- MVP 1
- MVP 2
- MVP 3
- MVP 4 non-UI/server scope

with real code and test evidence.

The only explicit uncovered architecture subtree is optional UI/server:

- `desktop manager`
- `team dashboard`

This subtree is now explicitly out of scope for this phase.

Within the scoped objective, no remaining non-optional command, workflow, file, gate, or named deliverable from the plan is known to be uncovered.

## Final Verification

Final verification required before marking complete:

- `npm run build`
- `npm test`
