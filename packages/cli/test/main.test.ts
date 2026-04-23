import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { main } from "../src/main.tsx";

function captureStdout(): { restore: () => void; get: () => string } {
  const orig = process.stdout.write.bind(process.stdout);
  let buf = "";
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    buf += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stdout.write;
  return {
    restore: () => {
      process.stdout.write = orig;
    },
    get: () => buf,
  };
}

function captureStderr(): { restore: () => void; get: () => string } {
  const orig = process.stderr.write.bind(process.stderr);
  let buf = "";
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    buf += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stderr.write;
  return {
    restore: () => {
      process.stderr.write = orig;
    },
    get: () => buf,
  };
}

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

describe("@nib/cli main()", () => {
  it("prints version with --version", async () => {
    const out = captureStdout();
    try {
      const code = await main(["--version"]);
      expect(code).toBe(0);
      expect(out.get()).toMatch(/^nib v\d+\.\d+\.\d+/);
    } finally {
      out.restore();
    }
  });

  it("prints help with --help", async () => {
    const out = captureStdout();
    try {
      const code = await main(["--help"]);
      expect(code).toBe(0);
      expect(out.get()).toContain("Usage:");
      expect(out.get()).toContain("--models");
      expect(out.get()).toContain("NIB_MODEL_MAIN");
    } finally {
      out.restore();
    }
  });

  it("prints models map with --models", async () => {
    process.env["NIB_MODEL_HAIKU"] = "my-haiku";
    const out = captureStdout();
    try {
      const code = await main(["--models"]);
      expect(code).toBe(0);
      expect(out.get()).toMatch(/main\s+→/);
      expect(out.get()).toMatch(/haiku\s+→ my-haiku/);
    } finally {
      out.restore();
    }
  });

  it("rejects unknown flag", async () => {
    const err = captureStderr();
    try {
      const code = await main(["--bogus"]);
      expect(code).toBe(2);
      expect(err.get()).toMatch(/unknown option/);
    } finally {
      err.restore();
    }
  });
});
