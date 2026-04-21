// Agent — ReAct loop. Streams events for the CLI/TUI to render.
// Hard caps on steps, tokens, cost, and timeout (PRD §6.3).
import Anthropic from "@anthropic-ai/sdk";
import { resolveModel, resolveProvider, type ModelRole } from "../config.ts";
import { ToolValidationError, type ToolContext } from "../tools/types.ts";
import type { ToolRegistry } from "../tools/registry.ts";
import { estimateCostUSD } from "./pricing.ts";
import { zodToJSONSchema } from "./schema.ts";

export interface AgentLimits {
  /** Max ReAct iterations (LLM call → tool exec). Default 10. */
  readonly maxSteps: number;
  /** Max input+output tokens cumulative. Default 100_000. */
  readonly maxTokens: number;
  /** Max estimated USD spend. Default 1.00. */
  readonly maxCostUSD: number;
  /** Per-call wall timeout in ms. Default 120_000. */
  readonly perCallTimeoutMs: number;
}

export const DEFAULT_LIMITS: AgentLimits = Object.freeze({
  maxSteps: 10,
  maxTokens: 100_000,
  maxCostUSD: 1.0,
  perCallTimeoutMs: 120_000,
});

export interface RunOptions {
  readonly prompt: string;
  readonly registry: ToolRegistry;
  readonly cwd?: string;
  readonly role?: ModelRole;
  readonly model?: string;
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly limits?: Partial<AgentLimits>;
  readonly signal?: AbortSignal;
  /** If true, all tool executions are auto-approved (DANGEROUS). Default false. */
  readonly autoApprove?: boolean;
  /** Called when a tool wants to execute. Return true to allow. Defaults to allow. */
  readonly approve?: (toolName: string, input: unknown, isDangerous: boolean) => Promise<boolean>;
  /** Test seam: inject a custom client. If set, `apiKey`/`baseURL` are ignored. */
  readonly client?: AgentClient;
}

/**
 * Minimal client surface the agent needs. Lets tests inject a fake without
 * pulling in the full Anthropic SDK.
 */
export interface AgentClient {
  createMessage(req: {
    model: string;
    messages: readonly Message[];
    tools: readonly Anthropic.Tool[];
    maxTokens: number;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<Anthropic.Message>;
}

export type AgentEvent =
  | { kind: "step_start"; step: number }
  | { kind: "text"; text: string }
  | { kind: "tool_call"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; id: string; name: string; output: unknown }
  | { kind: "tool_error"; id: string; name: string; message: string }
  | { kind: "tool_denied"; id: string; name: string }
  | { kind: "usage"; inputTokens: number; outputTokens: number; cumulativeUSD: number }
  | { kind: "done"; reason: "stop" | "limit_steps" | "limit_tokens" | "limit_cost" | "aborted" }
  | { kind: "error"; message: string };

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

interface TextBlock {
  type: "text";
  text: string;
}

type ContentBlock = ToolUseBlock | TextBlock;

interface AssistantMessage {
  role: "assistant";
  content: readonly ContentBlock[];
}

interface UserMessage {
  role: "user";
  content:
    | string
    | readonly { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }[];
}

type Message = AssistantMessage | UserMessage;

function defaultApprove(): Promise<boolean> {
  return Promise.resolve(true);
}

function buildToolDefs(registry: ToolRegistry): readonly Anthropic.Tool[] {
  return registry.list().map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: zodToJSONSchema(tool.schema) as Anthropic.Tool.InputSchema,
  }));
}

export async function* runAgent(opts: RunOptions): AsyncGenerator<AgentEvent> {
  const limits: AgentLimits = { ...DEFAULT_LIMITS, ...(opts.limits ?? {}) };
  const cwd = opts.cwd ?? process.cwd();
  const approve = opts.autoApprove ? defaultApprove : (opts.approve ?? defaultApprove);

  let client: AgentClient;
  if (opts.client) {
    client = opts.client;
  } else {
    let provider;
    try {
      provider = resolveProvider({ apiKey: opts.apiKey, baseURL: opts.baseURL });
    } catch (err) {
      yield { kind: "error", message: err instanceof Error ? err.message : String(err) };
      return;
    }
    const sdk = new Anthropic(provider);
    client = {
      createMessage: (req) =>
        sdk.messages.create(
          {
            model: req.model,
            max_tokens: req.maxTokens,
            messages: req.messages as unknown as Anthropic.MessageParam[],
            tools: req.tools as Anthropic.Tool[],
          },
          { signal: req.signal, timeout: req.timeoutMs },
        ),
    };
  }

  const model = resolveModel({ role: opts.role, modelOverride: opts.model });
  const tools = buildToolDefs(opts.registry);

  const messages: Message[] = [{ role: "user", content: opts.prompt } as UserMessage];

  let totalInput = 0;
  let totalOutput = 0;
  let totalUSD = 0;

  const ctx: ToolContext = { cwd, signal: opts.signal };

  for (let step = 1; step <= limits.maxSteps; step++) {
    if (opts.signal?.aborted) {
      yield { kind: "done", reason: "aborted" };
      return;
    }
    yield { kind: "step_start", step };

    let response: Anthropic.Message;
    try {
      response = await client.createMessage({
        model,
        maxTokens: 4096,
        messages,
        tools,
        timeoutMs: limits.perCallTimeoutMs,
        signal: opts.signal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (opts.signal?.aborted) {
        yield { kind: "done", reason: "aborted" };
        return;
      }
      yield { kind: "error", message };
      return;
    }

    totalInput += response.usage.input_tokens;
    totalOutput += response.usage.output_tokens;
    totalUSD += estimateCostUSD(model, response.usage.input_tokens, response.usage.output_tokens);
    yield {
      kind: "usage",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cumulativeUSD: totalUSD,
    };

    if (totalInput + totalOutput > limits.maxTokens) {
      yield { kind: "done", reason: "limit_tokens" };
      return;
    }
    if (totalUSD > limits.maxCostUSD) {
      yield { kind: "done", reason: "limit_cost" };
      return;
    }

    const blocks = response.content as readonly ContentBlock[];
    const toolUses: ToolUseBlock[] = [];
    for (const block of blocks) {
      if (block.type === "text" && block.text) {
        yield { kind: "text", text: block.text };
      } else if (block.type === "tool_use") {
        toolUses.push(block);
      }
    }

    messages.push({ role: "assistant", content: blocks });

    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      yield { kind: "done", reason: "stop" };
      return;
    }

    const toolResults: {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }[] = [];

    for (const use of toolUses) {
      const tool = opts.registry.get(use.name);
      const isDangerous = tool?.isDangerous?.(use.input) ?? false;
      const allowed = opts.autoApprove
        ? true
        : await approve(use.name, use.input, isDangerous);

      if (!allowed) {
        yield { kind: "tool_denied", id: use.id, name: use.name };
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: `tool '${use.name}' execution denied by user`,
          is_error: true,
        });
        continue;
      }

      yield { kind: "tool_call", id: use.id, name: use.name, input: use.input };
      try {
        const output = await opts.registry.dispatch(use.name, use.input, ctx);
        yield { kind: "tool_result", id: use.id, name: use.name, output };
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: serializeToolOutput(output),
        });
      } catch (err) {
        const message =
          err instanceof ToolValidationError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        yield { kind: "tool_error", id: use.id, name: use.name, message };
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: message,
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  yield { kind: "done", reason: "limit_steps" };
}

function serializeToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}
