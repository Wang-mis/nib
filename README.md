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

🚧 Phase 0 — 奠基中。Bun monorepo 已初始化，CLI stub 可跑：

```bash
bun install
bun run packages/cli/bin/nib
# → nib v0.0.1 — hello (Phase 0 stub)
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
