// @nib/core entry — Agent loop, Tool Registry, Context Engine, LLM Provider abstraction.
// Phase 0: only the streaming Anthropic shim is wired.
export const VERSION = "0.0.1";
export { streamAnthropic } from "./providers/anthropic.ts";
export type { StreamOptions, StreamEvent } from "./providers/anthropic.ts";
