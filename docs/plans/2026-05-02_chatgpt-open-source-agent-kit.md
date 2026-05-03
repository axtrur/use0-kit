# 开源项目统一管理

- Source: https://chatgpt.com/c/69f5b0e0-7ba4-83ea-815c-d86e0b8ec672
- Exported: 2026-05-02T09:31:01.094Z
- Messages: 11

## 1. User

有什么开源项目是用来统一管理skill, mcp等资源，同时又能屏蔽不同coding agent的（比如codex, claude code ），比如skills文件夹不是分散到不同coding agent的.xxx/skills下的，通过system link ?

## 2. Assistant

我会从开源工具和可落地架构两条线看，重点筛选能集中管理 skills/MCP/rules，并适配 Codex、Claude Code、Cursor 等多 agent 的方案。

## 3. Assistant

有，**最贴近你描述的项目是 Sentry 的 `dotagents`**。它明确用 `.agents/skills/` 作为单一来源，然后 symlink 到 `.claude/skills/`、`.cursor/skills/` 等各 agent 期望的位置，并用 `agents.toml` 同时声明 skills、MCP servers、hooks。它支持 Claude、Cursor、Codex、VS Code、OpenCode、Pi 等目标。[GitHub+1](https://github.com/getsentry/dotagents)

### 推荐顺序

| 项目 | 最适合场景 | 是否支持 symlink / 单一 skills 源 | MCP 支持 | 多 agent 抽象 |
| --- | --- | --- | --- | --- |
| **getsentry/dotagents** | 你说的这种：项目内统一管理 skills、MCP、hooks | **是**，`.agents/skills/` → 各 agent skills 目录 | **是** | Claude / Cursor / Codex / VS Code / OpenCode / Pi |
| **vercel-labs/skills** | skills-only，但想覆盖非常多 agent | **是**，推荐 symlink，也可 copy | 否，主要是 skills | 50+ agents |
| **mTarsier** | 想要 GUI / CLI 统一管理 MCP + Skills 配置 | 不强调单一 symlink 源，更像配置管理器 | **是** | Claude Code / Codex CLI / Cursor / Windsurf / Gemini CLI 等 |
| **Agentver** | 团队级 skill registry / 版本控制 / 安全扫描 | 不主打 symlink，主打版本化部署 | **有 MCP catalogue / bundles** | 43+ agents |
| **cgcone** | MCP 为主，同时覆盖 skills/plugins/hooks | 不主打 symlink | **强** | Claude Code / Gemini CLI / OpenAI Codex / Copilot CLI |
| **agent-add** | 一次性把 MCP、skills、prompt、command、sub-agent 安装进不同工具 | 不主打集中目录，偏安装器 | **是** | Claude Code / Cursor / Codex CLI / Gemini CLI / Windsurf 等 |

### 1. 最推荐：`getsentry/dotagents`

它就是为“不要把 skills 分散到各 agent 的 `.xxx/skills` 目录”这个问题设计的。README 里写得很直接：skills 放在 `.agents/skills/`，再 symlink 到 `.claude/skills/`、`.cursor/skills/` 或其他工具要求的路径；同时 `agents.toml` 可以声明 skills、MCP servers、hooks，`dotagents install` 会生成各 agent 的配置。[GitHub+1](https://github.com/getsentry/dotagents)

典型结构大概是：

```
repo/
  agents.toml
  .agents/
    skills/
      code-review/
        SKILL.md
  .claude/
    skills/code-review -> ../.agents/skills/code-review
  .cursor/
    skills/code-review -> ../.agents/skills/code-review
  .codex/
    ...
```

它的 CLI 也比较贴近工程化需求：`init` 创建 `agents.toml` 和 `.agents/skills/`，`install` 解析 sources、复制 skills、写 lockfile、创建 symlink，并生成 MCP / hooks 配置；`mcp add` 可以把 MCP server 声明写入 `agents.toml` 并生成目标 agent 配置。[Dotagents](https://dotagents.sentry.dev/cli)

适合你这种 agent builder 的原因：它不是 marketplace 优先，而是 **repo-level / team-level source of truth** 优先。一个项目提交 `agents.toml`，managed skills gitignored，协作者 clone 后跑 `dotagents install` 即可恢复一致配置。[Dotagents](https://dotagents.sentry.dev/guide)

安装示例：

```
npx @sentry/dotagents init
npx @sentry/dotagents add getsentry/skills
--name
 find-bugs
npx @sentry/dotagents mcp add github \

--command
 npx \

--args

-y
 \

--args
 @modelcontextprotocol/server-github \

--env
 GITHUB_TOKEN
npx @sentry/dotagents install
```

### 2. skills-only：`vercel-labs/skills`

如果你当前只关心 `SKILL.md`，Vercel 的 `skills` CLI 是覆盖面更广的选择。它支持 OpenCode、Claude Code、Codex、Cursor 以及 50+ agents；支持 project / global scope；安装方式里明确给了 **Symlink recommended**，即从每个 agent 目录指向 canonical copy。[GitHub](https://github.com/vercel-labs/add-skill)

示例：

```
npx skills add vercel-labs/agent-skills
--agent

'*'
npx skills list
npx skills update
```

但它的边界很清楚：它主要解决 **skills 包管理**，不是统一声明 MCP、hooks、commands 的全栈配置管理。Vercel 文档也把它定位为安装和管理 agent skill packages 的 CLI。[Vercel](https://vercel.com/changelog/introducing-skills-the-open-agent-skills-ecosystem)

### 3. GUI / 桌面管理：`mTarsier`

`mTarsier` 更像“本机 AI client 配置控制台”。它开源、MIT、本地运行，能统一查看和编辑 MCP servers、skills、client configs；支持 Claude Desktop、Cursor、Windsurf、VS Code、Claude Code、Codex CLI、Gemini CLI、OpenCode 等，并提供 `tsr` CLI。[GitHub+1](https://github.com/mcp360/mTarsier)

它适合这种场景：你不是特别执着于 `.agents/skills` 这种 repo-level source of truth，而是想在本机统一发现、编辑、安装、复制、同步 MCP 和 skills。它的 README 提到 Skills Manager、Skills Marketplace、一键安装到多个 clients、Custom Skills、copy skills between clients；MCP 部分也支持 unified dashboard、config editor、marketplace、auto-backup。[GitHub](https://github.com/mcp360/mTarsier)

### 4. 团队平台：`Agentver`

`Agentver` 更像“agent skills 的 GitHub / 私有 registry / 团队控制面”。它支持 43+ assistants，包含 git-native versioning、RBAC、audit log、security scanning、credential vault、bundles、MCP server catalogue、自托管 Docker 等。[GitHub](https://github.com/agentver/agentver)

它适合团队治理：谁能发布 skill、谁能安装、版本锁定、安全扫描、MCP 凭据如何共享。它不完全是你说的“symlink 中央目录”模型，而是“写一次 skill，部署到各 agent 正确位置”的平台模型。[Agentver](https://agentver.com/)

### 5. MCP-first：`cgcone`

`cgcone` 是 “npm for AI CLIs” 风格，重点是把 MCP servers、plugins、skills 同时安装到 Claude Code、Gemini CLI、OpenAI Codex、Copilot CLI 等工具。它会扫描已安装的 AI CLI，并把 MCP 配置写到各自格式，比如 Claude Code 的 `~/.claude.json`、Gemini CLI 的 `~/.gemini/settings.json`、OpenAI Codex 的 `~/.codex/config.toml`。[GitHub](https://github.com/Himanshu507/cgcone)

适合场景：你 MCP server 很多，想 `cgcone install brave-search` 一条命令写入所有 CLI。它也索引 MCP registry、GitHub MCP repos、Claude Code plugins、Claude Code skills、subagents、commands、hooks。[GitHub](https://github.com/Himanshu507/cgcone)

### 6. 通用安装器：`agent-add`

`agent-add` 支持 MCP、Skills、slash commands、sub-agents、prompts，并给了多个 host 的支持矩阵：Cursor、Claude Code、Qwen Code、GitHub Copilot、Codex CLI、Windsurf、Gemini CLI、opencode 等。它的目标是屏蔽不同 host 的配置格式，比如 Cursor 的 `.cursor/mcp.json`、Claude Code 的 `.mcp.json`、Codex 的 TOML。[GitHub](https://github.com/pea3nut/agent-add)

它更适合“资产发布者”或“一次性安装包”场景，不如 `dotagents` 那样强调 `.agents/skills` 作为项目内单一源。

## 我的结论

你描述的需求优先选：

```
npx @sentry/dotagents init
```

因为它同时满足这几个点：

```
单一目录：.agents/skills/
分发方式：symlink 到 .claude/.cursor/.codex 等
统一声明：agents.toml
资源范围：skills + MCP servers + hooks
目标 agent：Claude / Cursor / Codex / VS Code / OpenCode / Pi
```

如果你只要 skills，选 `vercel-labs/skills`；如果你要本机 GUI 管 MCP + skills，选 `mTarsier`；如果你偏团队 registry / 版本治理，选 `Agentver`；如果你 MCP-first，选 `cgcone`。

## 4. User

这个呢 https://github.com/millionco/agent-install ， 我的目的是后续实现一个自己的比较全面好用的agent-kit ，所以需要整体做一次深度对比，抽象设计模式等，

## 5. Assistant

我会把 `agent-install` 纳入前面那组项目做深度对比，重点看资源模型、安装/同步策略、跨 agent 适配、canonical source、schema 抽象和团队治理。

## 6. Assistant

我已经确认 `agent-install` 更像可嵌入的跨 agent 安装 SDK，而不是 dotagents 的同类替代；它用 Node API/CLI 覆盖 Skill、MCP 和 AGENTS.md。

## 7. Assistant

是，`millionco/agent-install` **很值得纳入重点对比**。它和我前面提到的 `dotagents` 不是同一类：`dotagents` 更像“repo 级声明式配置管理器”，而 `agent-install` 更像“给工具作者用的跨 agent 安装 SDK / adapter layer”。

我的判断是：

> **如果你要做自己的 `agent-kit`，`agent-install` 是当前最值得参考的底层 API 形态之一；但它还不是完整的 agent-kit。**
>
> 它解决的是“把 Skill、MCP、AGENTS.md 写到各 agent 原生位置”这一层；你还需要在它上面补：manifest、lockfile、registry、安全策略、packs、commands、subagents、hooks、secret 管理、diff/rollback/doctor、团队协作等。

---

## 1. `agent-install` 的定位

`agent-install` 的 README 定位很明确：用一个 CLI 和一个 Node API 安装 **skills、MCP servers、AGENTS.md guidance**，并写入 Claude Code、Cursor、Codex、OpenCode 等 agent 的原生配置格式，而不是让你的工具分别理解 JSON、JSONC、YAML、TOML、skills 目录和 AGENTS.md 变体。它同时提供 `skill`、`mcp`、`agentsMd` 三个 namespace，CLI verb 和 Node API verb 对齐。[GitHub+1](https://github.com/millionco/agent-install)

它支持的资源面现在是：

```
skill      -> SKILL.md directory
mcp        -> remote URL / npm package / raw command
agentsMd   -> AGENTS.md / CLAUDE.md / GEMINI.md / Cursor rules / Windsurf rules 等
```

Skill 来源支持本地路径、GitHub/GitLab shorthand、完整 URL、SSH git、任意 git remote、direct `SKILL.md` URL、以及 `/.well-known/agent-skills` 自动发现；MCP 来源支持 HTTP/SSE URL、npm package、raw command。[GitHub](https://github.com/millionco/agent-install)

它的覆盖面也不小：README 说 Skills 支持 52 个 agents，MCP 支持 Claude Code、Claude Desktop、Cursor、Codex、Cline、VS Code、GitHub Copilot CLI、Gemini CLI、Goose、OpenCode、Zed、Antigravity、MCPorter 等，AGENTS.md 则支持 Universal、Claude Code、Gemini CLI、Cursor、Windsurf、Codex、OpenCode、Aider。[GitHub](https://github.com/millionco/agent-install)

更关键的是，它的源码层面已经有你关心的 canonical skills 设计：常量里定义了 `.agents/skills` 作为 canonical skills dir，类型里有 `InstallMode = "symlink" | "copy"`，实际 installer 默认使用 symlink；安装时会先把 skill 复制到 canonical dir，再把 agent-specific 目录 symlink 到 canonical dir，symlink 失败时 fallback copy。[GitHub+2GitHub+2](https://raw.githubusercontent.com/millionco/agent-install/main/packages/agent-install/src/skill/constants.ts)

所以它比普通 installer 更接近你想要的东西。

---

## 2. 但它不是完整的 “agent-kit”

`agent-install` 的最大优势是 **imperative API-first**：

```
import
 {
skill
,
mcp
,
agentsMd
 }
from

"agent-install"
;
await

skill
.
add({
  source:
"owner/repo"
,
  agents: [
"cursor"
],
});
mcp
.
add({
  source:
"https://mcp.context7.com/mcp"
,
  agents: [
"cursor"
],
  name:
"context7"
,
});
agentsMd
.
setSection({
  heading:
"Testing"
,
  body:
"Run pnpm test"
,
});
```

这对你未来做 `agent-kit` 很有价值，因为你可以把它看成底层 adapter engine。但它当前的短板也明显：

| 维度 | `agent-install` 现状 | 对 agent-kit 的含义 |
| --- | --- | --- |
| Manifest | 没有 repo-level `agentkit.toml` / `agents.toml` 这种中心声明 | 你需要自己做 declarative layer |
| Lockfile | README 没看到完整的 reproducible lock 设计 | 你需要做 digest/ref/version 锁定 |
| Security | 没有类似 Agentver 的 scanner / trust gate | 你需要做 provenance、allowlist、risk scan |
| Registry | 没有 marketplace / search / index | 你需要做 registry 或兼容外部 registry |
| Packs | 没有多资源 bundle manifest | 需要参考 `agent-add` / Agentver |
| Commands/Subagents/Hooks | 当前主要是 Skill、MCP、AGENTS.md | 需要扩展 resource kind |
| Rollback/Backup | 未形成完整 transaction/rollback 体验 | 需要补 diff/apply/backup |
| Team workflow | 没有 RBAC、review、audit | 需要另做平台层或 Git-native workflow |

它的网站也说明 API 还处于 pre-1.0，短 verbs 和 long-form aliases 会保留，但 internal helpers 可能变化。[agent-install](https://www.agent-install.com/)

我的建议是：**可以参考或短期依赖 `agent-install`，但不要把它当成最终架构的全部。** 更稳的路线是吸收它的 adapter/API 设计，然后做你自己的 resource graph + manifest + policy + lifecycle。

---

## 3. 竞品/相关项目深度对比

### 总览表

| 项目 | 核心定位 | 最强点 | 最大短板 | 对你做 agent-kit 的启发 |
| --- | --- | --- | --- | --- |
| `agent-install` | API-first cross-agent installer | Node API + CLI；Skill/MCP/AGENTS.md 三面统一；source parsing 强 | 缺声明式状态、registry、安全、packs | 适合作为底层 `adapter/materializer` 模型参考 |
| `dotagents` | Repo-level declarative manager | `agents.toml` + `.agents/skills` + symlink + MCP/hooks | agent 覆盖少于 `agent-install`；resource 种类不够广 | 参考它的 manifest、sync、doctor、trust policy |
| `vercel-labs/skills` | Skills package manager | skills 生态、50+ agents、symlink/copy、skills.sh | 只管 skills，不管 MCP/commands/subagents | 参考 skill discovery、canonical copy、ecosystem positioning |
| `agent-add` | Multi-asset one-shot installer | MCP、Skill、Prompt、Command、Sub-agent、Pack 都支持 | 更像安装器，不是长期状态管理器 | 参考资源类型和 Pack manifest |
| `mTarsier` | Desktop/CLI MCP & Skill manager | GUI、client detection、backup、marketplace | 更偏本机配置 UI，不是 library-first | 参考 UX、backup、config editor |
| `Agentver` | Team-grade skill platform | RBAC、安全扫描、versioning、vault、bundles、self-host | 架构重，平台层 AGPL，可能过大 | 参考治理、安全、团队生命周期 |
| `cgcone` | MCP/extension registry + installer | registry/indexer、search、MCP-first marketplace | agent adapter 覆盖和 lifecycle 不如平台型 | 参考 registry generation pipeline |

---

## 4. `agent-install` vs `dotagents`

这两个最容易混淆，但设计哲学不同。

### `dotagents`

`dotagents` 是声明式的。它让你把 skills、MCP servers、hooks 写进 `agents.toml`，并把 skills 放在 `.agents/skills/`，再 symlink 到 `.claude/skills/`、`.cursor/skills/` 或其他 agent 需要的位置。README 直接强调 “one source of truth”，以及 Claude、Cursor、Codex、VS Code、OpenCode、Pi 多 agent 配置。[GitHub](https://github.com/getsentry/dotagents)

它的 guide 也明确：`init` 创建 `agents.toml` 和 `.agents/skills/`；`add` 从 GitHub/git/local 安装 skill；每个 skill copied 到 `.agents/skills/` 并 symlink 到 agent 目录；`install` 用于 clone 后恢复配置；`sync` 可离线修复 broken symlink、MCP/hook configs 等。[Dotagents+1](https://dotagents.sentry.dev/guide)

`dotagents` 还有 trust policy：`[trust]` 可以限制允许的 skill sources，并且在网络操作前验证。[Dotagents](https://dotagents.sentry.dev/security)

### `agent-install`

`agent-install` 是命令式的。它没有 `agents.toml` 这种中心声明，而是提供 API：

```
skill
.
add(...)
mcp
.
add(...)
agentsMd
.
setSection(...)
```

它的价值在于把各 agent 的路径、格式、config patch、source parser 都封成库。也就是说：

```
dotagents    = declarative manager
agent-install = imperative adapter SDK
```

### 结论

你自己的 `agent-kit` 最好把两者结合：

```
agentkit.toml / agentkit.lock
        ↓
resolver + policy + planner
        ↓
agent-install 风格 adapter/materializer
        ↓
Claude / Cursor / Codex / OpenCode / Gemini / Copilot / Windsurf ...
```

也就是：**上层学 `dotagents`，底层学 `agent-install`。**

---

## 5. `agent-install` vs `vercel-labs/skills`

`vercel-labs/skills` 是 skills-only 的 package manager。它支持 GitHub、GitLab、任意 git URL、本地路径；支持 project/global scope；支持 `--copy`，也支持 symlink。README 说 interactive install 时 Symlink 是推荐方式，因为它从各 agent 指向 canonical copy，保持 single source of truth。[GitHub](https://github.com/vercel-labs/skills)

它覆盖的 agent 非常多，支持 Claude Code、Codex、Cursor、OpenCode、Gemini CLI、GitHub Copilot、Windsurf 等 50+ agents。[GitHub](https://github.com/vercel-labs/skills)

但它主要服务 Agent Skills 生态。Agent Skills 规范本身是一个 folder + `SKILL.md` 的轻量格式，`SKILL.md` 至少需要 `name` 和 `description`，也可以包含 scripts、references、assets 等资源；加载方式是 progressive disclosure：启动时只加载 name/description，命中任务后才读取完整 `SKILL.md`，需要时再读取额外资源。[Agent Skills+1](https://agentskills.io/)

所以：

```
vercel-labs/skills = skill package manager
agent-install      = skill + MCP + AGENTS.md installer SDK
```

你做 agent-kit 时，`skills` 适合参考 **skills discovery / install UX / ecosystem spec compatibility**，但不能作为全资源抽象的主干。

---

## 6. `agent-install` vs `agent-add`

`agent-add` 的资源覆盖面比 `agent-install` 更广。它支持 MCP、Prompt、Skill、Command、Sub-agent，并且支持 Pack manifest。支持矩阵里包括 Cursor、Claude Code、Qwen Code、GitHub Copilot、Codex CLI、Windsurf、Gemini CLI、opencode 等；Claude Desktop 只支持 MCP。[GitHub](https://github.com/pea3nut/agent-add)

它的设计很像“asset installer”：

```
npx
-y
 agent-add \

--mcp

'{"playwright":{"command":"npx","args":["-y","@playwright/mcp"]}}'
 \

--skill

'https://github.com/anthropics/skills.git#skills/pdf'
 \

--prompt

'https://example.com/rules.md'
 \

--command

'https://github.com/wshobson/commands.git#tools/security-scan.md'
 \

--sub-agent

'https://github.com/VoltAgent/awesome-claude-code-subagents.git#...'
```

它还提供 Pack Manifest，把多个 asset 组合成一个 JSON 包，例如一个 pack 同时包含 MCP、skill、prompt、command、subAgent。[GitHub](https://github.com/pea3nut/agent-add)

它有一个非常值得借鉴的设计：**host-specialized frontmatter**。例如 sub-agent 文件可以写：

```
agent-add/cursor/model: fast
agent-add/claude-code/model: haiku
```

安装到不同 host 时，匹配的字段被提升为顶层字段，其他 host-specific 字段被删除。这个模式适合你自己的 agent-kit：

```
agent-kit/codex/model: gpt-5.5
agent-kit/claude-code/model: sonnet
agent-kit/cursor/rule-type: always
```

缺点是：`agent-add` 更像 one-shot installer，不像 `dotagents` 那样有持续同步、doctor、状态修复、team-level source of truth。

### 结论

```
agent-install = 更好的 SDK/API 形态
agent-add     = 更好的 resource type 覆盖和 pack 思路
```

你的 agent-kit 应该把两者融合：API-first + pack-first + stateful reconciliation。

---

## 7. `agent-install` vs `mTarsier`

`mTarsier` 是 GUI/desktop 方向。它定位为开源 MCP & Skills manager，提供 MCP unified dashboard、client detection、config editor、marketplace、auto-backup；skills 方面支持 view/create/manage、marketplace、一键安装到多个 clients、custom skills、copy between clients。[GitHub](https://github.com/mcp360/mTarsier)

它还支持 `tsr` CLI，比如：

```
tsr list
tsr clients
tsr install brave-search
tsr config cursor
--edit
tsr skills list
--client
 claude-code
tsr skills search
"frontend design"
tsr skills install anthropics/courses/prompt-eng
--client
 claude-code
```

支持 clients 包括 Claude Desktop、ChatGPT Desktop、Codex、GitHub Copilot、Cursor、Windsurf、VS Code、Antigravity、Claude Code、Gemini CLI、Codex CLI、Open Code 等。[GitHub](https://github.com/mcp360/mTarsier)

它对你的启发主要不是底层 API，而是 UX：

```
- 自动发现本机 clients
- 修改 config 前自动 backup
- JSON validation / syntax highlighting
- 一键 rollback
- marketplace browsing
- skills 在多个 client 之间 copy/share
```

如果你未来的 agent-kit 要做桌面版或 Web UI，`mTarsier` 是重要参考。

---

## 8. `agent-install` vs `Agentver`

`Agentver` 是最接近“团队平台”的项目。它不是轻量 installer，而是 team-grade skill management：版本、审计、部署到 43+ assistants，带 RBAC、安全扫描、credential vault、bundles、MCP catalogue、change proposal、self-hosting。[GitHub](https://github.com/agentver/agentver)

它的安全扫描值得重点参考：安装前本地扫描，75 条 deterministic rules，覆盖 dangerous commands、data exfiltration、credential exposure、remote code execution、obfuscated code、Unicode obfuscation、prompt injection、suspicious URLs 等，并用 `PASS/WARN/BLOCK` verdict。[GitHub](https://github.com/agentver/agentver)

还有一个架构点很重要：Agentver 说各 agent 的配置路径和格式定义在 data layer，agent 改格式时更新一个 entry，而不是改 skill 内容；添加新 agent 也是 data change，而不是架构变化。[GitHub](https://github.com/agentver/agentver)

这点你一定要吸收。你的 agent-kit 不应该把所有 agent 逻辑散落在 if/else 里，而应该做成：

```
interface

AgentDefinition
 {
  id:
string
;
  displayName:
string
;
  detect():
Promise
<
boolean
>;
  capabilities:
CapabilityMatrix
;
  paths:
PathResolver
;
  materializers:
Record
<
ResourceKind
,
Materializer
>;
  configFormats:
Record
<
string
,
"json"

|

"jsonc"

|

"toml"

|

"yaml"

|

"markdown"
>;
}
```

### 结论

```
Agentver = 治理/安全/团队生命周期参考
agent-install = 轻量 API/adapter 参考
```

如果你做的是 developer-first local agent-kit，不要一开始做成 Agentver 那么重；但安全扫描、lockfile、team policy 要从一开始留接口。

---

## 9. `agent-install` vs `cgcone`

`cgcone` 是 MCP/extension registry-first。它定位为 “package manager for AI CLI extensions”，一个命令把 MCP server、plugin、skill 安装到 Claude Code、Gemini CLI、OpenAI Codex、GitHub Copilot CLI 等；它会 scan 本机 CLI、search registry、install、uninstall、configure、doctor。[GitHub](https://github.com/Himanshu507/cgcone)

它最值得参考的是 registry pipeline：它从 official MCP registry、GitHub MCP repos、Claude Code plugins、Claude Code skills、community subagents/commands/hooks 生成 2400+ extensions 的 registry，并且 repo 结构里有 registry generation scripts、CLI adapters、local install tracking、doctor/update/configure commands。[GitHub](https://github.com/Himanshu507/cgcone)

对你的 agent-kit 来说，`cgcone` 的启发是：

```
agent-kit 不应该只做 installer
还应该有 registry/indexer/search
```

尤其是 MCP 会越来越多，source resolver 不能只靠用户手写 URL。你需要：

```
agentkit search context7
agentkit info context7
agentkit install context7
--agents
 codex,cursor
agentkit doctor context7
agentkit update
--all
```

---

## 10. 资源抽象：你自己的 agent-kit 应该管理什么？

我建议你把资源分成 9 类，而不是只做 skills/MCP：

```
1. skill         SKILL.md directory
2. mcp          MCP server config / remote URL / stdio command / npm / uvx / docker
3. instruction  AGENTS.md / CLAUDE.md / GEMINI.md / Cursor rules / Windsurf rules
4. command      slash command / command markdown
5. subagent     specialized agent profile
6. hook         pre/post tool use hooks, event hooks
7. plugin       Claude Code plugin / OpenCode plugin / future plugin systems
8. pack         bundle of multiple resources
9. secret       env binding / credential reference / auth profile
```

Skill 和 MCP 的语义要分开：

```
Skill = 教 agent 怎么做，主要是知识/流程/脚本/模板
MCP   = 给 agent 能调用的外部工具、数据源和动作接口
```

MCP 官方定义是一个 open-source standard，用来把 AI applications 连接到外部系统，包括数据源、工具和 workflows；传输层标准包括 stdio 和 Streamable HTTP。[Model Context Protocol+1](https://modelcontextprotocol.io/docs/getting-started/intro)

所以你的 IR 里不要把 MCP server 当成普通 config 文件。它应该有 transport、安全、auth、env、capability、lifecycle 等字段。

---

## 11. 推荐的核心架构模式

### Pattern A：Canonical Store + Materialized Views

这是你一开始提到的 symlink 问题。正确抽象是：

```
Canonical Store:
  .agent-kit/store/skills/<name>@<digest>/
  .agent-kit/store/commands/<name>@<digest>.md
  .agent-kit/store/subagents/<name>@<digest>.md
Materialized Views:
  .claude/skills/<name>        -> canonical
  .cursor/skills/<name>        -> canonical
  .codex/skills/<name>         -> canonical 或 .agents/skills
  .agents/skills/<name>        -> canonical
```

不要让每个 agent 目录成为真实源。它们应该只是 projection。

`dotagents` 和 `vercel-labs/skills` 都在用这个思想：一个 canonical skills source，然后 symlink 到 agent 目录。[GitHub+1](https://github.com/getsentry/dotagents)

### Pattern B：Declarative Intent + Reconciliation

不要只提供：

```
agentkit install skill foo
```

而是要有：

```
# agentkit.toml
version = 1
agents = ["claude-code", "cursor", "codex"]
[[skills]]
id = "frontend-review"
source = "github:acme/agent-resources#skills/frontend-review"
version = "v1.2.0"
[[mcp]]
id = "context7"
transport = "http"
url = "https://mcp.context7.com/mcp"
[[instructions]]
id = "testing"
target = "universal"
heading = "Testing"
body = "Run pnpm test before opening PRs."
```

然后：

```
agentkit plan
agentkit apply
agentkit sync
agentkit doctor
agentkit prune
```

状态机应该是：

```
resolve sources
  → validate resources
  → scan/policy gate
  → compute desired state
  → read current agent state
  → produce diff
  → apply transaction
  → verify
  → write lock/state
```

### Pattern C：Hexagonal Adapter Architecture

核心逻辑不应该知道 `.claude/skills`、`.cursor/mcp.json`、`.codex/config.toml` 这些细节。应做成 adapter：

```
interface

AgentAdapter
 {
  id:
string
;
  displayName:
string
;
  detect(
ctx
:
DetectContext
):
Promise
<
DetectionResult
>;
  capabilities():
CapabilityMatrix
;
  readState(
ctx
:
ScopeContext
):
Promise
<
AgentState
>;
  plan(

desired
:
ResourceGraph
,

current
:
AgentState
,

ctx
:
ScopeContext
  ):
Promise
<
AgentPlan
>;
  apply(
plan
:
AgentPlan
,
ctx
:
ApplyContext
):
Promise
<
ApplyResult
>;
  remove(
resourceId
:
string
,
ctx
:
ScopeContext
):
Promise
<
void
>;
  verify(
ctx
:
ScopeContext
):
Promise
<
VerifyResult
>;
}
```

每个 adapter 的数据层应该是声明式的：

```
const

codex
:
AgentDefinition

=
 {
  id:
"codex"
,
  paths: {
    skills:
".agents/skills"
,
    mcpProject:
".codex/config.toml"
,
    mcpGlobal:
"~/.codex/config.toml"
,
  },
  formats: {
    mcp:
"toml"
,
  },
  capabilities: {
    skill:
true
,
    mcp:
true
,
    instruction:
true
,
    command:
false
,
    subagent:
true
,
    hook:
false
,
  },
};
```

这就是 Agentver 提到的 data-layer 思路，但你可以做得更轻。[GitHub](https://github.com/agentver/agentver)

### Pattern D：Resource Graph，不是文件列表

你要管理的不是文件，而是资源图：

```
type

ResourceKind

=

|

"skill"

|

"mcp"

|

"instruction"

|

"command"

|

"subagent"

|

"hook"

|

"plugin"

|

"pack"

|

"secret"
;
interface

ResourceNode
 {
  id:
string
;
  kind:
ResourceKind
;
  source:
SourceRef
;
  version?:
string
;
  digest?:
string
;
  targets:
TargetSelector
[];
  dependencies?:
string
[];
  overlays?:
Record
<
string
,
unknown
>;
  policy?:
PolicyRef
;
  provenance?:
Provenance
;
}
```

Pack 只是 resource graph 的 bundle：

```
[[packs]]
id = "frontend-kit"
resources = [
  "skill:react-best-practices",
  "skill:web-design-guidelines",
  "mcp:context7",
  "instruction:testing",
  "command:security-scan"
]
```

这里可以参考 `agent-add` 的 Pack Manifest，它已经把 MCP、skill、prompt、command、subAgent 组合成 bundle。[GitHub](https://github.com/pea3nut/agent-add)

### Pattern E：Policy Gate / Trust Gate

最小也要支持：

```
[policy]
allow_unpinned_git = false
allow_remote_http_skills = false
require_digest = true
block_high_risk = true
[trust]
github_orgs = ["acme", "vercel-labs"]
git_domains = ["git.corp.example.com"]
```

`dotagents` 的 trust policy 是一个轻量参考；Agentver 的 scanner 是重型参考。[Dotagents+1](https://dotagents.sentry.dev/security)

### Pattern F：Host-specific Overlay

不同 agent 对同一资源的 schema 支持不同。不要 fork 多份资源，而是用 overlay：

```
---
name: playwright-tester
description: Generate and debug Playwright tests.
agent-kit:
  cursor:
    model: fast
  claude-code:
    model: haiku
  codex:
    effort: high
---
```

安装时：

```
base resource + target overlay → normalized host artifact
```

这个 pattern 可以从 `agent-add` 的 host-specific frontmatter 借鉴。[GitHub](https://github.com/pea3nut/agent-add)

---

## 12. 我建议你的 `agent-kit` 分层

```
agent-kit
├── core
│   ├── resource IR
│   ├── source resolver
│   ├── validator
│   ├── policy engine
│   ├── planner
│   ├── lockfile
│   └── transaction engine
│
├── adapters
│   ├── claude-code
│   ├── cursor
│   ├── codex
│   ├── opencode
│   ├── gemini-cli
│   ├── github-copilot
│   ├── windsurf
│   └── ...
│
├── materializers
│   ├── symlink-skill
│   ├── copy-skill
│   ├── jsonc-config-patch
│   ├── toml-config-patch
│   ├── yaml-config-patch
│   ├── markdown-section-upsert
│   └── native-command
│
├── registry
│   ├── search index
│   ├── metadata crawler
│   ├── source verifier
│   └── ranking/quality signals
│
├── cli
│   ├── init
│   ├── add
│   ├── install/apply
│   ├── plan
│   ├── sync
│   ├── doctor
│   ├── audit
│   ├── update
│   └── publish
│
└── optional UI/server
    ├── desktop manager
    ├── team dashboard
    └── MCP server interface
```

---

## 13. 一个可落地的 manifest 草案

```
version = 1
agents = ["claude-code", "cursor", "codex", "opencode"]
[scope]
mode = "project" # project | user | global
canonical_store = ".agent-kit/store"
materialize = "symlink" # symlink | copy | auto
[policy]
require_pinned_refs = true
require_lockfile = true
block_high_risk = true
allow_untrusted_sources = false
[trust]
github_orgs = ["acme", "vercel-labs"]
git_domains = ["git.corp.example.com"]
[[skills]]
id = "web-design-guidelines"
source = "github:vercel-labs/agent-skills#skills/web-design-guidelines"
ref = "main"
targets = ["*"]
[[skills]]
id = "internal-review"
source = "path:./agent-resources/skills/internal-review"
targets = ["claude-code", "cursor"]
[[mcp]]
id = "context7"
transport = "http"
url = "https://mcp.context7.com/mcp"
targets = ["cursor", "codex", "claude-code"]
[[mcp]]
id = "postgres"
transport = "stdio"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-postgres"]
env = ["DATABASE_URL"]
targets = ["claude-code", "cursor"]
[[instructions]]
id = "testing"
placement = "section"
heading = "Testing"
body = "Run pnpm test before opening a PR."
targets = ["universal", "claude-code", "cursor", "codex"]
[[commands]]
id = "security-scan"
source = "github:wshobson/commands#tools/security-scan.md"
targets = ["claude-code", "cursor", "opencode"]
[[subagents]]
id = "backend-developer"
source = "github:VoltAgent/awesome-claude-code-subagents#categories/01-core-development/backend-developer.md"
targets = ["claude-code", "cursor"]
[[packs]]
id = "frontend-kit"
resources = [
  "skill:web-design-guidelines",
  "mcp:context7",
  "instruction:testing",
  "command:security-scan"
]
```

Lockfile 则应记录 resolved ref、digest、source URL、resource kind、installed targets、generated artifact paths：

```
{
  "version":
1
,
  "resources": {
    "skill:web-design-guidelines": {
      "source":
"github:vercel-labs/agent-skills#skills/web-design-guidelines"
,
      "resolvedUrl":
"https://github.com/vercel-labs/agent-skills.git"
,
      "resolvedRef":
"abc123..."
,
      "digest":
"sha256:..."
,
      "targets": [
"claude-code"
,
"cursor"
,
"codex"
],
      "materialized": {
        "claude-code":
".claude/skills/web-design-guidelines"
,
        "cursor":
".agents/skills/web-design-guidelines"
,
        "codex":
".agents/skills/web-design-guidelines"
      }
    }
  }
}
```

---

## 14. MVP 路线建议

### MVP 1：Local-first core

先做：

```
Skill + MCP + AGENTS.md
agentkit.toml
agentkit.lock.json
symlink/copy materialization
Claude Code / Cursor / Codex / OpenCode
plan/apply/sync/doctor
```

这一阶段可以大量参考 `agent-install` + `dotagents`。

### MVP 2：多资源扩展

加入：

```
commands
subagents
hooks
packs
host overlays
```

这一阶段参考 `agent-add`。

### MVP 3：安全和可复制性

加入：

```
trust allowlist
static scanner
digest verification
pinning policy
backup/rollback
JSONC/TOML/YAML comment-preserving patch
secrets env binding
```

这一阶段参考 `Agentver`、`mTarsier`、`cgcone doctor`。

### MVP 4：Registry / Marketplace

加入：

```
agentkit search
agentkit info
agentkit publish
agentkit registry sync
quality signals: stars, last commit, archived, license, risk score
```

这一阶段参考 `cgcone` 和 `skills.sh`。

---

## 15. 我对 `agent-install` 的最终评价

`agent-install` 是一个很好的 **adapter SDK seed**：

```
优点：
- Skill / MCP / AGENTS.md 三个关键 surface 都覆盖
- Node API 很适合被你的 agent-kit 调用或借鉴
- source parser 强，支持 git/local/url/well-known
- MCP 写入原生 JSON/JSONC/YAML/TOML
- AGENTS.md section upsert 不破坏周围内容
- skills 默认 canonical + symlink，并有 copy fallback
- agent 覆盖面比 dotagents 更广
```

但它目前不是完整 agent-kit：

```
缺点：
- 没有 declarative manifest
- 没有完整 lockfile/reconciliation
- 没有 registry/search
- 没有 security scanner/trust lifecycle
- 没有 packs/commands/subagents/hooks 全面覆盖
- 没有 team governance
- pre-1.0，API 还年轻
```

所以你自己的设计可以这样取舍：

```
底层 adapter/API：参考 agent-install
repo source-of-truth：参考 dotagents
skills ecosystem：参考 vercel-labs/skills
multi-asset + pack：参考 agent-add
GUI/backup UX：参考 mTarsier
registry/indexer：参考 cgcone
security/team lifecycle：参考 Agentver
```

我会把你要做的东西定义为：

> **Agent resource graph manager with cross-agent materialization.**
>
> 不是“skills installer”，也不是“MCP installer”，而是把 skills、MCP、instructions、commands、subagents、hooks、plugins、packs、secrets 统一成一个 resource graph，再投影到不同 coding agent 的原生文件/配置系统里。

## 8. User

未来还需要 从全局 同步到 其他leve作用域下，比如user level, project level， 给一个kit的cli 命令的细化规范，综合参考其他几个开源项目的最佳组织规范

## 9. Assistant

我会把它整理成可落地的 CLI 规范：先定义 scope 与同步语义，再细化命令族、状态文件、冲突/安全策略和典型工作流。

## 10. Assistant

我也会把参考重点落到现有工具的可复用模式上：声明式同步、底层 adapter、多资源 pack、registry/doctor，以及 XDG 式多作用域目录分离。

## 11. Assistant

可以。我的建议是把你的 `agent-kit` CLI 做成 **“scope-first + resource-graph + materializer”**，而不是单纯做 `skill add` 或 `mcp add`。核心抽象应该是：

```
全局资源库 / profile
        ↓ sync / inherit / pin / fork
user scope
        ↓ sync / inherit / pin / fork
workspace / project / package scope
        ↓ apply / materialize
不同 coding agent 的原生目录与配置文件
```

也就是说，`global → user → project` 是 **声明层同步**，而 `.claude/skills`、`.cursor/mcp.json`、`.codex/config.toml` 是 **物化层输出**。

---

## 1. 先定设计原则

现有项目可以抽象成几类最佳实践：

`dotagents` 的强项是 **repo-level source of truth**：`agents.toml` 提交到项目，`.agents/skills/` 作为 canonical skills 目录，再 symlink 到 `.claude/skills/`、`.cursor/skills/` 等 agent 期望的位置；它也有 `install`、`sync`、`doctor`、`trust`，并支持 `--user` 作用域。这个模式适合作为你的声明式配置与同步语义参考。[GitHub](https://github.com/getsentry/dotagents)

`agent-install` 的强项是 **adapter SDK**：它把 `skill`、`mcp`、`agents-md` 做成三个 namespace，CLI verb 和 Node API verb 对齐，并负责把 MCP 写入不同 agent 的原生 JSON、JSONC、YAML、TOML 配置；它还支持大量 skill source 格式和 40+ coding agents。你的底层 adapter/materializer 层很适合参考它。[GitHub](https://github.com/millionco/agent-install)

`vercel-labs/skills` 的强项是 **skills package manager UX**：`add/list/find/remove/update/init` 命令很直观，支持 project/global scope、按 agent 选择安装、symlink 或 copy；它的命令组织可以作为 skills 子命令的 UX 参考。[GitHub](https://github.com/vercel-labs/skills)

`agent-add` 的强项是 **多资源一次性安装 + pack manifest + host overlay**：它不仅支持 MCP 和 skill，还支持 prompt、command、sub-agent、pack；并且能用 `agent-add/<host>/<key>` 这种 frontmatter overlay 给不同 host 生成不同配置。你的 pack、subagent、command、host-specific override 可以直接借鉴这个模式。[GitHub+2GitHub+2](https://github.com/pea3nut/agent-add)

路径组织上应该遵循 XDG 思路：config、data、state、cache 分开；`$XDG_CONFIG_HOME` 默认 `~/.config`，`$XDG_DATA_HOME` 默认 `~/.local/share`，`$XDG_STATE_HOME` 默认 `~/.local/state`，`$XDG_CACHE_HOME` 默认 `~/.cache`；XDG 也明确了多目录读取时“更重要的目录优先”的 precedence 语义，这正好能映射到 scope 层级。[Freedesktop Specifications](https://specifications.freedesktop.org/basedir-spec/0.8/)

---

## 2. Scope 模型：建议至少 5 层

我建议不要只做 `global/user/project` 三层，而是预留完整层级：

```
builtin    内置默认，只读
global     全局资源库 / profile library，可来自本机或远端 git
user       当前用户激活配置，跨所有项目生效
workspace  repo / monorepo 级团队配置
project    单项目或 package 级配置
session    临时会话覆盖，可选
```

优先级：

```
builtin < global < user < workspace < project < session
```

越靠右越具体，越具体的 scope 覆盖越通用的 scope。这个 precedence 规则和 XDG 的“更重要目录优先”思想一致。[Freedesktop Specifications](https://specifications.freedesktop.org/basedir-spec/0.8/)

### 每层的职责

| Scope | 目的 | 是否默认物化到 agent | 是否建议提交 Git |
| --- | --- | --- | --- |
| `builtin` | 内置模板、官方 adapter 定义 | 否 | 否 |
| `global` | 资源库、profile、组织基线、个人长期库 | 否，默认只是 library | 可选，通常是独立 dotfiles repo |
| `user` | 当前机器/用户实际启用的默认能力 | 是，物化到 `~/.claude`、`~/.codex` 等 | 否，除非 dotfiles |
| `workspace` | repo 级团队约定 | 是，物化到项目内 `.claude`、`.cursor` 等 | 是 |
| `project` | monorepo 子项目、package、service 特化 | 是 | 是 |
| `session` | 临时调试、实验、一次性工具 | 可选 | 否 |

关键点：**global 不等于 user**。

`global` 是“资源库 / profile source”，`user` 是“当前用户激活态”。这样你才能支持：

```
agentkit scope sync
--from
 global
--to
 user
agentkit scope sync
--from
 global
--to
 project
agentkit scope promote
--from
 project
--to
 global
```

---

## 3. 文件布局规范

### User / global 路径

遵循 XDG：

```
$XDG_CONFIG_HOME/agent-kit/
  agentkit.toml
  profiles/
    default.toml
    frontend.toml
    backend.toml
$XDG_DATA_HOME/agent-kit/
  store/
    skills/
    commands/
    subagents/
    packs/
  global/
    agentkit.toml
    packs/
$XDG_STATE_HOME/agent-kit/
  agentkit.lock.json
  state.json
  backups/
  materialized.json
  audit.log
$XDG_CACHE_HOME/agent-kit/
  git/
  registry/
  downloads/
```

默认 fallback：

```
~/.config/agent-kit/
~/.local/share/agent-kit/
~/.local/state/agent-kit/
~/.cache/agent-kit/
```

### Project 路径

建议项目根目录这样组织：

```
repo/
  agentkit.toml              # committed: 声明式 intent
  agentkit.lock.json         # committed: reproducible resolution
  .agents/                   # optional committed: vendor-neutral human-owned resources
    skills/
    commands/
    subagents/
    instructions/
    mcp.json
  .agent-kit/                # gitignored: tool-managed store/state/cache
    store/
    state.json
    backups/
    materialized.json
  .claude/                   # generated or partially generated
  .cursor/
  .codex/
```

推荐 `.gitignore`：

```
.agent-kit/
.claude/skills/
.cursor/skills/
.codex/skills/
```

但如果某些 agent 要求 repo 内配置文件必须存在，例如 `.cursor/mcp.json`、`.codex/config.toml`，可以让 CLI 生成并提交，或者使用 `--materialize generated --commit-artifacts` 标记。

---

## 4. CLI 总体命令形态

建议主命令叫：

```
agentkit
```

提供短别名：

```
ak
```

通用语法：

```
agentkit [global-options] <command> [subcommand] [args]
```

全局 options：

```
--scope
 <builtin|global|user|workspace|project|session>
--from
 <scope>
--to
 <scope>
--agent
 <agent...>
--kind
 <kind...>
--profile
 <name>
--root
 <path>
--config
 <path>
--store
 <path>
--mode
 <inherit|pin|copy|fork|mirror>
--conflict
 <fail|ask|skip|parent-wins|child-wins|merge>
--dry-run
--plan
--apply
--json
--yes
--offline
--force
--verbose
```

### 命令族总览

```
agentkit init
agentkit scope ...
agentkit profile ...
agentkit agent ...
agentkit add / remove / list / info / edit
agentkit skill ...
agentkit mcp ...
agentkit instruction ...
agentkit command ...
agentkit subagent ...
agentkit hook ...
agentkit pack ...
agentkit sync
agentkit plan
agentkit apply
agentkit update
agentkit lock
agentkit adopt
agentkit diff
agentkit doctor
agentkit audit
agentkit backup / restore
agentkit registry ...
agentkit publish
```

---

## 5. Scope 命令规范

这是你的 CLI 最核心的部分。

### `agentkit scope init`

初始化某个 scope。

```
agentkit scope init
--scope
 global
agentkit scope init
--scope
 user
--agents
 claude-code,codex,cursor
agentkit scope init
--scope
 project
--agents
 claude-code,cursor,codex
agentkit scope init
--scope
 workspace
--root
 .
```

效果：

```
global:
  创建 XDG data/config 下的 global resource library
user:
  创建 user manifest
  检测本机 agents
  准备用户级 materialization target
project:
  创建 agentkit.toml
  创建 .agents/
  创建 .agent-kit/
  可选生成 .gitignore
```

### `agentkit scope list`

列出可见 scope 与继承链。

```
agentkit scope list
agentkit scope list
--json
```

示例输出：

```
builtin     active  internal
global      active  ~/.local/share/agent-kit/global
user        active  ~/.config/agent-kit/agentkit.toml
workspace   active  ./agentkit.toml
project     active  ./apps/web/agentkit.toml
effective order:
builtin < global < user < workspace < project
```

### `agentkit scope inspect`

查看某层配置、父级、资源、物化路径。

```
agentkit scope inspect
--scope
 user
agentkit scope inspect
--scope
 project
--kind
 skill
agentkit scope inspect
--scope
 project
--agent
 codex
```

### `agentkit scope diff`

比较两个 scope 的声明层差异。

```
agentkit scope
diff

--from
 global
--to
 user
agentkit scope
diff

--from
 user
--to
 project
agentkit scope
diff

--from
 global
--to
 project
--kind
 skill,mcp
```

输出应该分四类：

```
ADDED       parent has, child missing
CHANGED     same id, different version/config
SHADOWED    child overrides parent
REMOVED     child has exclusion or parent deleted
```

### `agentkit scope sync`

跨 scope 同步声明。它不应该直接等同于写 `.claude` 或 `.cursor`；写 agent 原生配置交给 `apply`。

```
agentkit scope sync
--from
 global
--to
 user
agentkit scope sync
--from
 global
--to
 project
agentkit scope sync
--from
 user
--to
 project
agentkit scope sync
--from
 global
--to
 project pack:frontend
--mode
 inherit
agentkit scope sync
--from
 global
--to
 project skill:web-design
--mode
 pin
agentkit scope sync
--from
 global
--to
 project
--mode
 mirror
--prune
agentkit scope sync
--from
 project
--to
 global skill:repo-conventions
--mode
 fork
```

#### `--mode` 语义

| Mode | 语义 | 适合场景 |
| --- | --- | --- |
| `inherit` | child 只引用 parent 资源，不复制 source；parent 更新后 child 可跟随 | user/project 继承 global baseline |
| `pin` | child 写入 resolved version/digest；之后不自动跟随 parent | team repo 需要 reproducible |
| `copy` | 把资源复制到 child store，但保留 origin metadata | 本机离线或 agent 不支持 symlink |
| `fork` | 复制到 child `.agents/`，child 获得编辑所有权 | 项目要定制 global skill |
| `mirror` | child 精确镜像 parent 选择集，可配合 `--prune` | 组织强管控基线 |

#### `--conflict` 语义

```
--conflict
 fail
# 默认，CI 友好
--conflict
 ask
# 交互式
--conflict
 skip
# 保留 child，不改
--conflict
 parent-wins
# parent 覆盖 child
--conflict
 child-wins
# child 保留，并写 shadow
--conflict
 merge
# 仅对可 merge 资源启用，如 mcp/env/instruction section
```

### `agentkit scope promote`

把更低层资源提升到更高层。

```
agentkit scope promote skill:repo-conventions
--from
 project
--to
 global
agentkit scope promote pack:frontend
--from
 user
--to
 global
--publishable
agentkit scope promote mcp:context7
--from
 project
--to
 user
```

规则：

```
project → global: 默认 fork，避免把项目私密路径泄露到 global
project → user: 默认 pin
user → global: 默认 copy metadata + origin
```

### `agentkit scope explain`

解释某资源为什么最终生效。

```
agentkit scope explain skill:web-design
--scope
 project
agentkit scope explain mcp:github
--scope
 user
--agent
 cursor
```

示例：

```
skill:web-design
  builtin: not present
  global:  v1.3.0 inherited from profile frontend
  user:    excluded
  project: v1.2.1 pinned
  result:  project wins, pinned v1.2.1
```

这个命令非常重要，因为多 scope 系统最大的 UX 问题就是“我不知道为什么这个 skill/MCP 出现了”。

---

## 6. Resource 命令规范

资源类型建议统一成：

```
skill
mcp
instruction
command
subagent
hook
plugin
pack
secret
profile
```

`agent-add` 已经证明 MCP、skill、prompt、command、sub-agent、pack 这些资源可以放进一个统一安装接口；但你的 CLI 应该更进一步，把它们抽象为 resource graph，而不是一次性 asset flags。[GitHub+1](https://github.com/pea3nut/agent-add)

### Generic resource commands

```
agentkit add <kind> <source> [options]
agentkit remove <kind>:<id>
agentkit list [selectors...]
agentkit info <kind>:<id>
agentkit edit <kind>:<id>
agentkit enable <kind>:<id>
agentkit disable <kind>:<id>
```

示例：

```
agentkit add skill github:vercel-labs/agent-skills
#skills/web-design-guidelines --scope global
agentkit add mcp context7
--url
 https://mcp.context7.com/mcp
--scope
 user
agentkit add instruction testing
--body

"Run pnpm test before opening PRs."

--scope
 project
agentkit add command security-scan github:wshobson/commands
#tools/security-scan.md
agentkit add subagent backend github:VoltAgent/awesome-claude-code-subagents
#categories/01-core-development/backend-developer.md
```

### Surface aliases

为了 UX，可以保留 namespace 风格，类似 `agent-install` 的 `skill`、`mcp`、`agents-md` surfaces。`agent-install` 明确把 Node API 和 CLI verb 对齐，这种设计利于未来你提供 SDK。[GitHub](https://github.com/millionco/agent-install)

```
agentkit skill add <source>
agentkit skill init <name>
agentkit skill list
agentkit skill remove <name>
agentkit skill validate <path>
agentkit mcp add <name>
--url
 <url>
agentkit mcp add <name>
--command
 npx
--args

"-y,@modelcontextprotocol/server-postgres"
agentkit mcp list
agentkit mcp test <name>
agentkit mcp remove <name>
agentkit instruction init
agentkit instruction set-section
"Testing"

--body

"Run pnpm test"
agentkit instruction remove-section
"Testing"
agentkit instruction render
--agent
 claude-code
```

---

## 7. Source reference 规范

支持这些 source：

```
github:owner/repo[@ref][#path]
gitlab:owner/repo[@ref][#path]
git:https://git.example.com/org/repo.git[@ref][#path]
ssh:git@github.com:owner/repo.git[@ref][#path]
path:./local/path
url:https://example.com/resource.md
npm:@scope/package[@version]
well-known:https://docs.example.com
inline:<content>
```

示例：

```
agentkit skill add github:vercel-labs/agent-skills
#skills/web-design-guidelines
agentkit skill add github:acme/agent-resources@v1.2.0
#skills/review
agentkit mcp add postgres
--npm
 @modelcontextprotocol/server-postgres
--env
 DATABASE_URL
agentkit command add url:https://example.com/commands/security-scan.md
```

`agent-install` 已经支持本地路径、GitHub/GitLab shorthand、SSH、任意 git remote、direct `SKILL.md` URL、well-known endpoint，以及 MCP 的 HTTP/SSE、npm package、raw command；这说明 source resolver 应该独立成核心模块，不要绑定某个 resource kind。[GitHub](https://github.com/millionco/agent-install)

---

## 8. Agent 命令规范

### `agentkit agent detect`

检测本机或项目中有哪些 agent。

```
agentkit agent detect
agentkit agent detect
--scope
 user
agentkit agent detect
--scope
 project
agentkit agent detect
--json
```

输出：

```
claude-code   found   ~/.claude
cursor        found   ~/.cursor
codex         found   ~/.codex/config.toml
opencode      missing
gemini-cli    found   ~/.gemini/settings.json
```

mTarsier 的一个强 UX 是自动检测本机 AI clients、统一编辑配置、安装前 validation、自动 backup/rollback；你的 CLI 也应该把 `detect`、`doctor`、`backup` 作为一等能力，而不是隐藏在安装过程中。[mTarsier](https://mtarsier.com/?utm_source=chatgpt.com)

### `agentkit agent enable / disable`

```
agentkit agent enable claude-code
--scope
 user
agentkit agent enable cursor codex
--scope
 project
agentkit agent disable opencode
--scope
 project
```

### `agentkit agent paths`

展示 materializer 会写哪里。

```
agentkit agent paths
--agent
 codex
--scope
 user
agentkit agent paths
--agent
 cursor
--scope
 project
```

示例：

```
codex:
  user config:     ~/.codex/config.toml
  user skills:     ~/.codex/skills
  project config:  .codex/config.toml
  project skills:  .codex/skills
```

---

## 9. Sync / Plan / Apply：三件事要分开

这是整个 CLI 最容易设计错的地方。

### 1）`scope sync`：scope 到 scope

它修改 manifest / lock，不直接写 agent 原生目录。

```
agentkit scope sync
--from
 global
--to
 project pack:frontend
--mode
 pin
```

### 2）`plan`：计算 effective graph → materialization diff

```
agentkit plan
--scope
 project
agentkit plan
--scope
 user
--agent
 claude-code,codex
agentkit plan
--scope
 project
--json
```

输出：

```
CREATE symlink .claude/skills/web-design -> .agent-kit/store/skills/web-design@sha256...
PATCH  .cursor/mcp.json add mcpServers.context7
PATCH  .codex/config.toml add [mcp_servers.context7]
UPSERT AGENTS.md section "Testing"
```

### 3）`apply`：真正物化

```
agentkit apply
--scope
 project
agentkit apply
--scope
 user
agentkit apply
--scope
 project
--agent
 cursor,codex
agentkit apply
--scope
 project
--backup

--verify
```

### 顶层 `sync` 可以作为组合命令

为了日常使用，保留：

```
agentkit sync
```

等价于：

```
resolve parent scopes
→ update inherited refs if allowed
→ plan
→ apply
→ verify
```

但复杂场景必须允许拆开：

```
agentkit scope sync
--from
 global
--to
 project
--mode
 pin
--dry-run
agentkit plan
--scope
 project
agentkit apply
--scope
 project
```

---

## 10. Materialization 规范

### Skill

默认：

```
canonical:
  .agent-kit/store/skills/<id>@<digest>/
project view:
  .agents/skills/<id> -> .agent-kit/store/skills/<id>@<digest>/
agent view:
  .claude/skills/<id> -> ../../.agents/skills/<id>
  .cursor/skills/<id> -> ../../.agents/skills/<id>
  .codex/skills/<id>  -> ../../.agents/skills/<id>
```

默认 materialization mode：

```
symlink > hardlink > copy
```

命令：

```
agentkit apply
--materialize
 symlink
agentkit apply
--materialize
 copy
agentkit apply
--materialize
 auto
```

`dotagents` 和 `skills` 都采用“canonical copy + symlink 到 agent 目录”的思路；这是你统一管理 skills 的最佳默认策略。[GitHub+1](https://github.com/getsentry/dotagents)

### MCP

统一 IR：

```
type

McpServer

=
 {
  id:
string
;
  transport:
"stdio"

|

"http"

|

"sse"
;
  command?:
string
;
  args?:
string
[];
  url?:
string
;
  env?:
Record
<
string
,
SecretRef

|

string
>;
  targets:
string
[];
}
```

物化到不同 agent：

```
Claude Code:   .mcp.json 或 ~/.claude 相关配置
Cursor:        .cursor/mcp.json
Codex:         .codex/config.toml
VS Code:       .vscode/mcp.json
OpenCode:      opencode.json
```

`agent-install` 已经把 MCP 写入不同 agent 的 JSON、JSONC、YAML、TOML 原生配置，并且说明 JSONC 写入会保留 comments；这说明你的 materializer 应该是 format-aware patcher，而不是简单覆盖文件。[GitHub](https://github.com/millionco/agent-install)

### Instruction / AGENTS.md

支持三种策略：

```
section-upsert      在 AGENTS.md / CLAUDE.md 中按 section 管理
standalone-file     写入 .cursor/rules/<name>.md 等
symlink             CLAUDE.md -> AGENTS.md
```

命令：

```
agentkit instruction set-section
"Testing"

--body

"Run pnpm test"
agentkit instruction render
--agent
 claude-code
agentkit instruction render
--agent
 cursor
```

`agent-add` 的 prompt 写入策略值得借鉴：对于 append mode，用 HTML comment markers 包裹内容以保证幂等；对于 standalone mode，则写入 host-specific rules directory。[GitHub](https://github.com/pea3nut/agent-add)

### Command / Subagent

支持 host overlay：

```
---
id: playwright-tester
name: Playwright Tester
description: Generate and debug Playwright tests.
agentkit/cursor/model: fast
agentkit/claude-code/model: haiku
agentkit/codex/effort: high
---
```

安装到 Cursor 时：

```
---
id: playwright-tester
name: Playwright Tester
description: Generate and debug Playwright tests.
model: fast
---
```

安装到 Claude Code 时：

```
---
id: playwright-tester
name: Playwright Tester
description: Generate and debug Playwright tests.
model: haiku
---
```

这个设计对应 `agent-add` 的 host-specific frontmatter：匹配 host 的 prefixed fields 被提升到顶层，其他 prefixed fields 被移除。[GitHub](https://github.com/pea3nut/agent-add)

---

## 11. Pack / Profile 命令规范

### Pack 是资源 bundle

```
agentkit pack init frontend
agentkit pack add frontend skill:web-design
agentkit pack add frontend mcp:context7
agentkit pack add frontend command:security-scan
agentkit pack install frontend
--scope
 project
agentkit pack
export
 frontend
--out
 frontend.agentpack.json
```

Pack manifest：

```
{
  "name":
"acme/frontend"
,
  "version":
"1.0.0"
,
  "assets": [
    { "type":
"skill"
, "id":
"web-design"
, "source":
"github:vercel-labs/agent-skills#skills/web-design-guidelines"
 },
    { "type":
"mcp"
, "id":
"context7"
, "url":
"https://mcp.context7.com/mcp"
 },
    { "type":
"command"
, "id":
"security-scan"
, "source":
"github:wshobson/commands#tools/security-scan.md"
 }
  ]
}
```

`agent-add` 的 pack manifest 已经把 MCP、skill、prompt、command、subAgent 组合进一个 JSON bundle，你可以扩展为 versioned、lockable、policy-aware pack。[GitHub](https://github.com/pea3nut/agent-add)

### Profile 是 scope preset

Profile 用来从 global 同步到 user/project：

```
agentkit profile create frontend
agentkit profile add frontend pack:acme/frontend
agentkit profile add frontend skill:web-design
agentkit profile add frontend mcp:context7
agentkit profile use frontend
--scope
 user
agentkit profile sync frontend
--to
 project
--mode
 pin
```

Profile manifest：

```
[profile]
id = "frontend"
name = "Frontend Agent Baseline"
exports = [
  "pack:acme/frontend",
  "skill:web-design",
  "mcp:context7"
]
default_targets = ["claude-code", "cursor", "codex"]
```

---

## 12. Manifest 草案

### `agentkit.toml`

```
version = 1
[scope]
id = "repo"
level = "project"
parents = [
  { scope = "user", mode = "inherit" },
  { scope = "global", profile = "frontend", mode = "pin" }
]
[agents]
enabled = ["claude-code", "cursor", "codex"]
materialize = "symlink"
[policy]
require_pinned_refs = true
require_lockfile = true
allow_untrusted_sources = false
block_high_risk = true
on_conflict = "fail"
[trust]
github_orgs = ["acme", "vercel-labs"]
git_domains = ["git.corp.example.com"]
[[skills]]
id = "web-design"
source = "github:vercel-labs/agent-skills#skills/web-design-guidelines"
ref = "main"
targets = ["*"]
scope_mode = "pin"
[[skills]]
id = "repo-conventions"
source = "path:.agents/skills/repo-conventions"
targets = ["claude-code", "cursor", "codex"]
[[mcp]]
id = "context7"
transport = "http"
url = "https://mcp.context7.com/mcp"
targets = ["cursor", "codex", "claude-code"]
[[mcp]]
id = "postgres"
transport = "stdio"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-postgres"]
env = ["DATABASE_URL"]
targets = ["claude-code", "cursor"]
[[instructions]]
id = "testing"
placement = "section"
heading = "Testing"
body = "Run pnpm test before opening a PR."
targets = ["universal", "claude-code", "cursor", "codex"]
[[commands]]
id = "security-scan"
source = "github:wshobson/commands#tools/security-scan.md"
targets = ["claude-code", "cursor"]
[[subagents]]
id = "backend"
source = "github:VoltAgent/awesome-claude-code-subagents#categories/01-core-development/backend-developer.md"
targets = ["claude-code", "cursor", "codex"]
[[packs]]
id = "frontend"
resources = [
  "skill:web-design",
  "mcp:context7",
  "instruction:testing",
  "command:security-scan"
]
```

### `agentkit.lock.json`

```
{
  "version":
1
,
  "scope":
"project"
,
  "resources": {
    "skill:web-design": {
      "source":
"github:vercel-labs/agent-skills#skills/web-design-guidelines"
,
      "resolvedRef":
"abc123"
,
      "digest":
"sha256:..."
,
      "originScope":
"global"
,
      "scopeMode":
"pin"
,
      "targets": [
"claude-code"
,
"cursor"
,
"codex"
],
      "materialized": {
        "claude-code":
".claude/skills/web-design"
,
        "cursor":
".cursor/skills/web-design"
,
        "codex":
".codex/skills/web-design"
      }
    }
  }
}
```

### `state.json`

不要提交：

```
{
  "lastApply":
"2026-05-02T00:00:00Z"
,
  "backups": [
    {
      "id":
"20260502-001"
,
      "paths": [
".cursor/mcp.json"
,
".codex/config.toml"
]
    }
  ],
  "detectedAgents": {
    "cursor": { "found":
true
, "path":
".cursor"
 },
    "codex": { "found":
true
, "path":
".codex"
 }
  }
}
```

---

## 13. 关键日常流程

### A. 建立全局资源库

```
agentkit scope init
--scope
 global
agentkit add skill github:vercel-labs/agent-skills
#skills/web-design-guidelines \

--scope
 global \

--id
 web-design
agentkit add mcp context7 \

--scope
 global \

--url
 https://mcp.context7.com/mcp
agentkit pack init frontend
--scope
 global
agentkit pack add frontend skill:web-design
--scope
 global
agentkit pack add frontend mcp:context7
--scope
 global
```

### B. 从 global 同步到 user

```
agentkit scope init
--scope
 user
--agents
 claude-code,cursor,codex
agentkit scope sync \

--from
 global \

--to
 user \
  pack:frontend \

--mode
 inherit
agentkit plan
--scope
 user
agentkit apply
--scope
 user
```

结果：

```
global 仍然是资源库
user 获得 frontend pack 的继承引用
CLI 把 user effective graph 物化到 ~/.claude、~/.cursor、~/.codex
```

### C. 从 global 同步到 project，并 pin 版本

```
cd
 repo
agentkit scope init
--scope
 project
--agents
 claude-code,cursor,codex
agentkit scope sync \

--from
 global \

--to
 project \
  pack:frontend \

--mode
 pin
agentkit apply
--scope
 project
```

结果：

```
repo/agentkit.toml      写入 pack/resources
repo/agentkit.lock.json 写入 digest/ref
repo/.agents/skills     canonical project view
repo/.claude/.cursor    generated agent views
```

### D. 项目 fork 一个 global skill

```
agentkit scope sync \

--from
 global \

--to
 project \
  skill:web-design \

--mode
 fork
```

结果：

```
.agents/skills/web-design/SKILL.md
```

项目可以直接编辑，且不再自动跟随 global。

### E. 项目覆盖 user/global 中的 MCP

```
agentkit mcp add context7 \

--scope
 project \

--url
 https://mcp.context7.com/mcp \

--targets
 cursor,codex \

--shadow
```

然后解释：

```
agentkit scope explain mcp:context7
--scope
 project
```

### F. 从 project 推回 global

```
agentkit scope promote skill:repo-conventions \

--from
 project \

--to
 global \

--mode
 fork
agentkit profile add frontend skill:repo-conventions
--scope
 global
```

### G. 接管现有 agent 配置

```
agentkit adopt
--scope
 user
--agent
 claude-code
--kind
 skill,mcp,instruction
agentkit adopt
--scope
 project
--agent
 cursor
--kind
 mcp
```

`adopt` 应该做三件事：

```
1. 扫描原生 agent 配置
2. 转成 agent-kit resource IR
3. 让用户选择 import / ignore / leave-external
```

---

## 14. Doctor / Audit / Backup 规范

### `agentkit doctor`

```
agentkit doctor
agentkit doctor
--scope
 project
agentkit doctor
--scope
 user
--fix
```

检查：

```
- manifest 是否可解析
- lockfile 是否过期
- symlink 是否断裂
- agent 原生配置是否语法正确
- MCP command 是否存在
- env/secret 是否缺失
- generated section marker 是否损坏
- source digest 是否匹配
- unsupported target 是否被声明
```

`dotagents` 已经把 `doctor`、`trust`、`sync` 放进命令集；这个组织方式适合你的 CLI，因为跨 agent 配置很容易出现 broken symlink、stale generated configs、MCP 格式错误。[GitHub](https://github.com/getsentry/dotagents)

### `agentkit audit`

```
agentkit audit
--scope
 project
agentkit audit
--scope
 global
--kind
 skill
agentkit audit
--scope
 project
--fail-on
 high
```

检查：

```
- skill 中危险脚本
- 远程 curl | sh
- prompt injection pattern
- secret 泄露
- unpinned git ref
- suspicious URL
- MCP command 权限风险
```

### `agentkit backup / restore`

```
agentkit backup create
--scope
 user
agentkit backup list
agentkit backup restore <backup-id>
```

每次 `apply` 默认先 backup：

```
.agent-kit/backups/<timestamp>/
~/.local/state/agent-kit/backups/<timestamp>/
```

---

## 15. Registry 命令规范

后续如果做完整 agent-kit，registry 很重要。

```
agentkit registry add official https://registry.agentkit.dev
agentkit registry add internal https://agentkit.corp.dev
agentkit registry list
agentkit search react
agentkit search mcp:github
agentkit info skill:web-design
agentkit publish skill:repo-conventions
--registry
 internal
agentkit publish pack:frontend
--registry
 internal
```

可以加质量分：

```
agentkit validate skill ./my-skill
agentkit score skill ./my-skill
```

近期的 Skilldex 论文也把 package manager、registry、三层 hierarchical scope、格式 conformance scoring、skillset bundle、MCP server 作为组合方向；这说明“scope + registry + validation + bundle”会成为 agent skill tooling 的重要形态。[arXiv](https://arxiv.org/abs/2604.16911?utm_source=chatgpt.com)

---

## 16. 推荐的 CLI 命令完整清单

```
agentkit init
  --scope <global|user|workspace|project>
  --agents <agents...>
  --template <name>
  --yes
agentkit scope
  init
  list
  current
  inspect
  path
  diff
  sync
  promote
  fork
  exclude
  explain
agentkit profile
  create
  list
  add
  remove
  use
  sync
  export
  import
agentkit agent
  detect
  list
  enable
  disable
  paths
  capabilities
  doctor
agentkit add
  <kind> <source>
agentkit remove
  <kind>:<id>
agentkit list
  [--scope]
  [--kind]
  [--agent]
  [--effective]
agentkit info
  <kind>:<id>
agentkit skill
  add
  init
  list
  remove
  update
  validate
  score
agentkit mcp
  add
  list
  remove
  test
  enable
  disable
  env
  render
agentkit instruction
  init
  set-section
  remove-section
  read
  render
  link
agentkit command
  add
  list
  remove
  render
agentkit subagent
  add
  list
  remove
  render
agentkit hook
  add
  list
  remove
  test
agentkit pack
  init
  add
  remove
  list
  install
  build
  export
  import
  publish
agentkit plan
  --scope
  --agent
  --json
agentkit apply
  --scope
  --agent
  --backup
  --verify
agentkit sync
  --from
  --to
  --mode
  --apply
agentkit update
  [selectors...]
  --scope
  --recursive
  --lock
agentkit lock
  verify
  refresh
  explain
  prune
agentkit adopt
  --agent
  --scope
  --kind
agentkit diff
  --scope
  --effective
  --materialized
agentkit doctor
  --fix
agentkit audit
  --fail-on <low|medium|high|critical>
agentkit backup
  create
  list
  restore
agentkit registry
  add
  remove
  list
  search
  info
  login
  logout
agentkit publish
  <kind>:<id>
```

---

## 17. Exit codes / CI 规范

建议一开始就定义：

```
0   success
1   general error
2   validation failed
3   diff exists / plan has changes
4   conflict
5   policy violation
6   unsupported agent
7   network/source resolution error
8   lockfile mismatch
9   materialization failed
10  secret/env missing
```

CI 用法：

```
agentkit lock verify
agentkit audit
--fail-on
 high
agentkit plan
--scope
 project
--json
agentkit doctor
--scope
 project
```

---

## 18. MVP 优先级

### MVP 1：scope + skill + mcp + instruction

```
scope init/list/diff/sync/explain
agent detect/paths
skill add/list/remove
mcp add/list/remove/render
instruction set-section/render
plan/apply/doctor
manifest + lockfile
symlink/copy materialization
Claude Code / Cursor / Codex / OpenCode
```

### MVP 2：pack + command + subagent + host overlay

```
pack init/add/install/export
command add/render
subagent add/render
agentkit/<host>/<key> frontmatter overlay
adopt existing configs
backup/restore
```

### MVP 3：registry + audit + policy

```
registry search/info/publish
trust allowlist
security audit
digest verification
secret binding
profile sync
```

### MVP 4：团队/平台层

```
remote global profiles
internal registry
RBAC / approvals
signed packs
fleet sync
MCP server mode for agent self-management
```

---

## 19. 我会采用的最终命令设计核心

最重要的是这组：

```
agentkit scope sync
--from
 global
--to
 user pack:frontend
--mode
 inherit
agentkit scope sync
--from
 global
--to
 project pack:frontend
--mode
 pin
agentkit scope explain skill:web-design
--scope
 project
agentkit plan
--scope
 project
agentkit apply
--scope
 project
agentkit doctor
--fix
```

这组命令表达了你的产品差异化：

```
不是只安装 skill
不是只安装 MCP
不是只写某个 agent 的配置
而是：
跨 scope 管理资源声明
跨 agent 物化原生配置
跨项目复用全局 profile
保留 reproducible lock
支持 inherit / pin / fork / mirror
```

一句话定义：

> `agent-kit` 应该是一个 **hierarchical agent resource manager**：把 global/user/project 等作用域中的 skills、MCP、instructions、commands、subagents、hooks、packs 统一成 resource graph，再按不同 coding agent 的能力矩阵物化成原生配置。
