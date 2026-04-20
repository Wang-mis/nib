# Nib — Product Requirements Document

> "Nib" — 笔尖。最小、最锋利的写作工具。
> 一个为"亲手造一遍 Claude Code 来理解 AI 编程"而存在的学习型项目。

---

## 0. 项目定位

**一句话**：一个本地优先、终端形态的 AI 编程助手，作为 vibe coding 方法论的训练靶场。

**核心目的**：**学习为主**。
- 不追求超越 Claude Code 的功能
- 不追求商业化
- 追求"自己理解每一行代码"
- 追求"完整跑通一次 Agent 工程的全链路"

**非目标**：
- ❌ 不打算成为 Claude Code / Cursor / Aider 的替代品
- ❌ 不追求性能极限
- ❌ 不为他人维护稳定性

---

## 1. 目标用户

仅一人：**作者本人**（dogfooding-only）。

成功标准：在第 8 周起，能用 Nib 开发 Nib 自己（自举）。

---

## 2. 核心场景（按优先级）

| P | 场景 | 验收 |
|---|---|---|
| P0 | `nib` 进入交互式终端，对话式让 AI 修改文件 | AI 能正确读/改/创建文件 |
| P0 | AI 提议 diff，我审阅后接受/拒绝 | 类似 git add -p 的体验 |
| P0 | AI 主动跑测试/构建并基于错误自我修正 | 一次 prompt 后能自动通过测试 |
| P1 | `/commands`：`/test` `/review` `/plan` `/commit` | 可扩展 |
| P1 | 上下文文件管理（@file 引用、自动检索相关文件） | 大型项目可用 |
| P1 | Token / 成本统计 + 流式输出 | 实时反馈 |
| P2 | Hooks（Pre/PostToolUse、Stop） | 抄 Claude Code |
| P2 | Skills（可复用 prompt 包） | 抄 Claude Code |
| P2 | Subagents（专用代理：reviewer/tester） | 抄 Claude Code |
| P3 | 多 Provider（OpenAI / Ollama） | 学习抽象层 |
| P3 | MCP 协议接入 | 学习生态协议 |

---

## 3. 非功能需求

| 类别 | 要求 |
|---|---|
| 性能 | 首字节 < 1s；diff 应用 < 100ms |
| 安全 | 危险命令需用户确认；秘钥不入日志 |
| 可观测 | 全程 trace 落盘（JSONL），可重放 |
| 跨平台 | Windows (WSL) / macOS / Linux |
| 部署 | 单一可执行 + `bun install -g` |

---

## 4. 技术决策

| 决策 | 选型 | 理由 |
|---|---|---|
| 语言 | **TypeScript + Bun** | TS 生态丰富、AI 训练充分；Bun 启动快、内置 test |
| TUI 框架 | **Ink** (React for CLI) | Claude Code 同款，组件化好上手 |
| LLM SDK | `@anthropic-ai/sdk`（首选） | 主模型 Claude Sonnet 4.6 |
| Diff | `diff` + `diff-match-patch` | 成熟库 |
| AST | **tree-sitter** | 多语言增量解析 |
| 检索 | tree-sitter + ripgrep + (可选) sqlite-vec | 混合检索 |
| 配置 | `~/.nib/config.json` + 项目 `.nib/` | 类 Claude Code |
| 测试 | Bun test | 内置、快 |
| 持久化 | SQLite (Bun 内置) | 会话 / trace |

---

## 5. 系统架构（高层）

```
┌──────────────────────────────────────────────┐
│              TUI (Ink)                        │
└──────────────────┬───────────────────────────┘
                   │
┌──────────────────▼───────────────────────────┐
│              Agent Core                       │
│  ┌────────┐ ┌──────────┐ ┌──────────────┐   │
│  │ Planner│ │ Executor │ │ Self-Critic  │   │
│  └────────┘ └──────────┘ └──────────────┘   │
│  ┌──────────────────────────────────────┐   │
│  │  Tool Registry                       │   │
│  │  read/write/edit/bash/glob/grep/...  │   │
│  └──────────────────────────────────────┘   │
│  ┌──────────────────────────────────────┐   │
│  │  Context Engine                      │   │
│  │  rg + tree-sitter + git + (vec)      │   │
│  └──────────────────────────────────────┘   │
│  ┌──────────────────────────────────────┐   │
│  │  LLM Provider Abstraction            │   │
│  └──────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
                   │
              Anthropic API
```

