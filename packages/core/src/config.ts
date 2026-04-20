// Nib runtime config — model roles + provider endpoint.
//
// Roles (selected per-task by callers, not at CLI startup):
//   main       — 日常对话/工具调用（默认；未指定时回退到此）
//   reasoning  — 复杂规划/深度思考
//   haiku      — 廉价小任务/路由
//   sonnet     — 中等模型
//   opus       — 重型模型
//
// A skill / subagent / tool can request a specific role in its metadata
// (e.g. `model: haiku`). If it doesn't, callers should default to "main".
//
// Resolution order (highest priority first):
//   1. explicit `modelOverride` passed to resolveModel()
//   2. env NIB_MODEL_<ROLE>   e.g. NIB_MODEL_MAIN, NIB_MODEL_REASONING,
//                                  NIB_MODEL_HAIKU, NIB_MODEL_SONNET, NIB_MODEL_OPUS
//   3. built-in default
//
// Endpoint resolution:
//   1. explicit `baseURL`
//   2. env ANTHROPIC_BASE_URL
//   3. SDK default (https://api.anthropic.com)

export type ModelRole = "main" | "reasoning" | "haiku" | "sonnet" | "opus";

export const MODEL_ROLES: readonly ModelRole[] = Object.freeze([
  "main",
  "reasoning",
  "haiku",
  "sonnet",
  "opus",
]);

export const DEFAULT_MODELS: Readonly<Record<ModelRole, string>> = Object.freeze({
  main: "claude-sonnet-4-5",
  reasoning: "claude-opus-4-5",
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-5",
  opus: "claude-opus-4-5",
});

const ROLE_ENV: Readonly<Record<ModelRole, string>> = Object.freeze({
  main: "NIB_MODEL_MAIN",
  reasoning: "NIB_MODEL_REASONING",
  haiku: "NIB_MODEL_HAIKU",
  sonnet: "NIB_MODEL_SONNET",
  opus: "NIB_MODEL_OPUS",
});

export function isModelRole(value: string): value is ModelRole {
  return (MODEL_ROLES as readonly string[]).includes(value);
}

export interface ResolveModelInput {
  /** Role requested by the caller. Defaults to "main". */
  role?: ModelRole;
  /** Explicit model id; bypasses role resolution. */
  modelOverride?: string;
}

/** Resolve concrete model id from role or explicit override. */
export function resolveModel({ role = "main", modelOverride }: ResolveModelInput = {}): string {
  if (modelOverride) return modelOverride;
  const fromEnv = process.env[ROLE_ENV[role]];
  if (fromEnv) return fromEnv;
  return DEFAULT_MODELS[role];
}

/** Returns the env var name that controls a given role. */
export function envVarForRole(role: ModelRole): string {
  return ROLE_ENV[role];
}

export interface ProviderConfig {
  apiKey: string;
  baseURL?: string;
}

export interface ResolveProviderInput {
  apiKey?: string;
  baseURL?: string;
}

/** Resolve API key + base URL. Throws if API key is missing. */
export function resolveProvider({ apiKey, baseURL }: ResolveProviderInput = {}): ProviderConfig {
  const key = apiKey ?? process.env["ANTHROPIC_API_KEY"];
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY is not set. Export it or pass apiKey.");
  }
  const url = baseURL ?? process.env["ANTHROPIC_BASE_URL"];
  return url ? { apiKey: key, baseURL: url } : { apiKey: key };
}
