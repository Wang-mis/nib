# Nib — 13 周路线图

> 学习为主的 Claude Code 复刻项目。每周 10–15 小时投入估算。
> 每个 Sprint 结束应有：可运行 demo + 复盘笔记 + git tag。

---

## Phase 0 — 奠基 (Week 0, 3–5 天) ✅ 完成 (2026-04-20)

| 任务 | 产出 | 状态 |
|---|---|---|
| 写 `PRD.md` + `ROADMAP.md` + `ARCH.md` + `CLAUDE.md` | 项目宪法 | ✅ |
| 选型确认 + monorepo 初始化 | `bun init` + `packages/{core,cli,shared}` | ✅ |
| CI 跑通（lint + test + build） | GitHub Actions 绿（ubuntu + windows 矩阵） | ✅ |
| Hello World：CLI 接收输入 → 调 Claude → 流式打印 | 端到端最小通路 | ✅ |

附加产出：
- 5 角色模型配置（`main` / `reasoning` / `haiku` / `sonnet` / `opus`），可通过 `NIB_MODEL_<ROLE>` env 覆盖
- 自定义 `ANTHROPIC_BASE_URL`（代理 / 网关）
- `--models` 内省命令；CLI 主表面保持极简（启动不选模型，由 caller / skill metadata 决定）
- 18 个单测，覆盖 config 解析与 CLI argv 解析

**Tag**: `v0.0.1-hello`

---

## Phase 1 — MVP：单轮工具调用 (Week 1–2)

**目标**：AI 能读文件、改文件、跑命令。

### Sprint 1：核心工具 ✅ (2026-04-21)
- 实现 4 个工具：`read_file` / `write_file` / `bash` / `glob` ✅
- 工具 schema + JSON Schema 校验（Zod，strict mode） ✅
- 单元测试覆盖每个工具（46 个测试，含安全策略 / 超时 / 危险命令检测） ✅
- 不可变 `ToolRegistry`（`from` / `withTool` / `dispatch` + 输入校验）

### Sprint 2：Agent Loop + TUI ✅ (2026-04-21)
- ReAct loop（带 tool_use / tool_result 多轮） ✅
  - `runAgent()` 返回 `AsyncGenerator<AgentEvent>`，事件：`step_start` / `text` / `tool_call` / `tool_result` / `tool_error` / `tool_denied` / `usage` / `done` / `error`
  - 可注入 `client` 进行测试（`AgentClient` 接口与 SDK 解耦）
  - 用户审批钩子 `approve(name, input, isDangerous)`，`--yes` 自动通过
- Ink TUI 骨架：消息流 + 工具调用着色 + 流式渲染 + footer 实时统计 ✅
- 步数上限 / token 计数 / 成本统计 ✅（PRD §6.3）
  - 默认：steps=10，tokens=100k，cost=$1.00，per-call timeout=120s
  - 内置 Anthropic 定价表（haiku/sonnet/opus）+ 子串回退
- 31 个新单测（agent loop / pricing / schema / parseArgs），总 77 个测试

**验收**：`nib "在 README 末尾加一行 Hello"` 可读取/写入/确认。
**Tag**: `v0.1-mvp`

### Sprint 2.5：REPL + UX 打磨 ✅ (2026-04-23)
- REPL 多轮对话 ✅
  - `runAgent` 接受 `messages: readonly Message[]` 历史，`done` 事件回传完整 `messages`
  - `prompt` 改为可选；裸 `nib` 直接进 REPL，`nib "..."` 跑一轮再进 REPL
  - 斜杠命令：`/exit` / `/quit` / `/clear`
  - `Ctrl+C` / `Ctrl+D` 退出
- TUI 改进 ✅
  - 工具调用 chip 默认折叠（`◌ name  preview`），`Ctrl+O` 切换为带 input/output 的卡片
  - assistant 文本块用 `marked` + `marked-terminal` 渲染为 ANSI 着色 markdown
  - 底部 `›` 输入框，状态行 `○ idle / ● running / ✓ done / ! limit_*`

**验收**：`nib` 进入 REPL，多轮接续上下文，`Ctrl+O` 即可看每个工具调用的完整 input/output。

---

## Phase 2 — 可用编辑体验 (Week 3–4)

### Sprint 3：精确编辑
- `edit_file`（精确字符串替换 + 唯一性校验）
- diff 渲染（红绿对比 + 行号）
- 多 hunk 拆分

### Sprint 4：交互式 Diff 审阅
- accept / reject / edit / split-hunk
- 多文件批量审阅
- 操作历史 + undo