---

## 6. 核心模块拆解

### 6.1 Tool Registry

最小工具集（MVP）：
- `read_file(path, offset?, limit?)`
- `write_file(path, content)` — 大改用
- `edit_file(path, old, new, replace_all?)` — 小改用，节省 token
- `bash(cmd, timeout?, background?)`
- `glob(pattern)`
- `grep(pattern, path?)`
- `list_dir(path)`
- `apply_patch(diff)` — 多文件原子修改（Phase 4+）

### 6.2 Context Engine

分层检索：
1. **显式** `@file.ts` 用户指定
2. **最近编辑**（git status / git diff）
3. **结构化**（tree-sitter 提取相关函数/类）
4. **关键词**（ripgrep 全文）
5. **语义**（embeddings，可选，Phase 5+）

### 6.3 Agent Loop

```
while not done and steps < MAX_STEPS:
    response = LLM(messages + tools_spec)
    if response.tool_calls:
        for call in response.tool_calls:
            if is_dangerous(call): require_user_approval()
            results.append(execute(call))
        messages.append(results)
    else:
        return response.text
```

硬约束：步数上限、token 上限、成本上限、超时上限。

### 6.4 Diff Review UX

```
─── src/auth.ts ──────────────────────────
- function login(user) {
+ function login(user, password) {
+   if (!password) throw new Error(...)
    ...
─────────────────────────────────────────
[a]ccept  [r]eject  [e]dit  [s]plit  [?]help
```

---

## 7. 安全护栏

| 类别 | 措施 |
|---|---|
| 危险命令 | `rm -rf` / `git push --force` / `curl \| sh` 必须确认 |
| 写文件 | 默认 dry-run；patch 模式需确认 |
| 沙箱模式 | `--sandbox` 禁用所有 bash |
| 秘钥 | `.env` / `*credentials*` 默认拒读 |
| 网络 | 工具调用网络需白名单 |

---

## 8. 成功指标

仅自我评估，无外部 KPI：

- [ ] **Week 5**：能让 AI 在自己的代码里加一个工具并通过测试
- [ ] **Week 8**：用 Nib 开发 Nib 自身（自举）
- [ ] **Week 13**：累计自己使用 ≥ 50 次真实编程任务
- [ ] **过程性**：每个 Sprint 写一篇博客复盘

---

## 9. 关键学习目标（这才是 PRD 的灵魂）

通过这个项目，目标掌握：

1. **Agent 工程**：tool calling、ReAct loop、self-correction
2. **Context 工程**：检索策略、token 预算、相关性排序
3. **LLM 应用架构**：provider 抽象、流式、错误处理、重试
4. **TUI 工程**：Ink/React、键盘事件、流式渲染
5. **Diff 与 Patch**：字符串匹配、AST 编辑、冲突处理
6. **Harness 工程**：hooks、skills、subagents 的设计哲学
7. **可观测性**：trace、replay、eval
8. **协议设计**：MCP、JSON-RPC（后期）

---

## 10. 不做清单（YAGNI）

明确**不做**的东西，避免范围爆炸：
- ❌ VSCode 插件
- ❌ Web UI
- ❌ 团队协作
- ❌ 自托管部署
- ❌ 计费 / 用户系统
- ❌ 国际化
- ❌ 移动端
- ❌ 复杂权限系统

---

## 附录 A：必读参照

1. **Aider** (Python) — diff 策略鼻祖
2. **Cline** (TS, VSCode) — Agent loop 工程化
3. **gptme** — 极简终端 Agent
4. **OpenCode / Crush** — Claude Code 的开源克隆
5. Anthropic *"Building effective agents"* 博客
6. Aider *Edit Format* 系列博客
7. Anthropic *Claude Code Best Practices*
