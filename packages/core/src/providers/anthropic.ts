// Minimal Anthropic streaming provider — Phase 0 hello world.
// Phase 5 will replace this with a real Provider abstraction (Anthropic / OpenAI / Ollama).
import Anthropic from "@anthropic-ai/sdk";

export interface StreamOptions {
  prompt: string;
  model?: string;
  maxTokens?: number;
  apiKey?: string;
  signal?: AbortSignal;
}

export interface StreamEvent {
  kind: "text" | "done" | "error";
  text?: string;
  error?: Error;
}

const DEFAULT_MODEL = "claude-sonnet-4-5";
const DEFAULT_MAX_TOKENS = 1024;

export async function* streamAnthropic(opts: StreamOptions): AsyncGenerator<StreamEvent> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    yield {
      kind: "error",
      error: new Error("ANTHROPIC_API_KEY is not set. Export it or pass apiKey."),
    };
    return;
  }

  const client = new Anthropic({ apiKey });
  try {
    const stream = client.messages.stream({
      model: opts.model ?? DEFAULT_MODEL,
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
