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

✅ **Phase 0 完成 (2026-04-20)** — 奠基已就位，下一步 Phase 1 (MVP：单轮工具调用)。

Bun monorepo 已初始化，CI 双平台绿（ubuntu + windows），CLI 端到端流式打通：

```bash
bun install
export ANTHROPIC_API_KEY=sk-ant-...
bun run packages/cli/bin/nib "用一句话解释 ReAct 循环"
# → 流式打印 Claude 回答

bun run packages/cli/bin/nib --models   # 查看角色 → 模型映射
bun run packages/cli/bin/nib --version  # nib v0.0.1
```

## 目录结构

```
nib/
├── packages/
│   ├── core/                # Agent + Tools + Context + Providers
│   │   ├── src/
│   │   │   ├── agent/       # Agent loop (ReAct)
│   │   │   ├── tools/       # read_file / write_file / edit_file / bash / glob / grep / list_dir
│   │   │   ├── context/     # @file refs, git, tree-sitter, ripgrep
│   │   │   ├── providers/   # LLM provider abstraction (Anthropic 优先)
│   │   │   └── index.ts
│   │   ├── test/
│   │   └── package.json
│   ├── cli/                 # Ink TUI
│   │   ├── src/
│   │   │   ├── components/  # 输入框、消息流、diff 渲染
│   │   │   ├── commands/    # /plan /test /review /commit /clear
│   │   │   └── main.tsx
│   │   ├── bin/nib          # 可执行入口
│   │   └── package.json
│   └── shared/              # 跨包类型 / utils
│       ├── src/index.ts
│       └── package.json
├── docs/
│   ├── PRD.md
│   ├── ROADMAP.md
│   └── ARCH.md
├── .nib/                    # 项目级 harness：rules / hooks / skills / agents（Phase 6）
├── .gitignore
├── CLAUDE.md
├── package.json             # workspaces: packages/*
├── tsconfig.json            # strict + bundler resolution
└── README.md
```

## Docs

- [PRD](./docs/PRD.md) — 产品需求与定位
- [ROADMAP](./docs/ROADMAP.md) — 13 周 Sprint 计划
- [ARCH](./docs/ARCH.md) — 架构概览

## License

MIT (TBD)
