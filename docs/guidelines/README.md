# use0-kit Guidelines

These guides are copy-pasteable validation workflows. They use temporary directories and isolated XDG paths where needed so that they do not mutate your real global use0-kit state.

Run them after building and linking the CLI:

```bash
npm run build
npm link
```

Guides:

- [GUIDELINE_FIRST_USE.md](GUIDELINE_FIRST_USE.md): project-scope first-use flow.
- [GUIDELINE_SCOPE_LAYERING.md](GUIDELINE_SCOPE_LAYERING.md): global, workspace, and project layering.
- [GUIDELINE_SCOPE_SESSION.md](GUIDELINE_SCOPE_SESSION.md): session-scope experiment and promotion.
- [GUIDELINE_PACK_REGISTRY.md](GUIDELINE_PACK_REGISTRY.md): pack publishing and registry install flow.

Executable specs live in `tests/guidelines/specs/*.guideline.json` and are run by `tests/guidelines/guidelines.test.ts`.
Each spec declares its `doc`, and the test suite verifies that every `GUIDELINE_*.md` links back to its spec.

Expected final checks for each guide:

```bash
use0-kit doctor
use0-kit diff --materialized
```

Run all executable guideline specs:

```bash
npm test -- tests/guidelines/guidelines.test.ts
```

## Agent Capability Notes

`codex` (codex-cli >=0.128) does not honor user-defined slash commands, subagents, or on-disk secrets — those resource kinds must target a different agent (e.g. `claude-code`, `cursor`, or `opencode`). The guides reflect this: kinds supported by codex (`skill`, `instruction`, `mcp`, `hook`, `plugin`) target it directly; everything else is routed to a supporting agent. See `src/core/agent-profiles.ts` for the full per-agent capability matrix.
