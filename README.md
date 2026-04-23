# Nib

> 笔尖落处，代码成形。
> A learning-first Claude Code clone — built to understand, not to compete.

## What

Nib 是一个本地优先、终端形态的 AI 编程助手。它的存在目的是**通过亲手造一遍来理解 AI 编程工程的全链路**：Agent loop、tool calling、上下文工程、diff/patch、harness、observability。

名字 "Nib"（笔尖）— 一个最小、最锋利的写作工具。命令行体验：`nib "fix this bug"`。

## Why

> "What I cannot create, I do not understand." — Feynman

Claude Code / Cursor / Aider 已经足够好用。Nib 不打算超越它们，它只想让作者**理解每一行代码**。

## Status

✅ **Phase 1 MVP 完成 (2026-04-21)** — ReAct agent loop + 4 个核心工具 + Ink TUI 端到端打通。

| Phase | 内容 | 状态 | Tag |
|---|---|---|---|
| 0 | Bun monorepo 奠基 + CI 双平台 + 流式 hello world | ✅ | `v0.0.1-hello` |
| 1 | ReAct loop + read_file/write_file/bash/glob + Ink TUI + 步数/token/成本上限 | ✅ | `v0.1-mvp` |
| 1.5 | REPL 多轮对话 + Ctrl+O 详细工具卡 + 终端 markdown 渲染 | ✅ | (in main) |
| 2 | edit_file + 交互式 diff 审阅 | ⏳ | `v0.2-diff` |
| 3 | Context Engine（@file / git / tree-sitter / ripgrep） | ⏳ | `v0.3-context` |
| 4 | 自我修正循环 + 斜杠命令 + 自举 | ⏳ | `v0.4-autonomy` |
| 5 | Provider 抽象 + SQLite 会话持久化 | ⏳ | `v0.5-multimodel` |
| 6 | Harness（Hooks / Skills / Subagents / `.nib/`） | ⏳ | `v0.6-harness` |
| 7 | MCP client + JSONL trace + replay/eval | ⏳ | `v0.7-mcp` |

完整路线图见 [docs/ROADMAP.md](./docs/ROADMAP.md)。

## Quick Start

