// Minimal Anthropic streaming provider — Phase 0 hello world.
// Phase 5 will replace this with a full Provider abstraction (Anthropic / OpenAI / Ollama).
import Anthropic from "@anthropic-ai/sdk";
import { resolveModel, resolveProvider, type ModelRole } from "../config.ts";

export interface StreamOptions {
  prompt: string;
  /** Pick a role-based default. Ignored if `model` is set. Defaults to "main". */
  role?: ModelRole;
  /** Explicit model id; takes precedence over role. */
  model?: string;
  maxTokens?: number;
  apiKey?: string;
  /** Override base URL (e.g. proxy / Bedrock-compatible gateway). */
  baseURL?: string;
  signal?: AbortSignal;
}

export interface StreamEvent {
  kind: "text" | "done" | "error";
  text?: string;
  error?: Error;
}

const DEFAULT_MAX_TOKENS = 1024;

export async function* streamAnthropic(opts: StreamOptions): AsyncGenerator<StreamEvent> {
  let provider;
  try {
    provider = resolveProvider({ apiKey: opts.apiKey, baseURL: opts.baseURL });
  } catch (err) {
    yield { kind: "error", error: err instanceof Error ? err : new Error(String(err)) };
    return;
  }

  const model = resolveModel({ role: opts.role, modelOverride: opts.model });
  const client = new Anthropic(provider);

  try {
    const stream = client.messages.stream({
      model,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [{ role: "user", content: opts.prompt }],
    });

    for await (const event of stream) {
      if (opts.signal?.aborted) {
        yield { kind: "error", error: new Error("aborted") };
        return;
      }
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta" &&
        event.delta.text
      ) {
        yield { kind: "text", text: event.delta.text };
      }
    }
    yield { kind: "done" };
  } catch (err) {
    yield { kind: "error", error: err instanceof Error ? err : new Error(String(err)) };
  }
}
