# Guideline: Pack And Registry

This guide validates the durable sharing flow: build a pack in one project, publish resources to a local registry, then install the pack into another project.

Executable spec: `../../tests/guidelines/specs/pack-registry.guideline.json`

## 0. Create Producer, Consumer, And Registry

```bash
DEMO_ROOT=$(mktemp -d /tmp/use0-kit-pack-registry-XXXXXX)
export XDG_DATA_HOME="$DEMO_ROOT/xdg-data"
export XDG_CONFIG_HOME="$DEMO_ROOT/xdg-config"

PRODUCER="$DEMO_ROOT/producer"
CONSUMER="$DEMO_ROOT/consumer"
REGISTRY="$DEMO_ROOT/registry.json"

mkdir -p "$PRODUCER" "$CONSUMER"
```

## 1. Create A Producer Project

```bash
cd "$PRODUCER"
use0-kit scope init --scope project --agents codex
use0-kit skill init repo-conventions --targets codex
use0-kit command add repo-check --content "npm test" --targets codex
```

Expected:

```bash
test -f .use0-kit/sources/skills/repo-conventions/SKILL.md
test -f .use0-kit/sources/commands/repo-check.md
```

## 2. Build A Pack

```bash
use0-kit pack init agent-dev --name local/agent-dev --version 0.1.0
use0-kit pack add agent-dev skill:repo-conventions
use0-kit pack add agent-dev command:repo-check
use0-kit info pack:agent-dev
```

Expected:

```bash
use0-kit info pack:agent-dev | grep -q "skill:repo-conventions"
use0-kit info pack:agent-dev | grep -q "command:repo-check"
```

## 3. Publish To A Local Registry

```bash
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({items:[]}, null, 2))' "$REGISTRY"
use0-kit registry add local "$REGISTRY"
use0-kit registry login local
use0-kit publish skill:repo-conventions --registry local
use0-kit publish command:repo-check --registry local
use0-kit pack publish agent-dev --registry local
use0-kit registry sync local
use0-kit search agent
```

Expected:

```bash
grep -q "agent-dev" "$REGISTRY"
use0-kit search agent | grep -q "pack:agent-dev"
```

## 4. Install Into A Consumer Project

```bash
cd "$CONSUMER"
use0-kit scope init --scope project --agents codex
use0-kit registry add local "$REGISTRY"
use0-kit registry sync local
use0-kit install pack:agent-dev --registry local --apply --agent codex --verify
```

Expected:

```bash
use0-kit list pack:agent-dev skill:repo-conventions command:repo-check | sort
test -f .codex/skills/repo-conventions/SKILL.md
test -f .codex/commands/repo-check.md
```

## 5. Verify Consumer Health

```bash
use0-kit doctor
use0-kit lock verify
use0-kit diff --materialized
```

Expected:

```bash
use0-kit diff --materialized | grep -q "materialized: clean"
```

## 6. Cleanup

```bash
cd /
rm -rf "$DEMO_ROOT"
```
