# use0-kit

`use0-kit` is a local-first toolkit for managing AI-agent resources across multiple agent runtimes. It was designed from the `agent-kit` plan, but uses the `use0-kit` name and file layout.

It gives you one vendor-neutral resource graph for skills, MCP servers, instructions, commands, subagents, hooks, packs, profiles, secrets, and plugins, then materializes that graph into the native directories/config files used by supported agents.

For a command-by-command first-use walkthrough, see [GUIDELINE.md](GUIDELINE.md).

Supported agent targets:

- `claude-code`
- `cursor`
- `codex`
- `opencode`

## What It Does

`use0-kit` manages these resource types:

- `skill`: directory-based agent skills, usually with `SKILL.md`.
- `mcp`: MCP server definitions, including `stdio`, `http`, and `npm:` convenience inputs.
- `instruction`: managed sections rendered into agent instruction files.
- `command`: reusable markdown command files.
- `subagent`: reusable subagent definitions.
- `hook`: shell hook resources.
- `pack`: versioned resource bundles.
- `profile`: scope presets that export packs and individual resources.
- `secret`: environment-variable bindings for agent resources.
- `plugin`: declarative plugin descriptors.

Core capabilities:

- Hierarchical scopes: `global`, `user`, `workspace`, `project`, and `session`.
- Resource synchronization between scopes with `inherit`, `pin`, `copy`, `fork`, and `mirror`.
- Canonical store plus per-agent materialized views.
- `plan` / `apply` workflow with preview, backups, verification, and materialization modes.
- Registry search, sync, install, publish, local index, and quality metadata.
- Policy, trust, provenance, digest, audit, signed packs, and approvals.
- Fleet sync for propagating resources to multiple targets.
- Minimal MCP server mode for agent self-management.

Optional desktop UI and team dashboard are intentionally out of scope for this implementation phase.

## Install And Build

This repository is a TypeScript CLI package.

```bash
npm install
npm run build
```

Run tests:

```bash
npm test
```

Run the CLI from the built entrypoint:

```bash
node dist/cli.js --help
```

During development, the package exposes the binary name `use0-kit` after build/install:

```bash
npm run build
npm link
use0-kit scope init --scope project
```

## Files Created By use0-kit

Typical project files:

- `use0-kit.toml`: main manifest.
- `use0-kit.lock.json`: effective resource lock state.
- `.use0-kit/state.json`: apply state, backups, detected agents, active profile.
- `.use0-kit/materialized.json`: last materialized graph.
- `.use0-kit/store/`: canonical resource store by default.
- `.agents/`: vendor-neutral project-owned editable resources.

Agent materialization targets include:

- `.claude/`
- `.cursor/`
- `.codex/`
- `.opencode/`
- `AGENTS.md`, `CLAUDE.md`, and related instruction files when applicable.

## Quick Start

Initialize a project:

```bash
use0-kit init --scope project --agents codex,cursor --yes
```

Add a local skill:

```bash
mkdir -p skills/repo-conventions
printf '# Repo Conventions\n\nUse project rules.\n' > skills/repo-conventions/SKILL.md

use0-kit skill add path:skills/repo-conventions \
  --id repo-conventions \
  --targets codex,cursor
```

Preview materialization:

```bash
use0-kit plan --agent codex,cursor
```

Apply it:

```bash
use0-kit apply --agent codex,cursor --verify
```

Inspect health:

```bash
use0-kit doctor
use0-kit diff --materialized
```

## Common Workflows

### Manage Scopes

Create and inspect scopes:

```bash
use0-kit scope init --scope global
use0-kit scope init --scope project --agents codex,cursor
use0-kit scope list
use0-kit scope inspect --scope project --json
```

Sync from one scope to another:

```bash
use0-kit scope sync \
  --from global \
  --to project \
  skill:web-design \
  --mode pin
```

Preview without writing:

```bash
use0-kit scope sync \
  --from global \
  --to project \
  --mode mirror \
  --prune \
  --dry-run \
  --json
```

Explain why a resource is effective:

```bash
use0-kit scope explain skill:web-design --scope project --agent codex
```

### Use Profiles And Packs

Create a reusable frontend baseline:

```bash
use0-kit pack init frontend --name acme/frontend
use0-kit pack add frontend skill:web-design
use0-kit pack add frontend mcp:context7

use0-kit profile create frontend --targets codex,cursor
use0-kit profile add frontend pack:frontend
```