需要 [Bun](https://bun.sh) ≥ 1.3 + Anthropic API key。

```bash
# 1. 安装
git clone https://github.com/Wang-mis/nib.git
cd nib
bun install

# 2. 配置（任选其一）
export ANTHROPIC_API_KEY=sk-ant-...
# 或写入 .env（见 .env.example）
# 可选：自定义网关
export ANTHROPIC_BASE_URL=https://your-proxy/v1

# 3. 跑起来
bun run packages/cli/bin/nib                              # 进入 REPL
bun run packages/cli/bin/nib "在 README 末尾加一行 Hello"   # 跑一轮再进 REPL
```

首次运行会进入 Ink TUI：消息流（assistant 输出按 markdown 渲染）+ 工具调用 chip
（`Ctrl+O` 展开成带 input/output 的卡片）+ 底部实时统计（step / tokens / 成本）+
底部 `›` 输入框，回车提交下一轮。每次工具调用前都会请求审批（`--yes` 一键自动通过）。

## CLI

```bash
nib                             # 进入交互式 REPL（默认）
nib "<prompt>"                  # 先跑一轮，再进 REPL
nib --yes ...                   # 自动通过所有工具调用（DANGEROUS）
nib --max-steps N ...           # 覆盖步数上限（默认 10）
nib --models                    # 查看角色 → 模型映射
nib --version                   # 当前版本
nib --help                      # 完整帮助
```

### REPL 命令

| 命令 / 按键 | 作用 |
|---|---|
| `/exit` 或 `/quit` | 退出会话 |
| `/clear` | 清空当前会话历史与滚动屏 |
| `Ctrl+O` | 切换工具调用 chip ↔ 详细卡片 |
| `Ctrl+C` / `Ctrl+D` | 退出 |

REPL 会把每一轮的对话历史（assistant 文本块 + 工具调用 + 工具结果）通过
`runAgent({ messages, prompt })` 喂回模型，所以模型能看到此前的上下文。

### 5 个模型角色

启动时不需要选模型，由 caller / skill metadata 决定具体角色：

| 角色 | 默认模型 | 用途 | env 覆盖 |
|---|---|---|---|
| `main` | claude-sonnet-4-5 | 主任务 | `NIB_MODEL_MAIN` |
| `reasoning` | claude-opus-4-5 | 复杂推理 / extended thinking | `NIB_MODEL_REASONING` |
| `haiku` | claude-haiku-4-5 | 轻量 / 高频小任务 | `NIB_MODEL_HAIKU` |
| `sonnet` | claude-sonnet-4-5 | 显式选 sonnet | `NIB_MODEL_SONNET` |
| `opus` | claude-opus-4-5 | 显式选 opus | `NIB_MODEL_OPUS` |

未指定时回退到 `main`。`ANTHROPIC_BASE_URL` 可指向任意兼容代理 / 网关。

### 默认上限（每会话）

```
steps=10  tokens=100k  cost=$1.00  per-call timeout=120s
```

内置 Anthropic 定价表（haiku / sonnet / opus）+ 子串回退，实时累计成本。

## Architecture

```
nib/
├── packages/
│   ├── core/                # ✅ Agent + Tools (Phase 1)
│   │   ├── src/
│   │   │   ├── agent/       # ReAct loop, pricing, schema (Zod → JSON Schema)
│   │   │   │   ├── agent.ts        # runAgent() AsyncGenerator<AgentEvent>
│   │   │   │   ├── pricing.ts      # 内置定价表 + 子串回退
│   │   │   │   ├── schema.ts       # Zod → JSON Schema (strip $schema)
│   │   │   │   └── index.ts
│   │   │   ├── tools/       # ✅ read_file / write_file / bash / glob
│   │   │   │   ├── types.ts        # Tool<I,O> 接口 + ToolContext + 错误类
│   │   │   │   ├── registry.ts     # 不可变 ToolRegistry (from / withTool / dispatch)
│   │   │   │   ├── read_file.ts    # 行偏移 + 行数 + .env/credentials 拒读
│   │   │   │   ├── write_file.ts   # createDirs + isDangerous=true
│   │   │   │   ├── bash.ts         # Bun.spawn + 超时 + 危险模式检测
│   │   │   │   └── glob.ts         # Bun.Glob + 排序 + 截断上限
│   │   │   ├── context/     # ⏳ @file / git / tree-sitter / ripgrep (Phase 3)
│   │   │   ├── config.ts    # 5 角色模型解析 + ANTHROPIC_BASE_URL
│   │   │   └── index.ts
│   │   └── test/            # 75 单测（含安全策略 / 超时 / 审批 / 限额）
│   ├── cli/                 # ✅ Ink TUI + REPL
│   │   ├── src/
│   │   │   ├── components/  # App（REPL 循环 + chip/卡片切换 + markdown 渲染）+ Footer
│   │   │   ├── commands/    # ⏳ /plan /test /review /commit (Phase 4)
│   │   │   ├── types/       # marked-terminal ambient 声明
│   │   │   └── main.tsx     # parseArgs + render(<App>)
│   │   └── bin/nib          # 可执行入口
│   └── shared/              # 跨包类型 / utils
├── docs/
│   ├── PRD.md
│   ├── ROADMAP.md
│   └── ARCH.md
├── .nib/                    # ⏳ 项目级 harness (Phase 6)
├── CLAUDE.md                # Claude Code 工作指南（含 Hard Rules）
├── package.json             # workspaces: packages/*
├── tsconfig.json            # strict + noUncheckedIndexedAccess + verbatimModuleSyntax
└── README.md
```

### 关键设计

1. **Agent loop 是核心抽象**。`runAgent()` 返回 `AsyncGenerator<AgentEvent>`，事件流：
   `step_start` → `text` → `tool_call` → `tool_result` / `tool_error` / `tool_denied` → `usage` → `done`。
   `done` 事件携带累积的 `messages: readonly Message[]`，REPL 直接喂回下一轮。
   注入 `AgentClient` 接口与 SDK 解耦，便于测试。
2. **工具是能力的最小单元**。统一 `Tool<I,O>` 接口（name / description / Zod schema / execute / isDangerous）；
   不可变 `ToolRegistry` + 输入校验在 dispatch 层统一兜底。
3. **安全闸门**：危险命令（rm -rf / 强推 / curl|sh / 分叉炸弹 / mkfs / dd to /dev/）在 isDangerous 标记；
   `.env` / `*credentials*` 路径默认禁读；写文件默认 dangerous。
4. **硬上限**（PRD §6.3）：步数 / token / 成本 / 单次调用超时 — 永不发布无上限的 loop。

## Development

```bash
bun test                    # 75 单测
bun run --filter '*' build  # 全包构建
```

CI 矩阵：ubuntu-latest + windows-latest，每次 push 跑 lint + typecheck + test + build。

### Hard Rules

> **不需要考虑向后兼容，不要有历史遗留代码。** 重构时直接删除旧 API、旧 flag、旧 env 变量、旧文件、旧测试。
> 不写 deprecation shim，不留 legacy/v1/old 命名，不保留"以防万一"的兼容分支。
> 这是一个学习项目，源码即事实；当前实现是唯一实现。

## Docs

- [PRD](./docs/PRD.md) — 产品需求与定位
- [ROADMAP](./docs/ROADMAP.md) — 13 周 Sprint 计划
- [ARCH](./docs/ARCH.md) — 架构概览
- [CLAUDE.md](./CLAUDE.md) — Claude Code 协作指南

## License

MIT
