// @nib/core entry — Agent loop, Tool Registry, Context Engine, LLM Provider abstraction.
export const VERSION = "0.0.1";

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

// Tools (Phase 1 Sprint 1)
export {
  ToolRegistry,
  defaultRegistry,
  ToolNotFoundError,
  ToolValidationError,
  readFileTool,
  writeFileTool,
  bashTool,
  globTool,
  readFileSchema,
  writeFileSchema,
  bashSchema,
  globSchema,
} from "./tools/index.ts";
export type {
  Tool,
  ToolContext,
  AnyTool,
  ReadFileInput,
  ReadFileOutput,
  WriteFileInput,
  WriteFileOutput,
  BashInput,
  BashOutput,
  GlobInput,
  GlobOutput,
} from "./tools/index.ts";

// Agent (Phase 1 Sprint 2)
export { runAgent, DEFAULT_LIMITS, estimateCostUSD, zodToJSONSchema } from "./agent/index.ts";
export type { AgentEvent, AgentLimits, RunOptions, Message } from "./agent/index.ts";
