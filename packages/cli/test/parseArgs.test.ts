import { describe, expect, test } from "bun:test";
import { parseArgs } from "../src/main.tsx";

describe("parseArgs", () => {
  test("plain prompt", () => {
    const a = parseArgs(["hello", "world"]);
    expect(a.prompt).toBe("hello world");
    expect(a.legacy).toBeUndefined();
    expect(a.autoApprove).toBeUndefined();
  });

  test("--legacy sets legacy mode", () => {
    const a = parseArgs(["--legacy", "ping"]);
    expect(a.legacy).toBe(true);
    expect(a.prompt).toBe("ping");
  });

  test("--yes / -y sets autoApprove", () => {
    expect(parseArgs(["--yes", "x"]).autoApprove).toBe(true);
    expect(parseArgs(["-y", "x"]).autoApprove).toBe(true);
  });

  test("--max-steps parses positive int", () => {
    const a = parseArgs(["--max-steps", "3", "go"]);
    expect(a.maxSteps).toBe(3);
    expect(a.prompt).toBe("go");
  });

  test("--max-steps without value errors", () => {
    const a = parseArgs(["--max-steps"]);
    expect(a.error).toMatch(/positive integer/);
  });

  test("--max-steps with non-int errors", () => {
    const a = parseArgs(["--max-steps", "abc"]);
    expect(a.error).toMatch(/positive integer/);
  });

  test("--max-steps with zero errors", () => {
    const a = parseArgs(["--max-steps", "0"]);
    expect(a.error).toMatch(/positive integer/);
  });

  test("unknown option captured as error", () => {
    const a = parseArgs(["--nope"]);
    expect(a.error).toMatch(/unknown option/);
  });

  test("combined flags", () => {
    const a = parseArgs(["--yes", "--max-steps", "5", "do", "the", "thing"]);
    expect(a.autoApprove).toBe(true);
    expect(a.maxSteps).toBe(5);
    expect(a.prompt).toBe("do the thing");
  });
});
