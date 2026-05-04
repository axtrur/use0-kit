# Guideline: Session Scope

This guide validates `session` scope as an isolated experiment layer. Session resources are written under `.use0-kit/session/` and do not mutate the project materialization until you explicitly promote them.

Executable spec: `../../tests/guidelines/specs/scope-session.guideline.json`

## 0. Create A Project Baseline

```bash
DEMO_ROOT=$(mktemp -d /tmp/use0-kit-session-demo-XXXXXX)
export XDG_DATA_HOME="$DEMO_ROOT/xdg-data"
export XDG_CONFIG_HOME="$DEMO_ROOT/xdg-config"
PROJECT="$DEMO_ROOT/project"
mkdir -p "$PROJECT"
cd "$PROJECT"

use0-kit scope init --scope project --agents codex,claude-code
use0-kit instruction set-section Testing --body "Project baseline testing." --targets codex,claude-code
use0-kit apply --agent codex,claude-code --verify
```

Expected:

```bash
grep -q "Project baseline testing." AGENTS.md
grep -q "Project baseline testing." CLAUDE.md
```

## 1. Create A Session Scope

```bash
use0-kit scope init --scope session --agents codex
use0-kit scope inspect --scope session
```

Expected:

```bash
test -f .use0-kit/session/use0-kit.toml
test -d .use0-kit/session/.use0-kit/sources
```

## 2. Add Session-Only Resources

```bash
use0-kit instruction set-section SessionTesting --body "Session-only testing marker." --targets codex --scope session
use0-kit command add session-check --content "echo session-only" --targets codex --scope session
```

Expected:

```bash
use0-kit list --scope session | grep -q "instruction:sessiontesting"
use0-kit list --scope session | grep -q "command:session-check"
use0-kit list --scope project | grep -q "instruction:testing"
```

## 3. Plan And Apply Session Output

```bash
use0-kit plan --scope session --agent codex
use0-kit apply --scope session --agent codex --verify
```

Expected:

```bash
test -f .use0-kit/session/AGENTS.md
test -f .use0-kit/session/.codex/commands/session-check.md
grep -q "Session-only testing marker." .use0-kit/session/AGENTS.md
grep -q "Project baseline testing." AGENTS.md
```

The session marker should not appear in the project `AGENTS.md` yet:

```bash
if grep -q "Session-only testing marker." AGENTS.md; then
  echo "session marker leaked into project AGENTS.md"
  exit 1
fi
```

## 4. Verify Session Health

```bash
use0-kit doctor --scope session
use0-kit diff --scope session --materialized
```

Expected:

```bash
use0-kit diff --scope session --materialized | grep -q "materialized: clean"
```

## 5. Promote A Session Resource To Project

Promote only the resources that proved useful:

```bash
use0-kit scope sync --from session --to project command:session-check --mode fork --apply --agent codex
```

Expected:

```bash
use0-kit list --scope project | grep -q "command:session-check"
test -f .codex/commands/session-check.md
use0-kit doctor
use0-kit diff --materialized | grep -q "materialized: clean"
```

## 6. Drop The Session

```bash
rm -rf .use0-kit/session
use0-kit scope list
```

Expected:

```bash
if use0-kit scope list | grep -q $'session\tactive'; then
  echo "session scope is still active"
  exit 1
fi
```

## 7. Cleanup

```bash
cd /
rm -rf "$DEMO_ROOT"
```
