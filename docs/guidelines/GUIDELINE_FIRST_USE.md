# Guideline: First Use

This guide validates the core project-scope workflow: initialize, add resources, group them into a pack, materialize into multiple agents, and verify the result.

Executable spec: `../../tests/guidelines/specs/first-use.guideline.json`

## 0. Build And Link

Run from the repository root:

```bash
npm run build
npm link
which use0-kit
```

## 1. Create An Isolated Demo Project

```bash
DEMO_ROOT=$(mktemp -d /tmp/use0-kit-first-use-XXXXXX)
export XDG_DATA_HOME="$DEMO_ROOT/xdg-data"
export XDG_CONFIG_HOME="$DEMO_ROOT/xdg-config"
PROJECT="$DEMO_ROOT/project"
mkdir -p "$PROJECT"
cd "$PROJECT"
```

## 2. Initialize Project Scope

```bash
use0-kit scope init --scope project --agents codex,claude-code
sed -n '1,120p' use0-kit.toml
```

Expected:

```bash
test -f use0-kit.toml
test -f use0-kit.lock.json
test -d .use0-kit/sources/skills
test -d .use0-kit/store/skills
```

## 3. Add Managed Resources

```bash
use0-kit skill init repo-conventions --targets codex,claude-code
use0-kit instruction set-section Testing --body "Run npm test and npm run build before PRs." --targets codex,claude-code
use0-kit command add repo-check --content "npm test && npm run build" --targets codex
use0-kit subagent add reviewer --content "Review code for regressions and missing tests." --targets claude-code
use0-kit hook add pre-apply --content "echo before-apply" --targets codex
use0-kit secret add --id openai --env OPENAI_API_KEY --targets codex
```

Expected:

```bash
test -f .use0-kit/sources/skills/repo-conventions/SKILL.md
test -f .use0-kit/sources/instructions/testing.md
test -f .use0-kit/sources/commands/repo-check.md
test -f .use0-kit/sources/subagents/reviewer.md
test -f .use0-kit/sources/hooks/pre-apply.sh
use0-kit list | sort
```

## 4. Group Resources Into A Pack

```bash
use0-kit pack init demo --name local/demo --version 0.1.0
use0-kit pack add demo skill:repo-conventions
use0-kit pack add demo instruction:testing
use0-kit pack add demo command:repo-check
use0-kit pack add demo subagent:reviewer
```

Expected:

```bash
use0-kit info pack:demo
grep -q 'resources = [' use0-kit.toml
```

## 5. Plan And Apply

```bash
use0-kit plan --agent codex,claude-code
use0-kit apply --agent codex,claude-code --verify
```

Expected:

```bash
test -f .codex/skills/repo-conventions/SKILL.md
test -f .codex/commands/repo-check.md
test -f .claude/skills/repo-conventions/SKILL.md
test -f .claude/subagents/reviewer.md
test -f AGENTS.md
test -f CLAUDE.md
```

## 6. Render And Inspect Native Outputs

```bash
use0-kit instruction render --agent codex
use0-kit command render repo-check --agent codex
use0-kit hook test pre-apply
use0-kit secret env openai
```

Expected:

```bash
grep -q "Run npm test and npm run build before PRs." AGENTS.md
grep -q "Run npm test and npm run build before PRs." CLAUDE.md
```

## 7. Verify Health

```bash
use0-kit doctor
use0-kit lock verify
use0-kit lock explain
use0-kit diff --materialized
```

Expected:

```bash
use0-kit diff --materialized | grep -q "materialized: clean"
```

## 8. Cleanup

```bash
cd /
rm -rf "$DEMO_ROOT"
```
