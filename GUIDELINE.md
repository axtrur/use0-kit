# use0-kit First-Use Guideline

这份指南用于第一次验证 `use0-kit` 的核心能力。建议先在临时目录或演示项目执行；如果在真实项目执行，`apply` 会生成 `.codex/`、`.claude/`、`.use0-kit/`、`AGENTS.md`、`CLAUDE.md` 等托管产物。

## 0. Build And Link

```bash
npm run build
```

功能：编译 TypeScript CLI。  
可能变化：更新 `dist/` 构建产物。

```bash
npm link
```

功能：把当前包链接为本机全局命令 `use0-kit`。  
可能变化：写入当前 Node 环境的全局 npm link，不改项目 manifest。

```bash
which use0-kit
```

功能：确认 shell 能找到 `use0-kit` 命令。  
可能变化：只读检查，不写文件。

## 1. Initialize A Project Scope

```bash
use0-kit scope init --scope project --agents codex,claude-code
```

功能：初始化当前目录为 project scope，并启用 Codex 与 Claude Code 目标。  
可能变化：创建 `use0-kit.toml`、`use0-kit.lock.json`、`.use0-kit/state.json`。

```bash
sed -n '1,120p' use0-kit.toml
```

功能：查看初始化后的 manifest。  
可能变化：只读检查，不写文件。

## 2. Add Resources

```bash
use0-kit skill add --id codex-project-setup --source "path:$HOME/.codex/skills/project-setup" --targets codex
```

功能：登记一个 Codex skill。  
可能变化：只更新 `use0-kit.toml`，不会立刻创建 `.codex/skills`。

```bash
use0-kit skill add --id claude-web-fetch --source "path:$HOME/.claude/skills/web-fetch" --targets claude-code
```

功能：登记一个 Claude Code skill。  
可能变化：只更新 `use0-kit.toml`，不会立刻创建 `.claude/skills`。

```bash
use0-kit mcp add context7 --command npx --args "-y,@upstash/context7-mcp" --targets codex,claude-code
```

功能：登记一个 MCP server，并同时面向 Codex 和 Claude Code。  
可能变化：只更新 `use0-kit.toml`；原生 MCP 配置要等 `apply` 写入。

```bash
use0-kit instruction set-section Testing --body "Run npm test before PRs." --targets codex,claude-code
```

功能：登记一个托管 instruction markdown 片段。  
可能变化：更新 `use0-kit.toml`，并把完整 markdown 内容保存到 `.use0-kit/resources/instructions/`；`AGENTS.md` / `CLAUDE.md` 要等 `apply` 写入。

```bash
use0-kit command add repo-check --content "Run npm test and npm run build." --targets codex
```

功能：登记一个 Codex command。  
可能变化：更新 `use0-kit.toml`，并把源内容保存到 `.use0-kit/resources/commands/`。

```bash
use0-kit subagent add reviewer --content "Review code for regressions and missing tests." --targets claude-code
```

功能：登记一个 Claude Code subagent。  
可能变化：更新 `use0-kit.toml`，并把源内容保存到 `.use0-kit/resources/subagents/`。

```bash
use0-kit hook add pre-apply --content "echo before-apply" --targets codex
```

功能：登记一个 hook 资源。  
可能变化：更新 `use0-kit.toml`，并把源内容保存到 `.use0-kit/resources/hooks/`。

```bash
use0-kit secret add --id openai --env OPENAI_API_KEY --targets codex
```

功能：声明项目需要 `OPENAI_API_KEY` 这个环境变量。  
可能变化：更新 `use0-kit.toml`；不会保存真实 secret 值。

## 3. Group Resources

```bash
use0-kit pack init demo --name local/demo --version 0.1.0
```

功能：创建一个资源包。  
可能变化：在 `use0-kit.toml` 中新增 `pack:demo`。

```bash
use0-kit pack add demo skill:codex-project-setup
```

功能：把 skill 放入 pack。  
可能变化：更新 `pack:demo` 的 `resources` 列表。

## 4. Plan And Apply

```bash
use0-kit plan --agent codex,claude-code
```

功能：预览会写入哪些 store 和 agent-native 目标。  
可能变化：只读预览，不写文件；即使存在 pending changes，成功退出码也是 `0`。

```bash
use0-kit apply --agent codex,claude-code --verify
```

功能：真正物化当前声明，并在完成后运行验证。  
可能变化：创建或更新 `.use0-kit/store/`、`.codex/`、`.claude/`、`AGENTS.md`、`CLAUDE.md`、lock 和 materialized state。

```bash
find . -maxdepth 3 \( -path './.codex/*' -o -path './.claude/*' -o -path './.use0-kit/store/*' -o -name 'AGENTS.md' -o -name 'CLAUDE.md' \) | sort
```

功能：查看实际生成的物化产物。  
可能变化：只读检查，不写文件。

## 5. Verify Health

```bash
use0-kit doctor
```

功能：检查 manifest、lock、local source、agent config、symlink、marker、policy 等状态。  
可能变化：只读检查，不写文件。

```bash
use0-kit lock verify
```

功能：确认当前 effective graph 和 `use0-kit.lock.json` 一致。  
可能变化：只读检查，不写文件。

```bash
use0-kit lock explain
```

功能：查看 lock 中每个资源的 digest、来源和物化路径。  
可能变化：只读检查，不写文件。

```bash
use0-kit diff --materialized
```

功能：确认磁盘物化结果是否和 `.use0-kit/materialized.json` 一致。  
可能变化：只读检查，不写文件。

