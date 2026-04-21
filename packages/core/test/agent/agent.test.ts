import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { runAgent, type AgentClient, type AgentEvent } from "../../src/agent/agent.ts";
import { ToolRegistry } from "../../src/tools/registry.ts";
import type { Tool } from "../../src/tools/types.ts";

function makeMessage(
  content: readonly (
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  )[],
  stop_reason: "end_turn" | "tool_use" = "tool_use",
): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-5",
    content: content as unknown as Anthropic.ContentBlock[],
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: null, cache_read_input_tokens: null, server_tool_use: null, service_tier: null },
  } as Anthropic.Message;
}

const echoTool: Tool<{ message: string }, { echoed: string }> = {
  name: "echo",
  description: "echo input",
  schema: z.object({ message: z.string() }).strict(),
  execute: async (input) => ({ echoed: input.message }),
};

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe("runAgent", () => {
  test("single text turn → done", async () => {
    const client: AgentClient = {
      createMessage: async () =>
        makeMessage([{ type: "text", text: "hello world" }], "end_turn"),
    };
    const events = await collect(
      runAgent({
        prompt: "hi",
        registry: ToolRegistry.from([]),
        client,
      }),
    );
    expect(events.find((e) => e.kind === "text")).toMatchObject({ text: "hello world" });
    const done = events.find((e) => e.kind === "done");
    expect(done).toMatchObject({ reason: "stop" });
  });

  test("tool_use → tool_result → final stop", async () => {
    let call = 0;
    const client: AgentClient = {
      createMessage: async () => {
        call++;
        if (call === 1) {
          return makeMessage(
            [{ type: "tool_use", id: "tool_1", name: "echo", input: { message: "hi" } }],
            "tool_use",
          );
        }
        return makeMessage([{ type: "text", text: "done" }], "end_turn");
      },
    };
    const events = await collect(
      runAgent({
        prompt: "use echo",
        registry: ToolRegistry.from([echoTool]),
        client,
        autoApprove: true,
      }),
    );
    const calls = events.filter((e) => e.kind === "tool_call");
    const results = events.filter((e) => e.kind === "tool_result");
    expect(calls.length).toBe(1);
    expect(results.length).toBe(1);
    expect(events.at(-1)?.kind).toBe("done");
  });

  test("denied tool emits tool_denied and continues", async () => {
    let call = 0;
    const client: AgentClient = {
      createMessage: async () => {
        call++;
        if (call === 1) {
          return makeMessage(
            [{ type: "tool_use", id: "tool_1", name: "echo", input: { message: "hi" } }],
            "tool_use",
          );
        }
        return makeMessage([{ type: "text", text: "ok" }], "end_turn");
      },
    };
    const events = await collect(
      runAgent({
        prompt: "use echo",
        registry: ToolRegistry.from([echoTool]),
        client,
        approve: async () => false,
      }),
    );
    expect(events.some((e) => e.kind === "tool_denied")).toBe(true);
    expect(events.some((e) => e.kind === "tool_call")).toBe(false);
  });

  test("validation failure emits tool_error", async () => {
    let call = 0;
    const client: AgentClient = {
      createMessage: async () => {
        call++;
        if (call === 1) {
          return makeMessage(
            [{ type: "tool_use", id: "tool_1", name: "echo", input: { message: 123 } }],
            "tool_use",
          );
        }
        return makeMessage([{ type: "text", text: "ok" }], "end_turn");
      },
    };
    const events = await collect(
      runAgent({
        prompt: "bad input",
        registry: ToolRegistry.from([echoTool]),
        client,
        autoApprove: true,
      }),
    );
    const err = events.find((e) => e.kind === "tool_error");
    expect(err).toBeDefined();
  });

  test("respects maxSteps cap", async () => {
    const client: AgentClient = {
      createMessage: async () =>
        makeMessage(
          [{ type: "tool_use", id: `t${Math.random()}`, name: "echo", input: { message: "x" } }],
          "tool_use",
        ),
    };
    const events = await collect(
      runAgent({
        prompt: "loop",
        registry: ToolRegistry.from([echoTool]),
        client,
        autoApprove: true,
        limits: { maxSteps: 2 },
      }),
    );
    const done = events.find((e) => e.kind === "done");
    expect(done).toMatchObject({ reason: "limit_steps" });
    const stepStarts = events.filter((e) => e.kind === "step_start");
    expect(stepStarts.length).toBe(2);
  });

  test("aborted via signal yields done(aborted)", async () => {
    const controller = new AbortController();
    controller.abort();
    const client: AgentClient = { createMessage: async () => makeMessage([], "end_turn") };
    const events = await collect(
      runAgent({
        prompt: "x",
        registry: ToolRegistry.from([]),
        client,
        signal: controller.signal,
      }),
    );
    expect(events.at(-1)).toMatchObject({ kind: "done", reason: "aborted" });
  });

  test("emits usage events with cumulative cost", async () => {
    const client: AgentClient = {
      createMessage: async () => makeMessage([{ type: "text", text: "hi" }], "end_turn"),
    };
    const events = await collect(
      runAgent({
        prompt: "x",
        registry: ToolRegistry.from([]),
        client,
      }),
    );
    const usage = events.find((e) => e.kind === "usage");
    expect(usage).toBeDefined();
    if (usage?.kind === "usage") {
      expect(usage.inputTokens).toBe(10);
      expect(usage.outputTokens).toBe(5);
      expect(usage.cumulativeUSD).toBeGreaterThan(0);
    }
  });
});
