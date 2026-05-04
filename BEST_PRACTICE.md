# use0-kit Best Practice

This document defines the operating model for using `use0-kit` to manage resources across coding agents and scopes.

## Mental Model

Treat `use0-kit.toml`, `.use0-kit/store`, `use0-kit.lock.json`, and `.use0-kit/materialized.json` as the source of truth. Agent-native files such as `.codex/`, `.claude/`, `.cursor/`, `.opencode/`, `AGENTS.md`, and `CLAUDE.md` are materialized outputs.

The core flow is:

```txt
source -> resource -> pack -> scope -> agent materialization
```

- `source`: editable local source, remote git source, registry item, or generated managed source.
- `resource`: one skill, MCP server, instruction, command, subagent, hook, plugin, or secret declaration.
- `pack`: the reuse and distribution unit for related resources.
- `scope`: where a resource becomes effective.
- `agent`: the runtime receiving a native projection.

## Scope Strategy

Use scopes by lifecycle, not by convenience.

| Scope | Use For | Avoid |
| --- | --- | --- |
| `global` | Personal long-lived tools: browser skills, project setup skills, common MCP servers, release helpers. | Repo-specific rules. |
| `user` | Personal preferences and non-shared defaults. | Team or project policy. |
| `workspace` | Shared conventions across a group of repos. | One-off experiments. |
| `project` | Current repo rules, commands, hooks, and project-specific packs. | Personal-only tools. |
| `session` | Short-lived experiments and trial resources before promotion. | Durable team behavior. |

The effective order is:

```txt
builtin < global < user < workspace < project < session
```

Use `scope explain` before changing a resource when you are not sure which scope wins.

```bash
use0-kit scope explain skill:repo-conventions --agent codex
```

## Resource Strategy

Skills are folder packages. A skill source must point to a directory containing `SKILL.md`.

Recommended managed layout:

```txt
.use0-kit/sources/
  skills/<id>/SKILL.md
  instructions/<id>.md
  commands/<id>.md
  subagents/<id>.md
  hooks/<id>.sh
```

Rules:

- Use `skill init` for local managed skills.
- Put skill templates, references, scripts, and assets inside the same skill folder.
- Do not represent skills as single Markdown files.
- Commands, hooks, subagents, and instructions can stay as single-file text resources.
- Prefer one resource with multiple `targets` over copied per-agent resources.
- Split resources by agent only when the native runtime format or behavior is genuinely different.

## Pack Strategy

Use packs as the only composition unit. Do not create parallel profile or template concepts.

Good pack boundaries:

- `pack:frontend-basic`: frontend skill, lint command, testing instruction, reviewer subagent.
- `pack:browser-qa`: browser skill, QA command, console-check hook.
- `pack:agent-dev`: project setup skill, Context7 MCP, repo conventions instruction.

Recommended lifecycle:

```bash
use0-kit pack init agent-dev --name local/agent-dev --version 0.1.0
use0-kit pack add agent-dev skill:repo-conventions
use0-kit pack add agent-dev command:repo-check
use0-kit pack add agent-dev instruction:testing
```

Install packs into scopes rather than repeatedly installing individual resources.

## Sync Strategy

Use explicit sync modes:

| Mode | Use When |
| --- | --- |
| `pin` | You want a stable copy from a parent scope. This should be the default. |
| `mirror` | You want the child scope to keep following the parent. |
| `fork` | You want to start from the parent but edit independently. |
| `inherit` | You want the resource to stay logically inherited. |
| `copy` | You want a plain copy without stronger lifecycle semantics. |

Typical promotion flow:

```bash
use0-kit scope sync --from global --to project skill:repo-conventions --mode pin
use0-kit plan --agent codex,claude-code
use0-kit apply --agent codex,claude-code --verify
```

For session experiments:

```bash
use0-kit scope sync --from session --to project command:session-check --mode fork --apply --agent codex
```

## Agent Materialization

Use the same graph for multiple coding agents:

```bash
use0-kit plan --agent codex,claude-code,cursor
use0-kit apply --agent codex,claude-code,cursor --verify
```

Then verify native outputs:

```bash
use0-kit doctor
use0-kit lock verify
use0-kit diff --materialized
```

Do not hand-edit generated agent files unless you intend to adopt or fork them back into use0-kit-managed resources.

## Registry Strategy

Use registry after a resource or pack has passed local verification.

Recommended publish path:

```bash
use0-kit publish skill:repo-conventions --registry internal
use0-kit publish command:repo-check --registry internal
use0-kit pack publish agent-dev --registry internal
```

Recommended install path:

```bash
use0-kit registry sync internal
use0-kit install pack:agent-dev --registry internal --apply --agent codex --verify
```

Registry items should carry provenance and pinned refs or digests when they come from remote sources.

## Verification Standard

Every durable change should end with:

```bash
use0-kit plan --agent <target-agents>
use0-kit apply --agent <target-agents> --verify
use0-kit doctor
use0-kit lock verify
use0-kit diff --materialized
```

For implementation work in this repo, also run:

```bash
npm test
npm run build
```

## Documentation Guide

Use the runnable guides in `docs/guidelines/` when validating behavior:

- `GUIDELINE_FIRST_USE.md`: project-scope first-use flow.
- `GUIDELINE_SCOPE_LAYERING.md`: global, workspace, and project layering.
- `GUIDELINE_SCOPE_SESSION.md`: session-scope experiment and promotion.
- `GUIDELINE_PACK_REGISTRY.md`: pack publishing and registry install flow.

Each guide has a matching executable JSON spec under `tests/guidelines/specs/`.
Each spec declares the guideline document it validates, and `tests/guidelines/guidelines.test.ts` checks that the documentation and spec inventory stay in sync.
