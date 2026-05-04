# Guideline: Scope Layering

This guide validates a layered setup across `global`, `workspace`, and `project` scopes without touching your real global use0-kit state.

Executable spec: `../../tests/guidelines/specs/scope-layering.guideline.json`

## 0. Create Isolated Scope Roots

```bash
DEMO_ROOT=$(mktemp -d /tmp/use0-kit-layering-XXXXXX)
export XDG_DATA_HOME="$DEMO_ROOT/xdg-data"
export XDG_CONFIG_HOME="$DEMO_ROOT/xdg-config"

GLOBAL_ROOT="$XDG_DATA_HOME/use0-kit/global"
WORKSPACE="$DEMO_ROOT/workspace"
PROJECT="$WORKSPACE/apps/web"

mkdir -p "$GLOBAL_ROOT" "$WORKSPACE" "$PROJECT"
```

## 1. Initialize Global Scope

```bash
cd "$GLOBAL_ROOT"
use0-kit scope init --scope global --agents codex
use0-kit skill init global-review --targets codex
```

Expected:

```bash
test -f "$GLOBAL_ROOT/use0-kit.toml"
test -f "$GLOBAL_ROOT/.use0-kit/sources/skills/global-review/SKILL.md"
```

## 2. Initialize Workspace Scope

```bash
cd "$WORKSPACE"
use0-kit scope init --scope workspace --agents codex
use0-kit instruction set-section WorkspaceRules --body "Workspace shared rules." --targets codex
```

Expected:

```bash
test -f "$WORKSPACE/use0-kit.toml"
test -f "$WORKSPACE/.use0-kit/sources/instructions/workspacerules.md"
```

## 3. Initialize Project Scope

```bash
cd "$PROJECT"
use0-kit scope init --scope project --agents codex
use0-kit command add project-check --content "npm test" --targets codex
```

Expected:

```bash
test -f "$PROJECT/use0-kit.toml"
test -f "$PROJECT/.use0-kit/sources/commands/project-check.md"
```

## 4. Inspect Effective Layering

```bash
use0-kit scope list
use0-kit list --effective --agent codex | sort
use0-kit scope explain skill:global-review --agent codex
```

Expected:

```bash
use0-kit list --effective --agent codex | grep -q "skill:global-review"
use0-kit list --effective --agent codex | grep -q "instruction:workspacerules"
use0-kit list --effective --agent codex | grep -q "command:project-check"
use0-kit scope explain skill:global-review --agent codex | grep -q "global wins"
```

## 5. Promote Global Resource Into Project

Effective visibility is not the same as materialized project output. Materialize a global resource into the project by syncing it explicitly:

```bash
use0-kit scope sync --from global --to project skill:global-review --mode pin --apply --agent codex
```

Expected:

```bash
use0-kit list --scope project | grep -q "skill:global-review"
test -f .codex/skills/global-review/SKILL.md
```

## 6. Verify Project Health

```bash
use0-kit doctor
use0-kit lock verify
use0-kit diff --materialized
```

Expected:

```bash
use0-kit diff --materialized | grep -q "materialized: clean"
```

## 7. Cleanup

```bash
cd /
rm -rf "$DEMO_ROOT"
```
