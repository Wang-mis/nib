# Nib — 架构概览（占位）

> 详细架构将在 Phase 0 末完成。本文件用于在编码前固化关键决策。

## 目录结构（计划）

```
nib/
├── packages/
│   ├── core/          # Agent + Tools + Context + Providers
│   │   ├── src/
│   │   │   ├── agent/
│   │   │   ├── tools/
│   │   │   ├── context/
│   │   │   ├── providers/
│   │   │   └── index.ts
│   │   └── test/
│   ├── cli/           # Ink TUI
│   │   ├── src/
│   │   │   ├── components/
│   │   │   ├── commands/
│   │   │   └── main.tsx
│   │   └── bin/nib
│   └── shared/        # 类型 / utils
├── docs/
│   ├── PRD.md
│   ├── ROADMAP.md
│   └── ARCH.md
├── .nib/            # 自举：用自己开发自己
├── CLAUDE.md
├── package.json
└── README.md
```

## 关键接口（草案）

```ts
// Tool
interface Tool<I, O> {
  name: string;
  description: string;
  schema: JSONSchema;
  execute(input: I, ctx: ToolContext): Promise<O>;
  isDangerous?(input: I): boolean;
}

// Provider
interface LLMProvider {
  stream(messages: Message[], tools: Tool[]): AsyncIterable<Chunk>;
}

// Agent
interface Agent {
  run(prompt: string, opts: RunOptions): AsyncIterable<Event>;
}
```

## 数据流

```
User → CLI → Agent.run()
              │
              ├─→ ContextEngine.gather()
              ├─→ Provider.stream()
              ├─→ ToolRegistry.execute()  (loop)
              └─→ Events → CLI render
```

> TODO: Phase 0 末补充时序图、错误处理流、配置加载流。
