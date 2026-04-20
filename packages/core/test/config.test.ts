import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  DEFAULT_MODELS,
  MODEL_ROLES,
  envVarForRole,
  isModelRole,
  resolveModel,
  resolveProvider,
} from "../src/config.ts";

const ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "NIB_MODEL_MAIN",
  "NIB_MODEL_REASONING",
  "NIB_MODEL_HAIKU",
  "NIB_MODEL_SONNET",
  "NIB_MODEL_OPUS",
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("isModelRole", () => {
  it("accepts every role in MODEL_ROLES", () => {
    for (const r of MODEL_ROLES) expect(isModelRole(r)).toBe(true);
  });
  it("rejects unknown values", () => {
    expect(isModelRole("default-haiku")).toBe(false);
    expect(isModelRole("planner")).toBe(false);
    expect(isModelRole("")).toBe(false);
  });
});

describe("envVarForRole", () => {
  it("uppercases the role name", () => {
    expect(envVarForRole("main")).toBe("NIB_MODEL_MAIN");
    expect(envVarForRole("reasoning")).toBe("NIB_MODEL_REASONING");
    expect(envVarForRole("haiku")).toBe("NIB_MODEL_HAIKU");
    expect(envVarForRole("sonnet")).toBe("NIB_MODEL_SONNET");
    expect(envVarForRole("opus")).toBe("NIB_MODEL_OPUS");
  });
});

describe("resolveModel", () => {
  it("returns built-in default for each role", () => {
    for (const r of MODEL_ROLES) {
      expect(resolveModel({ role: r })).toBe(DEFAULT_MODELS[r]);
    }
  });
  it("modelOverride wins over env and default", () => {
    process.env["NIB_MODEL_MAIN"] = "from-env";
    expect(resolveModel({ role: "main", modelOverride: "explicit" })).toBe("explicit");
  });
  it("env NIB_MODEL_<ROLE> overrides default", () => {
    process.env["NIB_MODEL_REASONING"] = "my-opus";
    process.env["NIB_MODEL_HAIKU"] = "my-haiku";
    expect(resolveModel({ role: "reasoning" })).toBe("my-opus");
    expect(resolveModel({ role: "haiku" })).toBe("my-haiku");
  });
  it("default role is 'main'", () => {
    process.env["NIB_MODEL_MAIN"] = "main-x";
    expect(resolveModel()).toBe("main-x");
  });
});

describe("resolveProvider", () => {
  it("throws when no API key", () => {
    expect(() => resolveProvider()).toThrow(/ANTHROPIC_API_KEY/);
  });
  it("uses env API key", () => {
    process.env["ANTHROPIC_API_KEY"] = "k1";
    expect(resolveProvider()).toEqual({ apiKey: "k1" });
  });
  it("explicit apiKey wins", () => {
    process.env["ANTHROPIC_API_KEY"] = "env";
    expect(resolveProvider({ apiKey: "explicit" })).toEqual({ apiKey: "explicit" });
  });
  it("includes baseURL when env is set", () => {
    process.env["ANTHROPIC_API_KEY"] = "k";
    process.env["ANTHROPIC_BASE_URL"] = "https://proxy.example/v1";
    expect(resolveProvider()).toEqual({ apiKey: "k", baseURL: "https://proxy.example/v1" });
  });
  it("explicit baseURL wins over env", () => {
    process.env["ANTHROPIC_API_KEY"] = "k";
    process.env["ANTHROPIC_BASE_URL"] = "https://env";
    expect(resolveProvider({ baseURL: "https://explicit" })).toEqual({
      apiKey: "k",
      baseURL: "https://explicit",
    });
  });
});