**验收**：让 AI 重构一个 200 行文件，全程 diff 可见可控。
**Tag**: `v0.2-diff`

---

## Phase 3 — 上下文工程 (Week 5–6)

### Sprint 5：显式上下文
- `@file.ts` 引用
- `.nibignore`
- token 计数显示 + 预算上限

### Sprint 6：自动上下文
- git status / git diff 注入
- tree-sitter 提取相关符号
- ripgrep 关键词检索
- 相关性排序 + 截断策略

**验收**：在 10k 文件项目中提问 "`UserService` 怎么验证密码"，AI 自动找到相关代码。
**Tag**: `v0.3-context`

---

## Phase 4 — 自主性 (Week 7–8) ⭐ 最有价值的一步

### Sprint 7：自我修正循环
- 跑测试/构建 → 解析错误 → 喂回 LLM → 重试
- 失败模式分类（编译错 / 测试失败 / lint）
- 最大重试轮数 + 指数退避

### Sprint 8：斜杠命令 + Todo
- `/plan` `/test` `/review` `/commit` `/clear`
- 内置 TodoList 工具（让 AI 自己管理任务）
- 自举尝试：用 Nib 开发 Nib 一个新工具

**验收**：`nib "实现 LRU cache 并通过测试"`，AI 自动写代码 → 跑测试 → 修 bug → 提交。
**Tag**: `v0.4-autonomy`

---

## Phase 5 — Provider 抽象 + 持久化 (Week 9)

- LLM Provider 抽象层（Anthropic / OpenAI / Ollama）
- 各家 tool calling 格式适配器
- SQLite 会话持久化 + resume
- Token / 成本统计仪表盘（`/stats` 命令）

**Tag**: `v0.5-multimodel`

---

## Phase 6 — Harness 系统 (Week 10)

抄 Claude Code 的精髓：
- **Hooks**：`PreToolUse` / `PostToolUse` / `Stop`
- **Skills**：可复用 prompt 包（YAML frontmatter + markdown）
- **Subagents**：专用代理（reviewer / tester / planner）
- **项目级 `.nib/`**：rules / hooks / skills / agents

**验收**：能配置 "每次写完代码自动跑 prettier + eslint，失败则重试"。
**Tag**: `v0.6-harness`

---

## Phase 7 — MCP & 可观测性 (Week 11)

- MCP client：接入外部 MCP server
- Trace 系统：每个会话落 JSONL
- Replay 工具：从 trace 重放并重新评估
- 简易 Eval Harness：定义 task → 自动评分

**Tag**: `v0.7-mcp`

---

## Phase 8 — 打磨 + 复盘 (Week 12–13)

### Sprint 12：打磨
- bug 修复
- 文档完善（README + 架构图 + 教学博客）
- 性能优化（启动时间 / 首字节 / 大文件 diff）

### Sprint 13：发布 + 复盘
- 发布 v1.0（哪怕只有自己用）
- 写 13 周复盘长文（学到的 8 个核心能力）
- 录 demo 视频
- 规划 v2（如选差异化方向：Harness-First / 学习型 / TDD-First）

**Tag**: `v1.0`

---

## 关键风险与对策

| 风险 | 概率 | 对策 |
|---|---|---|
| Token 成本失控 | 高 | Phase 1 就做 token 计数 + Haiku 路由小任务 |
| 大文件 edit_file 字符串匹配失败 | 高 | diff 库 + LLM 重试 + 行号回退方案 |
| Agent loop 无限循环 | 中 | 硬性步数上限 + 人工中断 + 成本上限 |
| 多 provider tool calling 格式不一致 | 中 | 统一抽象层 + per-provider 适配器 |
| 范围蔓延 | 高 | 严守"不做清单"；每个 Sprint 只做一件事 |
| 失去动力 | 中 | 每个 Sprint 必须有可演示 demo + 写复盘 |

---

## 第一周具体动作清单

```
Day 1  写 PRD.md + ROADMAP.md + ARCH.md + CLAUDE.md
Day 2  bun init monorepo；接 Anthropic SDK；流式 hello world
Day 3  Ink TUI 骨架：输入框 + 消息列表 + 流式渲染
Day 4  实现 read_file / write_file / bash 三个工具 + agent loop
Day 5  端到端跑通："让 AI 在 README 加一行" 成功
Day 6  实现 edit_file + diff 渲染
Day 7  Sprint 1 复盘 + demo 录屏
```

---

## 自我评估卡（每个 Phase 末填写）

```
Phase: __
完成度（0–100%）: __
学到的核心能力（≥3）:
  1.
  2.
  3.
卡点 & 解决方式:
下一 Phase 是否需要调整：
```
