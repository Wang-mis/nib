# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hard Rules (project-wide)

- **不需要考虑向后兼容，不要有历史遗留代码。** 重构时直接删除旧 API、旧 flag、旧 env 变量、旧文件、旧测试。不写 deprecation shim，不留 legacy/v1/old 命名，不保留"以防万一"的兼容分支。这是一个学习项目，源码即事实；当前实现是唯一实现。

## Project Status

Nib is a **learning-first** project to clone Claude Code from scratch. As of this writing the repository is in **Phase 0 (foundation)** — there is **no code yet**, only design docs in `docs/` (`PRD.md`, `ROADMAP.md`, `ARCH.md`) and a `README.md`. Do not invent code commands; the build/test toolchain has not been initialized.

When code lands, it will be a Bun + TypeScript monorepo per `docs/ARCH.md`:

```
packages/
  core/    # Agent loop, Tool Registry, Context Engine, LLM Provider abstraction
  cli/     # Ink (React-for-CLI) TUI, bin/nib entrypoint
  shared/  # Shared types and utils
.nib/      # Project-level harness (rules / hooks / skills / agents) — bootstrapping target
```

Planned tooling (per PRD §4): Bun (runtime + test + sqlite), Ink (TUI), `@anthropic-ai/sdk`, `diff` + `diff-match-patch`, tree-sitter, ripgrep. Persistence in SQLite for sessions/traces. Config in `~/.nib/config.json` and project `.nib/`.

## Architectural Intent (read before adding code)

The product is intentionally a **Claude Code clone for learning**, not a competitor (PRD §0). Two things drive most design decisions:

1. **Agent loop is the core abstraction.** `Agent.run()` streams events. It calls `ContextEngine.gather()` to assemble context, `Provider.stream()` to invoke the LLM, and `ToolRegistry.execute()` in a loop until the model stops emitting tool calls. Hard caps on steps, tokens, cost, and timeout are mandatory (PRD §6.3) — never ship a loop without them.
2. **Tools are the unit of capability.** Every tool implements the `Tool<I, O>` interface in `ARCH.md` (name, description, JSON Schema, `execute`, optional `isDangerous`). The MVP set is fixed: `read_file`, `write_file`, `edit_file`, `bash`, `glob`, `grep`, `list_dir`, plus `apply_patch` later. `edit_file` (precise string replace with uniqueness check) is preferred over `write_file` to save tokens.

Provider abstraction is deferred to Phase 5 — until then code straight against Anthropic. Multi-provider adapters land later, so keep provider-specific tool-calling format isolated behind a single interface from the start.

## Roadmap-Driven Phases

`docs/ROADMAP.md` defines 8 phases ending at v1.0. Each Sprint must produce a runnable demo, a retrospective note, and a git tag. Current phase gating order:

- Phase 1 (MVP) — 4 tools + ReAct loop + Ink TUI → tag `v0.1-mvp`
- Phase 2 — `edit_file` + interactive diff review (accept/reject/edit/split-hunk) → `v0.2-diff`
- Phase 3 — Context Engine: `@file` refs, `.nibignore`, git status injection, tree-sitter, ripgrep → `v0.3-context`
- Phase 4 — Self-correction loop (run tests → parse errors → retry) + slash commands + bootstrapping → `v0.4-autonomy`
- Phase 5 — Provider abstraction + SQLite session resume → `v0.5-multimodel`
- Phase 6 — Harness (Hooks / Skills / Subagents / `.nib/`) → `v0.6-harness`
- Phase 7 — MCP client + JSONL trace + replay/eval → `v0.7-mcp`

Honor the **Not-Doing list** (PRD §10): no VSCode plugin, no Web UI, no team features, no auth/billing, no i18n, no mobile.

## Safety Rails (must implement when relevant code lands)

PRD §7 requires:
- Dangerous commands (`rm -rf`, `git push --force`, `curl | sh`) require user approval before execution.
- Writes default to dry-run; patch mode requires confirmation.
- `--sandbox` flag must disable all `bash` execution.
- `.env` and `*credentials*` paths default to read-denied.
- Tool-driven network access goes through a whitelist.

These are product requirements, not nice-to-haves — wire them in at the Tool Registry layer rather than per-tool.

## Working in This Repo Right Now

- The only meaningful edits today are to `docs/*.md` and `README.md`. Use `Edit`/`Write` directly; there is no formatter, linter, or test runner configured yet.
- When initializing the project (Phase 0 Day 2 in the roadmap), use `bun init` and create the `packages/{core,cli,shared}` layout from `ARCH.md` exactly — the docs are the source of truth.
- The repo's working files are under `C:\Users\v-shaoxwang\claude_workspace\nib`. There is a sibling `anvil/` directory (a previous naming iteration) outside this repo; do not modify it.