## 6. Render Native Outputs

```bash
use0-kit mcp render --agent codex
```

功能：预览 Codex 的 MCP TOML 配置。  
可能变化：只打印内容，不写 `.codex/config.toml`。

```bash
use0-kit mcp render --agent claude-code
```

功能：预览 Claude Code 的 MCP JSON 配置。  
可能变化：只打印内容，不写 `.claude/mcp.json`。

```bash
use0-kit instruction render --agent codex
```

功能：预览会写入 `AGENTS.md` 的托管 instruction markdown 片段。  
可能变化：只打印内容，不写文件。

```bash
use0-kit command render repo-check --agent codex
```

功能：预览 `command:repo-check` 的最终内容。  
可能变化：只打印内容，不写文件。

```bash
use0-kit hook test pre-apply
```

功能：真实执行 hook 脚本并返回执行输出。  
可能变化：真实执行 hook 脚本；可能产生 stdout/stderr，也可能产生脚本自身的副作用。

```bash
use0-kit secret env openai
```

功能：查看 secret requirement 对应的环境变量名和 required 状态。  
可能变化：只读检查，不读取或保存真实 secret 值。

## 7. Force A Managed Update

```bash
use0-kit instruction set-section Testing --body "Run npm test and npm run build before PRs." --targets codex,claude-code --force
```

功能：替换同 scope 下已有的 `instruction:testing` 声明。  
可能变化：更新 `use0-kit.toml`；`--force` 只允许覆盖 use0-kit 管理的资源声明。

```bash
use0-kit apply --agent codex,claude-code --verify --force
```

功能：强制重建 use0-kit-managed 物化内容。  
可能变化：更新 `.codex/`、`.claude/`、`AGENTS.md`、`CLAUDE.md` 和 lock；不会绕过 policy/trust，也不会删除非托管文件。

```bash
sed -n '/use0-kit:begin instruction:testing/,/use0-kit:end instruction:testing/p' AGENTS.md
```

功能：确认 Codex instruction 托管 section 已更新。  
可能变化：只读检查，不写文件。

## 8. Local Registry Demo

```bash
node -e 'require("fs").writeFileSync("registry.json", JSON.stringify({items:[]}, null, 2))'
```

功能：创建一个本地 file registry。  
可能变化：新增或覆盖当前目录的 `registry.json`。

```bash
use0-kit registry add local "$PWD/registry.json"
```

功能：把本地 JSON 文件注册为名为 `local` 的 registry。  
可能变化：如果目标 JSON 不存在会先创建一个空 registry 文件，然后更新 `.use0-kit/registries.json`。

```bash
use0-kit registry login local
```

功能：标记当前项目已登录 `local` registry。  
可能变化：更新 `.use0-kit/registry-auth.json`。

```bash
use0-kit publish skill:codex-project-setup --registry local
```

功能：把当前 skill 转成 registry item 并发布到 `local`。  
可能变化：写入 `registry.json`，并更新 `.use0-kit/publish-log.json` 和 registry index。

```bash
use0-kit search project
```

功能：搜索当前项目已登记 registry 中的资源。  
可能变化：可能刷新 `.use0-kit/registry-index/` 缓存。

```bash
use0-kit registry info skill:codex-project-setup
```

功能：查看 registry item 的 source、targets、quality 和 provenance。  
可能变化：只读或刷新 registry index，不改资源声明。

## 9. Install From Registry In Another Project

```bash
TARGET=$(mktemp -d /tmp/use0-kit-install-target-XXXXXX)
cd "$TARGET"
```

功能：创建临时目标项目。  
可能变化：创建一个 `/tmp` 下的临时目录。

```bash
use0-kit scope init --scope project --agents codex
```

功能：初始化临时项目。  
可能变化：创建临时项目的 `use0-kit.toml`、lock 和 `.use0-kit/`。

```bash
use0-kit registry add local "/path/to/source/project/registry.json"
```

功能：让临时项目复用源项目的本地 registry。  
可能变化：如果目标 JSON 不存在会先创建一个空 registry 文件，然后更新临时项目的 `.use0-kit/registries.json`。

```bash
use0-kit install skill:codex-project-setup
```

功能：从 registry 安装 skill 声明。  
可能变化：更新临时项目的 `use0-kit.toml`，并写入 provenance。

```bash
use0-kit apply --agent codex --verify
```

功能：把安装来的 skill 物化到临时项目的 Codex 目录。  
可能变化：创建临时项目的 `.use0-kit/store/skills/` 和 `.codex/skills/`。

## 10. Rollback Demo

```bash
use0-kit backup create
```

功能：在当前全绿状态创建一个可回滚快照。  
可能变化：新增 `.use0-kit/backups/<backup-id>/`。

```bash
use0-kit instruction set-section Testing --body "Rollback verification marker" --targets codex,claude-code --force
```

功能：制造一个托管 instruction 变更用于验证 rollback。  
可能变化：更新 `use0-kit.toml`。

```bash
use0-kit apply --agent codex,claude-code --verify
```

功能：把 marker 变更写入 agent-native instruction 文件。  
可能变化：更新 `AGENTS.md`、`CLAUDE.md`、lock 和 materialized state。

```bash
use0-kit rollback <backup-id>
```

功能：恢复指定 backup 中的 use0-kit 管理路径。  
可能变化：恢复 `use0-kit.toml`、lock、`.use0-kit/state.json`、agent-native 目录和 instruction 文件。

```bash
use0-kit doctor
```

功能：确认 rollback 后状态健康。  
可能变化：只读检查，不写文件。
