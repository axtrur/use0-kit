# Pack-First Resource Model

## Decision

`use0-kit` uses `pack` as the only public resource composition unit.

```txt
resource -> pack -> scope -> agent
```

- `resource` is the smallest manageable unit: skill, MCP server, instruction, command, subagent, hook, plugin, or secret binding.
- `pack` groups resources and can itself be synced, installed, published, signed, locked, audited, and explained.
- `scope` is the only effective location model: global, user, workspace, project, or session.
- `agent` is the materialization target: Codex, Cursor, Claude Code, or OpenCode.

## Removed Concept

`profile` is not a first-class model. The previous profile behavior is represented by pack and scope operations:

```bash
use0-kit pack install frontend --to project --mode inherit
use0-kit scope sync --from global --to project pack:frontend --mode pin
```

There is no `profile create`, `profile add`, `profile sync`, or `sync --profile` public workflow.

## Init Model

`template` is not a first-class model. Initialization consumes a pack:

```bash
use0-kit init --with frontend
use0-kit scope init --scope project --with frontend
```

Built-in init packs can seed starter pack declarations. Future scaffold behavior should live on packs, not in a separate template registry.

## Scope Parent Model

Declared parent sync can target a whole scope or a selector:

```toml
[scope]
parents = [
  { scope = "global", selector = "pack:frontend", mode = "pin" }
]
```

This keeps the meaning direct: sync the selected pack from the parent scope into the current scope.

## Compatibility

There is no backward compatibility layer because the CLI has not shipped. Old profile commands, profile registry items, profile scope-parent fields, and template flags are not translated into the pack-first model.