Sync a profile into a project:

```bash
use0-kit profile sync frontend --to project --mode pin --apply --agent codex
```

Or use the top-level sync shortcut:

```bash
use0-kit sync --profile frontend --agent codex
```

### Registry Workflow

Add and sync a registry:

```bash
use0-kit registry add official https://registry.example.com/use0-kit.json
use0-kit registry sync official
```

Search and inspect:

```bash
use0-kit search react
use0-kit search mcp:github
use0-kit registry info skill:web-design --registry official
```

Install and apply:

```bash
use0-kit install skill:web-design --registry official --apply --agent codex --verify
```

Publish a resource:

```bash
use0-kit registry login internal
use0-kit publish skill:repo-conventions --registry internal
use0-kit pack publish frontend --registry internal
```

### Policy, Trust, Audit, And Doctor

Run audits:

```bash
use0-kit audit
use0-kit audit --kind skill
use0-kit audit --fail-on high
```

Run doctor checks and conservative fixes:

```bash
use0-kit doctor
use0-kit doctor --fix
```

Require lockfiles, trusted sources, signed packs, approvals, and digests through `use0-kit.toml` policy/trust sections. `--force` does not bypass these gates.

### Backup And Rollback

Create and restore backups:

```bash
use0-kit backup create
use0-kit backup list
use0-kit backup restore <backup-id>
```

Rollback to the last apply backup:

```bash
use0-kit rollback
```

## Command Overview

High-level commands:

```bash
use0-kit init
use0-kit scope ...
use0-kit profile ...
use0-kit agent ...
use0-kit add / remove / list / info / edit / enable / disable
use0-kit skill ...
use0-kit mcp ...
use0-kit instruction ...
use0-kit command ...
use0-kit subagent ...
use0-kit hook ...
use0-kit pack ...
use0-kit sync
use0-kit plan
use0-kit apply
use0-kit update
use0-kit lock ...
use0-kit adopt
use0-kit diff
use0-kit doctor
use0-kit audit
use0-kit backup ...
use0-kit registry ...
use0-kit publish
use0-kit install
use0-kit restore
use0-kit rollback
use0-kit fleet ...
```

Useful global options:

- `--scope <global|user|workspace|project|session>`
- `--agent <agent[,agent...]>`
- `--agents <agent[,agent...]>`
- `--root <path>`
- `--config <path/to/use0-kit.toml>`
- `--store <path>`
- `--mode <inherit|pin|copy|fork|mirror>`
- `--conflict <fail|ask|skip|parent-wins|child-wins|merge>`
- `--dry-run`
- `--plan`
- `--apply`
- `--json`
- `--yes`
- `--offline`
- `--force`
- `--verbose`

## Important Semantics

### `--plan`

`--plan` previews apply-like workflows without writing to the real manifest or materialized filesystem. For workflows such as `install --apply --plan`, use0-kit copies the target root to a temporary preview root, runs the mutation and apply planning there, then prints the resulting actions.

### `--force`

`--force` means: overwrite or recreate use0-kit-managed resources and generated artifacts.

It can:

- Replace an existing resource declaration in the selected scope.
- Recreate managed symlinks, generated files, and generated config sections.
- Re-apply managed materialization when you suspect agent config drift.

It does not:

- Bypass policy, trust, provenance, or digest checks.
- Delete or overwrite unmanaged user files.
- Resolve parent/child scope conflicts.
- Remove dependent resources.
- Answer confirmation prompts.

Use explicit flags such as `--conflict`, `--prune`, or future destructive flags for other behaviors.

### `--verbose`

`--verbose` keeps normal command output and appends execution context such as command, root, scope, agent selection, materialization mode, registry, profile, plan mode, and verification mode.

## MCP Server Mode

`use0-kit` can expose a minimal MCP self-management interface:

```bash
use0-kit mcp serve --request '<json-rpc-payload>'
```

Supported tool surface includes:

- `use0.list`
- `use0.info`
- `use0.explain`
- `use0.plan`
- `use0.apply`
- `use0.sync`
- `use0.doctor`

## Development Notes

Run the full validation suite before claiming a change is complete:

```bash
npm run build
npm test
```

The current implementation is intentionally CLI/local-runtime first. Desktop manager and team dashboard are excluded from this phase.
