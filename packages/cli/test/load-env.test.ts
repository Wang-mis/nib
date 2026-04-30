import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadNibEnv, parseDotenv, loadEnvFile } from "../src/load-env.ts";

const KEYS = [
  "NIB_HOME",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "NIB_MODEL_MAIN",
  "NIB_TEST_VAR",
] as const;

let saved: Record<string, string | undefined> = {};
let tmp: string;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  tmp = mkdtempSync(join(tmpdir(), "nib-env-"));
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe("parseDotenv", () => {
  test("parses key=value lines", () => {
    expect(parseDotenv("A=1\nB=two\n")).toEqual({ A: "1", B: "two" });
  });
  test("ignores comments and blank lines", () => {
    expect(parseDotenv("# c\n\nA=1\n")).toEqual({ A: "1" });
  });
  test("strips matching surrounding quotes", () => {
    expect(parseDotenv('A="x y"\nB=\'z\'\n')).toEqual({ A: "x y", B: "z" });
  });
  test("ignores lines without '='", () => {
    expect(parseDotenv("just-a-line\nA=1\n")).toEqual({ A: "1" });
  });
});

describe("loadNibEnv", () => {
  test("loads ~/.nib/.env when present", () => {
    const home = join(tmp, ".nib");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, ".env"), "NIB_TEST_VAR=from-file\nANTHROPIC_API_KEY=sk-from-file\n");
    process.env["NIB_HOME"] = home;
    loadNibEnv();
    expect(process.env["NIB_TEST_VAR"]).toBe("from-file");
    expect(process.env["ANTHROPIC_API_KEY"]).toBe("sk-from-file");
  });

  test("does not overwrite existing process.env values", () => {
    const home = join(tmp, ".nib");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, ".env"), "ANTHROPIC_API_KEY=from-file\n");
    process.env["NIB_HOME"] = home;
    process.env["ANTHROPIC_API_KEY"] = "from-shell";
    loadNibEnv();
    expect(process.env["ANTHROPIC_API_KEY"]).toBe("from-shell");
  });

  test("strips surrounding quotes and ignores comments", () => {
    const home = join(tmp, ".nib");
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, ".env"),
      [
        "# a comment",
        "",
        'NIB_TEST_VAR="quoted value"',
        "ANTHROPIC_BASE_URL='https://x.example/v1'",
      ].join("\n"),
    );
    process.env["NIB_HOME"] = home;
    loadNibEnv();
    expect(process.env["NIB_TEST_VAR"]).toBe("quoted value");
    expect(process.env["ANTHROPIC_BASE_URL"]).toBe("https://x.example/v1");
  });

  test("no-op when file is missing", () => {
    process.env["NIB_HOME"] = join(tmp, "does-not-exist");
    loadNibEnv();
    expect(process.env["ANTHROPIC_API_KEY"]).toBeUndefined();
  });
});

describe("loadEnvFile", () => {
  test("no-op when path missing", () => {
    loadEnvFile(join(tmp, "nope.env"));
    expect(process.env["NIB_TEST_VAR"]).toBeUndefined();
  });
});
