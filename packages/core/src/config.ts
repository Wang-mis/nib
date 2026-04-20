// Nib runtime config — model roles + provider endpoint.
//
// Roles:
//   main             — 日常对话/工具调用（活跃模型，可被任意切换）
//   reasoning        — 复杂规划/深度思考（thinking 模式）
//   default-haiku    — 廉价小任务/路由
//   default-sonnet   — 默认中等模型
//   default-opus     — 默认重型模型
//
// Resolution order (highest priority first):
//   1. explicit `modelOverride` passed to resolveModel()
//   2. env NIB_MODEL_<ROLE>   e.g. NIB_MODEL_MAIN, NIB_MODEL_REASONING,
//                                  NIB_MODEL_DEFAULT_HAIKU,
//                                  NIB_MODEL_DEFAULT_SONNET,
//                                  NIB_MODEL_DEFAULT_OPUS
//   3. built-in default
//
// Endpoint resolution:
//   1. explicit `baseURL`
//   2. env ANTHROPIC_BASE_URL
//   3. SDK default (https://api.anthropic.com)

export type ModelRole =
  | "main"
  | "reasoning"
  | "default-haiku"
  | "default-sonnet"
  | "default-opus";

export const MODEL_ROLES: readonly ModelRole[] = Object.freeze([
  "main",
  "reasoning",
  "default-haiku",
  "default-sonnet",
  "default-opus",
]);

export const DEFAULT_MODELS: Readonly<Record<ModelRole, string>> = Object.freeze({
  main: "claude-sonnet-4-5",
  reasoning: "claude-opus-4-5",
  "default-haiku": "claude-haiku-4-5",
  "default-sonnet": "claude-sonnet-4-5",
  "default-opus": "claude-opus-4-5",
});

const ROLE_ENV: Readonly<Record<ModelRole, string>> = Object.freeze({
  main: "NIB_MODEL_MAIN",
  reasoning: "NIB_MODEL_REASONING",
  "default-haiku": "NIB_MODEL_DEFAULT_HAIKU",
  "default-sonnet": "NIB_MODEL_DEFAULT_SONNET",
  "default-opus": "NIB_MODEL_DEFAULT_OPUS",
});

export function isModelRole(value: string): value is ModelRole {
  return (MODEL_ROLES as readonly string[]).includes(value);
}

export interface ResolveModelInput {
  role?: ModelRole;
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
