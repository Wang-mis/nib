// @nib/core entry — Agent loop, Tool Registry, Context Engine, LLM Provider abstraction.
// Phase 0: streaming Anthropic shim + config helpers.
export const VERSION = "0.0.1";

export { streamAnthropic } from "./providers/anthropic.ts";
export type { StreamOptions, StreamEvent } from "./providers/anthropic.ts";

export {
  DEFAULT_MODELS,
  MODEL_ROLES,
  envVarForRole,
  isModelRole,
  resolveModel,
  resolveProvider,
} from "./config.ts";
export type {
  ModelRole,
  ProviderConfig,
  ResolveModelInput,
  ResolveProviderInput,
} from "./config.ts";
