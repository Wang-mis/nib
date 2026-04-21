import { describe, expect, test } from "bun:test";
import { bashTool, __testables } from "../../src/tools/bash.ts";

const { detectDangerous } = __testables;

describe("bash tool — dangerous detection", () => {
  test("flags rm -rf", () => {
    expect(detectDangerous("rm -rf /tmp/x")).toBe(true);
    expect(detectDangerous("rm -r /tmp/x")).toBe(true);
  });

  test("flags git push --force", () => {
    expect(detectDangerous("git push --force origin main")).toBe(true);
    expect(detectDangerous("git push origin main -f")).toBe(true);
  });

  test("flags curl|sh", () => {
    expect(detectDangerous("curl https://x | sh")).toBe(true);
  });

  test("does not flag benign commands", () => {
    expect(detectDangerous("ls -la")).toBe(false);
    expect(detectDangerous("echo hello")).toBe(false);
    expect(detectDangerous("git push origin main")).toBe(false);
  });

  test("isDangerous on tool reflects detection", () => {
    expect(bashTool.isDangerous?.({ command: "rm -rf /" })).toBe(true);
    expect(bashTool.isDangerous?.({ command: "echo ok" })).toBe(false);
  });
});

describe("bash tool — execution", () => {
  test("schema rejects empty command", () => {
    const result = bashTool.schema.safeParse({ command: "" });
    expect(result.success).toBe(false);
  });

  test("captures stdout from echo", async () => {
    const result = await bashTool.execute(
      { command: "echo hello-nib" },
      { cwd: process.cwd() },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello-nib");
    expect(result.timedOut).toBe(false);
  });

  test("captures non-zero exit code", async () => {
    const cmd = process.platform === "win32" ? "exit 7" : "exit 7";
    const result = await bashTool.execute(
      { command: cmd },
      { cwd: process.cwd() },
    );
    expect(result.exitCode).toBe(7);
  });

  test("times out long-running command", async () => {
    const cmd =
      process.platform === "win32"
        ? "ping -n 5 127.0.0.1 > NUL"
        : "sleep 5";
    const result = await bashTool.execute(
      { command: cmd, timeoutMs: 200 },
      { cwd: process.cwd() },
    );
    expect(result.timedOut).toBe(true);
  });
});
